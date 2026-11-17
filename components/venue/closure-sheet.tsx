// Adding a closure (P6e; spec 13 "Venue setup"): a range of days closed to
// new bookings, from today in Cyprus onwards. Games already booked then stay
// on and their players are told, so adding asks first.
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, ScrollView, useWindowDimensions } from 'react-native';

import { Button, ListRow, Sheet, Text, TextField } from '@/components/ui';
import { ConfirmStep, setupStyles } from '@/components/venue/setup-parts';
import { formatDay } from '@/lib/venue-money';
import { NOTIFY_WARNING } from '@/lib/venue-setup';

/** The calendar day a picker shows for "YYYY-MM-DD" (noon, so no clock change moves it). */
function pickerDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** The calendar day staff picked, as "YYYY-MM-DD". */
function dayOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function DayField({
  label,
  value,
  min,
  testID,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  testID: string;
  onChange: (day: string) => void;
}) {
  const [showIOS, setShowIOS] = useState(false);

  function open() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerDate(value),
        mode: 'date',
        minimumDate: pickerDate(min),
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) onChange(dayOf(picked));
        },
      });
    } else {
      setShowIOS((v) => !v);
    }
  }

  return (
    <>
      <ListRow testID={testID} title={label} subtitle={formatDay(value)} leading={{ icon: 'calendar' }} onPress={open} />
      {Platform.OS === 'ios' && showIOS ? (
        <DateTimePicker
          testID={`${testID}-picker`}
          value={pickerDate(value)}
          mode="date"
          display="inline"
          minimumDate={pickerDate(min)}
          onChange={(event, picked) => {
            if (event.type === 'set' && picked) {
              onChange(dayOf(picked));
              setShowIOS(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

export function ClosureSheet({
  today,
  onClose,
  onAdd,
}: {
  /** Today in Cyprus. */
  today: string;
  onClose: () => void;
  /** Null when added, or the server's refusal in words. */
  onAdd: (input: { startsOn: string; endsOn: string; reason: string }) => Promise<string | null>;
}) {
  const { height } = useWindowDimensions();
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeStart(day: string) {
    setStartsOn(day);
    if (endsOn < day) setEndsOn(day);
  }

  async function add() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const refusal = await onAdd({ startsOn, endsOn, reason });
    setBusy(false);
    setConfirming(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <Sheet visible onClose={onClose} title="Add closure">
      <ScrollView
        style={{ maxHeight: height * 0.75 }}
        contentContainerStyle={setupStyles.sheet}
        keyboardShouldPersistTaps="handled">
        <Text variant="callout" tone="inkMuted">
          Nobody can book these days. Both days are included.
        </Text>
        <DayField label="First day" value={startsOn} min={today} testID="closure-from" onChange={changeStart} />
        <DayField label="Last day" value={endsOn} min={startsOn} testID="closure-to" onChange={setEndsOn} />
        <TextField label="Reason" helper="Optional, for your staff." value={reason} onChangeText={setReason} />
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {confirming ? (
          <ConfirmStep
            message={NOTIFY_WARNING}
            confirmLabel="Yes, add closure"
            busy={busy}
            onConfirm={add}
            onBack={() => setConfirming(false)}
          />
        ) : (
          <Button testID="closure-add" label="Add closure" onPress={() => setConfirming(true)} />
        )}
      </ScrollView>
    </Sheet>
  );
}
