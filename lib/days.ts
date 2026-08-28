import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

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

/** Today plus the following `count - 1` days, each normalised to midnight local. */
export function nextDays(count: number = DAY_PICKER_LENGTH, from: Date = new Date()) {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());

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

export function isToday(date: Date) {
  return toDateKey(date) === toDateKey(new Date());
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

export function dayLabel(date: Date) {
  return isToday(date) ? 'Today' : `${weekdayLabel(date)} ${dayNumberLabel(date)} ${monthLabel(date)}`;
}
