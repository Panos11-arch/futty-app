import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { WizardModal } from '@/components/wizard-modal';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { bookSlot } from '@/lib/booking-actions';
import { describeBookingError } from '@/lib/booking-errors';
import {
  buildSlotGrid,
  CAPACITY_OPTIONS,
  canFitFormat,
  DURATIONS,
  formatForCapacity,
  pitchesForCapacity,
  timeToMin,
  type DurationHours,
  type Slot,
} from '@/lib/booking';
import { dayNumberLabel, isToday, toDateKey, useDays, weekdayLabel } from '@/lib/days';
import { PostSquadNeed } from '@/app/my-bookings';
import { useDayBookings } from '@/lib/use-day-bookings';
import type { MyBooking } from '@/lib/use-my-bookings';
import { isDayLocked, PREMIUM_ADVANCE_DAYS, STANDARD_ADVANCE_DAYS } from '@/lib/premium';
import { useProfile } from '@/lib/use-profile';
import { useVenues, type Venue } from '@/lib/use-venues';

const ALL_CITIES = 'All';
const DEFAULT_DURATION: DurationHours = DURATIONS[0];

type NeedChoice = 'players' | 'opposition' | 'neither';
type WizardStep = 'location' | 'venue' | 'quantity' | 'date' | 'time' | 'need';
// Location→Venue→Quantity come before Date/Time (rather than the more
// obvious "when, then where" order) because a real time-slot grid — struck-
// through, unavailable slots disabled, not just a rough time-of-day guess —
// needs a specific venue, format and day already known to compute actual
// availability against. Picking the pitch first is what makes that grid real
// instead of another abstract preference step.
const WIZARD_STEPS: WizardStep[] = ['location', 'venue', 'quantity', 'date', 'time', 'need'];
const STEP_META: Record<WizardStep, { title: string; name: string; subtitle: string }> = {
  location: { title: 'Where?', name: 'Location', subtitle: 'Which city should we search in?' },
  venue: { title: 'Pick a pitch', name: 'Venue', subtitle: 'Choose which venue you want to play at.' },
  quantity: { title: 'How many players?', name: 'Quantity', subtitle: 'Pick the format you need a pitch for.' },
  date: { title: 'When are you playing?', name: 'Date', subtitle: 'Pick a day to check availability.' },
  time: { title: 'What time?', name: 'Time', subtitle: 'Already-booked slots are shown struck through.' },
  need: { title: 'Need anyone else?', name: 'Squad', subtitle: "Let other players know if you're short, or skip it." },
};

/** A single real time-slot button — struck-through and disabled when
 *  unavailable, highlighted when selected (item 3). */
function TimeSlotButton({
  slot,
  selected,
  onPress,
}: {
  slot: Slot & { isPast?: boolean };
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !slot.available }}
      disabled={!slot.available}
      onPress={onPress}
      style={[styles.timeSlot, selected && styles.timeSlotSelected, !slot.available && styles.timeSlotDisabled]}>
      <ThemedText
        style={[
          styles.timeSlotText,
          selected && styles.timeSlotTextSelected,
          !slot.available && styles.timeSlotTextDisabled,
        ]}>
        {slot.start}
      </ThemedText>
    </Pressable>
  );
}

export default function BookScreen() {
  const { cities, ...venuesState } = useVenues();
  const profile = useProfile();
  const isPremium = profile.status === 'ready' && profile.profile.is_premium;

  // Today plus the Premium window; days past the standard window show a lock.
  const days = useDays(PREMIUM_ADVANCE_DAYS + 1);

  const [city, setCity] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [needChoice, setNeedChoice] = useState<NeedChoice | null>(null);
  const [step, setStep] = useState<WizardStep>('location');
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [dayLockedPrompt, setDayLockedPrompt] = useState(false);
  const [completed, setCompleted] = useState<MyBooking | null>(null);

  const venues = venuesState.status === 'ready' ? venuesState.venues.filter((v) => v.is_live) : [];
  const venuesInCity = city === ALL_CITIES ? venues : venues.filter((v) => v.city === city);
  const venue: Venue | null = venues.find((v) => v.id === venueId) ?? null;
  const dayBookings = useDayBookings(venueId, selectedDay ?? '');

  const stepIndex = WIZARD_STEPS.indexOf(step);
  const selectedDayIndex = selectedDay ? days.findIndex((d) => toDateKey(d) === selectedDay) : -1;
  const dayLocked = isDayLocked(selectedDayIndex, isPremium);

  const slots: (Slot & { isPast: boolean })[] =
    venue && selectedDay && capacity && dayBookings.status === 'ready'
      ? (() => {
          const nowMinutes = isToday(new Date(selectedDay))
            ? new Date().getHours() * 60 + new Date().getMinutes()
            : -1;
          return buildSlotGrid({
            openTime: venue.open_time,
            closeTime: venue.close_time,
            basePitches: venue.base_pitches,
            bookings: dayBookings.bookings,
            capacity,
            durationHours: DEFAULT_DURATION,
          }).map((slot) => {
            const isPast = nowMinutes >= 0 && timeToMin(slot.start) <= nowMinutes;
            return { ...slot, available: slot.available && !isPast, isPast };
          });
        })()
      : [];

  function canAdvance() {
    switch (step) {
      case 'location':
        return !!city;
      case 'venue':
        return !!venueId;
      case 'quantity':
        return !!capacity;
      case 'date':
        return !!selectedDay;
      case 'time':
        return !!selectedSlot;
      case 'need':
        return !!needChoice;
    }
  }

  function goNext() {
    if (step === 'need') {
      confirmBooking();
      return;
    }
    const next = WIZARD_STEPS[stepIndex + 1];
    if (next) setStep(next);
  }

  function goBack() {
    if (stepIndex === 0) {
      router.back();
      return;
    }
    setStep(WIZARD_STEPS[stepIndex - 1]);
  }

  async function confirmBooking() {
    if (!venue || !selectedDay || !selectedSlot || !capacity || bookBusy) return;

    if (dayLocked) {
      setDayLockedPrompt(true);
      return;
    }

    setBookBusy(true);
    setBookError(null);

    const { data: bookingData, error } = await bookSlot({
      venueId: venue.id,
      day: selectedDay,
      start: selectedSlot.start,
      end: selectedSlot.end,
      pitches: pitchesForCapacity(capacity),
      format: formatForCapacity(capacity),
    });

    setBookBusy(false);

    if (error || !bookingData) {
      setBookError(error ? describeBookingError(error) : 'Could not create booking.');
      return;
    }

    const booking = bookingData as unknown as MyBooking & { amount_cents: number };

    if (booking.amount_cents) {
      // Priced venue — authorizing (not charging, item 6) the booker's own
      // share is what actually reserves it, and happens on that screen.
      router.replace({
        pathname: '/booking-payment',
        params: { bookingId: booking.id, needChoice: needChoice ?? 'neither' },
      });
      return;
    }

    if (needChoice && needChoice !== 'neither') {
      setCompleted(booking);
    } else {
      router.replace({ pathname: '/fixture-confirmed', params: { kind: 'booking', id: booking.id } });
    }
  }

  if (completed) {
    return (
      <View style={styles.completedWrap}>
        <IconLabel icon="checkmark.circle.fill" type="defaultSemiBold" iconColor={FuttyColors.emerald700}>
          Booked! {completed.start_time.slice(0, 5)}–{completed.end_time.slice(0, 5)}
        </IconLabel>
        {needChoice && needChoice !== 'neither' ? <PostSquadNeed booking={completed} initialMode={needChoice} /> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace({ pathname: '/fixture-confirmed', params: { kind: 'booking', id: completed.id } })}
          style={styles.doneButton}>
          <ThemedText style={styles.doneButtonText}>Done</ThemedText>
        </Pressable>
      </View>
    );
  }

  const meta = STEP_META[step];

  return (
    <WizardModal
      visible
      title="Book a pitch"
      stepIndex={stepIndex}
      stepCount={WIZARD_STEPS.length}
      stepName={meta.name}
      onBack={goBack}
      continueLabel={step === 'need' ? 'Confirm booking' : 'Continue'}
      onContinue={goNext}
      continueDisabled={!canAdvance()}
      continueBusy={bookBusy}>
      <ThemedText type="title" style={styles.stepTitle}>
        {meta.title}
      </ThemedText>
      <ThemedText style={styles.stepSubtitle}>{meta.subtitle}</ThemedText>

      {step === 'location' ? (
        <View style={styles.wrapRow}>
          {[ALL_CITIES, ...cities].map((name) => (
            <Chip
              key={name}
              label={name}
              selected={name === city}
              onPress={() => {
                setCity(name);
                setVenueId(null);
              }}
            />
          ))}
        </View>
      ) : null}

      {step === 'venue' ? (
        <View style={styles.wrapRow}>
          {venuesState.status === 'loading' ? <ActivityIndicator /> : null}
          {venuesInCity.length === 0 && venuesState.status === 'ready' ? (
            <ThemedText style={styles.note}>No venues found for this city.</ThemedText>
          ) : null}
          {venuesInCity.map((v) => (
            <Chip
              key={v.id}
              label={v.name}
              sublabel={`${v.surface ?? 'Pitch'} · ${v.base_pitches} pitches`}
              selected={v.id === venueId}
              onPress={() => setVenueId(v.id)}
            />
          ))}
        </View>
      ) : null}

      {step === 'quantity' ? (
        <View style={styles.wrapRow}>
          {CAPACITY_OPTIONS.map((option) => (
            <Chip
              key={option.capacity}
              label={option.format}
              sublabel={`${option.capacity}p · ${option.pitches} pitch${option.pitches > 1 ? 'es' : ''}`}
              selected={option.capacity === capacity}
              disabled={!!venue && !canFitFormat(venue.base_pitches, option.capacity)}
              onPress={() => setCapacity(option.capacity)}
            />
          ))}
        </View>
      ) : null}

      {step === 'date' ? (
        <>
          {!isPremium ? (
            <View style={styles.premiumNote}>
              <IconSymbol name="crown.fill" size={13} color={FuttyColors.amber400} />
              <ThemedText style={styles.premiumNoteText}>
                Standard: book up to {STANDARD_ADVANCE_DAYS} days ahead.
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.dayRow}>
            {days.map((day, index) => {
              const key = toDateKey(day);
              const selected = key === selectedDay;
              const locked = isDayLocked(index, isPremium);
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setSelectedDay(key);
                    setSelectedSlot(null);
                  }}
                  style={[styles.dayCard, selected && styles.dayCardSelected]}>
                  {locked ? <IconSymbol name="lock.fill" size={10} color={selected ? FuttyColors.white : FuttyColors.stone400} /> : null}
                  <ThemedText style={[styles.dayCardName, selected && styles.dayCardTextSelected]}>
                    {isToday(day) ? 'Today' : weekdayLabel(day)}
                  </ThemedText>
                  <ThemedText style={[styles.dayCardNumber, selected && styles.dayCardTextSelected]}>
                    {dayNumberLabel(day)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {step === 'time' ? (
        <>
          {dayBookings.status === 'loading' || dayBookings.status === 'idle' ? <ActivityIndicator /> : null}
          {dayBookings.status === 'error' ? (
            <ThemedText style={styles.note}>Could not load availability: {dayBookings.message}</ThemedText>
          ) : null}
          {dayBookings.status === 'ready' && slots.length === 0 ? (
            <ThemedText style={styles.note}>No slot fits between opening and closing time.</ThemedText>
          ) : null}
          {dayBookings.status === 'ready' && slots.length > 0 ? (
            <View style={styles.timeGrid}>
              {slots.map((slot) => (
                <TimeSlotButton
                  key={slot.start}
                  slot={slot}
                  selected={selectedSlot?.start === slot.start}
                  onPress={() => setSelectedSlot(slot)}
                />
              ))}
            </View>
          ) : null}
          {dayLockedPrompt ? (
            <View style={styles.premiumNote}>
              <IconSymbol name="crown.fill" size={13} color={FuttyColors.amber400} />
              <ThemedText style={styles.premiumNoteText}>
                This day needs Premium — standard accounts book up to {STANDARD_ADVANCE_DAYS} days ahead.
              </ThemedText>
            </View>
          ) : null}
        </>
      ) : null}

      {step === 'need' ? (
        <View style={styles.wrapRow}>
          <Chip
            icon="person.2.fill"
            label="Need players"
            selected={needChoice === 'players'}
            onPress={() => setNeedChoice('players')}
          />
          <Chip
            icon="flag.fill"
            label="Need opposition"
            selected={needChoice === 'opposition'}
            onPress={() => setNeedChoice('opposition')}
          />
          <Chip
            icon="checkmark"
            label="Neither"
            selected={needChoice === 'neither'}
            onPress={() => setNeedChoice('neither')}
          />
        </View>
      ) : null}

      {bookError ? <ThemedText style={styles.errorText}>{bookError}</ThemedText> : null}
    </WizardModal>
  );
}

const styles = StyleSheet.create({
  stepTitle: {
    fontSize: 26,
  },
  stepSubtitle: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 16,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  errorText: {
    fontSize: 13,
    color: FuttyColors.rose600,
    marginTop: 12,
  },
  premiumNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FuttyColors.stone200,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  premiumNoteText: {
    flex: 1,
    fontSize: 12,
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayCard: {
    width: 60,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    gap: 2,
    backgroundColor: FuttyColors.stone200,
  },
  dayCardSelected: {
    backgroundColor: FuttyColors.emerald950,
  },
  dayCardName: {
    fontSize: 11,
    fontWeight: '600',
    color: FuttyColors.stone700,
  },
  dayCardNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: FuttyColors.stone900,
  },
  dayCardTextSelected: {
    color: FuttyColors.white,
  },
  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeSlot: {
    minWidth: 72,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: FuttyColors.stone200,
  },
  timeSlotSelected: {
    backgroundColor: FuttyColors.emerald950,
  },
  timeSlotDisabled: {
    opacity: 0.5,
  },
  timeSlotText: {
    fontSize: 13,
    fontWeight: '700',
    color: FuttyColors.stone900,
  },
  timeSlotTextSelected: {
    color: FuttyColors.white,
  },
  timeSlotTextDisabled: {
    textDecorationLine: 'line-through',
    color: FuttyColors.stone500,
  },
  completedWrap: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    gap: 16,
    backgroundColor: FuttyColors.stone50,
  },
  doneButton: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FuttyColors.emerald950,
  },
  doneButtonText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 16,
    color: FuttyColors.white,
  },
});
