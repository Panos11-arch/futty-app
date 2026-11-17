// P6 check-in QR (docs/specs/match-record.md decisions 1a.1 and 1a.4,
// sections 4.4, 4.9a and 5.4; spec 05 section 12, item 7).
//
// The venue shows futtyapp://check-in?match=<id>&code=<code> as a QR, with
// the code from get_match_check_in_code (agreed with Anghelo, 17 November).
// A player scans it in the app, or with the phone's own camera, or types the
// code, and check_in_to_match decides: it checks the player, the code and the
// window. The app only reads the link, shows when the window is open (from
// the server's kickoff_at and ends_at) and words the server's refusal.
import type { PostgrestError } from '@supabase/supabase-js';

import { formatKickoff } from '@/lib/match/format';
import { supabase } from '@/lib/supabase';
import { fetchCheckInCode } from '@/lib/venue-today';

const SCHEME = 'futtyapp';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[0-9a-z]+$/;
/** Decision 1a.4: 60 minutes before kickoff, until 1 hour after the end. */
const HOUR_MS = 60 * 60 * 1000;

export type CheckInLink = { kind: 'ok'; matchId: string; code: string } | { kind: 'not_futty' } | { kind: 'malformed' };
export type ScanProblem = 'not_futty' | 'malformed' | 'other_match';

/** What the venue's QR holds. */
export function checkInLink(matchId: string, code: string): string {
  return `${SCHEME}://check-in?match=${encodeURIComponent(matchId)}&code=${encodeURIComponent(code)}`;
}

/** A typed code: spaces, dashes and case don't matter. */
export function normaliseCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toLowerCase();
}

/** "3f9a 1c0e 5b7d …", for reading a code out and typing it. */
export function groupCode(code: string): string {
  return (normaliseCode(code).match(/.{1,4}/g) ?? []).join(' ');
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The deep link route's params (app/check-in.tsx). */
export function parseCheckInParams(params: Record<string, string | string[] | undefined>): CheckInLink {
  const matchId = (first(params.match) ?? '').trim().toLowerCase();
  const code = (first(params.code) ?? '').trim().toLowerCase();
  if (!UUID.test(matchId) || !CODE.test(code)) return { kind: 'malformed' };
  return { kind: 'ok', matchId, code };
}

/** Whatever a scanned QR holds. */
export function parseCheckInLink(text: string): CheckInLink {
  const found = /^futtyapp:\/\/\/?check-in\/?(?:\?(.*))?$/i.exec(text.trim());
  if (!found) return { kind: 'not_futty' };
  const params: Record<string, string> = {};
  for (const pair of (found[1] ?? '').split('&')) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const key = pair.slice(0, at);
    if (key in params) continue;
    try {
      params[key] = decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '));
    } catch {
      return { kind: 'malformed' };
    }
  }
  return parseCheckInParams(params);
}

/** A scan on one match's screen: the code, or why it can't be used here. */
export function checkLinkFor(matchId: string, text: string): { kind: 'ok'; code: string } | { kind: ScanProblem } {
  const link = parseCheckInLink(text);
  if (link.kind !== 'ok') return link;
  if (link.matchId !== matchId.toLowerCase()) return { kind: 'other_match' };
  return { kind: 'ok', code: link.code };
}

type Times = { kickoff_at: string; ends_at: string };

export function checkInWindow(match: Times): { opens: Date; closes: Date } {
  return {
    opens: new Date(Date.parse(match.kickoff_at) - HOUR_MS),
    closes: new Date(Date.parse(match.ends_at) + HOUR_MS),
  };
}

/** As check_in_to_match: open from `opens`, closed from `closes`; never for a void match. */
export function windowState(match: Times & { status: string }, now: Date): 'before' | 'open' | 'closed' {
  if (match.status === 'void') return 'closed';
  const { opens, closes } = checkInWindow(match);
  const t = now.getTime();
  if (t < opens.getTime()) return 'before';
  if (t >= closes.getTime()) return 'closed';
  return 'open';
}

/** "19:00", Cyprus time. */
export function opensAtLabel(match: Times): string {
  return formatKickoff(checkInWindow(match).opens.toISOString());
}

/** "Players can check in from 19:00 to 22:00.", Cyprus time. */
export function windowLabel(match: Times): string {
  const { opens, closes } = checkInWindow(match);
  return `Players can check in from ${formatKickoff(opens.toISOString())} to ${formatKickoff(closes.toISOString())}.`;
}

export type CheckInMatch = {
  id: string;
  kickoff_at: string;
  ends_at: string;
  status: string;
  venue_name: string | null;
};

type MatchRow = Omit<CheckInMatch, 'venue_name'> & { venues: { name: string } | null };

/** The booking's match (not a void one), or a match by id; null when the
 *  player can't see it (RLS) or there is none. */
export async function fetchCheckInMatch(
  by: { bookingId: string } | { matchId: string },
): Promise<{ data: CheckInMatch | null; error: PostgrestError | null }> {
  let query = supabase.from('matches').select('id, kickoff_at, ends_at, status, venues(name)');
  query = 'bookingId' in by ? query.eq('booking_id', by.bookingId).neq('status', 'void') : query.eq('id', by.matchId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return { data: null, error: error ?? null };
  const { venues, ...match } = data as unknown as MatchRow;
  return { data: { ...match, venue_name: venues?.name ?? null }, error: null };
}

/** Whether the player has a match_attendance row (section 4.4). */
export async function fetchMyCheckIn(
  matchId: string,
  profileId: string,
): Promise<{ data: boolean; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('match_attendance')
    .select('match_id')
    .eq('match_id', matchId)
    .eq('profile_id', profileId)
    .maybeSingle();
  return { data: !error && !!data, error: error ?? null };
}

/** Section 5.4. Idempotent: already checked in is a success. */
export function checkInToMatch(matchId: string, code: string) {
  return supabase.rpc('check_in_to_match', { p_match_id: matchId, p_code: normaliseCode(code) });
}

const QR_LOAD_FAILED = "We couldn't load the check-in code. Try again.";

export type CheckInQr ={ code: string; kickoffAt: string; endsAt: string };

/** Venue staff: the code and the match's times, for the QR and its window. */
export async function loadCheckInQr(matchId: string): Promise<CheckInQr | { error: string }> {
  const [code, match] = await Promise.all([fetchCheckInCode(matchId), fetchCheckInMatch({ matchId })]);
  if (code.error || typeof code.data !== 'string') {
    const refusal = code.error?.message.trim() ?? '';
    const known = refusal === 'not_venue_staff' || refusal === 'match_not_found';
    return { error: known ? checkInErrorWords(refusal) : QR_LOAD_FAILED };
  }
  if (match.error) return { error: QR_LOAD_FAILED };
  if (!match.data) return { error: checkInErrorWords('match_not_found') };
  return { code: code.data, kickoffAt: match.data.kickoff_at, endsAt: match.data.ends_at };
}

export function checkInErrorWords(message: string): string {
  switch (message.trim()) {
    case 'invalid_code':
      return "That code doesn't match this game. Check it with the venue.";
    case 'check_in_closed':
      return 'Check-in for this game is closed. It opens an hour before kickoff and closes an hour after the end.';
    case 'not_in_match':
      return "You're not in this game, so you can't check in to it.";
    case 'match_not_found':
      return "We couldn't find this game.";
    case 'not_venue_staff':
      return "Only this venue's staff can show its check-in code.";
    default:
      return "We couldn't check you in. Try again.";
  }
}

export function scanWords(problem: ScanProblem): string {
  switch (problem) {
    case 'not_futty':
      return "That's not a Futty check-in code. Scan the QR the venue shows you.";
    case 'malformed':
      return "That check-in code can't be read. Scan it again, or type the code.";
    case 'other_match':
      return 'That code is for a different game.';
  }
}
