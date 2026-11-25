// The venue page's Book tab (S5; 03-venue-book-tab): the day strip, the
// day's start times (taken ones struck through) and the slot checkout
// prices. The free times come from venue_free_slots and the pitches and
// prices from venue_free_pitches: this file only shapes them.
import type { Slot as DaySlot } from '@/lib/booking';
import { endTime, type Slot } from '@/lib/booking-search';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';

/** A day in the strip: "Thu" over "26"; the label is for screen readers and the bar. */
export function dayCell(day: string): { weekday: string; date: string; label: string } {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const month = date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return { weekday, date: String(d), label: `${weekday} ${d} ${month}` };
}

/** The day's start times: every one in the opening hours not yet past in
 *  Cyprus; one the server didn't list as free is taken. */
export function bookTimes(slots: DaySlot[], day: string, now: Date): { start: string; taken: boolean }[] {
  return slots
    .filter((s) => cyprusWallTime(day, s.start).getTime() > now.getTime())
    .map((s) => ({ start: s.start, taken: !s.available }));
}

export type BookSelection = {
  day: string;
  start: string | null;
  minutes: number;
  format: string | null;
  playersPerSide: 5 | 6;
};

/** The slot the pitch list and checkout price; null until a time and format
 *  are chosen, or when the game would run past midnight. */
export function venueSlot(venueId: string, s: BookSelection): Slot | null {
  if (!s.start || !s.format) return null;
  const end = endTime(s.start, s.minutes);
  if (!end) return null;
  return { venueId, day: s.day, start: s.start, end, format: s.format, playersPerSide: s.playersPerSide };
}

/** The bar above Continue: "Thu 26 Nov · 20:00" over "Pitch 2 · 5-a-side". */
export function continueLine(
  day: string,
  start: string,
  pitch: string | null,
  format: string,
): { title: string; subtitle: string } {
  const { label } = dayCell(day);
  return { title: `${label} · ${start.slice(0, 5)}`, subtitle: [pitch, format].filter(Boolean).join(' · ') };
}
