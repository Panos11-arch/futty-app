// Home (S3; spec 15 section 0.6; images 01 and 26; Playtomic's home). Under
// the fixed header (S2) everything scrolls as one page, in the agreed order:
// greeting, quick actions, Log the score, Upcoming matches, Games needing
// players, Featured event, the rotating banner. Futty Games joins with
// G1–G5. Every section hides itself when it has nothing to show.
//
// The owed banner and a half pitch's no-opponent choice (B3) aren't in the
// agreed image; they sit right under the quick actions so money owed always
// shows. Nothing that loads sits above the quick actions: a button moving
// under a finger drops the tap.
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { NoOpponentChoices } from '@/components/booking/no-opponent-choices';
import { FeaturedEvent } from '@/components/home/featured-event';
import { GamesNeedingPlayers } from '@/components/home/games-needing-players';
import { HomeBanner } from '@/components/home/home-banner';
import { HomeGreeting } from '@/components/home/home-greeting';
import { LogScoreSection } from '@/components/home/log-score-section';
import { OwedBanner } from '@/components/home/owed-banner';
import { QuickActions } from '@/components/home/quick-actions';
import { UpcomingMatches } from '@/components/home/upcoming-matches';
import { space } from '@/constants/futty-theme';
import { useStartingLevelOffer } from '@/lib/match/use-levels';
import { makeStyles, useTheme } from '@/lib/theme';

export default function HomeScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  // A5b: the five starting-level questions, once per device, after sign-up.
  useStartingLevelOffer();

  // Pull to refresh: each section reloads its own data and shows its own
  // skeleton, so the spinner only marks the pull.
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    setRefreshSignal((n) => n + 1);
    setRefreshing(false);
  };

  return (
    <View testID="home-screen" style={styles.screen}>
      <ScrollView
        testID="home-scroll"
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
      >
        <HomeGreeting />
        <QuickActions />
        <OwedBanner refreshSignal={refreshSignal} />
        <NoOpponentChoices />
        <LogScoreSection refreshSignal={refreshSignal} />
        <UpcomingMatches refreshSignal={refreshSignal} />
        <GamesNeedingPlayers refreshSignal={refreshSignal} />
        {/* G4a: the banner ad (none on Premium Plus). */}
        <AdBanner testID="home-ad" />
        <FeaturedEvent refreshSignal={refreshSignal} />
        <HomeBanner />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
}));
