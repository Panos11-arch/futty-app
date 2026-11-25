// "Choose your days" (Playtomic 13): a month calendar; today through the
// booking window can be picked, up to 3 days. The calendar alone
// (DaysCalendar) is also Find a match's "Dates and times" step (S6).
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
      <DaysCalendar
        today={today}
        windowDays={windowDays}
        selected={draft}
        onToggle={(day) => setDraft((d) => toggleDay(d, day))}
      />
    </Sheet>
  );
}

export type DaysCalendarProps = {
  /** The server's today (Cyprus) and booking window. */
  today: string;
  windowDays: number;
  selected: string[];
  onToggle: (day: string) => void;
  /** Each day's testID: book-day-YYYY-MM-DD or find-match-day-YYYY-MM-DD. */
  testIDPrefix?: 'book' | 'find-match';
};

/** The month calendar, for any sheet. */
export function DaysCalendar({ today, windowDays, selected, onToggle, testIDPrefix = 'book' }: DaysCalendarProps) {
  const styles = useStyles();
  const months = useMemo(() => calendarMonths(today, windowDays), [today, windowDays]);
  return (
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
                const isSelected = selected.includes(cell.day);
                return (
                  <Pressable
                    key={cell.day}
                    {...(testIDPrefix === 'find-match' ? { testID: `find-match-day-${cell.day}` } : { testID: `book-day-${cell.day}` })}
                    accessibilityRole="button"
                    accessibilityLabel={dayLabel(cell.day)}
                    accessibilityState={{ selected: isSelected, disabled: !cell.selectable }}
                    disabled={!cell.selectable}
                    onPress={() => onToggle(cell.day)}
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
