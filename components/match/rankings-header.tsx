// The Rankings tab's night header (images 14, 15 and 27): the Team of the
// Week | Power ranking switch, the format chips (5-a-side, 6, 7, 9, 11) and
// the "How it's picked" / "How it works" link. Fixed: each view below
// scrolls itself.
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/ui/chip';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { TEAM_FORMATS, type TeamFormat } from '@/lib/match/stats-api';
import { makeStyles } from '@/lib/theme';

export type RankingsView = 'totw' | 'power';

/** "5-a-side" for the first chip, the number alone for the rest (image 14). */
export function formatChipLabel(format: TeamFormat): string {
  return format === TEAM_FORMATS[0] ? format : format.split('-')[0];
}

export type RankingsHeaderProps = {
  view: RankingsView;
  onChangeView: (view: RankingsView) => void;
  format: TeamFormat;
  onChangeFormat: (format: TeamFormat) => void;
  onPressHow: () => void;
};

export function RankingsHeader({ view, onChangeView, format, onChangeFormat, onPressHow }: RankingsHeaderProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const how = view === 'totw' ? 'How it’s picked' : 'How it works';
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
      <SegmentedControl<RankingsView>
        onDark
        accessibilityLabel="Rankings"
        value={view}
        onChange={onChangeView}
        options={[
          { value: 'totw', label: 'Team of the Week', testID: 'rankings-totw' },
          { value: 'power', label: 'Power ranking', testID: 'rankings-power' },
        ]}
      />
      <View style={styles.row}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
          {TEAM_FORMATS.map((f) => (
            <Chip
              key={f}
              onDark
              label={formatChipLabel(f)}
              selected={f === format}
              onPress={() => onChangeFormat(f)}
              testID={`rankings-format-${f.split('-')[0]}`}
            />
          ))}
        </ScrollView>
        <Pressable
          testID="rankings-how"
          accessibilityRole="button"
          accessibilityLabel={how}
          onPress={onPressHow}
          style={({ pressed }) => [styles.how, pressed && styles.pressed]}>
          <Text variant="callout" tone="onNightMuted">
            {how}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  bar: { backgroundColor: colors.night, paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chipScroll: { flexGrow: 1, flexShrink: 1 },
  chips: { gap: space.sm, alignItems: 'center' },
  how: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
}));
