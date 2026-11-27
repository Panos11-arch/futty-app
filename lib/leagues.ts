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
