// Streak badges on another player's profile (A11, match-record decision
// 1i): only the badges they have earned, in colour while that player is
// Premium and greyed otherwise. Nothing at all while they have none.
import { StyleSheet, View } from 'react-native';

import { StreakBadgeArt } from '@/components/stats/streak-badge-art';
import { SectionHeader } from '@/components/ui/section-header';
import { space } from '@/constants/futty-theme';
import { usePlayerStreakBadges } from '@/lib/stats/use-streak';
import type { PlayerStreakBadges } from '@/lib/stats/streaks';

export function StreakBadgesView({ badges }: { badges: PlayerStreakBadges | null }) {
  if (!badges || badges.badges.length === 0) return null;
  return (
    <View style={styles.section} testID="player-streak-badges">
      <SectionHeader title="Streak badges" />
      <View style={styles.badges}>
        {badges.badges.map((b) => (
          <StreakBadgeArt
            key={b.badge}
            badge={b.badge}
            label={b.label}
            weeks={b.weeks}
            earned
            inColour={badges.inColour}
          />
        ))}
      </View>
    </View>
  );
}

/** A badge row is extra: while loading or after an error it shows nothing. */
export function StreakBadges({ profileId }: { profileId: string }) {
  const state = usePlayerStreakBadges(profileId);
  return <StreakBadgesView badges={state.status === 'ready' ? state.badges : null} />;
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
