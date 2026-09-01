import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DURATIONS, durationLabel, minToTime, timeToMin, type DurationHours } from '@/lib/booking';
import { dateKeyToDate, dayLabel, toDateKey } from '@/lib/days';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useProfile } from '@/lib/use-profile';
import type { Venue } from '@/lib/use-venues';

type DashboardBooking = {
  id: string;
  start_time: string;
  end_time: string;
  pitches: number;
  format: string | null;
  booking_type: string;
  note: string | null;
  playerLabel: string | null;
  teamLabel: string | null;
};

type BookingsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bookings: DashboardBooking[] };

/** Groups same-time-window bookings together (item 7) — a venue with
 *  several pitches can have more than one booking starting at the same
 *  time, and the list should read as "who's on at 18:00" rather than a flat
 *  chronological list that happens to repeat a time. */
function groupBookingsByTimeSlot(bookings: DashboardBooking[]) {
  const groups = new Map<string, { start_time: string; end_time: string; bookings: DashboardBooking[] }>();
  for (const booking of bookings) {
    const key = `${booking.start_time}-${booking.end_time}`;
    const group = groups.get(key);
    if (group) {
      group.bookings.push(booking);
    } else {
      groups.set(key, { start_time: booking.start_time, end_time: booking.end_time, bookings: [booking] });
    }
  }
  return [...groups.values()];
}

/** All bookings for one venue on one day — both real customer bookings (with
 *  who booked it, resolved via profiles/squad_posts/teams) and the owner's
 *  own recurring training blocks — so the dashboard reflects everything
 *  occupying the venue that day, not just the owner's own blocks. */
function useVenueDayBookings(venueId: string | null, dateKey: string) {
  const [state, setState] = useState<BookingsState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!venueId) {
      setState({ status: 'loading' });
      return;
    }

    setState({ status: 'loading' });

    const { data: bookings, error } = await supabase
      .from('venue_bookings')
      .select('id, start_time, end_time, pitches, format, booking_type, note, created_by')
      .eq('venue_id', venueId)
      .eq('booking_day', dateKey)
      // Only 'confirmed' — a real booking that's still 'pending_payment'
      // (checkout not finished; auto-cancelled after 15 min if it never is,
      // see supabase/booking-payments.sql) hasn't actually reserved the
      // pitch from the owner's point of view and shouldn't show up as if it
      // had. Owner blocks are inserted as 'confirmed' directly (no payment
      // to wait on), so this still covers both booking_types.
      .eq('status', 'confirmed')
      .order('start_time', { ascending: true });

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    const rows = bookings ?? [];
    const profileIds = [...new Set(rows.map((b) => b.created_by).filter((id): id is string => !!id))];
    const bookingIds = rows.map((b) => b.id);

    const [{ data: profiles }, { data: squadPosts }] = await Promise.all([
      // profiles' RLS only allows reading your own row — a plain
      // .from('profiles') select here would silently come back empty for
      // every booker except the venue owner. get_public_profiles is the
      // security-definer RPC (supabase/public-profiles.sql) built for this.
      profileIds.length > 0
        ? (supabase.rpc('get_public_profiles', { p_profile_ids: profileIds }) as unknown as Promise<{
            data: { id: string; username: string | null; full_name: string | null }[] | null;
          }>)
        : Promise.resolve({ data: [] as { id: string; username: string | null; full_name: string | null }[] }),
      bookingIds.length > 0
        ? supabase.from('squad_posts').select('team_id, venue_booking_id').in('venue_booking_id', bookingIds)
        : Promise.resolve({ data: [] as { team_id: string | null; venue_booking_id: string | null }[] }),
    ]);

    if (requestIdRef.current !== requestId) return;

    const teamIds = [
      ...new Set((squadPosts ?? []).map((p) => p.team_id).filter((id): id is string => !!id)),
    ];
    const { data: teams } =
      teamIds.length > 0
        ? await supabase.from('teams').select('id, name').in('id', teamIds)
        : { data: [] as { id: string; name: string }[] };

    if (requestIdRef.current !== requestId) return;

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const teamById = new Map((teams ?? []).map((t) => [t.id, t.name]));
    const teamIdByBookingId = new Map(
      (squadPosts ?? [])
        .filter((p) => p.venue_booking_id && p.team_id)
        .map((p) => [p.venue_booking_id as string, p.team_id as string])
    );

    setState({
      status: 'ready',
      bookings: rows.map((b) => {
        const profile = b.created_by ? profileById.get(b.created_by) : null;
        const teamId = teamIdByBookingId.get(b.id);
        return {
          id: b.id,
          start_time: b.start_time,
          end_time: b.end_time,
          pitches: b.pitches,
          format: b.format,
          booking_type: b.booking_type,
          note: b.note,
          playerLabel: profile?.full_name || profile?.username || null,
          teamLabel: teamId ? teamById.get(teamId) ?? null : null,
        };
      }),
    });
  }, [venueId, dateKey]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}

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

/** Every still-upcoming owner_block occurrence for this venue, grouped back
 *  into the recurring series that created them (item 8 — this "recurring
 *  training slots" management view didn't exist before; only the creation
 *  form and the day-by-day feed did, so a series could only be reviewed one
 *  day at a time, and cancelling one meant cancelling every future
 *  occurrence by hand). */
function useRecurringSlots(venueId: string | null, userId: string | null) {
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
      .gte('booking_day', toDateKey(new Date()))
      .order('booking_day', { ascending: true });

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    const groups = new Map<string, RecurringSlotSeries>();
    for (const row of data ?? []) {
      const weekdayIndex = (dateKeyToDate(row.booking_day).getDay() + 6) % 7;
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
  }, [venueId, userId]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// One row of hourly start times covering a typical training-slot day —
// same reasoning as matchmaking.tsx's KICKOFF_TIMES: simpler than tying into
// the specific venue's open/close hours for a first version of this screen.
const START_TIMES = Array.from({ length: 15 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);

const WEEKS_AHEAD_OPTIONS = [4, 8, 12, 26];

/** Every Monday..Sunday index (0=Mon) that falls on/after today, then every
 *  7 days after that, for `weeksAhead` total occurrences. */
function upcomingWeekdayDates(weekdayIndex: number, weeksAhead: number): string[] {
  const today = new Date();
  const todayIndex = (today.getDay() + 6) % 7; // getDay() is 0=Sun; shift to 0=Mon
  let offset = weekdayIndex - todayIndex;
  if (offset < 0) offset += 7;

  const first = new Date(today);
  first.setDate(today.getDate() + offset);

  return Array.from({ length: weeksAhead }, (_, i) => {
    const date = new Date(first);
    date.setDate(first.getDate() + i * 7);
    return toDateKey(date);
  });
}

/** Recurring training-slot creation screen for venue owners (item 10) —
 *  generates real venue_bookings rows (booking_type = 'owner_block'), one
 *  per week, via the direct RLS insert path in supabase/venue-owners.sql
 *  rather than the paid book_slot() RPC (there's no payment or capacity race
 *  to protect against when an owner blocks their own pitch). */
export default function VenueDashboardScreen() {
  const { user } = useAuth();
  const profile = useProfile();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(() => toDateKey(new Date()));
  const dayBookings = useVenueDayBookings(venueId, selectedDay);
  const recurringSlots = useRecurringSlots(venueId, user?.id ?? null);
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

  useEffect(() => {
    if (!user) return;
    supabase
      .from('venues')
      .select('id, name, city, surface, base_pitches, open_time, close_time, price_per_pitch_hour')
      .eq('owner_profile_id', user.id)
      .then(({ data }) => {
        setVenues(data ?? []);
        if (data && data.length > 0) setVenueId(data[0].id);
      });
  }, [user]);

  const venue = venues?.find((v) => v.id === venueId) ?? null;

  async function submit() {
    if (!user || !venue || busy) return;

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
    const dates = upcomingWeekdayDates(weekdayIndex, weeksAhead);

    const rows = dates.map((day) => ({
      venue_id: venue.id,
      booking_day: day,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      pitches: pitchesNum,
      capacity: 0,
      format: 'Training',
      status: 'confirmed',
      created_by: user.id,
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
      dayBookings.reload();
      recurringSlots.reload();
    }
  }

  async function cancelSeries(series: RecurringSlotSeries) {
    setCancellingSeries(series.key);
    // Direct update, not the cancel_booking() RPC — the RPC only takes one
    // booking id at a time, and the RLS policy "Owners can cancel their own
    // blocks" (supabase/venue-owners.sql) already permits an owner to update
    // their own owner_block rows directly, so a single batched update
    // cancels the whole series in one round trip instead of N.
    await supabase
      .from('venue_bookings')
      .update({ status: 'cancelled' })
      .in('id', series.bookingIds);
    setCancellingSeries(null);
    recurringSlots.reload();
    dayBookings.reload();
  }

  if (profile.status === 'loading') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (profile.status !== 'ready' || profile.profile.role !== 'venue_owner') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.loading}>
          <IconLabel icon="lock.fill" iconColor={FuttyColors.stone400} style={styles.note}>
            This screen is only available to venue owner accounts.
          </IconLabel>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {!venues ? <ActivityIndicator /> : null}

        {venues && venues.length === 0 ? (
          <IconLabel icon="building.columns.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            No venues are linked to your account yet — ask an admin to set venues.owner_profile_id.
          </IconLabel>
        ) : null}

        {venues && venues.length > 0 ? (
          <>
            <ThemedText style={styles.label}>Venue</ThemedText>
            <View style={styles.wrapRow}>
              {venues.map((v) => (
                <Chip key={v.id} label={v.name} selected={v.id === venueId} onPress={() => setVenueId(v.id)} />
              ))}
            </View>

            <ThemedText style={styles.sectionHeading}>Bookings</ThemedText>
            <View style={styles.dayNavRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous day"
                hitSlop={8}
                onPress={() => setSelectedDay((d) => toDateKey(new Date(dateKeyToDate(d).getTime() - 86400000)))}
                style={styles.dayNavButton}>
                <IconSymbol name="chevron.left" size={16} color={FuttyColors.stone700} />
              </Pressable>
              <ThemedText style={styles.dayNavLabel}>{dayLabel(dateKeyToDate(selectedDay))}</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next day"
                hitSlop={8}
                onPress={() => setSelectedDay((d) => toDateKey(new Date(dateKeyToDate(d).getTime() + 86400000)))}
                style={styles.dayNavButton}>
                <IconSymbol name="chevron.right" size={16} color={FuttyColors.stone700} />
              </Pressable>
            </View>

            {dayBookings.status === 'loading' ? <ActivityIndicator /> : null}
            {dayBookings.status === 'error' ? <AuthError>{dayBookings.message}</AuthError> : null}
            {dayBookings.status === 'ready' && dayBookings.bookings.length === 0 ? (
              <ThemedText style={styles.note}>No bookings for this day.</ThemedText>
            ) : null}
            {dayBookings.status === 'ready'
              ? groupBookingsByTimeSlot(dayBookings.bookings).map((group) => (
                  <View key={`${group.start_time}-${group.end_time}`} style={styles.timeSlotGroup}>
                    <View style={styles.timeSlotHeaderRow}>
                      <ThemedText style={styles.timeSlotHeading}>
                        {group.start_time.slice(0, 5)}–{group.end_time.slice(0, 5)}
                      </ThemedText>
                      <ThemedText style={styles.timeSlotPitchCount}>
                        {group.bookings.reduce((sum, b) => sum + b.pitches, 0)} pitch
                        {group.bookings.reduce((sum, b) => sum + b.pitches, 0) === 1 ? '' : 'es'} in use
                      </ThemedText>
                    </View>

                    {group.bookings.map((booking) => {
                      const isOwnerBlock = booking.booking_type === 'owner_block';
                      const who = isOwnerBlock
                        ? 'Your training block'
                        : booking.teamLabel ?? booking.playerLabel ?? 'A player';
                      return (
                        <ThemedView key={booking.id} style={[styles.bookingRow, { borderColor: border }]}>
                          <View style={styles.bookingRowMain}>
                            <ThemedText style={styles.bookingWho}>{who}</ThemedText>
                            <View
                              style={[
                                styles.formatTag,
                                { backgroundColor: isOwnerBlock ? FuttyColors.stone200 : FuttyColors.emerald200 },
                              ]}>
                              <ThemedText style={styles.formatTagText}>{booking.format ?? 'Booking'}</ThemedText>
                            </View>
                          </View>
                          <ThemedText style={styles.bookingMeta}>
                            {booking.pitches} pitch{booking.pitches === 1 ? '' : 'es'}
                            {isOwnerBlock && booking.note ? ` · ${booking.note}` : ''}
                          </ThemedText>
                        </ThemedView>
                      );
                    })}
                  </View>
                ))
              : null}

            <ThemedText style={styles.sectionHeading}>Recurring training slots</ThemedText>
            {recurringSlots.status === 'loading' ? <ActivityIndicator /> : null}
            {recurringSlots.status === 'error' ? <AuthError>{recurringSlots.message}</AuthError> : null}
            {recurringSlots.status === 'ready' && recurringSlots.series.length === 0 ? (
              <ThemedText style={styles.note}>No recurring slots set up yet.</ThemedText>
            ) : null}
            {recurringSlots.status === 'ready'
              ? recurringSlots.series.map((series) => (
                  <ThemedView key={series.key} style={[styles.recurringRow, { borderColor: border }]}>
                    <View style={styles.recurringRowMain}>
                      <ThemedText style={styles.recurringLabel}>
                        {series.weekdayLabel}s, {series.start_time.slice(0, 5)}–{series.end_time.slice(0, 5)}
                      </ThemedText>
                      <ThemedText style={styles.note}>
                        {series.bookingIds.length} upcoming{series.note ? ` · ${series.note}` : ''}
                      </ThemedText>
                    </View>
                    <AuthButton
                      label="Cancel series"
                      variant="secondary"
                      onPress={() => cancelSeries(series)}
                      busy={cancellingSeries === series.key}
                      disabled={cancellingSeries !== null}
                    />
                  </ThemedView>
                ))
              : null}

            <ThemedText style={styles.sectionHeading}>Create recurring training slot</ThemedText>

            <ThemedText style={styles.label}>Day of week</ThemedText>
            <View style={styles.wrapRow}>
              {WEEKDAYS.map((label, index) => (
                <Chip key={label} label={label.slice(0, 3)} selected={index === weekdayIndex} onPress={() => setWeekdayIndex(index)} />
              ))}
            </View>

            <ThemedText style={styles.label}>Start time</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.row}>
                {START_TIMES.map((time) => (
                  <Chip key={time} label={time} selected={time === startTime} onPress={() => setStartTime(time)} />
                ))}
              </View>
            </ScrollView>

            <ThemedText style={styles.label}>Duration</ThemedText>
            <View style={styles.wrapRow}>
              {DURATIONS.map((hours) => (
                <Chip key={hours} label={durationLabel(hours)} selected={hours === duration} onPress={() => setDuration(hours)} />
              ))}
            </View>

            <ThemedText style={styles.label}>Weeks ahead</ThemedText>
            <View style={styles.wrapRow}>
              {WEEKS_AHEAD_OPTIONS.map((weeks) => (
                <Chip key={weeks} label={`${weeks} weeks`} selected={weeks === weeksAhead} onPress={() => setWeeksAhead(weeks)} />
              ))}
            </View>

            <ThemedText style={styles.label}>Pitches occupied{venue ? ` (of ${venue.base_pitches})` : ''}</ThemedText>
            <AuthField
              value={pitches}
              onChangeText={(v) => setPitches(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
              style={styles.narrowField}
            />

            <ThemedText style={styles.label}>Note (optional)</ThemedText>
            <AuthField value={note} onChangeText={setNote} placeholder="e.g. U14 academy training" />

            {venue ? (
              <ThemedView style={[styles.summary, { borderColor: border }]}>
                <ThemedText style={styles.summaryText}>
                  {WEEKDAYS[weekdayIndex]}s, {startTime} for {durationLabel(duration)}, at {venue.name} —{' '}
                  {weeksAhead} weeks ({pitches || '0'} pitch{Number(pitches) === 1 ? '' : 'es'} each time).
                </ThemedText>
              </ThemedView>
            ) : null}

            {error ? <AuthError>{error}</AuthError> : null}
            {created !== null ? (
              <IconLabel icon="checkmark.circle.fill" iconColor={FuttyColors.emerald700} style={styles.note}>
                Created {created} training slot{created === 1 ? '' : 's'}.
              </IconLabel>
            ) : null}

            <AuthButton label="Create recurring slots" onPress={submit} busy={busy} disabled={!venue} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    gap: 10,
    padding: 16,
    paddingBottom: 48,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: FuttyColors.stone900,
    marginTop: 8,
  },
  note: {
    fontSize: 12,
    opacity: 0.8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  narrowField: {
    width: 80,
  },
  summary: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  summaryText: {
    fontSize: 13,
    color: FuttyColors.stone700,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 12,
  },
  dayNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dayNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FuttyColors.stone50,
  },
  dayNavLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  timeSlotGroup: {
    gap: 6,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
  },
  timeSlotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  timeSlotHeading: {
    fontSize: 16,
    fontWeight: '800',
  },
  timeSlotPitchCount: {
    fontSize: 11,
    color: FuttyColors.stone500,
  },
  bookingRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  bookingRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  bookingWho: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  formatTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  formatTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: FuttyColors.stone900,
  },
  bookingMeta: {
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  recurringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  recurringRowMain: {
    flex: 1,
    gap: 2,
  },
  recurringLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
});
