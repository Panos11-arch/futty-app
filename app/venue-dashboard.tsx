import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DURATIONS, durationLabel, minToTime, timeToMin, type DurationHours } from '@/lib/booking';
import { toDateKey } from '@/lib/days';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useProfile } from '@/lib/use-profile';
import type { Venue } from '@/lib/use-venues';

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
    }
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
    color: FuttyColors.emerald950,
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
});
