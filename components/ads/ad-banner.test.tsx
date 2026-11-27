import { fireEvent, render, screen } from '@testing-library/react-native';

import { AdBanner } from './ad-banner';

let mockReady = false;
let mockLive = false;

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/ads', () => ({
  ...jest.requireActual('@/lib/ads'),
  useAdsReady: () => mockReady,
  isLiveAdsBuild: () => mockLive,
}));

beforeEach(() => {
  mockReady = false;
  mockLive = false;
});

describe('AdBanner', () => {
  it('renders nothing while not ready: Premium Plus (ads_allowed false), signed out, no consent, loading', async () => {
    await render(<AdBanner testID="home-ad" />);
    expect(screen.queryByTestId('home-ad')).toBeNull();
    expect(screen.queryByTestId('admob-banner')).toBeNull();
  });

  it('ready: a small adaptive banner, non-personalised, with the test unit in a development build', async () => {
    mockReady = true;
    await render(<AdBanner testID="home-ad" />);
    expect(screen.getByTestId('home-ad')).toBeTruthy();
    const banner = screen.getByTestId('admob-banner');
    expect(banner.props.size).toBe('ANCHORED_ADAPTIVE_BANNER');
    expect(banner.props.requestOptions).toEqual({ requestNonPersonalizedAdsOnly: true });
    expect(banner.props.unitId).toBe('ca-app-pub-3940256099942544/2435281174');
  });

  it("a production build: Futty's real iPhone banner", async () => {
    mockReady = true;
    mockLive = true;
    await render(<AdBanner testID="home-ad" />);
    expect(screen.getByTestId('admob-banner').props.unitId).toBe('ca-app-pub-2436288039660225/6579627774');
  });

  it('an ad that fails to load (no fill, offline) leaves no gap', async () => {
    mockReady = true;
    await render(<AdBanner testID="home-ad" />);
    await fireEvent(screen.getByTestId('admob-banner'), 'adFailedToLoad', new Error('no-fill'));
    expect(screen.queryByTestId('home-ad')).toBeNull();
  });

  it('is labelled for VoiceOver and TalkBack', async () => {
    mockReady = true;
    await render(<AdBanner testID="home-ad" />);
    expect(screen.getByLabelText('Advertisement')).toBeTruthy();
  });
});
