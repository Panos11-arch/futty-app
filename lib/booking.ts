/**
 * Slot availability rules, ported from the prototype's `slotGrid` so the app and
 * the prototype agree exactly. See futty-app_2.jsx (`slotGrid` / `bookSlot`).
 */

export type CapacityOption = {
  capacity: number;
  format: string;
  /** How many of the venue's pitches this format consumes. */
  pitches: number;
};

export const CAPACITY_OPTIONS: CapacityOption[] = [
  { capacity: 10, format: '5-a-side', pitches: 1 },
  { capacity: 14, format: '7-a-side', pitches: 2 },
  { capacity: 18, format: '9-a-side', pitches: 3 },
  { capacity: 22, format: '11-a-side', pitches: 4 },
];

export const DURATIONS = [1, 1.5, 2] as const;
export type DurationHours = (typeof DURATIONS)[number];

export const SLOT_STEP_MINUTES = 30;

export function pitchesForCapacity(capacity: number) {
  return CAPACITY_OPTIONS.find((option) => option.capacity === capacity)?.pitches ?? 1;
}

export function formatForCapacity(capacity: number) {
  return CAPACITY_OPTIONS.find((option) => option.capacity === capacity)?.format ?? '';
}

export function durationLabel(hours: DurationHours) {
  return hours === 1 ? '1h' : hours === 1.5 ? '1h 30' : '2h';
}

/**
 * Postgres `time` values arrive as "HH:MM:SS" where the prototype used "HH:MM".
 * Both parse identically, and a close time of "24:00:00" correctly yields 1440
 * rather than wrapping to 0.
 */
export function timeToMin(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

export function minToTime(min: number) {
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The fields of a venue_bookings row that affect availability. */
export type BookingWindow = {
  start_time: string;
  end_time: string;
  pitches: number;
};

export type Slot = {
  start: string;
  end: string;
  /** Pitches still free across the whole slot. */
  free: number;
  available: boolean;
};

export function canFitFormat(basePitches: number, capacity: number) {
  return basePitches >= pitchesForCapacity(capacity);
}

export function buildSlotGrid(params: {
  openTime: string;
  closeTime: string;
  basePitches: number;
  bookings: BookingWindow[];
  capacity: number;
  durationHours: number;
}): Slot[] {
  const { openTime, closeTime, basePitches, bookings, capacity, durationHours } = params;

  const needed = pitchesForCapacity(capacity);
  const durationMin = durationHours * 60;
  const openMin = timeToMin(openTime);
  const closeMin = timeToMin(closeTime);
  const slots: Slot[] = [];

  // The slot must finish by closing time, so the last start is close - duration.
  for (let start = openMin; start + durationMin <= closeMin; start += SLOT_STEP_MINUTES) {
    const end = start + durationMin;
    let used = 0;

    for (const booking of bookings) {
      const bookingStart = timeToMin(booking.start_time);
      const bookingEnd = timeToMin(booking.end_time);

      // Half-open overlap: a booking that ends exactly when this slot begins
      // does not conflict with it.
      if (bookingStart < end && bookingEnd > start) {
        used += booking.pitches;
      }
    }

    const free = basePitches - used;
    slots.push({
      start: minToTime(start),
      end: minToTime(end),
      free,
      available: free >= needed,
    });
  }

  return slots;
}
