// Cyprus dates for Edge Functions.
//
// Edge Functions run on UTC servers, but every booking day and time in the
// database is Cyprus wall-clock time (Asia/Nicosia: UTC+2 in winter, UTC+3
// in summer). `new Date().toISOString().slice(0, 10)` gives the UTC date,
// which is yesterday in Cyprus between midnight and 02:00 (03:00 in summer).

export const CYPRUS_TIME_ZONE = 'Asia/Nicosia';

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The date in Cyprus at `at` (default: now), as YYYY-MM-DD. */
export function cyprusToday(at: Date = new Date()): string {
  const parts = Object.fromEntries(dateParts.formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
