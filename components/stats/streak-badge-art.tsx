// One streak badge (A11, match-record decision 1i), drawn with Anghelo's
// artwork in assets/badges/ (its colours live in the SVG files). Three looks:
//   colour  earned, and the player is Premium: badge-<name>.svg;
//   greyed  earned, but the player isn't Premium (or no longer is):
//           badge-<name>-greyed.svg;
//   locked  not earned yet (own Streak card only): the greyed art, faded.
// The art already shows the weeks, so only the badge's name is written under it.
import { StyleSheet, View } from 'react-native';
import { LocalSvg } from 'react-native-svg/css';

import { DISABLED_OPACITY } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { weeksLabel, type StreakBadgeKey } from '@/lib/stats/streaks';

export type StreakBadgeLook = 'colour' | 'greyed' | 'locked';
export type StreakBadgeArtFile = 'colour' | 'greyed';

/** The artwork's own size (viewBox 120 x 140), drawn at half. */
const ART = { width: 60, height: 70 } as const;

const artwork: Record<StreakBadgeKey, Record<StreakBadgeArtFile, number>> = {
  bronze: { colour: require('@/assets/badges/badge-bronze.svg'), greyed: require('@/assets/badges/badge-bronze-greyed.svg') },
  silver: { colour: require('@/assets/badges/badge-silver.svg'), greyed: require('@/assets/badges/badge-silver-greyed.svg') },
  gold: { colour: require('@/assets/badges/badge-gold.svg'), greyed: require('@/assets/badges/badge-gold-greyed.svg') },
  platinum: {
    colour: require('@/assets/badges/badge-platinum.svg'),
    greyed: require('@/assets/badges/badge-platinum-greyed.svg'),
  },
  diamond: {
    colour: require('@/assets/badges/badge-diamond.svg'),
    greyed: require('@/assets/badges/badge-diamond-greyed.svg'),
  },
  champion: {
    colour: require('@/assets/badges/badge-champion.svg'),
    greyed: require('@/assets/badges/badge-champion-greyed.svg'),
  },
};

export function streakBadgeLook(earned: boolean, inColour: boolean): StreakBadgeLook {
  if (!earned) return 'locked';
  return inColour ? 'colour' : 'greyed';
}

/** Only an earned badge of a Premium player uses the coloured file; every other look uses the greyed one. */
export function streakBadgeArtFile(look: StreakBadgeLook): StreakBadgeArtFile {
  return look === 'colour' ? 'colour' : 'greyed';
}

export function StreakBadgeArt({
  badge,
  label,
  weeks,
  earned,
  inColour,
}: {
  badge: StreakBadgeKey;
  label: string;
  weeks: number;
  earned: boolean;
  inColour: boolean;
}) {
  const look = streakBadgeLook(earned, inColour);
  const file = streakBadgeArtFile(look);
  // An unknown badge from a newer server has no artwork: only its name shows.
  const asset = artwork[badge]?.[file];
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
      style={[styles.badge, look === 'locked' && styles.locked]}
    >
      {asset ? (
        <LocalSvg testID={`streak-badge-art-${badge}-${file}`} asset={asset} width={ART.width} height={ART.height} />
      ) : (
        <View style={styles.missing} />
      )}
      <Text variant="caption" tone={look === 'colour' ? 'ink' : 'inkMuted'}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', gap: space.xs },
  locked: { opacity: DISABLED_OPACITY },
  missing: { width: ART.width, height: ART.height },
});
