// Recurring training slots (spec 05 section 12, item 4), moved unchanged from
// the old app/venue-dashboard.tsx in P6c with a light restyle; the full
// restyle is P6e. It creates real venue_bookings rows (booking_type =
// 'owner_block'), one per week, through the direct RLS insert path in
// supabase/venue-owners.sql rather than the paid book_slot() RPC (there's no
// payment or capacity race to protect against when an owner blocks their
// own pitch), and cancels a whole series in one update. Which slots are still
// upcoming, and the dates a new series falls on, use the Cyprus date
// (`today`, from cyprusToday) and Cyprus weekdays, never the phone's date.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, SectionHeader, Text, TextField } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { DURATIONS, durationLabel, minToTime, timeToMin, type DurationHours } from '@/lib/booking';
import { supabase } from '@/lib/supabase';
import { weekdayDates, weekdayIndex as weekdayOf } from '@/lib/venue-today';

type RecurringSlotSeries = {
  key: string;
  weekdayLabel: string;
  start_time: string;
  end_time: string;
  note: string | null;
  bookingIds: string[];
};

type RecurringSlotsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; series: RecurringSlotSeries[] };

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Every still-upcoming owner_block occurrence for this venue, grouped back
 *  into the recurring series that created them. */
function useRecurringSlots(venueId: string | null, userId: string | null, today: string) {
  const [state, setState] = useState<RecurringSlotsState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!venueId || !userId) {
      setState({ status: 'loading' });
      return;
    }

    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('venue_bookings')
      .select('id, booking_day, start_time, end_time, note')
      .eq('venue_id', venueId)
      .eq('booking_type', 'owner_block')
      .eq('created_by', userId)
      .eq('status', 'confirmed')
      .gte('booking_day', today)
      .order('booking_day', { ascending: true });

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    const groups = new Map<string, RecurringSlotSeries>();
    for (const row of data ?? []) {
      const weekdayIndex = weekdayOf(row.booking_day);
      const key = `${weekdayIndex}-${row.start_time}-${row.end_time}-${row.note ?? ''}`;
      const group = groups.get(key);
      if (group) {
        group.bookingIds.push(row.id);
      } else {
        groups.set(key, {
          key,
          weekdayLabel: WEEKDAYS[weekdayIndex],
          start_time: row.start_time,
          end_time: row.end_time,
          note: row.note,
          bookingIds: [row.id],
        });
      }
    }

    setState({ status: 'ready', series: [...groups.values()] });
  }, [venueId, userId, today]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}

// One row of hourly start times covering a typical training-slot day.
const START_TIMES = Array.from({ length: 15 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);

const WEEKS_AHEAD_OPTIONS = [4, 8, 12, 26];

export type TrainingSlotsSectionProps = {
  venue: { id: string; name: string; base_pitches: number | null };
  userId: string;
  /** Today's date in Cyprus (YYYY-MM-DD). */
  today: string;
  /** The day calendar shows training slots too: reload it after a change. */
  onChanged: () => void;
};

export function TrainingSlotsSection({ venue, userId, today, onChanged }: TrainingSlotsSectionProps) {
  const recurringSlots = useRecurringSlots(venue.id, userId, today);
  const [cancellingSeries, setCancellingSeries] = useState<string | null>(null);
  const [weekdayIndex, setWeekdayIndex] = useState(0);
  const [startTime, setStartTime] = useState('18:00');
  const [duration, setDuration] = useState<DurationHours>(1);
  const [weeksAhead, setWeeksAhead] = useState(8);
  const [pitches, setPitches] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  async function submit() {
    if (busy) return;

    const pitchesNum = Number(pitches);
    if (!pitchesNum || pitchesNum < 1) {
      setError('Enter how many pitches this training occupies.');
      return;
    }

    setBusy(true);
    setError(null);
    setCreated(null);

    const startMin = timeToMin(`${startTime}:00`);
    const endTime = minToTime(startMin + duration * 60);
    const dates = weekdayDates(weekdayIndex, weeksAhead, today);

    const rows = dates.map((day) => ({
      venue_id: venue.id,
      booking_day: day,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      pitches: pitchesNum,
      capacity: 0,
      format: 'Training',
      status: 'confirmed',
      created_by: userId,
      amount_cents: 0,
      booking_type: 'owner_block',
      note: note.trim() || null,
    }));

    const { error: insertError } = await supabase.from('venue_bookings').insert(rows);

    setBusy(false);

    if (insertError) {
      setError(insertError.message);
    } else {
      setCreated(rows.length);
      onChanged();
      recurringSlots.reload();
    }
  }

  async function cancelSeries(series: RecurringSlotSeries) {
    setCancellingSeries(series.key);
    // One batched update: the RLS policy "Owners can cancel their own
    // blocks" (supabase/venue-owners.sql) lets an owner update their own
    // owner_block rows directly.
    await supabase.from('venue_bookings').update({ status: 'cancelled' }).in('id', series.bookingIds);
    setCancellingSeries(null);
    recurringSlots.reload();
    onChanged();
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Recurring training slots" />
      {recurringSlots.status === 'loading' ? <Text tone="inkMuted">Loading…</Text> : null}
      {recurringSlots.status === 'error' ? <Text tone="danger">{recurringSlots.message}</Text> : null}
      {recurringSlots.status === 'ready' && recurringSlots.series.length === 0 ? (
        <Text tone="inkMuted">No recurring slots set up yet.</Text>
      ) : null}
      {recurringSlots.status === 'ready'
        ? recurringSlots.series.map((series) => (
            <Card key={series.key}>
              <View style={styles.seriesRow}>
                <View style={styles.flex}>
                  <Text variant="headline" tabular>
                    {series.weekdayLabel}s, {series.start_time.slice(0, 5)}–{series.end_time.slice(0, 5)}
                  </Text>
                  <Text variant="callout" tone="inkMuted">
                    {series.bookingIds.length} upcoming{series.note ? ` · ${series.note}` : ''}
                  </Text>
                </View>
                <Button
                  label="Cancel series"
                  variant="secondary"
                  onPress={() => cancelSeries(series)}
                  loading={cancellingSeries === series.key}
                  disabled={cancellingSeries !== null}
                />
              </View>
            </Card>
          ))
        : null}

      <SectionHeader title="Create recurring training slot" />

      <Text variant="callout">Day of week</Text>
      <View style={styles.wrapRow}>
        {WEEKDAYS.map((label, index) => (
          <Chip key={label} label={label.slice(0, 3)} selected={index === weekdayIndex} onPress={() => setWeekdayIndex(index)} />
        ))}
      </View>

      <Text variant="callout">Start time</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {START_TIMES.map((time) => (
          <Chip key={time} label={time} tabular selected={time === startTime} onPress={() => setStartTime(time)} />
        ))}
      </ScrollView>

      <Text variant="callout">Duration</Text>
      <View style={styles.wrapRow}>
        {DURATIONS.map((hours) => (
          <Chip key={hours} label={durationLabel(hours)} selected={hours === duration} onPress={() => setDuration(hours)} />
        ))}
      </View>

      <Text variant="callout">Weeks ahead</Text>
      <View style={styles.wrapRow}>
        {WEEKS_AHEAD_OPTIONS.map((weeks) => (
          <Chip key={weeks} label={`${weeks} weeks`} selected={weeks === weeksAhead} onPress={() => setWeeksAhead(weeks)} />
        ))}
      </View>

      <TextField
        label={`Pitches occupied${venue.base_pitches != null ? ` (of ${venue.base_pitches})` : ''}`}
        value={pitches}
        onChangeText={(v) => setPitches(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
      />

      <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. U14 academy training" />

      <Text variant="callout" tone="inkMuted">
        {WEEKDAYS[weekdayIndex]}s, {startTime} for {durationLabel(duration)}, at {venue.name} — {weeksAhead} weeks (
        {pitches || '0'} pitch{Number(pitches) === 1 ? '' : 'es'} each time).
      </Text>

      {error ? <Text tone="danger">{error}</Text> : null}
      {created !== null ? (
        <Text tone="success">
          Created {created} training slot{created === 1 ? '' : 's'}.
        </Text>
      ) : null}

      <Button label="Create recurring slots" onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  seriesRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  row: { gap: space.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
