import { AD_REQUEST_OPTIONS, prepareAds } from './ads';

const mockGather = jest.fn();
const mockInfo = jest.fn();
const mockInitialize = jest.fn();

jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({ initialize: () => mockInitialize() }),
  AdsConsent: {
    gatherConsent: () => mockGather(),
    getConsentInfo: () => mockInfo(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGather.mockResolvedValue({ canRequestAds: true });
  mockInitialize.mockResolvedValue([]);
});

describe('prepareAds (for G4)', () => {
  it("asks Google's consent form first (shown only where it's needed, e.g. the EU), then starts the SDK", async () => {
    mockInfo.mockResolvedValue({ canRequestAds: true });
    expect(await prepareAds()).toEqual({ canRequestAds: true });
    expect(mockGather).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockGather.mock.invocationCallOrder[0]).toBeLessThan(mockInitialize.mock.invocationCallOrder[0]);
  });

  it('no consent: the SDK is not started and no ad may be requested', async () => {
    mockInfo.mockResolvedValue({ canRequestAds: false });
    expect(await prepareAds()).toEqual({ canRequestAds: false });
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('the consent form failing (offline): still uses any consent already given, as Google advises', async () => {
    mockGather.mockRejectedValue(new Error('offline'));
    mockInfo.mockResolvedValue({ canRequestAds: true });
    expect(await prepareAds()).toEqual({ canRequestAds: true });
    expect(mockInitialize).toHaveBeenCalled();
  });

  it('the SDK failing to start: no ads, never a crash', async () => {
    mockInfo.mockResolvedValue({ canRequestAds: true });
    mockInitialize.mockRejectedValue(new Error('boom'));
    expect(await prepareAds()).toEqual({ canRequestAds: false });
  });

  it('every ad request is non-personalised (so no App Tracking Transparency prompt is needed)', () => {
    expect(AD_REQUEST_OPTIONS).toEqual({ requestNonPersonalizedAdsOnly: true });
  });
});
