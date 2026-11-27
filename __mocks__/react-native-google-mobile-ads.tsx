// Jest: AdMob has no native module under Jest, so every test that renders a
// screen with an AdBanner gets this stand-in automatically. A test that
// needs other behaviour still calls jest.mock('react-native-google-mobile-ads', ...).
import { View } from 'react-native';

type BannerProps = {
  unitId: string;
  size: string;
  requestOptions?: unknown;
  onAdLoaded?: () => void;
  onAdFailedToLoad?: (error: Error) => void;
};

export function BannerAd(props: BannerProps) {
  return <View testID="admob-banner" {...(props as object)} />;
}

export const BannerAdSize = {
  BANNER: 'BANNER',
  ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER',
  INLINE_ADAPTIVE_BANNER: 'INLINE_ADAPTIVE_BANNER',
};

export const TestIds = { ADAPTIVE_BANNER: 'ca-app-pub-3940256099942544/2435281174', BANNER: 'ca-app-pub-3940256099942544/2934735716' };

export const AdsConsent = {
  gatherConsent: jest.fn(() => Promise.resolve({ canRequestAds: false })),
  getConsentInfo: jest.fn(() => Promise.resolve({ canRequestAds: false })),
};

const mobileAds = () => ({
  initialize: jest.fn(() => Promise.resolve([])),
  setRequestConfiguration: jest.fn(() => Promise.resolve()),
});

export default mobileAds;
