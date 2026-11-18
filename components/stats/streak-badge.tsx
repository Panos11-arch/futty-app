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

/** Each badge's fill and the colour of its label on that fill. */
const badgeColours: Record<StreakBadgeKey, { fill: string; label: string }> = {
  bronze: { fill: colors.badgeBronze, label: colors.badgeOnBronze },
  silver: { fill: colors.badgeSilver, label: colors.badgeOnSilver },
  gold: { fill: colors.badgeGold, label: colors.badgeOnGold },
  platinum: { fill: colors.badgePlatinum, label: colors.badgeOnPlatinum },
  diamond: { fill: colors.badgeDiamond, label: colors.badgeOnDiamond },
  champion: { fill: colors.badgeChampion, label: colors.badgeOnChampion },
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
  // An unknown badge from a newer server shows greyed rather than guessing a colour.
  const palette = badgeColours[badge];
  const shown = look === 'colour' && !palette ? 'greyed' : look;
  const a11y =
    look === 'colour'
      ? `${label} streak badge, earned`
      : look === 'greyed'
        ? `${label} streak badge, earned, shown in colour with Premium`
        : `${label} streak badge, ${weeksLabel(weeks)} in a row`;
  return (
    <View
      testID={`streak-badge-${badge}-${shown}`}
      accessible
      accessibilityLabel={a11y}
      style={[
        styles.badge,
        shown === 'colour' && { backgroundColor: palette.fill },
        shown === 'greyed' && styles.greyed,
        shown === 'locked' && styles.locked,
      ]}
    >
      <Text variant="caption" tone="inkMuted" style={shown === 'colour' ? { color: palette.label } : undefined}>
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
