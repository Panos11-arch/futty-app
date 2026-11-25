// Reads and writes for the match page (docs/specs/match-record.md section
// 5.3). Everything shown comes from get_match_page; the squad and check-ins
// are read only for the editors and voters, who are always match members
// (RLS can_view_match). Every write goes through A4a's functions with ids
// only: the server decides who may write, which side and whether it's open.
import type { MatchPage, RosterPlayer } from '@/lib/match/page';
import { getPublicNames } from '@/lib/match/profile-api';
import type { Side } from '@/lib/match/types';
import { supabase } from '@/lib/supabase';

type ApiError = { message: string };

/** The page, or null for match_not_found (a stranger before confirmation, or no such match). */
export async function getMatchPage(matchId: string): Promise<{ page: MatchPage | null; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('get_match_page', { p_match_id: matchId });
  if (error) {
    if (error.message === 'match_not_found') return { page: null, error: null };
    return { page: null, error };
  }
  return { page: (data as MatchPage | null) ?? null, error: null };
}

type PlayerRow = { id: string; side: Side | null; profile_id: string | null; guest_name: string | null; left_at: string | null };

/** The squad with names and who checked in. */
export async function getMatchRoster(matchId: string): Promise<{ roster: RosterPlayer[]; error: ApiError | null }> {
  const [players, attendance] = await Promise.all([
    supabase.from('match_players').select('id, side, profile_id, guest_name, left_at').eq('match_id', matchId).order('created_at'),
    supabase.from('match_attendance').select('profile_id').eq('match_id', matchId),
  ]);
  const error = players.error ?? attendance.error;
  if (error) return { roster: [], error };

  const rows = (players.data ?? []) as PlayerRow[];
  const checkedIn = new Set(((attendance.data ?? []) as { profile_id: string }[]).map((a) => a.profile_id));
  const ids = rows.map((r) => r.profile_id).filter((id): id is string => id !== null);
  const { names, kits, error: namesError } = await getPublicNames(ids);
  if (namesError) return { roster: [], error: namesError };

  return {
    roster: rows.map((r) => ({
      id: r.id,
      side: r.side,
      profileId: r.profile_id,
      guestName: r.guest_name,
      name: (r.profile_id ? names[r.profile_id] : r.guest_name) ?? 'Player',
      leftAt: r.left_at,
      checkedIn: r.profile_id !== null && checkedIn.has(r.profile_id),
      kit: r.profile_id ? (kits[r.profile_id] ?? null) : null,
    })),
    error: null,
  };
}

/** The formations for this many players a side, in the presets' order. */
export async function getFormationPresets(playersPerSide: number): Promise<{ formations: string[]; error: ApiError | null }> {
  const { data, error } = await supabase
    .from('match_formation_presets')
    .select('formation')
    .eq('players_per_side', playersPerSide)
    .order('sort');
  if (error) return { formations: [], error };
  return { formations: ((data ?? []) as { formation: string }[]).map((f) => f.formation), error: null };
}

export function castMotmVote(matchId: string, nomineePlayerId: string) {
  return supabase.rpc('cast_motm_vote', { p_match_id: matchId, p_nominee_player_id: nomineePlayerId });
}

/** positions: every key of the formation, null for an empty one. */
export function setMatchLineup(matchId: string, side: Side, formation: string, positions: Record<string, string | null>) {
  return supabase.rpc('set_match_lineup', {
    p_match_id: matchId,
    p_side: side,
    p_formation: formation,
    p_positions: positions,
  });
}
