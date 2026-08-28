import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthLink } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { bookSlot } from '@/lib/booking-actions';
import { describeBookingError } from '@/lib/booking-errors';
import {
  buildSlotGrid,
  CAPACITY_OPTIONS,
  canFitFormat,
  DURATIONS,
  durationLabel,
  formatForCapacity,
  pitchesForCapacity,
  timeToMin,
  type DurationHours,
  type Slot,
} from '@/lib/booking';
import {
  dateKeyToDate,
  dayLabel,
  dayNumberLabel,
  isToday,
  monthLabel,
  toDateKey,
  useDays,
  weekdayLabel,
} from '@/lib/days';
import { useDayBookings } from '@/lib/use-day-bookings';
import { isDayLocked, STANDARD_ADVANCE_DAYS } from '@/lib/premium';
import { useProfile } from '@/lib/use-profile';
import { mapsUrlForVenue, useVenues, type Venue } from '@/lib/use-venues';

const ALL_CITIES = 'All';

/** The "confirm this slot?" card shown after tapping an available slot. */
function BookingConfirm({
  venue,
  dateKey,
  slot,
  capacity,
  duration,
  onDone,
  onCancel,
}: {
  venue: Venue;
  dateKey: string;
  slot: Slot;
  capacity: number;
  duration: DurationHours;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tint = useThemeColor({}, 'tint');

  async function confirm() {
    setBusy(true);
    setError(null);

    const { data: bookingData, error: bookError } = await bookSlot({
      venueId: venue.id,
      day: dateKey,
      start: slot.start,
      end: slot.end,
      pitches: pitchesForCapacity(capacity),
      capacity,
      format: formatForCapacity(capacity),
    });

    setBusy(false);

    if (bookError || !bookingData) {
      setError(bookError ? describeBookingError(bookError) : 'Could not create booking.');
      return;
    }

    const booking = bookingData as unknown as { id: string; amount_cents: number };
    onDone();

    // Free venue — book_slot already confirmed it directly, no payment step
    // (and so nothing to split). A priced booking instead goes to the split
    // payment screen: the pitch is only actually reserved once the BOOKER's
    // own share is paid there — see supabase/booking-payment-splits.sql.
    if (booking.amount_cents) {
      router.push({ pathname: '/booking-payment', params: { bookingId: booking.id } });
    }
  }

  return (
    <ThemedView style={[styles.confirmCard, { borderColor: tint }]}>
      <IconLabel icon="sportscourt.fill" type="defaultSemiBold" iconSize={18}>
        Book {venue.name}, {dayLabel(dateKeyToDate(dateKey))} {slot.start}–{slot.end}?
      </IconLabel>
      <ThemedText style={styles.note}>
        {formatForCapacity(capacity)} · {durationLabel(duration)}
        {venue.price_per_pitch_hour
          ? ` · €${Math.round(venue.price_per_pitch_hour * pitchesForCapacity(capacity) * duration)} total`
          : ''}
      </ThemedText>

      {error ? <AuthError>{error}</AuthError> : null}

      <View style={styles.confirmRow}>
        <View style={styles.confirmButton}>
          <AuthButton label="Confirm booking" onPress={confirm} busy={busy} />
        </View>
        <View style={styles.confirmButton}>
          <AuthButton label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
        </View>
      </View>
    </ThemedView>
  );
}

/** Shown instead of the booking confirm card when the tapped slot is on a day
 *  beyond what a standard account can reach. */
function PremiumPrompt({ onDismiss }: { onDismiss: () => void }) {
  const tint = useThemeColor({}, 'tint');

  return (
    <ThemedView style={[styles.confirmCard, { borderColor: tint }]}>
      <ThemedText type="defaultSemiBold">This day needs Premium</ThemedText>
      <ThemedText style={styles.note}>
        Standard accounts can book up to {STANDARD_ADVANCE_DAYS} days ahead. Premium unlocks the
        full 21-day calendar.
      </ThemedText>
      <View style={styles.confirmRow}>
        <View style={styles.confirmButton}>
          <AuthButton label="See Premium" onPress={() => router.push('/account/premium')} />
        </View>
        <View style={styles.confirmButton}>
          <AuthButton label="Cancel" variant="secondary" onPress={onDismiss} />
        </View>
      </View>
    </ThemedView>
  );
}

function SlotGrid({
  venue,
  dateKey,
  capacity,
  duration,
  dayLocked,
  onBooked,
}: {
  venue: Venue;
  dateKey: string;
  capacity: number;
  duration: DurationHours;
  dayLocked: boolean;
  onBooked: () => void;
}) {
  const bookings = useDayBookings(venue.id, dateKey);
  const needed = pitchesForCapacity(capacity);
  const [pending, setPending] = useState<Slot | 'locked' | null>(null);

  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const okBorder = useThemeColor({ light: FuttyColors.emerald600, dark: FuttyColors.emerald600 }, 'text');

  if (!canFitFormat(venue.base_pitches, capacity)) {
    return (
      <ThemedText style={styles.note}>
        This venue can&apos;t fit {formatForCapacity(capacity)} ({needed} pitches needed, has{' '}
        {venue.base_pitches}).
      </ThemedText>
    );
  }

  if (bookings.status === 'loading' || bookings.status === 'idle') {
    return <ActivityIndicator style={styles.note} />;
  }

  if (bookings.status === 'error') {
    return <ThemedText style={styles.note}>Could not load bookings: {bookings.message}</ThemedText>;
  }

  // Only relevant for today — every other day in the picker is already in
  // the future. A slot starting at or before the current time is treated as
  // unavailable, same as book_slot's server-side "slot_in_past" check.
  const nowMinutes = isToday(dateKeyToDate(dateKey))
    ? new Date().getHours() * 60 + new Date().getMinutes()
    : -1;

  const slots = buildSlotGrid({
    openTime: venue.open_time,
    closeTime: venue.close_time,
    basePitches: venue.base_pitches,
    bookings: bookings.bookings,
    capacity,
    durationHours: duration,
  }).map((slot) => {
    const isPast = nowMinutes >= 0 && timeToMin(slot.start) <= nowMinutes;
    return { ...slot, available: slot.available && !isPast, isPast };
  });

  if (slots.length === 0) {
    return (
      <ThemedText style={styles.note}>
        No {durationLabel(duration)} slot fits between {venue.open_time.slice(0, 5)} and{' '}
        {venue.close_time.slice(0, 5)}.
      </ThemedText>
    );
  }

  return (
    <>
      <View style={styles.slotGrid}>
        {slots.map((slot) => {
          // Greyed out the instant it's pressed, rather than waiting for the
          // booking to confirm and the day's bookings to reload — otherwise
          // tapping a slot gives no feedback until the network round-trip lands.
          const isSelected = pending !== 'locked' && pending?.start === slot.start;
          return (
            <Pressable
              key={slot.start}
              accessibilityRole="button"
              disabled={!slot.available}
              onPress={() => setPending(dayLocked ? 'locked' : slot)}
              style={[
                styles.slot,
                { borderColor: slot.available && !isSelected ? okBorder : border },
                (!slot.available || isSelected) && styles.dimmed,
              ]}>
              <ThemedText style={styles.slotLabel}>{slot.start}</ThemedText>
              <ThemedText style={styles.slotFree}>
                {isSelected ? 'selected' : slot.available ? `${slot.free} free` : slot.isPast ? 'passed' : 'full'}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <ThemedText style={styles.note}>
        {venue.price_per_pitch_hour ? `€${venue.price_per_pitch_hour}/pitch/hour · ` : ''}
        needs {needed} of {venue.base_pitches} pitches · dimmed slots are booked out for{' '}
        {formatForCapacity(capacity)}
      </ThemedText>

      {pending === 'locked' ? (
        <PremiumPrompt onDismiss={() => setPending(null)} />
      ) : pending ? (
        <BookingConfirm
          venue={venue}
          dateKey={dateKey}
          slot={pending}
          capacity={capacity}
          duration={duration}
          onCancel={() => setPending(null)}
          onDone={() => {
            setPending(null);
            bookings.reload();
            onBooked();
          }}
        />
      ) : null}
    </>
  );
}

export default function BookScreen() {
  const { cities, reload, ...venuesState } = useVenues();
  const profile = useProfile();
  const isPremium = profile.status === 'ready' && profile.profile.is_premium;
  const DAYS = useDays();

  // Each step starts unpicked — the one after it doesn't render at all until
  // this one has a value. Picking an EARLIER step resets everything after it
  // (see the setters below), so changing your mind about, say, the city
  // re-collapses duration/format/venue rather than leaving stale picks that
  // no longer make sense together.
  const [selectedDay, setSelectedDayState] = useState<string | null>(null);
  const [city, setCityState] = useState<string | null>(null);
  const [duration, setDurationState] = useState<DurationHours | null>(null);
  const [capacity, setCapacityState] = useState<number | null>(null);
  const [openVenueId, setOpenVenueId] = useState<string | null>(null);
  // Bumped on every successful book/cancel so an open slot grid remounts and
  // refetches — otherwise it would keep showing stale availability after a
  // booking made elsewhere on this screen.
  const [bookingsVersion, setBookingsVersion] = useState(0);
  const refresh = () => setBookingsVersion((v) => v + 1);

  function setSelectedDay(key: string) {
    setSelectedDayState(key);
    setCityState(null);
    setDurationState(null);
    setCapacityState(null);
    setOpenVenueId(null);
  }
  function setCity(name: string) {
    setCityState(name);
    setDurationState(null);
    setCapacityState(null);
    setOpenVenueId(null);
  }
  function setDuration(hours: DurationHours) {
    setDurationState(hours);
    setCapacityState(null);
    setOpenVenueId(null);
  }
  function setCapacity(cap: number) {
    setCapacityState(cap);
    setOpenVenueId(null);
  }

  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const tint = useThemeColor({}, 'tint');

  const venues = venuesState.status === 'ready' ? venuesState.venues : [];
  const visibleVenues = city === ALL_CITIES ? venues : venues.filter((v) => v.city === city);
  const selectedDayIndex = selectedDay ? DAYS.findIndex((day) => toDateKey(day) === selectedDay) : -1;
  const selectedDayLocked = isDayLocked(selectedDayIndex, isPremium);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Pressable accessibilityRole="button" onPress={() => router.push('/my-bookings')}>
            <IconLabel icon="calendar" type="link" iconColor={FuttyColors.emerald700}>
              Your bookings
            </IconLabel>
          </Pressable>
        </View>

        <IconLabel icon="calendar" type="subtitle">Day</IconLabel>
        {!isPremium ? (
          <View style={styles.premiumBanner}>
            <ThemedText style={styles.note}>
              Standard: book up to {STANDARD_ADVANCE_DAYS} days ahead.
            </ThemedText>
            <AuthLink label="See Premium" onPress={() => router.push('/account/premium')} />
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.row}>
            {DAYS.map((day, index) => {
              const key = toDateKey(day);
              return (
                <Chip
                  key={key}
                  label={isToday(day) ? 'Today' : weekdayLabel(day)}
                  sublabel={`${dayNumberLabel(day)} ${monthLabel(day)}`}
                  selected={key === selectedDay}
                  locked={isDayLocked(index, isPremium)}
                  onPress={() => setSelectedDay(key)}
                />
              );
            })}
          </View>
        </ScrollView>

        {selectedDay ? (
          <>
            <IconLabel icon="mappin.and.ellipse" type="subtitle">City</IconLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.row}>
                {[ALL_CITIES, ...cities].map((name) => (
                  <Chip key={name} label={name} selected={name === city} onPress={() => setCity(name)} />
                ))}
              </View>
            </ScrollView>
          </>
        ) : null}

        {city ? (
          <>
            <IconLabel icon="clock.fill" type="subtitle">Duration</IconLabel>
            <View style={styles.wrapRow}>
              {DURATIONS.map((hours) => (
                <Chip
                  key={hours}
                  label={durationLabel(hours)}
                  selected={hours === duration}
                  onPress={() => setDuration(hours)}
                />
              ))}
            </View>
          </>
        ) : null}

        {duration ? (
          <>
            <IconLabel icon="sportscourt.fill" type="subtitle">Format</IconLabel>
            <View style={styles.wrapRow}>
              {CAPACITY_OPTIONS.map((option) => (
                <Chip
                  key={option.capacity}
                  label={option.format}
                  sublabel={`${option.capacity}p · ${option.pitches} pitch${option.pitches > 1 ? 'es' : ''}`}
                  selected={option.capacity === capacity}
                  onPress={() => setCapacity(option.capacity)}
                />
              ))}
            </View>
          </>
        ) : null}

        {capacity && selectedDay && city && duration ? (
          <>
            <IconLabel icon="building.columns.fill" type="subtitle">Venue</IconLabel>

            {venuesState.status === 'loading' ? <ActivityIndicator /> : null}

            {venuesState.status === 'error' ? (
              <ThemedText style={styles.note}>Could not load venues: {venuesState.message}</ThemedText>
            ) : null}

            {venuesState.status === 'ready' && visibleVenues.length === 0 ? (
              <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
                No venues found for this city.
              </IconLabel>
            ) : null}

            {visibleVenues.map((venue) => {
              const isOpen = venue.id === openVenueId;

              return (
                <ThemedView key={venue.id} style={[styles.venueCard, { borderColor: border }]}>
                  <View style={styles.venueHeaderRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isOpen }}
                      onPress={() => setOpenVenueId(isOpen ? null : venue.id)}
                      style={styles.venueHeaderMain}>
                      <ThemedText type="defaultSemiBold">{venue.name}</ThemedText>
                      <ThemedText style={styles.note}>
                        {venue.city}
                        {venue.surface ? ` · ${venue.surface}` : ''} · {venue.open_time.slice(0, 5)}–
                        {venue.close_time.slice(0, 5)} · {venue.base_pitches} pitches
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${venue.name} in Maps`}
                      onPress={() => Linking.openURL(mapsUrlForVenue(venue))}
                      style={styles.mapsButton}
                      hitSlop={8}>
                      <IconSymbol name="mappin.and.ellipse" size={20} color={tint} />
                    </Pressable>
                  </View>

                  {isOpen ? (
                    <>
                      <IconLabel icon="clock.fill" type="subtitle">Time</IconLabel>
                      <SlotGrid
                        key={`${venue.id}-${selectedDay}-${bookingsVersion}`}
                        venue={venue}
                        dateKey={selectedDay}
                        capacity={capacity}
                        duration={duration}
                        dayLocked={selectedDayLocked}
                        onBooked={refresh}
                      />
                    </>
                  ) : null}
                </ThemedView>
              );
            })}
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
  content: {
    gap: 10,
    padding: 16,
    paddingBottom: 48,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dimmed: {
    opacity: 0.4,
  },
  venueCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  venueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  venueHeaderMain: {
    flex: 1,
  },
  mapsButton: {
    padding: 4,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  slot: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 60,
  },
  slotLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  slotFree: {
    fontSize: 10,
    opacity: 0.7,
  },
  confirmCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmButton: {
    flex: 1,
  },
});
