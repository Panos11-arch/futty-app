import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';

export const DAY_PICKER_LENGTH = 21;

/**
 * Formats as YYYY-MM-DD in *local* time, to match a Postgres `date` column.
 * Deliberately not toISOString(), which converts to UTC first and can therefore
 * report yesterday's date for anyone east of Greenwich in the evening.
 */
export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today in Cyprus (Asia/Nicosia) at the instant `from`, plus the following
 * `count - 1` days. Each is a local-midnight Date whose toDateKey() is that
 * Cyprus date, so a phone abroad never skips or adds a day around midnight.
 */
export function nextDays(count: number = DAY_PICKER_LENGTH, from: Date = new Date()) {
  const base = dateKeyToDate(cyprusDateKey(from));

  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(base);
    // setDate handles month and year rollover, and DST shifts, for us.
    date.setDate(base.getDate() + offset);
    return date;
  });
}

/**
 * `nextDays(count)`, recomputed whenever the app returns to the foreground —
 * not just once at module load. RN doesn't reload the JS bundle on
 * background/foreground, only on a full kill+relaunch, so a plain module-level
 * `const DAYS = nextDays()` goes stale the moment a user leaves the app
 * running across midnight: day 0 stops being "today", `isToday()` never
 * matches it, and slots on that now-past day stop being marked as passed.
 */
export function useDays(count: number = DAY_PICKER_LENGTH) {
  const [days, setDays] = useState(() => nextDays(count));

  useEffect(() => {
    setDays(nextDays(count));

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDays(nextDays(count));
    });

    return () => subscription.remove();
  }, [count]);

  return days;
}

export function weekdayLabel(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

export function dayNumberLabel(date: Date) {
  return String(date.getDate());
}

export function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'short' });
}

/**
 * Whether `date` (a day as toDateKey/dateKeyToDate build it) is today in Cyprus
 * (Asia/Nicosia), not today on the phone. Booking and fixture days are Cyprus
 * dates, so a phone still on London, New York or Tokyo time must not move
 * "Today" to another day.
 */
export function isToday(date: Date, now: Date = new Date()) {
  return toDateKey(date) === cyprusDateKey(now);
}

const cyprusDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Cyprus date (YYYY-MM-DD) at the instant `now`. Same as cyprusToday in
 *  lib/venue-today.ts, which can't be imported here: it pulls in the Supabase
 *  client. */
function cyprusDateKey(now: Date) {
  const parts: Record<string, string> = {};
  for (const part of cyprusDate.formatToParts(now)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Inverse of toDateKey — parses "YYYY-MM-DD" as a local midnight Date, not UTC. */
export function dateKeyToDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Combines a toDateKey() day with a Postgres "HH:MM:SS" time into one local
 * Date. Use `.toISOString()` on the result before sending it to a
 * `timestamptz` column/param — a bare "2026-08-01T18:00:00" string has no
 * offset, so Postgres reads it in the database session's timezone (UTC on
 * Supabase) instead of the device's local (Cyprus) time, silently shifting
 * the stored instant by a few hours.
 */
export function dateKeyAndTimeToDate(dateKey: string, time: string) {
  const date = dateKeyToDate(dateKey);
  const [hours, minutes, seconds] = time.split(':').map(Number);
  date.setHours(hours, minutes, seconds || 0, 0);
  return date;
}

/** "Today" when `date` is today in Cyprus, otherwise "Mon 3 Aug". */
export function dayLabel(date: Date, now: Date = new Date()) {
  return isToday(date, now) ? 'Today' : `${weekdayLabel(date)} ${dayNumberLabel(date)} ${monthLabel(date)}`;
}
