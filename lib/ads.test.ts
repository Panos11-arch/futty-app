import { renderHook, waitFor } from '@testing-library/react-native';

import {
  AD_REQUEST_OPTIONS,
  AD_SETTINGS_TTL_MS,
  BANNER_IDS,
  adsSupported,
  bannerUnitId,
  getAdSettings,
  isLiveAdsBuild,
  prepareAds,
  resetAdsForTesting,
  useAdsReady,
} from './ads';

const mockGather = jest.fn();
const mockInfo = jest.fn();
const mockInitialize = jest.fn();
const mockSetConfig = jest.fn();
const mockRpc = jest.fn();
const mockSession = jest.fn();

jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({
    initialize: () => mockInitialize(),
    setRequestConfiguration: (c: unknown) => mockSetConfig(c),
  }),
  AdsConsent: {
    gatherConsent: (o: unknown) => mockGather(o),
    getConsentInfo: () => mockInfo(),
  },
  TestIds: { ADAPTIVE_BANNER: 'google-test-adaptive-banner' },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    auth: { getSession: () => mockSession() },
  },
}));

const signedIn = (id: string) => mockSession.mockResolvedValue({ data: { session: { user: { id } } } });

beforeEach(() => {
  jest.clearAllMocks();
  resetAdsForTesting();
  mockGather.mockResolvedValue({ canRequestAds: true });
  mockInfo.mockResolvedValue({ canRequestAds: true });
  mockInitialize.mockResolvedValue([]);
  mockSetConfig.mockResolvedValue(undefined);
  signedIn('me');
  mockRpc.mockResolvedValue({ data: { ads_allowed: true, under_age: false }, error: null });
});

describe('prepareAds', () => {
  it("asks Google's consent form first (shown only where it's needed, e.g. the EU), then starts the SDK", async () => {
    expect(await prepareAds({ underAge: false })).toEqual({ canRequestAds: true });
    expect(mockGather).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockGather.mock.invocationCallOrder[0]).toBeLessThan(mockInitialize.mock.invocationCallOrder[0]);
  });

  it('no consent: the SDK is not started and no ad may be requested', async () => {
    mockInfo.mockResolvedValue({ canRequestAds: false });
    expect(await prepareAds({ underAge: false })).toEqual({ canRequestAds: false });
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('the consent form failing (offline): still uses any consent already given, as Google advises', async () => {
    mockGather.mockRejectedValue(new Error('offline'));
    expect(await prepareAds({ underAge: false })).toEqual({ canRequestAds: true });
    expect(mockInitialize).toHaveBeenCalled();
  });

  it('the SDK failing to start: no ads, never a crash', async () => {
    mockInitialize.mockRejectedValue(new Error('boom'));
    expect(await prepareAds({ underAge: false })).toEqual({ canRequestAds: false });
  });

  it("under 18: AdMob's under-age setting on every request and on the consent form, before anything loads", async () => {
    await prepareAds({ underAge: true });
    expect(mockSetConfig).toHaveBeenCalledWith({ tagForUnderAgeOfConsent: true });
    expect(mockGather).toHaveBeenCalledWith({ tagForUnderAgeOfConsent: true });
    expect(mockSetConfig.mock.invocationCallOrder[0]).toBeLessThan(mockGather.mock.invocationCallOrder[0]);
    expect(mockSetConfig.mock.invocationCallOrder[0]).toBeLessThan(mockInitialize.mock.invocationCallOrder[0]);
  });

  it('adults: the under-age setting is switched off explicitly (a minor may have used the phone before)', async () => {
    await prepareAds({ underAge: false });
    expect(mockSetConfig).toHaveBeenCalledWith({ tagForUnderAgeOfConsent: false });
    expect(mockGather).toHaveBeenCalledWith({ tagForUnderAgeOfConsent: false });
  });

  it('the under-age setting failing to apply: no ads at all, never an untagged minor', async () => {
    mockSetConfig.mockRejectedValue(new Error('native'));
    expect(await prepareAds({ underAge: true })).toEqual({ canRequestAds: false });
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('every ad request is non-personalised, for every age (so no App Tracking Transparency prompt is needed)', () => {
    expect(AD_REQUEST_OPTIONS).toEqual({ requestNonPersonalizedAdsOnly: true });
  });
});

describe('getAdSettings (my_ad_settings, from the server)', () => {
  it('reads the signed-in player’s settings, sending nothing', async () => {
    expect(await getAdSettings()).toEqual({ adsAllowed: true, underAge: false });
    expect(mockRpc).toHaveBeenCalledWith('my_ad_settings');
  });

  it('Premium Plus: ads not allowed', async () => {
    mockRpc.mockResolvedValue({ data: { ads_allowed: false, under_age: false }, error: null });
    expect(await getAdSettings()).toEqual({ adsAllowed: false, underAge: false });
  });

  it('a minor: under age', async () => {
    mockRpc.mockResolvedValue({ data: { ads_allowed: true, under_age: true }, error: null });
    expect(await getAdSettings()).toEqual({ adsAllowed: true, underAge: true });
  });

  it('an answer without under_age counts as under age; without ads_allowed, as no ads', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    expect(await getAdSettings()).toEqual({ adsAllowed: false, underAge: true });
  });

  it('signed out: null, and the server is not asked', async () => {
    mockSession.mockResolvedValue({ data: { session: null } });
    expect(await getAdSettings()).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('a server error or a throw: null (no ads), never a crash', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await getAdSettings()).toBeNull();
    mockRpc.mockRejectedValue(new Error('offline'));
    expect(await getAdSettings()).toBeNull();
    mockSession.mockRejectedValue(new Error('storage'));
    expect(await getAdSettings()).toBeNull();
  });

  it('asks once per player for a minute (many banners on one screen), then again', async () => {
    await Promise.all([getAdSettings(1_000), getAdSettings(1_000), getAdSettings(1_000)]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await getAdSettings(1_000 + AD_SETTINGS_TTL_MS - 1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    mockRpc.mockResolvedValue({ data: { ads_allowed: false, under_age: false }, error: null });
    expect(await getAdSettings(1_000 + AD_SETTINGS_TTL_MS)).toEqual({ adsAllowed: false, underAge: false });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(AD_SETTINGS_TTL_MS).toBe(60_000);
  });

  it('another player signing in on the same phone is asked about straight away', async () => {
    await getAdSettings(1_000);
    signedIn('someone-else');
    mockRpc.mockResolvedValue({ data: { ads_allowed: true, under_age: true }, error: null });
    expect(await getAdSettings(1_001)).toEqual({ adsAllowed: true, underAge: true });
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('a failed read is not remembered', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await getAdSettings(1_000)).toBeNull();
    expect(await getAdSettings(1_001)).toEqual({ adsAllowed: true, underAge: false });
  });
});

describe('banner IDs', () => {
  it('development, preview and test builds: Google’s test banner, so we never click our own ads', () => {
    expect(bannerUnitId('ios', false)).toBe('google-test-adaptive-banner');
    expect(bannerUnitId('android', false)).toBe('google-test-adaptive-banner');
  });

  it('production builds: Futty’s real banner for each platform', () => {
    expect(bannerUnitId('ios', true)).toBe('ca-app-pub-2436288039660225/6579627774');
    expect(bannerUnitId('android', true)).toBe('ca-app-pub-2436288039660225/3376034886');
    expect(BANNER_IDS).toEqual({
      ios: 'ca-app-pub-2436288039660225/6579627774',
      android: 'ca-app-pub-2436288039660225/3376034886',
    });
  });

  it('only a release build on the production channel is live', () => {
    expect(isLiveAdsBuild({ dev: false, channel: 'production' })).toBe(true);
    expect(isLiveAdsBuild({ dev: true, channel: 'production' })).toBe(false);
    expect(isLiveAdsBuild({ dev: false, channel: 'preview' })).toBe(false);
    expect(isLiveAdsBuild({ dev: false, channel: 'development' })).toBe(false);
    expect(isLiveAdsBuild({ dev: false, channel: null })).toBe(false);
  });
});

describe('adsSupported', () => {
  it('iPhone and Android only, never in the e2e build (Maestro journeys stay steady)', () => {
    expect(adsSupported({ os: 'ios', e2e: undefined })).toBe(true);
    expect(adsSupported({ os: 'android', e2e: undefined })).toBe(true);
    expect(adsSupported({ os: 'web', e2e: undefined })).toBe(false);
    expect(adsSupported({ os: 'ios', e2e: '1' })).toBe(false);
  });
});

describe('useAdsReady', () => {
  it('Basic or Premium with consent: ready, and the SDK is prepared once for every banner', async () => {
    const a = await renderHook(() => useAdsReady());
    const b = await renderHook(() => useAdsReady());
    await waitFor(() => expect(a.result.current).toBe(true));
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(mockGather).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('Premium Plus: never ready, and the SDK is never started', async () => {
    mockRpc.mockResolvedValue({ data: { ads_allowed: false, under_age: false }, error: null });
    const { result } = await renderHook(() => useAdsReady());
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBe(false);
    expect(mockGather).not.toHaveBeenCalled();
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('a minor: ready only with the under-age setting on', async () => {
    mockRpc.mockResolvedValue({ data: { ads_allowed: true, under_age: true }, error: null });
    const { result } = await renderHook(() => useAdsReady());
    await waitFor(() => expect(result.current).toBe(true));
    expect(mockSetConfig).toHaveBeenCalledWith({ tagForUnderAgeOfConsent: true });
  });

  it('an adult then a minor on the same phone: the setting follows the player', async () => {
    const first = await renderHook(() => useAdsReady());
    await waitFor(() => expect(first.result.current).toBe(true));
    await first.unmount();
    signedIn('minor');
    mockRpc.mockResolvedValue({ data: { ads_allowed: true, under_age: true }, error: null });
    const second = await renderHook(() => useAdsReady());
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(mockSetConfig).toHaveBeenLastCalledWith({ tagForUnderAgeOfConsent: true });
  });

  it('no consent or signed out: not ready', async () => {
    mockInfo.mockResolvedValue({ canRequestAds: false });
    const noConsent = await renderHook(() => useAdsReady());
    await waitFor(() => expect(mockInfo).toHaveBeenCalled());
    expect(noConsent.result.current).toBe(false);

    resetAdsForTesting();
    mockSession.mockResolvedValue({ data: { session: null } });
    const signedOut = await renderHook(() => useAdsReady());
    await waitFor(() => expect(mockSession).toHaveBeenCalled());
    expect(signedOut.result.current).toBe(false);
  });
});
