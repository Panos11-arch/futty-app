// Reads for season stats, leaderboards and team of the week (A7,
// docs/specs/match-record.md decision 1g and section 7). Every number comes
// from the A7a views and tables; the app only formats them.
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { getPublicNames } from '@/lib/match/profile-api';
import type { PlayerRecentMatchRow } from '@/lib/match/types';
import { supabase } from '@/lib/supabase';
import type { AvatarLook } from '@/lib/avatar';

/** 'year' = a calendar year in Cyprus time; 'all' = all time (decision 1g.2). */
export type SeasonChoice = { kind: 'year'; year: number } | { kind: 'all' };

export type PlayerSeasonStats = {
  appearances: number;
  won: number;
  drawn: number;
  lost: number;
  win_pct: number;
  goals: number;
  assists: number;
  motm: number;
  /** Null until a match rating counts (3 ratings, window closed). */
  average_rating: number | null;
  rated_matches: number;
  level_start: number | null;
  level_end: number | null;
};

export type TeamSeasonStats = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  win_pct: number;
  goals_for: number;
  goals_against: number;
  clean_sheets: number;
  longest_win_run: number;
  motm: number;
  average_rating: number | null;
};

export type LeaderboardScope = { scope: 'venue' | 'city'; scope_key: string; scope_name: string | null };

export type LeaderboardBoard = 'goals' | 'motm' | 'win_rate';

export type LeaderboardRow = {
  profile_id: string;
  name: string;
  appearances: number;
  goals: number;
  motm: number;
  win_pct: number;
  rank: number;
  /** A12: the player's kit avatar; null shows initials. */
  kit?: AvatarLook | null;
};

/** One team of the week for all of Futty (decision 1g.4). */
export type TeamOfTheWeek = {
  id: string;
  week_start: string;
  matches: number;
};

export type PositionGroup = 'gk' | 'def' | 'mid' | 'fwd';

export type TeamOfTheWeekPlayer = {
  profile_id: string;
  name: string;
  /** A12: the player's kit avatar; null shows initials. */
  kit?: AvatarLook | null;
  position_group: PositionGroup;
  sort: number;
  /** Average points per game that week, from the server. */
  average_points: number;
  games: number;
  goals: number;
  assists: number;
  clean_sheets: number;
  motm: number;
  average_rating: number | null;
};

const yearFormat = new Intl.DateTimeFormat('en-GB', { timeZone: CYPRUS_TIME_ZONE, year: 'numeric' });

/** The calendar year in Cyprus at `now`: the current season (decision 1g.2). */
export function cyprusYear(now: Date = new Date()): number {
  return Number(yearFormat.format(now));
}

/** A city as the server keys it: lower case, without surrounding spaces. Null for none. */
export function cityKey(city: string | null | undefined): string | null {
  const key = (city ?? '').trim().toLowerCase();
  return key === '' ? null : key;
}

const PLAYER_STATS =
  'appearances, won, drawn, lost, win_pct, goals, assists, motm, average_rating, rated_matches, level_start, level_end';
const TEAM_STATS =
  'played, won, drawn, lost, win_pct, goals_for, goals_against, clean_sheets, longest_win_run, motm, average_rating';

/** A player's season; null when they have no confirmed match in it. */
export async function getPlayerSeasonStats(profileId: string, season: SeasonChoice) {
  let query = supabase
    .from('player_season_stats')
    .select(PLAYER_STATS)
    .eq('profile_id', profileId)
    .eq('season_kind', season.kind);
  if (season.kind === 'year') query = query.eq('season_year', season.year);
  const { data, error } = await query.maybeSingle();
  return { stats: (data as PlayerSeasonStats | null) ?? null, error };
}

/** A named team's season; null when it has no confirmed match in it. */
export async function getTeamSeasonStats(teamId: string, season: SeasonChoice) {
  let query = supabase
    .from('team_season_stats')
    .select(TEAM_STATS)
    .eq('team_id', teamId)
    .eq('season_kind', season.kind);
  if (season.kind === 'year') query = query.eq('season_year', season.year);
  const { data, error } = await query.maybeSingle();
  return { stats: (data as TeamSeasonStats | null) ?? null, error };
}

type TeamRecentRow = Omit<PlayerRecentMatchRow, 'profile_id' | 'kind'> & { team_id: string };

/** A team's recent confirmed matches, newest first, as recent-match rows (always named games). */
export async function getTeamRecentMatches(teamId: string, limit = 10) {
  const { data, error } = await supabase
    .from('team_recent_matches')
    .select('*')
    .eq('team_id', teamId)
    .order('kickoff_at', { ascending: false })
    .order('match_id', { ascending: true })
    .limit(limit);
  const rows: PlayerRecentMatchRow[] = ((data as TeamRecentRow[] | null) ?? []).map((r) => ({
    ...r,
    profile_id: '',
    kind: 'named',
  }));
  return { rows, error };
}

/** Decision 1g.1: the fewest appearances to be on a leaderboard. */
export async function getMinAppearances() {
  const { data, error } = await supabase.rpc('stats_min_appearances');
  return { min: typeof data === 'number' ? data : null, error };
}

/** The venues and cities with a leaderboard in `year`, each once, cities first. */
export async function getLeaderboardScopes(year: number) {
  const { data, error } = await supabase
    .from('stats_leaderboards')
    .select('scope, scope_key, scope_name')
    .eq('season_year', year)
    .order('scope', { ascending: true })
    .order('scope_name', { ascending: true })
    .limit(1000);
  const seen = new Set<string>();
  const scopes: LeaderboardScope[] = [];
  for (const row of (data as LeaderboardScope[] | null) ?? []) {
    const key = `${row.scope}|${row.scope_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push(row);
  }
  return { scopes, error };
}

/** The viewer's city first, if it has a board; otherwise the first scope. */
export function defaultScope(scopes: LeaderboardScope[], city: string | null | undefined): LeaderboardScope | null {
  const key = cityKey(city);
  return scopes.find((s) => s.scope === 'city' && s.scope_key === key) ?? scopes[0] ?? null;
}

type LeaderboardRaw = {
  profile_id: string;
  appearances: number;
  goals: number;
  motm: number;
  win_pct: number;
  goals_rank?: number;
  motm_rank?: number;
  win_rate_rank?: number;
};

const RANK_COLUMN: Record<LeaderboardBoard, 'goals_rank' | 'motm_rank' | 'win_rate_rank'> = {
  goals: 'goals_rank',
  motm: 'motm_rank',
  win_rate: 'win_rate_rank',
};

/** One leaderboard in the server's order, with names. */
export async function getLeaderboard(scope: LeaderboardScope, year: number, board: LeaderboardBoard, limit = 20) {
  const rank = RANK_COLUMN[board];
  const { data, error } = await supabase
    .from('stats_leaderboards')
    .select(`profile_id, appearances, goals, motm, win_pct, ${rank}`)
    .eq('scope', scope.scope)
    .eq('scope_key', scope.scope_key)
    .eq('season_year', year)
    .order(rank, { ascending: true })
    .order('profile_id', { ascending: true })
    .limit(limit);
  if (error) return { rows: [] as LeaderboardRow[], error };
  const raw = (data as unknown as LeaderboardRaw[] | null) ?? [];
  const { names, kits, error: namesError } = await getPublicNames(raw.map((r) => r.profile_id));
  const rows: LeaderboardRow[] = raw.map((r) => ({
    profile_id: r.profile_id,
    name: names[r.profile_id] ?? 'Player',
    appearances: r.appearances,
    goals: r.goals,
    motm: r.motm,
    win_pct: r.win_pct,
    rank: r[rank] ?? 0,
    kit: kits[r.profile_id] ?? null,
  }));
  return { rows, error: namesError };
}

/** The latest team of the week, or null when there's none yet. */
export async function getLatestTeamOfTheWeek() {
  const { data, error } = await supabase
    .from('team_of_the_week')
    .select('id, week_start, matches')
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { team: (data as TeamOfTheWeek | null) ?? null, error };
}

/** A team of the week's five players, in their slots, with names. */
export async function getTeamOfTheWeekPlayers(teamOfTheWeekId: string) {
  const { data, error } = await supabase
    .from('team_of_the_week_players')
    .select('profile_id, position_group, sort, average_points, games, goals, assists, clean_sheets, motm, average_rating')
    .eq('team_of_the_week_id', teamOfTheWeekId)
    .order('sort', { ascending: true });
  if (error) return { players: [] as TeamOfTheWeekPlayer[], error };
  const raw = (data as Omit<TeamOfTheWeekPlayer, 'name' | 'kit'>[] | null) ?? [];
  const { names, kits, error: namesError } = await getPublicNames(raw.map((r) => r.profile_id));
  return {
    players: raw.map((r) => ({ ...r, name: names[r.profile_id] ?? 'Player', kit: kits[r.profile_id] ?? null })),
    error: namesError,
  };
}

/** "8.4": a rating with one decimal, as the match page shows it. */
export function formatRating(rating: number | null | undefined): string {
  return rating == null ? '–' : Number(rating).toFixed(1);
}

/** "Week of 9 Nov" for a week_start date (a Monday, YYYY-MM-DD). */
export function formatWeekOf(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const label = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `Week of ${label}`;
}

export const POSITION_LABELS: Record<PositionGroup, string> = {
  gk: 'Keeper',
  def: 'Defender',
  mid: 'Midfielder',
  fwd: 'Forward',
};

/** "8.5 pts": average points per game, one decimal. */
export function formatPoints(points: number): string {
  return `${Number(points).toFixed(1)} pts`;
}

/** The numbers behind a pick, for its position: "2 goals · 1 assist", "1 clean sheet". */
export function pickLine(p: Pick<TeamOfTheWeekPlayer, 'position_group' | 'goals' | 'assists' | 'clean_sheets' | 'games' | 'motm'>): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts =
    p.position_group === 'gk' || p.position_group === 'def'
      ? [n(p.clean_sheets, 'clean sheet', 'clean sheets')]
      : p.position_group === 'mid'
        ? [n(p.assists, 'assist', 'assists'), n(p.goals, 'goal', 'goals')]
        : [n(p.goals, 'goal', 'goals'), n(p.assists, 'assist', 'assists')];
  if (p.motm > 0) parts.push(n(p.motm, 'man of the match', 'men of the match'));
  parts.push(n(p.games, 'game', 'games'));
  return parts.join(' · ');
}
