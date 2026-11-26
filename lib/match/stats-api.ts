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

/**
 * A team of the week (match-record.md decision 1k): one per week, kind
 * (league or general), area and format. area_key is '' for All Cyprus, the
 * city key, the venue id or the league id.
 */
export type TeamOfTheWeek = {
  id: string;
  week_start: string;
  kind: 'general' | 'league';
  area: 'all' | 'city' | 'venue' | 'league';
  area_key: string;
  area_name: string;
  league_id: string | null;
  format: string;
  matches: number;
};

/** Where the server placed a player (no positions: from goals and assists). */
export type TeamSlot = 'gk' | 'def' | 'mid' | 'fwd';

export type TeamOfTheWeekPlayer = {
  profile_id: string;
  name: string;
  /** A12: the player's kit avatar; null shows initials. */
  kit?: AvatarLook | null;
  slot: TeamSlot;
  sort: number;
  games: number;
  goals: number;
  assists: number;
  clean_sheets: number;
  /** Average match rating that week, from the server. */
  average_rating: number;
  player_of_the_week: boolean;
};

/** A format's shape (team_of_the_week_shapes). */
export type TeamShape = {
  format: string;
  keepers: number;
  defenders: number;
  midfielders: number;
  strikers: number;
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

const TEAM_COLUMNS = 'id, week_start, kind, area, area_key, area_name, league_id, format, matches';

/** The formats in the order the app offers them. */
export const TEAM_FORMATS = ['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] as const;

/** The team shown first: the latest week's General · All Cyprus team, smallest format first; null if none. */
export function defaultTeam(teams: TeamOfTheWeek[]): TeamOfTheWeek | null {
  const general = teams.filter((t) => t.kind === 'general' && t.area === 'all');
  if (general.length === 0) return null;
  const latest = general.reduce((week, t) => (t.week_start > week ? t.week_start : week), general[0].week_start);
  const rank = (format: string) => {
    const i = (TEAM_FORMATS as readonly string[]).indexOf(format);
    return i === -1 ? TEAM_FORMATS.length : i;
  };
  return general.filter((t) => t.week_start === latest).sort((x, y) => rank(x.format) - rank(y.format))[0];
}

/** The latest General · All Cyprus team of the week, or null when there's none yet. */
export async function getLatestTeamOfTheWeek() {
  const { data, error } = await supabase
    .from('team_of_the_week')
    .select(TEAM_COLUMNS)
    .eq('kind', 'general')
    .eq('area', 'all')
    .order('week_start', { ascending: false })
    .limit(TEAM_FORMATS.length);
  if (error) return { team: null, error };
  return { team: defaultTeam((data as TeamOfTheWeek[] | null) ?? []), error: null };
}

/** One team of the week by id (a notification names it); null once it no longer exists. */
export async function getTeamOfTheWeek(id: string) {
  const { data, error } = await supabase.from('team_of_the_week').select(TEAM_COLUMNS).eq('id', id).maybeSingle();
  return { team: (data as TeamOfTheWeek | null) ?? null, error };
}

/** A team of the week's players, in the server's order, with names. */
export async function getTeamOfTheWeekPlayers(teamOfTheWeekId: string) {
  const { data, error } = await supabase
    .from('team_of_the_week_players')
    .select('profile_id, slot, sort, games, goals, assists, clean_sheets, average_rating, player_of_the_week')
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

/** A format's shape from the server; null for an unknown format. */
export async function getTeamShape(format: string) {
  const { data, error } = await supabase
    .from('team_of_the_week_shapes')
    .select('format, keepers, defenders, midfielders, strikers')
    .eq('format', format)
    .maybeSingle();
  return { shape: (data as TeamShape | null) ?? null, error };
}

export type LineupSlot = { slot: TeamSlot; player: TeamOfTheWeekPlayer | null };

/** Every slot of the shape, keeper first, then defence, midfield and strikers; null where no one was eligible. */
export function lineup(players: TeamOfTheWeekPlayer[], shape: TeamShape): LineupSlot[] {
  const counts: [TeamSlot, number][] = [
    ['gk', shape.keepers],
    ['def', shape.defenders],
    ['mid', shape.midfielders],
    ['fwd', shape.strikers],
  ];
  const sorted = [...players].sort((a, b) => a.sort - b.sort);
  return counts.flatMap(([slot, n]) => {
    const inSlot = sorted.filter((p) => p.slot === slot);
    return Array.from({ length: n }, (_, i) => ({ slot, player: inSlot[i] ?? null }));
  });
}

export const SLOT_LABELS: Record<TeamSlot, string> = {
  gk: 'Keeper',
  def: 'Defence',
  mid: 'Midfield',
  fwd: 'Striker',
};

/** "2 G · 3 A"; a player with neither shows clean sheets ("1 clean sheet"), else nothing. */
export function statLine(p: Pick<TeamOfTheWeekPlayer, 'goals' | 'assists' | 'clean_sheets'>): string {
  const parts = [p.goals > 0 ? `${p.goals} G` : null, p.assists > 0 ? `${p.assists} A` : null].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  if (p.clean_sheets > 0) return `${p.clean_sheets} ${p.clean_sheets === 1 ? 'clean sheet' : 'clean sheets'}`;
  return '';
}

/** "Week of 9 Nov · 5-a-side · All Cyprus". */
export function teamCaption(team: Pick<TeamOfTheWeek, 'week_start' | 'format' | 'area_name'>): string {
  return `${formatWeekOf(team.week_start)} · ${team.format} · ${team.area_name}`;
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
