// The Filter sheet (Playtomic 12): venues without free times, Type,
// Format, Players per side (5-a-side where 6 v 6 is allowed), Game length
// (the lengths the server offers), "See N results" with the live count, and
// Reset.
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ChoiceRow } from '@/components/booking/book-search/choice-row';
import { Button, Chip, SectionHeader, Sheet } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { PITCH_FORMATS } from '@/lib/booking';
import { showPlayersPerSide, type BookSearchQuery, type PitchType } from '@/lib/booking-search';
import { makeStyles } from '@/lib/theme';

export type FilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  value: BookSearchQuery;
  /** What Reset goes back to (only the filter fields are taken). */
  defaults: BookSearchQuery;
  lengths: number[];
  sixOnFiveAllowed: boolean;
  /** The draft's live result count; null while counting. */
  count: number | null;
  onDraftChange: (draft: BookSearchQuery) => void;
  onApply: (draft: BookSearchQuery) => void;
};

const TYPES: { id: PitchType; label: string }[] = [
  { id: 'indoor', label: 'Indoor' },
  { id: 'outdoor', label: 'Outdoor' },
];

export function FilterSheet({
  visible,
  onClose,
  value,
  defaults,
  lengths,
  sixOnFiveAllowed,
  count,
  onDraftChange,
  onApply,
}: FilterSheetProps) {
  const styles = useStyles();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
    // Start again from the search each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const change = (next: BookSearchQuery) => {
    setDraft(next);
    onDraftChange(next);
  };

  const reset = () =>
    change({
      ...draft,
      includeUnavailable: defaults.includeUnavailable,
      types: defaults.types,
      format: defaults.format,
      playersPerSide: defaults.playersPerSide,
      minutes: defaults.minutes,
    });

  const label = count === null ? 'See results' : `See ${count} ${count === 1 ? 'result' : 'results'}`;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter"
      primaryAction={{ label, testID: 'book-filter-see-results', onPress: () => onApply(draft) }}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.reset}>
          <Button testID="book-filter-reset" label="Reset" variant="plain" size="compact" onPress={reset} />
        </View>
        <ChoiceRow
          testID="book-filter-unavailable"
          kind="checkbox"
          title="Show venues without free times"
          checked={draft.includeUnavailable}
          onPress={() => change({ ...draft, includeUnavailable: !draft.includeUnavailable })}
        />

        <SectionHeader title="Type" />
        {TYPES.map((t) => {
          const on = draft.types.includes(t.id);
          return (
            <ChoiceRow
              key={t.id}
              testID={`book-filter-type-${t.id}`}
              kind="checkbox"
              title={t.label}
              checked={on}
              onPress={() => change({ ...draft, types: on ? draft.types.filter((x) => x !== t.id) : [...draft.types, t.id] })}
            />
          );
        })}

        <SectionHeader title="Format" />
        <View style={styles.wrap}>
          {PITCH_FORMATS.map((f) => (
            <Chip
              key={f}
              testID={`book-filter-format-${f}`}
              label={f}
              selected={f === draft.format}
              onPress={() => change({ ...draft, format: f, playersPerSide: f === draft.format ? draft.playersPerSide : 5 })}
            />
          ))}
        </View>

        {showPlayersPerSide(draft.format, sixOnFiveAllowed) ? (
          <>
            <SectionHeader title="Players per side" />
            <View style={styles.wrap}>
              {([5, 6] as const).map((n) => (
                <Chip
                  key={n}
                  testID={`book-filter-pps-${n}`}
                  label={`${n} v ${n}`}
                  selected={n === draft.playersPerSide}
                  onPress={() => change({ ...draft, playersPerSide: n })}
                />
              ))}
            </View>
          </>
        ) : null}

        <SectionHeader title="Game length" />
        <View style={styles.wrap}>
          {lengths.map((m) => (
            <Chip
              key={m}
              testID={`book-length-${m}`}
              label={`${m} min`}
              tabular
              selected={m === draft.minutes}
              onPress={() => change({ ...draft, minutes: m })}
            />
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  scroll: { maxHeight: 460 },
  content: { gap: space.sm, paddingBottom: space.md },
  reset: { alignItems: 'flex-end' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
