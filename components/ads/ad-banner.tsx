// G4a: the one shared banner ad. Small, between sections or at the end of a
// list, never covering a button. It renders nothing unless the server says
// this player may see ads (ads_allowed: false on Premium Plus) and consent
// allows a request (lib/ads.ts), and nothing if the ad fails to load, so it
// never leaves an empty gap.
//
// Only the screens G4a lists show it (tests/guards/ad-placements.test.ts):
// Home, the competition page, Rankings, the Community feed, a played match,
// other players' and teams' profiles. Futty Games screens get it when G1
// builds them.
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { AD_REQUEST_OPTIONS, bannerUnitId, isLiveAdsBuild, useAdsReady } from '@/lib/ads';
import { makeStyles } from '@/lib/theme';

export function AdBanner({ testID }: { testID: string }) {
  const styles = useStyles();
  const ready = useAdsReady();
  const [failed, setFailed] = useState(false);

  if (!ready || failed) return null;
  return (
    <View testID={testID} accessibilityLabel="Advertisement" style={styles.wrap}>
      <BannerAd
        unitId={bannerUnitId(Platform.OS, isLiveAdsBuild())}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={AD_REQUEST_OPTIONS}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { alignItems: 'center' },
}));
