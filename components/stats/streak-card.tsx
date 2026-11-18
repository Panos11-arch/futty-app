// The Streak card on the player's own profile (A11, match-record decision
// 1i): the current and best streak, and all six badges. Earned badges show
// in colour only while the player is Premium; otherwise they are greyed,
// with "Go Premium to unlock streak badges". The numbers are the server's
// (get_my_streak).
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { StreakBadgeArt } from '@/components/stats/streak-badge-art';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import type { Loadable } from '@/lib/match/use-match-result';
import { weeksLabel, type MyStreak } from '@/lib/stats/streaks';
import { useMyStreak } from '@/lib/stats/use-streak';

export const GO_PREMIUM_BADGES = 'Go Premium to unlock streak badges';

function Figure({ label, weeks, testID }: { label: string; weeks: number; testID: string }) {
  return (
    <View style={styles.figure} testID={testID} accessible accessibilityLabel={`${label} ${weeksLabel(weeks)}`}>
      <Text variant="title" tabular>
        {String(weeks)}
      </Text>
      <Text variant="caption" tone="inkMuted">
        {label}
      </Text>
    </View>
  );
}

export function StreakCardView({
  state,
  onRetry,
  onGoPremium,
}: {
  state: Loadable<{ streak: MyStreak | null }>;
  onRetry: () => void;
  onGoPremium: () => void;
}) {
  if (state.status === 'error') {
    return (
      <Banner tone="danger" message="Couldn’t load your streak." action={{ label: 'Try again', onPress: onRetry }} />
    );
  }
  return (
    <View style={styles.section} testID="streak-card">
      <SectionHeader title="Streak" />
      <Card>
        {state.status === 'loading' || !state.streak ? (
          <View testID="streak-card-loading">
            <SkeletonText lines={3} />
          </View>
        ) : (
          <View style={styles.body}>
            <View style={styles.figures}>
              <Figure label="Weeks in a row" weeks={state.streak.current} testID="streak-current" />
              <Figure label="Best" weeks={state.streak.best} testID="streak-best" />
            </View>
            <View style={styles.badges}>
              {state.streak.badges.map((b) => (
                <StreakBadgeArt
                  key={b.badge}
                  badge={b.badge}
                  label={b.label}
                  weeks={b.weeks}
                  earned={b.earned}
                  inColour={state.streak!.isPremium}
                />
              ))}
            </View>
            {state.streak.isPremium ? null : (
              <Text variant="callout" tone="brand" accessibilityRole="link" onPress={onGoPremium}>
                {GO_PREMIUM_BADGES}
              </Text>
            )}
          </View>
        )}
      </Card>
    </View>
  );
}

/** The signed-in player's own Streak card; reloads whenever the profile comes back into view. */
export function StreakCard() {
  const { user } = useAuth();
  const streak = useMyStreak(user?.id);
  const { reload } = streak;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );
  return (
    <StreakCardView state={streak} onRetry={reload} onGoPremium={() => router.push('/account/premium')} />
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  body: { gap: space.lg },
  figures: { flexDirection: 'row', gap: space.xl },
  figure: { gap: space.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
