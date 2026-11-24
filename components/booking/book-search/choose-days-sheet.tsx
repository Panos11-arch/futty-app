// "Choose your days" (Playtomic 13): a month calendar; today through the
// booking window can be picked, up to 3 days.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Sheet, Text } from '@/components/ui';
import { DISABLED_OPACITY, MIN_TOUCH } from '@/components/ui/foundation';
import { radius, space } from '@/constants/futty-theme';
import { calendarMonths, toggleDay } from '@/lib/booking-search';
import { makeStyles } from '@/lib/theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export type ChooseDaysSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The server's today (Cyprus) and booking window. */
  today: string;
  windowDays: number;
  selected: string[];
  onApply: (days: string[]) => void;
};

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '');
}

export function ChooseDaysSheet({ visible, onClose, today, windowDays, selected, onApply }: ChooseDaysSheetProps) {
  const styles = useStyles();
  const months = useMemo(() => calendarMonths(today, windowDays), [today, windowDays]);
  const [draft, setDraft] = useState(selected);

  useEffect(() => {
    if (visible) setDraft(selected);
    // Start again from the search each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Choose your days"
      primaryAction={{
        label: 'See results',
        testID: 'book-days-see-results',
        disabled: draft.length === 0,
        onPress: () => {
          if (draft.length > 0) onApply(draft);
        },
      }}>
      <ScrollView style={styles.scroll}>
        {months.map((month) => (
          <View key={month.key} style={styles.month}>
            <Text variant="headline">{month.title}</Text>
            <View style={styles.week} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {WEEKDAYS.map((w, i) => (
                <Text key={i} variant="caption" tone="inkMuted" style={styles.cell}>
                  {w}
                </Text>
              ))}
            </View>
            {month.weeks.map((week, wi) => (
              <View key={wi} style={styles.week}>
                {week.map((cell, ci) => {
                  if (!cell) return <View key={ci} style={styles.cell} />;
                  const isSelected = draft.includes(cell.day);
                  return (
                    <Pressable
                      key={cell.day}
                      testID={`book-day-${cell.day}`}
                      accessibilityRole="button"
                      accessibilityLabel={dayLabel(cell.day)}
                      accessibilityState={{ selected: isSelected, disabled: !cell.selectable }}
                      disabled={!cell.selectable}
                      onPress={() => setDraft((d) => toggleDay(d, cell.day))}
                      style={[styles.cell, styles.day, isSelected && styles.selected, !cell.selectable && styles.disabled]}>
                      <Text variant="callout" tone={isSelected ? 'greenInk' : 'ink'} tabular>
                        {cell.date}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  scroll: { maxHeight: 420 },
  month: { gap: space.sm, paddingBottom: space.lg },
  week: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: MIN_TOUCH, textAlign: 'center', textAlignVertical: 'center' },
  day: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  selected: { backgroundColor: colors.green },
  disabled: { opacity: DISABLED_OPACITY },
}));
