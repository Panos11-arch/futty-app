// One format's prices an hour (P6e; spec 13 "Venue setup", "Prices and
// fees"): the price, and optional peak and weekend prices with their days
// and peak hours. Staff type each price; it is read as whole cents by
// parseEurosInput, never through a floating-point number, and the server
// decides whether it is allowed (a €0 price is refused there). A day can't
// be in both bands, so a day the other band has is greyed out; a band that
// is off sends no days. New prices apply to new bookings only.
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { Button, Chip, SegmentedControl, Sheet, Text, TextField } from '@/components/ui';
import { ChipRow, setupStyles, TimeChips } from '@/components/venue/setup-parts';
import { formatEurosPlain, parseEurosInput } from '@/lib/money/format';
import {
  CLOSE_TIMES,
  NEW_PRICES_NOTE,
  OPEN_TIMES,
  WEEKDAYS,
  type PriceInput,
  type PriceRule,
} from '@/lib/venue-setup';

/** The defaults of spec 13 "Prices and fees", as set_price_rule fills them in. */
const DEFAULT_PEAK_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_PEAK_STARTS = '17:00';
const DEFAULT_WEEKEND_DAYS = [6, 7];

const NOT_AN_AMOUNT = 'Enter a price like 50 or 50.50.';

function toggle(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

function DayChips({
  days,
  blocked,
  onToggle,
  testPrefix,
}: {
  days: number[];
  /** Days the other band has. */
  blocked: number[];
  onToggle: (day: number) => void;
  testPrefix: string;
}) {
  return (
    <ChipRow>
      {WEEKDAYS.map((d) => (
        <Chip
          key={d.weekday}
          testID={`${testPrefix}-${d.weekday}`}
          label={d.short}
          selected={days.includes(d.weekday)}
          disabled={blocked.includes(d.weekday)}
          onPress={() => onToggle(d.weekday)}
        />
      ))}
    </ChipRow>
  );
}

export function PriceSheet({
  format,
  rule,
  onClose,
  onSave,
  onRemove,
}: {
  format: string;
  /** The saved prices, or undefined when the format has none. */
  rule: PriceRule | undefined;
  onClose: () => void;
  /** Null when saved, or the server's refusal in words. */
  onSave: (input: PriceInput) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}) {
  const { height } = useWindowDimensions();
  const [priceText, setPriceText] = useState(rule ? formatEurosPlain(rule.price_cents) : '');
  const [peakOn, setPeakOn] = useState(rule?.peak_cents != null);
  const [peakText, setPeakText] = useState(rule?.peak_cents != null ? formatEurosPlain(rule.peak_cents) : '');
  const [peakDays, setPeakDays] = useState(
    rule && rule.peak_cents != null ? rule.peak_weekdays : DEFAULT_PEAK_DAYS,
  );
  const [peakStarts, setPeakStarts] = useState(rule?.peak_starts ?? DEFAULT_PEAK_STARTS);
  const [peakEnds, setPeakEnds] = useState<string | null>(rule?.peak_ends ?? null);
  const [weekendOn, setWeekendOn] = useState(rule?.weekend_cents != null);
  const [weekendText, setWeekendText] = useState(
    rule?.weekend_cents != null ? formatEurosPlain(rule.weekend_cents) : '',
  );
  const [weekendDays, setWeekendDays] = useState(
    rule && rule.weekend_cents != null ? rule.weekend_weekdays : DEFAULT_WEEKEND_DAYS,
  );
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A band that is on keeps its days from the other one.
  const peakBlocked = weekendOn ? weekendDays : [];
  const weekendBlocked = peakOn ? peakDays : [];

  function turnPeak(on: boolean) {
    setPeakOn(on);
    if (on) setPeakDays((days) => days.filter((d) => !peakBlocked.includes(d)));
  }

  function turnWeekend(on: boolean) {
    setWeekendOn(on);
    if (on) setWeekendDays((days) => days.filter((d) => !weekendBlocked.includes(d)));
  }

  function changePeakStarts(time: string) {
    setPeakStarts(time);
    if (peakEnds !== null && peakEnds <= time) setPeakEnds(null);
  }

  async function save() {
    if (busy) return;
    const priceCents = parseEurosInput(priceText);
    const peakCents = peakOn ? parseEurosInput(peakText) : null;
    const weekendCents = weekendOn ? parseEurosInput(weekendText) : null;
    if (priceCents === null || (peakOn && peakCents === null) || (weekendOn && weekendCents === null)) {
      setError(NOT_AN_AMOUNT);
      return;
    }
    setBusy('save');
    setError(null);
    const refusal = await onSave({
      format,
      priceCents,
      peakCents,
      weekendCents,
      peakWeekdays: peakOn ? peakDays : [],
      peakStarts,
      peakEnds,
      weekendWeekdays: weekendOn ? weekendDays : [],
    });
    setBusy(null);
    if (refusal) setError(refusal);
    else onClose();
  }

  async function remove() {
    if (busy) return;
    setBusy('remove');
    setError(null);
    const refusal = await onRemove();
    setBusy(null);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <Sheet visible onClose={onClose} title={`${format} price`}>
      <ScrollView
        style={{ maxHeight: height * 0.75 }}
        contentContainerStyle={setupStyles.sheet}
        keyboardShouldPersistTaps="handled">
        <Text variant="callout" tone="inkMuted">
          {NEW_PRICES_NOTE}
        </Text>
        <TextField
          label="Price an hour"
          helper="In euros, like 50 or 50.50."
          value={priceText}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
        />

        <SegmentedControl
          accessibilityLabel="Peak price on or off"
          options={[
            { value: 'off', label: 'No peak price' },
            { value: 'on', label: 'Peak price' },
          ]}
          value={peakOn ? 'on' : 'off'}
          onChange={(value) => turnPeak(value === 'on')}
        />
        {peakOn ? (
          <View style={setupStyles.sheet}>
            <TextField
              label="Peak price an hour"
              value={peakText}
              onChangeText={setPeakText}
              keyboardType="decimal-pad"
            />
            <DayChips
              days={peakDays}
              blocked={peakBlocked}
              onToggle={(d) => setPeakDays((days) => toggle(days, d))}
              testPrefix="peak-day"
            />
            <TimeChips
              label="Peak starts"
              times={OPEN_TIMES}
              value={peakStarts}
              onChange={changePeakStarts}
              testPrefix="peak-start"
            />
            <TimeChips
              label="Peak ends"
              times={CLOSE_TIMES}
              value={peakEnds}
              onChange={setPeakEnds}
              isDisabled={(t) => t <= peakStarts}
              testPrefix="peak-end"
              extra={
                <Chip
                  testID="peak-end-closing"
                  label="Until closing"
                  selected={peakEnds === null}
                  onPress={() => setPeakEnds(null)}
                />
              }
            />
          </View>
        ) : null}

        <SegmentedControl
          accessibilityLabel="Weekend price on or off"
          options={[
            { value: 'off', label: 'No weekend price' },
            { value: 'on', label: 'Weekend price' },
          ]}
          value={weekendOn ? 'on' : 'off'}
          onChange={(value) => turnWeekend(value === 'on')}
        />
        {weekendOn ? (
          <View style={setupStyles.sheet}>
            <TextField
              label="Weekend price an hour"
              value={weekendText}
              onChangeText={setWeekendText}
              keyboardType="decimal-pad"
            />
            <DayChips
              days={weekendDays}
              blocked={weekendBlocked}
              onToggle={(d) => setWeekendDays((days) => toggle(days, d))}
              testPrefix="weekend-day"
            />
          </View>
        ) : null}

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label="Save price" loading={busy === 'save'} disabled={busy === 'remove'} onPress={save} />
        {rule ? (
          <>
            <Button
              label="Remove price"
              variant="destructive"
              loading={busy === 'remove'}
              disabled={busy === 'save'}
              onPress={remove}
            />
            <Text variant="caption" tone="inkMuted">
              Without a price, nobody can book {format} here. Games already booked keep theirs.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
