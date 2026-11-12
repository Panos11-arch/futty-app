// Reads for form, recent matches, head-to-head and "players you play with
// most" (docs/specs/match-record.md section 7). Every number comes from the
// A3b views, which run the form rules on the server; the app shows the rows
// as they arrive and never recomputes form (lib/match/form.ts is for tests
// and mocks only).
import type {
  FormResult,
  HeadToHeadRow,
  MatchListItem,
  Outcome,
  PlayerRecentMatchRow,
  Side,
  TeammateRow,
} from '@/lib/match/types';
import { supabase } from '@/lib/supabase';

type FormRows = { position: number; result: FormResult }[] | null;

/** A player's last 5 results, newest first. */
export async function getPlayerForm(profileId: string) {
  const { data, error } = await supabase
    .from('player_form')
    .select('position, result')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  return { form: ((data as FormRows) ?? []).map((r) => r.result), error };
}

/** A named team's last 5 results, newest first. */
export async function getTeamForm(teamId: string) {
  const { data, error } = await supabase
    .from('team_form')
    .select('position, result')
    .eq('team_id', teamId)
    .order('position', { ascending: true });
  return { form: ((data as FormRows) ?? []).map((r) => r.result), error };
}

/** The player's recent confirmed matches, newest first. */
export async function getPlayerRecentMatches(profileId: string, limit = 10) {
  const { data, error } = await supabase
    .from('player_recent_matches')
    .select('*')
    .eq('profile_id', profileId)
    .order('kickoff_at', { ascending: false })
    .order('match_id', { ascending: true })
    .limit(limit);
  return { rows: (data as PlayerRecentMatchRow[] | null) ?? [], error };
}

/** The record between two named teams from teamId's side; null when they've never met. */
export async function getHeadToHead(teamId: string, opponentTeamId: string) {
  const { data, error } = await supabase
    .from('head_to_head')
    .select('*')
    .eq('team_id', teamId)
    .eq('opponent_team_id', opponentTeamId)
    .maybeSingle();
  return { record: (data as HeadToHeadRow | null) ?? null, error };
}

export type Teammate = Pick<TeammateRow, 'teammate_profile_id' | 'matches_together' | 'last_played_at'>;

/** "Players you play with most": the view returns the caller's own list only. */
export async function getMyTeammates(limit = 5) {
  const { data, error } = await supabase
    .from('player_teammates')
    .select('teammate_profile_id, matches_together, last_played_at')
    .order('matches_together', { ascending: false })
    .order('last_played_at', { ascending: false })
    .limit(limit);
  return { rows: (data as Teammate[] | null) ?? [], error };
}

/** Display names for other players, from the public profile function (no private columns). */
export async function getPublicNames(ids: string[]) {
  if (ids.length === 0) return { names: {} as Record<string, string>, error: null };
  const { data, error } = await supabase.rpc('get_public_profiles', { p_profile_ids: ids });
  const names: Record<string, string> = {};
  for (const p of (data as { id: string; username: string | null; full_name: string | null }[] | null) ?? []) {
    names[p.id] = p.full_name || p.username || 'Player';
  }
  return { names, error };
}

const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

/** Which side won, as the server's result for `side` says: a relabelling, not a recount. */
function outcomeOf(result: FormResult, side: Side): Outcome {
  if (result === 'D') return 'draw';
  const winner = result === 'W' ? side : other(side);
  return winner === 'a' ? 'side_a_won' : 'side_b_won';
}

/**
 * A recent-matches row as the MatchRow a list shows. The view gives the
 * match from the player's side; this puts the goals back on sides a and b.
 * The result chip is the server's `result`, passed to MatchRow separately.
 */
export function recentRowToListItem(row: PlayerRecentMatchRow): MatchListItem {
  const mine = row.side;
  const theirs = other(mine);
  const side = (s: Side, label: string, teamId: string | null) => ({
    match_id: row.match_id,
    side: s,
    team_id: teamId,
    label,
    captain_profile_id: null,
  });
  const sides = {
    [mine]: side(mine, row.label, row.team_id),
    [theirs]: side(theirs, row.opponent_label, row.opponent_team_id),
  } as MatchListItem['sides'];
  const score = (s: Side) => (s === mine ? row.goals_for : row.goals_against);
  return {
    match: { id: row.match_id, kind: row.kind, status: 'confirmed', kickoff_at: row.kickoff_at, ends_at: row.kickoff_at },
    sides,
    result: {
      match_id: row.match_id,
      booking_id: null,
      venue_id: row.venue_id,
      friendly_match_id: null,
      league_fixture_id: null,
      side_a_team_id: sides.a.team_id,
      side_b_team_id: sides.b.team_id,
      side_a_score: score('a'),
      side_b_score: score('b'),
      outcome: outcomeOf(row.result, mine),
      result_status: 'confirmed',
      disputed: false,
      confirmed_via: row.forfeit_side ? 'forfeit' : null,
      forfeit_side: row.forfeit_side,
      forfeit_reason: row.forfeit_reason,
      kickoff_at: row.kickoff_at,
      ends_at: row.kickoff_at,
      kickoff_local: row.kickoff_local,
      ends_local: row.kickoff_local,
      settled_at: row.kickoff_at,
    },
    venueName: row.venue_name ?? '',
    viewerSide: null,
  };
}
