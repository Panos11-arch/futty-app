// One streak badge (A11, match-record decision 1i). Three looks:
//   colour  earned, and the player is Premium: the badge's own colour;
//   greyed  earned, but the player isn't Premium (or no longer is);
//   locked  not earned yet (own Streak card only): an outline with the
//           weeks it needs.
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import { weeksLabel, type StreakBadgeKey } from '@/lib/stats/streaks';

export type StreakBadgeLook = 'colour' | 'greyed' | 'locked';

const badgeColours: Record<StreakBadgeKey, string> = {
  bronze: colors.badgeBronze,
  silver: colors.badgeSilver,
  gold: colors.badgeGold,
  platinum: colors.badgePlatinum,
  diamond: colors.badgeDiamond,
  champion: colors.badgeChampion,
};

export function streakBadgeLook(earned: boolean, inColour: boolean): StreakBadgeLook {
  if (!earned) return 'locked';
  return inColour ? 'colour' : 'greyed';
}

export function StreakBadge({
  badge,
  label,
  weeks,
  look,
}: {
  badge: StreakBadgeKey;
  label: string;
  weeks: number;
  look: StreakBadgeLook;
}) {
  const a11y =
    look === 'colour'
      ? `${label} streak badge, earned`
      : look === 'greyed'
        ? `${label} streak badge, earned, shown in colour with Premium`
        : `${label} streak badge, ${weeksLabel(weeks)} in a row`;
  return (
    <View
      testID={`streak-badge-${badge}-${look}`}
      accessible
      accessibilityLabel={a11y}
      style={[
        styles.badge,
        look === 'colour' && { backgroundColor: badgeColours[badge] ?? colors.inkMuted },
        look === 'greyed' && styles.greyed,
        look === 'locked' && styles.locked,
      ]}
    >
      <Text variant="caption" tone={look === 'colour' ? 'onBrand' : 'inkMuted'}>
        {label}
      </Text>
      {look === 'locked' ? (
        <Text variant="caption" tone="inkMuted" tabular>
          {weeksLabel(weeks)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.xs,
  },
  greyed: { backgroundColor: colors.border },
  locked: { backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
});
