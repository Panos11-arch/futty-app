// A player's S13B match rating as a coloured badge (SofaScore style). The
// number is always shown, so the colour is never the only signal; the
// colours come from the theme tokens (lib/match/rating.ts).
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { formatMatchRating, RATING_BAND_COLOURS, ratingBand } from '@/lib/match/rating';
import { useTheme } from '@/lib/theme';

export type RatingBadgeProps = {
  rating: number;
  /** compact in lists; regular on its own. */
  size?: 'compact' | 'regular';
  testID?: string;
};

export function RatingBadge({ rating, size = 'compact', testID }: RatingBadgeProps) {
  const { colors } = useTheme();
  const band = ratingBand(rating);
  const look = RATING_BAND_COLOURS[band];
  const shown = formatMatchRating(rating);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`Rating ${shown}`}
      style={{
        backgroundColor: colors[look.fill],
        borderRadius: radius.chip,
        minWidth: size === 'compact' ? space.xxl + space.sm : space.xxl + space.lg,
        paddingHorizontal: space.sm,
        paddingVertical: size === 'compact' ? space.xs / 2 : space.xs,
        alignItems: 'center',
      }}>
      <Text variant={size === 'compact' ? 'callout' : 'headline'} tabular style={{ color: colors[look.ink] }}>
        {shown}
      </Text>
    </View>
  );
}
