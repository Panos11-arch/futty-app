// S15: the power ranking as the Rankings tab and the team profile read it
// (match-record.md decision 1m; S14b's get_power_ranking and
// get_power_ranking_history, S15's get_team_power_ranking and
// my_most_played_format). Points come from the server unrounded; the screen
// rounds them. Nothing here computes a ranking.
import { supabase } from '@/lib/supabase';

export type PowerResult = 'W' | 'D' | 'L';

export type PowerRankingRow = {
  rank: number;
  team_id: string;
  team_name: string;
  points: number;
  matches: number;
  /** The last 3 results, latest first. */
  last_results: PowerResult[] | null;
  /** Places gained since Monday 00:00 Cyprus time; null when the team wasn't listed then. */
  rank_change: number | null;
};

export type PowerRankingGame = {
  game_id: string;
  kickoff_at: string;
  opponent_team_id: string;
  opponent_name: string;
  category: string;
  goals_for: number;
  goals_against: number;
  result: PowerResult;
  /** The expected win chance before the game, 0 to 1. */
  expected: number;
  points_before: number;
  points_after: number;
  change: number;
};

export type TeamFormatRanking = { format: string; rank: number; points: number; matches: number };

type RpcError = { message: string } | null;

export async function getPowerRanking(format: string): Promise<{ rows: PowerRankingRow[]; error: RpcError }> {
  const { data, error } = await supabase.rpc('get_power_ranking', { p_format: format });
  return { rows: (data as PowerRankingRow[] | null) ?? [], error };
}

export async function getPowerRankingHistory(
  teamId: string,
  format: string,
  limit = 20,
): Promise<{ games: PowerRankingGame[]; error: RpcError }> {
  const { data, error } = await supabase.rpc('get_power_ranking_history', {
    p_team_id: teamId,
    p_format: format,
    p_limit: limit,
  });
  return { games: (data as PowerRankingGame[] | null) ?? [], error };
}

export async function getTeamPowerRanking(teamId: string): Promise<{ rows: TeamFormatRanking[]; error: RpcError }> {
  const { data, error } = await supabase.rpc('get_team_power_ranking', { p_team_id: teamId });
  return { rows: (data as TeamFormatRanking[] | null) ?? [], error };
}

/** The caller's most played format; null with no games. */
export async function getMyMostPlayedFormat(): Promise<{ format: string | null; error: RpcError }> {
  const { data, error } = await supabase.rpc('my_most_played_format');
  return { format: typeof data === 'string' && data ? data : null, error };
}

/** "1046": points as a whole number. */
export function formatPoints(points: number): string {
  return String(Math.round(Number(points)));
}

/** "+20.8", "−3.1", "0": the change one game made, one decimal. */
export function formatChange(change: number): string {
  const rounded = Math.round(Number(change) * 10) / 10;
  if (rounded === 0) return '0';
  const text = Math.abs(rounded).toFixed(1).replace(/\.0$/, '');
  return rounded > 0 ? `+${text}` : `−${text}`;
}

export type RankMove = { direction: 'up' | 'down' | 'none'; label: string; spoken: string };

/** ▲2, ▼1, or – for no change or new to the list. */
export function rankMove(change: number | null): RankMove {
  if (change == null || change === 0) {
    return { direction: 'none', label: '–', spoken: change == null ? 'new' : 'no change' };
  }
  const n = Math.abs(change);
  return change > 0
    ? { direction: 'up', label: `▲${n}`, spoken: `up ${n}` }
    : { direction: 'down', label: `▼${n}`, spoken: `down ${n}` };
}

const CATEGORY_LABELS: Record<string, string> = {
  non_league: 'Non-league',
  league: 'League',
  tournament_group: 'Tournament',
  tournament_knockout: 'Knockout',
};

/** The match type as the breakdown names it. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? 'Match';
}

/** "Beat Limassol Lions 3–2 · League", "Lost to …", "Drew with …". */
export function breakdownLine(g: Pick<PowerRankingGame, 'result' | 'opponent_name' | 'goals_for' | 'goals_against' | 'category'>): string {
  const verb = g.result === 'W' ? 'Beat' : g.result === 'L' ? 'Lost to' : 'Drew with';
  return `${verb} ${g.opponent_name} ${g.goals_for}–${g.goals_against} · ${categoryLabel(g.category)}`;
}

/** "Expected to win 48% of the time". */
export function expectedLine(expected: number): string {
  return `Expected to win ${Math.round(Number(expected) * 100)}% of the time`;
}

/** "won", "drew", "lost": a result as a screen reader says it. */
export function spokenResult(result: PowerResult): string {
  return result === 'W' ? 'won' : result === 'L' ? 'lost' : 'drew';
}
