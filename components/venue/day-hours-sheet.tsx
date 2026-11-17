// One weekday's opening hours (P6e; spec 13 "Venue setup"). Saving sends the
// whole week. Hours that only grow save at once; a later opening, an earlier
// closing or a closed day may put booked games outside the hours, so it asks
// first: those games stay on and their players are told.
import { useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { Button, SegmentedControl, Sheet, Text } from '@/components/ui';
import { ConfirmStep, setupStyles, TimeChips } from '@/components/venue/setup-parts';
import {
  CLOSE_TIMES,
  hoursShortened,
  NOTIFY_WARNING,
  OPEN_TIMES,
  WEEKDAYS,
  type DayHours,
} from '@/lib/venue-setup';

/** What a closed day starts at when staff open it. */
const NEW_DAY = { opens: '08:00', closes: '23:00' };

export function DayHoursSheet({
  weekday,
  week,
  onClose,
  onSave,
}: {
  weekday: number;
  week: DayHours[];
  onClose: () => void;
  /** Null when saved, or the server's refusal in words. */
  onSave: (week: DayHours[]) => Promise<string | null>;
}) {
  const { height } = useWindowDimensions();
  const saved = week.find((d) => d.weekday === weekday);
  const [open, setOpen] = useState(saved !== undefined);
  const [opens, setOpens] = useState(saved?.opens ?? NEW_DAY.opens);
  const [closes, setCloses] = useState(saved?.closes ?? NEW_DAY.closes);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = WEEKDAYS.find((d) => d.weekday === weekday)?.long ?? '';
  const next = [...week.filter((d) => d.weekday !== weekday), ...(open ? [{ weekday, opens, closes }] : [])];

  function changeOpens(time: string) {
    setOpens(time);
    if (closes <= time) setCloses(CLOSE_TIMES[OPEN_TIMES.indexOf(time)]);
  }

  async function save(confirmed: boolean) {
    if (busy) return;
    if (!confirmed && hoursShortened(week, next)) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const refusal = await onSave(next);
    setBusy(false);
    setConfirming(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <Sheet visible onClose={onClose} title={name}>
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={setupStyles.sheet}>
        <SegmentedControl
          accessibilityLabel={`${name} open or closed`}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ]}
          value={open ? 'open' : 'closed'}
          onChange={(value) => {
            setOpen(value === 'open');
            setConfirming(false);
          }}
        />
        {open ? (
          <>
            <TimeChips label="Opens" times={OPEN_TIMES} value={opens} onChange={changeOpens} testPrefix="opens" />
            <TimeChips
              label="Closes"
              times={CLOSE_TIMES}
              value={closes}
              onChange={setCloses}
              isDisabled={(t) => t <= opens}
              testPrefix="closes"
            />
          </>
        ) : null}
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {confirming ? (
          <ConfirmStep
            message={NOTIFY_WARNING}
            confirmLabel="Yes, save hours"
            busy={busy}
            onConfirm={() => save(true)}
            onBack={() => setConfirming(false)}
          />
        ) : (
          <Button label="Save" loading={busy} onPress={() => save(false)} />
        )}
      </ScrollView>
    </Sheet>
  );
}
