// The venue dashboard's Bookings list (P6d; spec 14 P6, added 11 November):
// the venue's app, walk-in and phone bookings in a date range, filtered by
// source and status. The range starts on Cyprus today to today+6 and is at
// most 31 days, both ends counted (decided 14 November): a longer or
// backwards range is refused here, before any call. Walk-in and phone rows
// show the phone staff entered; app rows show the booker's name only.
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Chip, EmptyState, IconButton, ListRow, SkeletonBlock, StatusPill, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useLoad } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import {
  bookingSourceLabel,
  bookingStatusLabel,
  checkRange,
  defaultRange,
  describeMoneyError,
  fetchBookingsList,
  formatDay,
  type BookingListItem,
  type BookingSource,
  type BookingStatus,
} from '@/lib/venue-money';
import { addDays, cyprusToday, hhmm } from '@/lib/venue-today';

const SOURCES: { value: BookingSource | null; label: string }[] = [
  { value: null, label: 'All sources' },
  { value: 'app', label: 'App' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'phone', label: 'Phone' },
];

const STATUSES: { value: BookingStatus | null; label: string }[] = [
  { value: null, label: 'All statuses' },
  { value: 'pending_payment', label: bookingStatusLabel('pending_payment') },
  { value: 'confirmed', label: bookingStatusLabel('confirmed') },
  { value: 'cancelled', label: bookingStatusLabel('cancelled') },
];

export function BookingStatusMark({ status }: { status: BookingStatus }) {
  if (status === 'confirmed') return <StatusPill status="confirmed" />;
  if (status === 'pending_payment') return <StatusPill status="pending" />;
  return (
    <Text variant="caption" tone="inkMuted">
      {bookingStatusLabel(status)}
    </Text>
  );
}

function rowLines(b: BookingListItem): string[] {
  const head = [b.name ?? 'No name', bookingSourceLabel(b.source), b.format].join(' · ');
  if (b.source === 'app') {
    return [head, b.capacity ? `${b.joined} of ${b.capacity} in` : `${b.joined} in`];
  }
  const yours = b.venue_price_cents === null ? 'No price set' : `Your price ${formatEuros(b.venue_price_cents)}`;
  const charged = b.charged_cents === null ? null : `charged ${formatEuros(b.charged_cents)}`;
  const paid = b.paid_method === 'cash' ? 'paid cash' : b.paid_method === 'card' ? 'paid by card' : 'not paid yet';
  return [head, b.phone, [yours, charged, paid].filter(Boolean).join(' · ')].filter((l): l is string => !!l);
}

function DateStepper({
  label,
  day,
  onStep,
  which,
}: {
  label: string;
  day: string;
  onStep: (n: number) => void;
  which: 'start' | 'end';
}) {
  return (
    <View style={styles.stepper}>
      <Text variant="callout" tone="inkMuted" style={styles.stepperLabel}>
        {label}
      </Text>
      <IconButton icon="chevron.left" accessibilityLabel={`Earlier ${which} date`} onPress={() => onStep(-1)} />
      <Text variant="body" tabular style={styles.stepperDay}>
        {formatDay(day)}
      </Text>
      <IconButton icon="chevron.right" accessibilityLabel={`Later ${which} date`} onPress={() => onStep(1)} />
    </View>
  );
}

export function BookingsListView({ venueId }: { venueId: string }) {
  const [range, setRange] = useState(() => defaultRange(cyprusToday()));
  const [source, setSource] = useState<BookingSource | null>(null);
  const [status, setStatus] = useState<BookingStatus | null>(null);

  const refusal = checkRange(range.from, range.to);

  const load = useCallback(async () => {
    const { data, error } = await fetchBookingsList({ venueId, from: range.from, to: range.to, source, status });
    if (error || !data) throw new Error(describeMoneyError(error?.message ?? ''));
    return data as BookingListItem[];
  }, [venueId, range, source, status]);
  // No key while the range is refused: nothing is asked for.
  const key = refusal ? null : `${venueId}|${range.from}|${range.to}|${source}|${status}`;
  const { state, reload } = useLoad(key, load);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <DateStepper label="From" which="start" day={range.from} onStep={(n) => setRange((r) => ({ ...r, from: addDays(r.from, n) }))} />
      <DateStepper label="To" which="end" day={range.to} onStep={(n) => setRange((r) => ({ ...r, to: addDays(r.to, n) }))} />

      <View style={styles.wrapRow}>
        {SOURCES.map((s) => (
          <Chip key={s.label} label={s.label} selected={source === s.value} onPress={() => setSource(s.value)} />
        ))}
      </View>
      <View style={styles.wrapRow}>
        {STATUSES.map((s) => (
          <Chip key={s.label} label={s.label} selected={status === s.value} onPress={() => setStatus(s.value)} />
        ))}
      </View>

      {refusal ? <Banner tone="warning" message={refusal} /> : null}
      {!refusal && state.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 8} /> : null}
      {!refusal && state.status === 'error' ? (
        <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />
      ) : null}
      {!refusal && state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState icon="calendar" message="No bookings in these dates." />
      ) : null}
      {!refusal && state.status === 'ready'
        ? state.data.map((b) => (
            <View key={b.id} testID={`booking-${b.id}`}>
              <ListRow
                title={`${formatDay(b.booking_day)} · ${hhmm(b.start_time)}–${hhmm(b.end_time)}`}
                subtitle={rowLines(b).join('\n')}
                trailing={<BookingStatusMark status={b.status} />}
              />
            </View>
          ))
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepperLabel: { width: space.xxl + space.md },
  stepperDay: { flex: 1, textAlign: 'center' },
});
