import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { cancelBooking, logBookingResult } from '@/lib/booking-actions';
import { describeBookingError } from '@/lib/booking-errors';
import { dateKeyToDate, dayLabel } from '@/lib/days';
import type { MyBooking } from '@/lib/use-my-bookings';

/** A plain booking (no opponent team, so no friendly_matches/league_fixtures
 *  row at all) — logging just derives won/drawn/lost from the two scores,
 *  self-reported since there's no other side to agree it with. Shown
 *  (capped) on the home screen and in full on app/previous-games.tsx — the
 *  venue name is required, not optional, since several of a captain's own
 *  unscored bookings can otherwise look identical (same day, same format).
 *
 *  Also offers "Cancel booking" — the only other place that action lives
 *  (app/my-bookings.tsx) only shows bookings that haven't happened yet, so a
 *  past booking you don't want to (or can't) log a score for had no way to
 *  be cancelled at all. cancel_booking has no time restriction, and
 *  useMyUnscoredBookings already excludes cancelled rows, so cancelling here
 *  is what makes the prompt disappear on the next reload. */
export function BookingResultForm({
  booking,
  venueName,
  onSubmitted,
}: {
  booking: MyBooking;
  venueName: string;
  onSubmitted: () => void;
}) {
  const [goalsFor, setGoalsFor] = useState('');
  const [goalsAgainst, setGoalsAgainst] = useState('');
  const [action, setAction] = useState<'log' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!goalsFor.trim() || !goalsAgainst.trim() || action) return;

    setAction('log');
    setError(null);
    const { error: submitError } = await logBookingResult({
      bookingId: booking.id,
      goalsFor: Number(goalsFor),
      goalsAgainst: Number(goalsAgainst),
    });
    setAction(null);

    if (submitError) {
      setError(describeBookingError(submitError));
    } else {
      onSubmitted();
    }
  }

  async function cancel() {
    if (action) return;

    setAction('cancel');
    setError(null);
    const { error: cancelError } = await cancelBooking(booking.id);
    setAction(null);

    if (cancelError) {
      setError(describeBookingError(cancelError));
    } else {
      onSubmitted();
    }
  }

  return (
    <View style={styles.scoreForm}>
      <Text style={styles.scoreFormTitle}>
        {venueName} · {dayLabel(dateKeyToDate(booking.booking_day))} · {booking.start_time.slice(0, 5)} ·{' '}
        {booking.format}
      </Text>
      <View style={styles.scoreInputsRow}>
        <AuthField
          value={goalsFor}
          onChangeText={setGoalsFor}
          placeholder="0"
          keyboardType="number-pad"
          style={styles.scoreInput}
        />
        <Text style={styles.scoreDash}>–</Text>
        <AuthField
          value={goalsAgainst}
          onChangeText={setGoalsAgainst}
          placeholder="0"
          keyboardType="number-pad"
          style={styles.scoreInput}
        />
        <AuthButton
          label="Log result"
          onPress={submit}
          disabled={!goalsFor.trim() || !goalsAgainst.trim() || action === 'cancel'}
          busy={action === 'log'}
        />
      </View>
      {error ? <AuthError>{error}</AuthError> : null}
      <AuthButton
        label="Cancel booking"
        variant="secondary"
        onPress={cancel}
        disabled={action === 'log'}
        busy={action === 'cancel'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scoreForm: {
    gap: 6,
  },
  scoreFormTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  scoreInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreInput: {
    width: 48,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  scoreDash: {
    opacity: 0.6,
  },
});
