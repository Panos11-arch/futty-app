// "At what time?" (Playtomic 14): specific hours, or all day, morning,
// afternoon or evening. A time window for the start times shown.
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
  const styles = useStyles();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
    // Start again from the search each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const hours = specificHours();
  const ends = [...hours.filter((h) => h > draft.from), MIDNIGHT];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="At what time?"
      primaryAction={{ label: 'See results', testID: 'book-time-see-results', onPress: () => onApply(draft) }}>
      <ChoiceRow
        testID="book-time-preset-specific"
        kind="radio"
        title="Specific hours"
        checked={draft.preset === 'specific'}
        onPress={() => setDraft((d) => ({ ...d, preset: 'specific' }))}
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
                testID={`book-time-${h.replace(':', '')}`}
                label={h}
                tabular
                selected={h === draft.from}
                onPress={() => setDraft((d) => ({ ...d, from: h, to: d.to > h ? d.to : MIDNIGHT }))}
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
                testID={`book-time-to-${h.replace(':', '')}`}
                label={h}
                tabular
                selected={h === draft.to}
                onPress={() => setDraft((d) => ({ ...d, to: h }))}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      {TIME_PRESETS.map((p) => (
        <ChoiceRow
          key={p.id}
          testID={`book-time-preset-${p.id}`}
          kind="radio"
          title={p.label}
          subtitle={p.range}
          checked={draft.preset === p.id}
          onPress={() => setDraft({ preset: p.id, from: p.from, to: p.to })}
        />
      ))}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  hours: { gap: space.sm, paddingBottom: space.sm },
  row: { gap: space.sm },
}));
