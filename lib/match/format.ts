// Match dates and times in Cyprus time (Asia/Nicosia), whatever time zone
// the phone is in. Shown with tabular figures by the components.
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(format: Intl.DateTimeFormat, iso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of format.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** "Sat 14 Nov" */
export function formatMatchDate(iso: string): string {
  const p = parts(dateFormat, iso);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "19:00" */
export function formatKickoff(iso: string): string {
  const p = parts(timeFormat, iso);
  return `${p.hour}:${p.minute}`;
}

/** "Sat 14 Nov · 19:00" */
export function formatMatchWhen(iso: string): string {
  return `${formatMatchDate(iso)} · ${formatKickoff(iso)}`;
}
