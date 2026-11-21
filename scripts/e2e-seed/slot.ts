// The slot each platform books, in Cyprus time (Asia/Nicosia), never UTC.
//
// Two days ahead of today in Cyprus, at a fixed time per platform:
// - more than 6 hours before kickoff, so the booking has its free hour and
//   no "non-refundable" notice (spec 13, "When money is held and taken",
//   steps 2 and 4): cancelling it straight after paying gives everything
//   back;
// - inside a standard account's 7-day booking window (spec 13, "Premium").
// The day is computed when the seed runs and handed to the flows.
import type { Platform } from './config';

export const CYPRUS_TIME_ZONE = 'Asia/Nicosia';
export const E2E_DAYS_AHEAD = 2;
export const E2E_MINUTES = 60;
export const E2E_START: Record<Platform, string> = { ios: '19:00', android: '20:00' };

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function cyprusParts(at: Date) {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Today's date in Cyprus, YYYY-MM-DD. */
export function cyprusToday(now: Date = new Date()): string {
  const { y, m, d } = cyprusParts(now);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A calendar date plus n days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The instant a Cyprus wall-clock time happens. */
export function cyprusWallTime(day: string, time: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wanted = Date.UTC(y, m - 1, d, h, mi);
  let guess = wanted;
  // Twice, for the hour around a daylight-saving change.
  for (let i = 0; i < 2; i++) {
    const p = cyprusParts(new Date(guess));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    guess += wanted - shown;
  }
  return new Date(guess);
}

function plusMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type E2eSlot = { day: string; start: string; end: string; kickoffAt: Date };

export function e2eSlot(platform: Platform, now: Date = new Date()): E2eSlot {
  const day = addDays(cyprusToday(now), E2E_DAYS_AHEAD);
  const start = E2E_START[platform];
  return { day, start, end: plusMinutes(start, E2E_MINUTES), kickoffAt: cyprusWallTime(day, start) };
}
