// S10 screens: the competition page's reads (match-record.md 1n; server in
// 20261126230200_match_s10_competition.sql) and the pure helpers that shape
// them for the screen. Every standing, rating, award and ranking comes from
// the server; nothing here computes one.
import { avatarLook, type AvatarLook } from '@/lib/avatar';
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import type { PowerResult, PowerRankingRow } from '@/lib/match/power-ranking-api';
import type { TeamOfTheWeekPlayer, TeamShape, TeamSlot } from '@/lib/match/stats-api';
import { supabase } from '@/lib/supabase';

type RpcError = { message: string } | null;

/** A player as the server sends one (a minor's first name only, A5). */
export type CompetitionPlayer = {
  profileId: string;
  name: string;
  avatarStyle: string | null;
  avatarKitColour: string | null;
  avatarNumber: number | null;
  avatarIllustration: string | null;
};

export type CompetitionSeasonRef = { id: string; name: string; number: number | null; startDate: string | null; finished: boolean };

export type CompetitionSeason = {
  id: string;
  name: string;
  number: number | null;
  stage: string;
  startDate: string | null;
  endDate: string | null;
  finished: boolean;
  tables: { id: string; name: string }[];
};

export type FeaturedSide = { teamId: string; name: string; score: number | null };

export type FeaturedMatch = {
  kind: 'upcoming' | 'result';
  fixtureId: string;
  matchId: string | null;
  kickoffAt: string | null;
  home: FeaturedSide;
  away: FeaturedSide;
};

export type CompetitionTitle = {
  seasonId: string;
  name: string;
  number: number | null;
  year: number | null;
  teamId: string;
  teamName: string;
  holder: boolean;
};

export type Competition = {
  id: string;
  name: string;
  area: string;
  format: string;
  stage: string;
  isPinned: boolean;
  seasons: CompetitionSeasonRef[];
  season: CompetitionSeason;
  featured: FeaturedMatch | null;
  titles: CompetitionTitle[];
};

export type StandingZone = 'division_1' | 'division_2' | 'relegation' | 'promotion' | null;

export type StandingRow = {
  pos: number;
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** The last five, newest first. */
  form: PowerResult[];
  zone: StandingZone;
};

export type CompetitionStandings = { rules: string; tables: { id: string; name: string; rows: StandingRow[] }[] };

export type CompetitionMatch = {
  fixture_id: string;
  table_id: string;
  table_name: string;
  /** Week n of the season; null when the fixture has no day ("Not scheduled"). */
  matchday: number | null;
  kickoff_at: string | null;
  status: string;
  forfeit_result: 'home_forfeited' | 'away_forfeited' | 'void' | null;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  match_id: string | null;
};

export type PlayerStatRow = CompetitionPlayer & {
  teamId: string | null;
  teamName: string | null;
  rating: number | null;
  matches: number;
  goals: number;
  assists: number;
  motm: number;
  cleanSheets: number;
  goalsConcededPerMatch: number | null;
};

export type StatsTab = 'players' | 'teams' | 'performances';

export type StatRow = Partial<CompetitionPlayer> & {
  teamId: string | null;
  teamName?: string | null;
  value: number;
  matchId?: string | null;
  homeTeamName?: string;
  homeScore?: number | null;
  awayTeamName?: string;
  awayScore?: number | null;
};

export type StatsCategory = { category: string; rows: StatRow[] };

export type AwardPlayer = CompetitionPlayer & {
  slot: TeamSlot;
  sort: number;
  best: boolean;
  teamId: string | null;
  teamName: string | null;
  rating: number;
  matches: number;
  goals: number;
  assists: number;
};

export type CompetitionAwards = {
  premiumOnly: boolean;
  matchdays: number[];
  player: (CompetitionPlayer & { teamId: string | null; teamName: string | null; rating: number; matches: number }) | null;
  team: {
    format: string;
    matchday: number | null;
    shape: { keepers: number; defenders: number; midfielders: number; strikers: number };
    players: AwardPlayer[];
  } | null;
};

export type CompetitionPowerRow = {
  position: number;
  team_id: string;
  team_name: string;
  points: number;
  matches: number;
  app_rank: number | null;
  /** Places gained since Monday 00:00 Cyprus time. */
  position_change: number | null;
  last_results: PowerResult[] | null;
};

// ---- Reads ---------------------------------------------------------------

export async function getCompetition(leagueId: string, seasonId: string | null = null) {
  const { data, error } = await supabase.rpc('get_competition', { p_league_id: leagueId, p_season_id: seasonId });
  return { competition: (data as Competition | null) ?? null, error: error as RpcError };
}

export async function getCompetitionStandings(seasonId: string) {
  const { data, error } = await supabase.rpc('get_competition_standings', { p_season_id: seasonId });
  return { standings: (data as CompetitionStandings | null) ?? { rules: '', tables: [] }, error: error as RpcError };
}

export async function getCompetitionMatches(seasonId: string, teamId: string | null = null) {
  const { data, error } = await supabase.rpc('get_competition_matches', { p_season_id: seasonId, p_team_id: teamId });
  return { matches: (data as CompetitionMatch[] | null) ?? [], error: error as RpcError };
}

/** Premium only: the server refuses everyone else with premium_required. */
export async function getCompetitionPlayerStats(seasonId: string, teamId: string | null = null) {
  const { data, error } = await supabase.rpc('get_competition_player_stats', { p_season_id: seasonId, p_team_id: teamId });
  return { rows: (data as PlayerStatRow[] | null) ?? [], error: error as RpcError };
}

export async function getCompetitionStats(seasonId: string, tab: StatsTab, category: string | null = null, limit = 3) {
  const { data, error } = await supabase.rpc('get_competition_stats', {
    p_season_id: seasonId,
    p_tab: tab,
    p_category: category,
    p_limit: limit,
  });
  return { categories: (data as StatsCategory[] | null) ?? [], error: error as RpcError };
}

export async function getCompetitionAwards(seasonId: string, matchday: number | null = null) {
  const { data, error } = await supabase.rpc('get_competition_awards', { p_season_id: seasonId, p_matchday: matchday });
  return { awards: (data as CompetitionAwards | null) ?? null, error: error as RpcError };
}

export async function getCompetitionPowerRanking(seasonId: string) {
  const { data, error } = await supabase.rpc('get_competition_power_ranking', { p_season_id: seasonId });
  return { rows: (data as CompetitionPowerRow[] | null) ?? [], error: error as RpcError };
}

export function isPremiumRequired(error: RpcError | undefined): boolean {
  return !!error && error.message === 'premium_required';
}

// ---- Season --------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const keyToUtc = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

/** How far through the season `today` (a Cyprus date key) is, 0 to 1; null without both dates. */
export function seasonProgress(startDate: string | null, endDate: string | null, today: string): number | null {
  if (!startDate || !endDate) return null;
  const start = keyToUtc(startDate);
  const end = keyToUtc(endDate);
  const now = keyToUtc(today);
  if (now >= end) return 1;
  if (now <= start) return 0;
  return Math.round(((now - start) / DAY_MS / ((end - start) / DAY_MS)) * 100) / 100;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Dec" for a date key. */
export function progressDateLabel(key: string): string {
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
}

// ---- Matches -------------------------------------------------------------

export const NOT_SCHEDULED = 'Not scheduled';

const cyprusParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(iso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of cyprusParts.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** "FT", "FF" (a forfeit), "Cancelled" (a void fixture), or the kickoff time in Cyprus ("19:00"). */
export function matchStatusLabel(m: Pick<CompetitionMatch, 'status' | 'forfeit_result' | 'kickoff_at'>): string {
  if (m.forfeit_result === 'void') return 'Cancelled';
  if (m.forfeit_result) return 'FF';
  if (m.status === 'completed') return 'FT';
  if (!m.kickoff_at) return '';
  const p = parts(m.kickoff_at);
  return `${p.hour}:${p.minute}`;
}

/** "07/12/26": the Cyprus day; empty when the fixture has none. */
export function matchDateLabel(m: Pick<CompetitionMatch, 'kickoff_at'>): string {
  if (!m.kickoff_at) return '';
  const p = parts(m.kickoff_at);
  return `${p.day}/${p.month}/${p.year}`;
}

export function roundLabel(matchday: number | null): string {
  return matchday == null ? NOT_SCHEDULED : `Matchday ${matchday}`;
}

export type MatchSection = { key: string; title: string; data: CompetitionMatch[] };

function dayTitle(iso: string): { key: string; title: string } {
  const p = parts(iso);
  return {
    key: `20${p.year}-${p.month}-${p.day}`,
    title: `${p.weekday} ${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`,
  };
}

/** One section per Cyprus day, earliest first, then "Not scheduled". */
export function groupMatchesByDate(rows: CompetitionMatch[]): MatchSection[] {
  const dated = rows.filter((m) => m.kickoff_at).sort((a, b) => a.kickoff_at!.localeCompare(b.kickoff_at!));
  const sections: MatchSection[] = [];
  for (const m of dated) {
    const { key, title } = dayTitle(m.kickoff_at!);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.data.push(m);
    else sections.push({ key, title, data: [m] });
  }
  const undated = rows.filter((m) => !m.kickoff_at);
  if (undated.length > 0) sections.push({ key: 'none', title: NOT_SCHEDULED, data: undated });
  return sections;
}

/** One section per matchday, then "Not scheduled". With `only` (a matchday, or
 *  null for Not scheduled) just that round. */
export function groupMatchesByRound(rows: CompetitionMatch[], only?: number | null): MatchSection[] {
  const byRound = new Map<number | null, CompetitionMatch[]>();
  for (const m of rows) {
    if (only !== undefined && m.matchday !== only) continue;
    byRound.set(m.matchday, [...(byRound.get(m.matchday) ?? []), m]);
  }
  const order = [...byRound.keys()].sort((a, b) => (a == null ? 1 : b == null ? -1 : a - b));
  return order.map((round) => ({ key: String(round), title: roundLabel(round), data: byRound.get(round)! }));
}

/** The rounds present, in order, for the round picker. */
export function roundsOf(rows: CompetitionMatch[]): (number | null)[] {
  return groupMatchesByRound(rows).map((s) => (s.key === 'null' ? null : Number(s.key)));
}

export type CaptainContactLike = { my_team_id: string | null; team_id: string; can_message?: boolean };

/** The chat to open from a fixture row: only on my own (captain) team's row,
 *  and only when the server says that chat is allowed (no block either way,
 *  no adult-minor pair). Null hides the button. */
export function canMessageFrom(
  m: Pick<CompetitionMatch, 'home_team_id' | 'away_team_id'>,
  contacts: CaptainContactLike[],
): { myTeamId: string; otherTeamId: string } | null {
  for (const c of contacts) {
    if (!c.my_team_id || c.can_message !== true) continue;
    if (c.my_team_id === m.home_team_id && c.team_id === m.away_team_id) return { myTeamId: c.my_team_id, otherTeamId: c.team_id };
    if (c.my_team_id === m.away_team_id && c.team_id === m.home_team_id) return { myTeamId: c.my_team_id, otherTeamId: c.team_id };
  }
  return null;
}

// ---- Standings -----------------------------------------------------------

export type StandingsView = 'short' | 'full' | 'form';

export type StandingsColumn = { label: string; spoken: string; value: (r: StandingRow) => string; views: StandingsView[] };

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export const STANDINGS_COLUMNS: StandingsColumn[] = [
  { label: 'P', spoken: 'played', value: (r) => String(r.played), views: ['short', 'full', 'form'] },
  { label: 'W', spoken: 'won', value: (r) => String(r.won), views: ['full'] },
  { label: 'D', spoken: 'drawn', value: (r) => String(r.drawn), views: ['full'] },
  { label: 'L', spoken: 'lost', value: (r) => String(r.lost), views: ['full'] },
  { label: 'GF', spoken: 'goals for', value: (r) => String(r.goalsFor), views: ['full'] },
  { label: 'GA', spoken: 'goals against', value: (r) => String(r.goalsAgainst), views: ['full'] },
  { label: 'Diff', spoken: 'goal difference', value: (r) => signed(r.goalDiff), views: ['short', 'full', 'form'] },
  { label: 'Pts', spoken: 'points', value: (r) => String(r.points), views: ['short', 'full', 'form'] },
];

export function standingsColumns(view: StandingsView): StandingsColumn[] {
  return STANDINGS_COLUMNS.filter((c) => c.views.includes(view));
}

// ---- Player stats --------------------------------------------------------

export type PlayerStatKey = 'rating' | 'matches' | 'goals' | 'assists' | 'motm' | 'cleanSheets' | 'goalsConcededPerMatch';

/** Biggest first, except goals conceded per match (fewest first); no value last. */
export function sortPlayerStats(rows: PlayerStatRow[], key: PlayerStatKey): PlayerStatRow[] {
  const ascending = key === 'goalsConcededPerMatch';
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return ascending ? Number(x) - Number(y) : Number(y) - Number(x);
  });
}

export function competitionPlayerLook(p: Partial<CompetitionPlayer>): AvatarLook | null {
  return avatarLook({
    avatar_style: p.avatarStyle ?? null,
    avatar_kit_colour: p.avatarKitColour ?? null,
    avatar_number: p.avatarNumber ?? null,
    avatar_illustration: p.avatarIllustration ?? null,
  });
}

// ---- Awards and power ----------------------------------------------------

/** The server's Team of the season, as the Team of the Week pitch draws it. */
export function toTotwPlayers(team: NonNullable<CompetitionAwards['team']>): { shape: TeamShape; players: TeamOfTheWeekPlayer[] } {
  return {
    shape: { format: team.format, ...team.shape },
    players: team.players.map((p) => ({
      profile_id: p.profileId,
      name: p.name,
      kit: competitionPlayerLook(p),
      slot: p.slot,
      sort: p.sort,
      games: p.matches,
      goals: p.goals,
      assists: p.assists,
      clean_sheets: 0,
      average_rating: p.rating,
      player_of_the_week: p.best,
    })),
  };
}

export function toPowerRankingRows(rows: CompetitionPowerRow[]): PowerRankingRow[] {
  return rows.map((r) => ({
    rank: r.position,
    team_id: r.team_id,
    team_name: r.team_name,
    points: r.points,
    matches: r.matches,
    last_results: r.last_results,
    rank_change: r.position_change,
  }));
}
