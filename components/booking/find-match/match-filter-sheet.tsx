// Find a match's filters (Playtomic 15): one sheet, four steps, as Book a
// pitch's sheets: "Which format?" → "Places" (towns and venues) → "Choose
// your days" → "At what time?". "Next" moves on; "See results" applies.
import { useEffect, useState } from 'react';
import { FlatList } from 'react-native';

import { ChoiceRow } from '@/components/booking/book-search/choice-row';
import { DaysCalendar } from '@/components/booking/book-search/choose-days-sheet';
import { TimeWindowPicker } from '@/components/booking/book-search/time-sheet';
import { Sheet } from '@/components/ui';
import { toggleDay, type BookPlace, type PlaceVenue } from '@/lib/booking-search';
import { emptyFilters, MATCH_FORMATS, type MatchFilters } from '@/lib/find-match';
import { makeStyles } from '@/lib/theme';

export type FilterStep = 'format' | 'places' | 'days' | 'time';
const STEPS: FilterStep[] = ['format', 'places', 'days', 'time'];
const TITLES: Record<FilterStep, string> = {
  format: 'Which format?',
  places: 'Places',
  days: 'Choose your days',
  time: 'At what time?',
};

export type MatchFilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The filters so far; none yet: everything unset. */
  initial: MatchFilters | null;
  /** The server's today (Cyprus) and booking window. */
  today: string;
  windowDays: number;
  towns: string[];
  venues: PlaceVenue[];
  onApply: (filters: MatchFilters) => void;
};

type PlaceRow = { key: string; title: string; place: BookPlace };

function placeKey(p: BookPlace): string {
  return p.kind === 'town' ? `town:${p.town}` : p.kind === 'venue' ? `venue:${p.venueId}` : 'all';
}

export function MatchFilterSheet({ visible, onClose, initial, today, windowDays, towns, venues, onApply }: MatchFilterSheetProps) {
  const styles = useStyles();
  const [step, setStep] = useState<FilterStep>('format');
  const [draft, setDraft] = useState<MatchFilters>(initial ?? emptyFilters());

  useEffect(() => {
    if (visible) {
      setStep('format');
      setDraft(initial ?? emptyFilters());
    }
    // Start again from the filters each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const last = step === 'time';
  const next = () => setStep(STEPS[STEPS.indexOf(step) + 1]);

  const placeRows: PlaceRow[] = [
    { key: 'all', title: 'All places', place: { kind: 'all' } },
    ...towns.map((town) => ({ key: `town:${town}`, title: town, place: { kind: 'town' as const, town } })),
    ...venues.map((v) => ({ key: `venue:${v.id}`, title: v.name, place: { kind: 'venue' as const, venueId: v.id, name: v.name } })),
  ];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={TITLES[step]}
      primaryAction={
        last
          ? { label: 'See results', testID: 'find-match-filter-see-results', onPress: () => onApply(draft) }
          : {
              label: 'Next',
              testID: `find-match-filter-next-${step}`,
              disabled: step === 'format' && draft.format === null,
              onPress: next,
            }
      }>
      {step === 'format'
        ? MATCH_FORMATS.map((f) => (
            <ChoiceRow
              key={f}
              testID={`find-match-format-${f}`}
              kind="radio"
              title={f}
              checked={draft.format === f}
              onPress={() => setDraft((d) => ({ ...d, format: f }))}
            />
          ))
        : null}
      {step === 'places' ? (
        <FlatList
          style={styles.list}
          data={placeRows}
          keyExtractor={(r) => r.key}
          renderItem={({ item }) => (
            <ChoiceRow
              testID={`find-match-place-${item.key}`}
              kind="radio"
              title={item.title}
              checked={placeKey(draft.place) === item.key}
              onPress={() => setDraft((d) => ({ ...d, place: item.place }))}
            />
          )}
        />
      ) : null}
      {step === 'days' ? (
        <DaysCalendar
          testIDPrefix="find-match"
          today={today}
          windowDays={windowDays}
          selected={draft.days}
          onToggle={(day) => setDraft((d) => ({ ...d, days: toggleDay(d.days, day) }))}
        />
      ) : null}
      {step === 'time' ? (
        <TimeWindowPicker testIDPrefix="find-match" value={draft.window} onChange={(window) => setDraft((d) => ({ ...d, window }))} />
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 420 },
}));
