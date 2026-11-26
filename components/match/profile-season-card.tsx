// S8 Profile tab, "This season" (image 19): the format picker ("All
// formats") and the tiles from my_profile_season, in image 19's order.
// Friendly games count here: these are the player's own stats.
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text, useToneColour } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { seasonTiles, type ProfileSeason } from '@/lib/match/profile-summary-api';
import type { Loadable } from '@/lib/match/use-match-result';
import { makeStyles } from '@/lib/theme';

export const ALL_FORMATS = 'All formats';

export type ProfileSeasonCardProps = {
  state: Loadable<{ season: ProfileSeason }>;
  format: string | null;
  /** Every format the player has played this season, kept while a filter is on. */
  formats: string[];
  onFormat: (format: string | null) => void;
  onRetry: () => void;
};

function Tile({ label, value, testID }: { label: string; value: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label} ${value}`} testID={testID}>
      <Text variant="number" tabular>
        {value}
      </Text>
      <Text variant="caption" tone="inkMuted" numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </View>
  );
}

export function ProfileSeasonCard({ state, format, formats, onFormat, onRetry }: ProfileSeasonCardProps) {
  const styles = useStyles();
  const [picking, setPicking] = useState(false);
  const chevron = useToneColour('inkMuted');
  const shown = format ?? ALL_FORMATS;

  const choose = (next: string | null) => {
    setPicking(false);
    if (next !== format) onFormat(next);
  };

  return (
    <Card style={styles.card} testID="profile-season">
      <View style={styles.header}>
        <Text variant="headline" accessibilityRole="header">
          This season
        </Text>
        {formats.length > 0 ? (
          <Pressable
            testID="profile-season-format"
            accessibilityRole="button"
            accessibilityLabel={`${shown}, change format`}
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
            <Text variant="callout" tone="inkMuted">
              {shown}
            </Text>
            <IconSymbol name="chevron.down" size={ICON.small} color={chevron} />
          </Pressable>
        ) : null}
      </View>

      {state.status === 'loading' ? (
        <View style={styles.grid} testID="profile-season-skeleton">
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={styles.cell}>
              <SkeletonBlock width="100%" height={space.xxl * 2} />
            </View>
          ))}
        </View>
      ) : state.status === 'error' ? (
        <Banner tone="danger" message="This season couldn’t load." action={{ label: 'Try again', onPress: onRetry }} />
      ) : (
        <View style={styles.grid}>
          {seasonTiles(state.season).map((t) => (
            <View key={t.key} style={styles.cell}>
              <Tile label={t.label} value={t.value} testID={`profile-season-tile-${t.key}`} />
            </View>
          ))}
        </View>
      )}

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Format">
        {[null, ...formats].map((f) => (
          <ListRow
            key={f ?? 'all'}
            testID={`profile-season-format-${f ?? 'all'}`}
            title={f ?? ALL_FORMATS}
            accessibilityRole="radio"
            accessibilityState={{ selected: f === format }}
            trailing={f === format ? <IconSymbol name="checkmark" size={ICON.small} color={chevron} /> : undefined}
            onPress={() => choose(f)}
          />
        ))}
      </Sheet>
    </Card>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  card: { gap: space.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  picker: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  cell: { width: '25%', padding: space.xs },
  tile: {
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius.control,
    backgroundColor: colors.fill,
  },
  pressed: { opacity: 0.8 },
}));
