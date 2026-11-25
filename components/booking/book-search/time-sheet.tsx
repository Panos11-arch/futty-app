// "At what time?" (Playtomic 14): specific hours, or all day, morning,
// afternoon or evening. A time window for the start times shown. The choice
// alone (TimeWindowPicker) is also Find a match's "Dates and times" step (S6).
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ChoiceRow } from '@/components/booking/book-search/choice-row';
import { Chip, Sheet, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { specificHours, TIME_PRESETS, type TimeWindow } from '@/lib/booking-search';
import { makeStyles } from '@/lib/theme';

export type TimeSheetProps = {
  visible: boolean;
  onClose: () => void;
  value: TimeWindow;
  onApply: (window: TimeWindow) => void;
};

const MIDNIGHT = '24:00';

export function TimeSheet({ visible, onClose, value, onApply }: TimeSheetProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
    // Start again from the search each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="At what time?"
      primaryAction={{ label: 'See results', testID: 'book-time-see-results', onPress: () => onApply(draft) }}>
      <TimeWindowPicker value={draft} onChange={setDraft} />
    </Sheet>
  );
}

export type TimeWindowPickerProps = {
  value: TimeWindow;
  onChange: (window: TimeWindow) => void;
  /** testIDs start book-time- or find-match-time-. */
  testIDPrefix?: 'book' | 'find-match';
};

/** Specific hours, or a part of the day. */
export function TimeWindowPicker({ value: draft, onChange, testIDPrefix = 'book' }: TimeWindowPickerProps) {
  const styles = useStyles();
  const hours = specificHours();
  const ends = [...hours.filter((h) => h > draft.from), MIDNIGHT];
  const fm = testIDPrefix === 'find-match';

  return (
    <View>
      <ChoiceRow
        {...(fm ? { testID: 'find-match-time-preset-specific' } : { testID: 'book-time-preset-specific' })}
        kind="radio"
        title="Specific hours"
        checked={draft.preset === 'specific'}
        onPress={() => onChange({ ...draft, preset: 'specific' })}
      />
      {draft.preset === 'specific' ? (
        <View style={styles.hours}>
          <Text variant="callout" tone="inkMuted">
            From
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {hours.map((h) => (
              <Chip
                key={h}
                {...(fm ? { testID: `find-match-time-${h.replace(':', '')}` } : { testID: `book-time-${h.replace(':', '')}` })}
                label={h}
                tabular
                selected={h === draft.from}
                onPress={() => onChange({ ...draft, from: h, to: draft.to > h ? draft.to : MIDNIGHT })}
              />
            ))}
          </ScrollView>
          <Text variant="callout" tone="inkMuted">
            To
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {ends.map((h) => (
              <Chip
                key={h}
                {...(fm ? { testID: `find-match-time-to-${h.replace(':', '')}` } : { testID: `book-time-to-${h.replace(':', '')}` })}
                label={h}
                tabular
                selected={h === draft.to}
                onPress={() => onChange({ ...draft, to: h })}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      {TIME_PRESETS.map((p) => (
        <ChoiceRow
          key={p.id}
          {...(fm ? { testID: `find-match-time-preset-${p.id}` } : { testID: `book-time-preset-${p.id}` })}
          kind="radio"
          title={p.label}
          subtitle={p.range}
          checked={draft.preset === p.id}
          onPress={() => onChange({ preset: p.id, from: p.from, to: p.to })}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  hours: { gap: space.sm, paddingBottom: space.sm },
  row: { gap: space.sm },
}));
