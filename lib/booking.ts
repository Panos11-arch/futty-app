/**
 * Booking helpers for the venue model (P3): named pitches, opening hours per
 * weekday and price rules. Availability and prices come from the server
 * (venue_free_slots); these only shape what it returns for the screen. The
 * legacy pooled venue columns (base_pitches, open_time, close_time,
 * price_per_pitch_hour) are not read anywhere.
 */

export type CapacityOption = {
  capacity: number;
  format: string;
};

/** The formats leagues and fixtures use, with their player counts. */
export const CAPACITY_OPTIONS: CapacityOption[] = [
  { capacity: 10, format: '5-a-side' },
  { capacity: 14, format: '7-a-side' },
  { capacity: 18, format: '9-a-side' },
  { capacity: 22, format: '11-a-side' },
];

/** Every format a pitch can host, smallest first (as the server's pitches.size check). */
export const PITCH_FORMATS = ['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] as const;

export const DURATIONS = [1, 1.5, 2] as const;
export type DurationHours = (typeof DURATIONS)[number];

export const SLOT_STEP_MINUTES = 30;

export function durationLabel(hours: DurationHours) {
  return hours === 1 ? '1h' : hours === 1.5 ? '1h 30' : '2h';
}

/** "5-a-side" -> 10 players. */
export function playersForFormat(format: string): number | null {
  const m = format.match(/^(\d+)-a-side$/);
  return m ? Number(m[1]) * 2 : null;
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

/** ISO weekday (1 = Monday ... 7 = Sunday) of a "YYYY-MM-DD" day, the same on every device. */
export function isoWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The formats a venue can be booked for: any its open pitches host, or a
 *  pitch combination makes. Smallest first. */
export function formatsOffered(
  pitches: { formats: string[]; is_open: boolean }[],
  combinations: { format: string }[],
): string[] {
  const offered = new Set<string>();
  for (const pitch of pitches) if (pitch.is_open) pitch.formats.forEach((f) => offered.add(f));
  for (const combination of combinations) offered.add(combination.format);
  return PITCH_FORMATS.filter((f) => offered.has(f));
}

/** A free slot as venue_free_slots returns it. */
export type FreeSlot = { start_time: string; end_time: string; price_cents: number };

export type Slot = {
  start: string;
  end: string;
  /** Free to book now: the server returned it (open, not past in Cyprus time, a pitch free, priced). */
  available: boolean;
  /** The server's price for the whole game, in cents; null when not available. */
  priceCents: number | null;
};

/**
 * Every start time in the day's opening hours, every 30 minutes, for a game
 * of `minutes`; a slot is available only when the server listed it as free.
 * Times outside the hours aren't shown; times inside them that the server
 * didn't list (booked, blocked, past) show as unavailable.
 */
export function slotGrid(hours: { opens: string; closes: string } | null, free: FreeSlot[], minutes: number): Slot[] {
  if (!hours) return [];
  const freeByStart = new Map(free.map((s) => [minToTime(timeToMin(s.start_time)), s]));
  // The same bounds as venue_free_slots: a game must end by closing time.
  const opens = timeToMin(hours.opens);
  const closes = timeToMin(hours.closes);
  const slots: Slot[] = [];
  for (let start = opens; start + minutes <= closes; start += SLOT_STEP_MINUTES) {
    const key = minToTime(start);
    const match = freeByStart.get(key);
    slots.push({
      start: key,
      end: minToTime(start + minutes),
      available: !!match,
      priceCents: match ? match.price_cents : null,
    });
  }
  return slots;
}
