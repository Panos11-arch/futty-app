import { supabase } from '@/lib/supabase';

export type League = {
  id: string;
  name: string;
  format: string;
  scope: string;
  stage: 'signup' | 'season' | 'divisions' | string;
  start_date: string | null;
  season_weeks: number | null;
  /** 0 means uncapped (a standard league) — leagues.capacity is NOT NULL. */
  capacity: number;
  parent_league_id: string | null;
};

export type LeagueTeamRow = {
  id: string;
  league_id: string;
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  pts_adjustment: number;
};

/** w*3 + d + adjustment — matches the prototype's StandingsTable `pts` function. */
export function points(row: Pick<LeagueTeamRow, 'won' | 'drawn' | 'pts_adjustment'>) {
  return row.won * 3 + row.drawn + row.pts_adjustment;
}

export function goalDifference(row: Pick<LeagueTeamRow, 'goals_for' | 'goals_against'>) {
  return row.goals_for - row.goals_against;
}

export function sortStandings<T extends LeagueTeamRow>(rows: T[]) {
  return [...rows].sort((a, b) => points(b) - points(a) || goalDifference(b) - goalDifference(a));
}

export async function registerTeamForLeague(leagueId: string, teamId: string) {
  return supabase.rpc('register_team_for_league', { p_league_id: leagueId, p_team_id: teamId });
}

export async function startLeagueSeason(leagueId: string) {
  return supabase.rpc('start_league_season', { p_league_id: leagueId });
}

export async function endSeasonToDivisions(leagueId: string) {
  return supabase.rpc('end_season_to_divisions', { p_league_id: leagueId });
}

export async function formNewDivision(hubLeagueId: string) {
  return supabase.rpc('form_new_division', { p_hub_league_id: hubLeagueId });
}

export async function applyPromotionRelegation(hubLeagueId: string) {
  return supabase.rpc('apply_promotion_relegation', { p_hub_league_id: hubLeagueId });
}
