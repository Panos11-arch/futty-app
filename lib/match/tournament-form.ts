// S10A admin: the tournament form's fields as typed, turned into what
// admin_create_tournament / admin_update_tournament take, and back. Dates are
// Cyprus days and times (Asia/Nicosia, lib/calendar/cyprus-time.ts). The fee
// is read as whole cents, never through floating point. The server checks
// every field again (match-record.md 1o).
import { CYPRUS_TIME_ZONE, cyprusWallTime } from '@/lib/calendar/cyprus-time';
import type { Tournament, TournamentInput } from '@/lib/match/tournament-api';
import { formatEurosPlain, parseEurosInput } from '@/lib/money/format';

export const TOURNAMENT_FORMATS = ['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] as const;
export const SQUAD_SUBS = [0, 1, 2] as const;

export type TournamentForm = {
  name: string;
  area: string;
  venueId: string | null;
  format: string;
  /** YYYY-MM-DD, or empty for "Coming soon". */
  startDate: string;
  endDate: string;
  /** The sign-up deadline's Cyprus day (YYYY-MM-DD) and time (HH:MM); both empty for none. */
  deadlineDay: string;
  deadlineTime: string;
  squadSubs: number;
  /** As typed: "12" or "12.50". */
  entryFee: string;
  /** As typed. */
  matchMinutes: string;
};

export const EMPTY_FORM: TournamentForm = {
  name: '',
  area: '',
  venueId: null,
  format: '5-a-side',
  startDate: '',
  endDate: '',
  deadlineDay: '',
  deadlineTime: '',
  squadSubs: 2,
  entryFee: '',
  matchMinutes: '',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

/** A Cyprus day and time as an ISO instant; null when either isn't valid. */
export function cyprusInstant(day: string, time: string): string | null {
  if (!DAY.test(day.trim()) || !TIME.test(time.trim())) return null;
  const [h, m] = time.trim().split(':').map(Number);
  if (h > 23 || m > 59) return null;
  const date = cyprusWallTime(day.trim(), time.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The form as the server's JSON, or the server's own error code for what's wrong. */
export function toTournamentInput(form: TournamentForm): { input: TournamentInput } | { error: string } {
  const name = form.name.trim();
  const area = form.area.trim();
  if (!name || !area) return { error: 'invalid_tournament' };
  const fee = parseEurosInput(form.entryFee);
  if (fee === null) return { error: 'invalid_entry_fee' };
  // Whole minutes; the allowed range is the server's (invalid_match_minutes).
  const minutes = /^\d{1,4}$/.test(form.matchMinutes.trim()) ? Number(form.matchMinutes.trim()) : NaN;
  if (!Number.isInteger(minutes)) return { error: 'invalid_match_minutes' };
  const start = form.startDate.trim();
  const end = form.endDate.trim();
  if ((start && !DAY.test(start)) || (end && !DAY.test(end)) || (end && !start) || (start && end && end < start)) {
    return { error: 'invalid_dates' };
  }
  let deadline: string | null = null;
  if (form.deadlineDay.trim() || form.deadlineTime.trim()) {
    deadline = cyprusInstant(form.deadlineDay, form.deadlineTime);
    if (!deadline) return { error: 'invalid_dates' };
  }
  return {
    input: {
      name,
      area,
      venueId: form.venueId,
      format: form.format,
      startDate: start || null,
      endDate: end || null,
      registrationDeadline: deadline,
      squadSubs: form.squadSubs,
      entryFeeCents: fee,
      matchMinutes: minutes,
    },
  };
}

/** For an edit: only the fields that changed, so nothing the form didn't
 *  know (a Coming soon tournament's header has no deadline or match length)
 *  is wiped. admin_update_tournament merges only the keys it is sent. */
export function toTournamentChanges(
  initial: TournamentForm,
  form: TournamentForm,
): { input: Partial<TournamentInput> } | { error: string } {
  // A match length the header didn't carry: compared against the new one, so
  // it's sent only when typed, and never sent empty.
  const initialKnown = initial.matchMinutes.trim() !== '';
  const formKnown = form.matchMinutes.trim() !== '';
  const fill = (f: TournamentForm, minutes: string) => (f.matchMinutes.trim() ? f : { ...f, matchMinutes: minutes });
  const next = toTournamentInput(fill(form, '15'));
  if ('error' in next) return next;
  const before = toTournamentInput(fill(initial, formKnown ? form.matchMinutes : '15'));
  const old: Partial<TournamentInput> = 'input' in before ? before.input : {};
  const input: Partial<TournamentInput> = {};
  for (const key of Object.keys(next.input) as (keyof TournamentInput)[]) {
    if (key === 'matchMinutes' && !formKnown) continue;
    const changed = JSON.stringify(next.input[key]) !== JSON.stringify(old[key]);
    if (changed || (key === 'matchMinutes' && !initialKnown)) {
      (input as Record<string, unknown>)[key] = next.input[key];
    }
  }
  return { input };
}

const cyprusParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** An instant as its Cyprus day and time ("2026-12-06", "19:00"). */
export function cyprusDayTime(iso: string): { day: string; time: string } {
  const p: Record<string, string> = {};
  for (const part of cyprusParts.formatToParts(new Date(iso))) p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** An existing tournament in the form, to edit. */
export function formFromTournament(t: Tournament): TournamentForm {
  const deadline = t.registrationDeadline ? cyprusDayTime(t.registrationDeadline) : null;
  return {
    name: t.name,
    area: t.area,
    venueId: t.venueId,
    format: t.format,
    startDate: t.startDate ?? '',
    endDate: t.endDate ?? '',
    deadlineDay: deadline?.day ?? '',
    deadlineTime: deadline?.time ?? '',
    squadSubs: t.squadMax != null && t.squadMin != null ? t.squadMax - t.squadMin : 2,
    entryFee: formatEurosPlain(t.entryFeeCents),
    matchMinutes: t.matchMinutes != null ? String(t.matchMinutes) : '',
  };
}
