// Reads and writes for match results. Every write goes through A2's
// functions (submit_match_result, respond_to_match_result): the app sends
// the match id and the scores or the answer, and the server decides
// whether the caller may (docs/specs/match-record.md section 5.2).
import type { ResultMatch } from '@/lib/match/result';
import type { MatchRecord, MatchResultSubmission, MatchSideRecord, Side } from '@/lib/match/types';
import { supabase } from '@/lib/supabase';

const MATCH_COLUMNS =
  'id, booking_id, venue_id, friendly_match_id, league_fixture_id, kind, format, players_per_side, kickoff_at, ends_at, status, result_deadline_at, side_a_score, side_b_score, forfeit_side, forfeit_reason, confirmed_at, confirmed_via, created_at, updated_at';

const RESULT_SELECT = `${MATCH_COLUMNS},
  match_sides (match_id, side, team_id, label, captain_profile_id),
  match_result_submissions (id, match_id, side, side_a_score, side_b_score, submitted_by, submitted_at, response, responded_by, responded_at),
  match_players (id, side, profile_id, left_at),
  venue:venues (name)`;

type ResultRow = MatchRecord & {
  match_sides: MatchSideRecord[] | null;
  match_result_submissions: MatchResultSubmission[] | MatchResultSubmission | null;
  match_players: { id: string; side: Side | null; profile_id: string | null; left_at: string | null }[] | null;
  venue: { name: string } | { name: string }[] | null;
};

/** Shapes one embedded row; null when a side is missing (never for a real match). */
export function toResultMatch(row: ResultRow, viewerId: string): ResultMatch | null {
  const { match_sides, match_result_submissions, match_players, venue, ...match } = row;
  const a = match_sides?.find((s) => s.side === 'a');
  const b = match_sides?.find((s) => s.side === 'b');
  if (!a || !b) return null;
  // match_id is unique on submissions, so PostgREST may embed it as one object.
  const submission = Array.isArray(match_result_submissions)
    ? (match_result_submissions[0] ?? null)
    : match_result_submissions;
  const me = match_players?.find((p) => p.profile_id === viewerId && p.left_at === null) ?? null;
  const venueRow = Array.isArray(venue) ? venue[0] : venue;
  return {
    match,
    sides: { a, b },
    submission,
    myPlayer: me ? { id: me.id, side: me.side } : null,
    venueName: venueRow?.name ?? null,
  };
}

function selectResults(viewerId: string) {
  return supabase
    .from('matches')
    .select(RESULT_SELECT)
    .eq('match_players.profile_id', viewerId);
}

/** One match with what the result screen needs. RLS shows it to match members only. */
export async function getResultMatch(matchId: string, viewerId: string) {
  const { data, error } = await selectResults(viewerId).eq('id', matchId).maybeSingle();
  if (error) return { match: null, error };
  return { match: data ? toResultMatch(data as unknown as ResultRow, viewerId) : null, error: null };
}

/** The viewer's matches whose result is still open: kicked off, before the deadline. */
export async function listMyOpenResultMatches(viewerId: string, now: Date = new Date()) {
  const iso = now.toISOString();
  const { data, error } = await selectResults(viewerId)
    .in('status', ['scheduled', 'played'])
    .lte('kickoff_at', iso)
    .gt('result_deadline_at', iso)
    .order('kickoff_at', { ascending: false });
  if (error) return { matches: [] as ResultMatch[], error };
  const matches = ((data ?? []) as unknown as ResultRow[])
    .map((row) => toResultMatch(row, viewerId))
    .filter((m): m is ResultMatch => m !== null);
  return { matches, error: null };
}

export type MatchLinkCandidates = {
  bookingIds?: string[];
  friendlyMatchIds?: string[];
  leagueFixtureIds?: string[];
};

/** Which match each candidate id has (a match made since A2). Ids without
 *  one are games recorded before A2 and keep their old score form. */
export type MatchLinks = {
  byBookingId: Map<string, string>;
  byFriendlyMatchId: Map<string, string>;
  byLeagueFixtureId: Map<string, string>;
};

export const emptyMatchLinks = (): MatchLinks => ({
  byBookingId: new Map(),
  byFriendlyMatchId: new Map(),
  byLeagueFixtureId: new Map(),
});

export async function findMatchLinks(candidates: MatchLinkCandidates) {
  const links = emptyMatchLinks();
  const filters = [
    candidates.bookingIds?.length ? `booking_id.in.(${candidates.bookingIds.join(',')})` : null,
    candidates.friendlyMatchIds?.length ? `friendly_match_id.in.(${candidates.friendlyMatchIds.join(',')})` : null,
    candidates.leagueFixtureIds?.length ? `league_fixture_id.in.(${candidates.leagueFixtureIds.join(',')})` : null,
  ].filter((f): f is string => f !== null);
  if (filters.length === 0) return { links, error: null };

  const { data, error } = await supabase
    .from('matches')
    .select('id, booking_id, friendly_match_id, league_fixture_id')
    .or(filters.join(','));
  if (error) return { links, error };

  for (const row of (data ?? []) as Pick<MatchRecord, 'id' | 'booking_id' | 'friendly_match_id' | 'league_fixture_id'>[]) {
    if (row.booking_id) links.byBookingId.set(row.booking_id, row.id);
    if (row.friendly_match_id) links.byFriendlyMatchId.set(row.friendly_match_id, row.id);
    if (row.league_fixture_id) links.byLeagueFixtureId.set(row.league_fixture_id, row.id);
  }
  return { links, error: null };
}

export function submitMatchResult(matchId: string, sideAScore: number, sideBScore: number) {
  return supabase.rpc('submit_match_result', {
    p_match_id: matchId,
    p_side_a_score: sideAScore,
    p_side_b_score: sideBScore,
  });
}

export function respondToMatchResult(matchId: string, accept: boolean) {
  return supabase.rpc('respond_to_match_result', { p_match_id: matchId, p_accept: accept });
}
