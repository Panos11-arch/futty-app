// Booking days and times in the database are Cyprus wall-clock time
// (Asia/Nicosia: UTC+2 in winter, UTC+3 in summer). The phone may be set to any
// time zone, so `new Date('2026-12-05T19:00')` (device local time) is wrong for
// a visitor whose phone is still on London time. This turns a Cyprus day and
// time into the exact instant, whatever the phone's zone.

export const CYPRUS_TIME_ZONE = 'Asia/Nicosia';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const cyprusParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Minutes Cyprus is ahead of UTC at the instant `epochMs`. */
function cyprusOffsetMinutes(epochMs: number): number {
  const parts: Record<string, number> = {};
  for (const part of cyprusParts.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

/**
 * The instant at which it is `day` (YYYY-MM-DD) `time` (HH:MM or HH:MM:SS, as
 * Postgres returns it) in Cyprus. "24:00" is midnight at the end of `day`.
 */
export function cyprusWallTime(day: string, time: string): Date {
  const d = DAY.exec(day);
  const t = TIME.exec(time);
  if (!d || !t) throw new Error(`Not a Cyprus day and time: ${day} ${time}`);

  // The wall-clock reading as if it were UTC, then shifted by Cyprus's offset.
  // The offset is checked again at the result because the first guess can sit
  // on the other side of a daylight-saving change.
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
  let instant = wall - cyprusOffsetMinutes(wall) * 60000;
  instant = wall - cyprusOffsetMinutes(instant) * 60000;
  return new Date(instant);
}
