// S9: the competitions a player pins (competition_pins, owner-only RLS). The
// Pin on LEAGUES and the star on MATCHES are the same row. The server sets
// profile_id; the app sends only what is pinned. S10A: tournaments are pinned
// in their own table (tournament_pins, owner-only RLS); listPins returns both.
import { normaliseScope, type CompetitionPin, type LeaguePin } from '@/lib/match/league-directory';
import { supabase } from '@/lib/supabase';

export async function listPins(): Promise<{ pins: CompetitionPin[]; error: string | null }> {
  const [leagues, tournaments] = await Promise.all([
    supabase.from('competition_pins').select('target_type, scope, format').order('created_at', { ascending: true }),
    supabase.from('tournament_pins').select('tournament_id').order('created_at', { ascending: true }),
  ]);
  const error = leagues.error ?? tournaments.error;
  if (error) return { pins: [], error: error.message };
  return {
    pins: [
      ...((leagues.data ?? []) as LeaguePin[]),
      ...((tournaments.data ?? []) as { tournament_id: string }[]).map(
        (row): CompetitionPin => ({ target_type: 'tournament', tournament_id: row.tournament_id }),
      ),
    ],
    error: null,
  };
}

export async function pinTournament(tournamentId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tournament_pins').insert({ tournament_id: tournamentId });
  return { error: error?.message ?? null };
}

export async function unpinTournament(tournamentId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tournament_pins').delete().eq('tournament_id', tournamentId);
  return { error: error?.message ?? null };
}

export async function pinCompetition(scope: string, format: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('competition_pins')
    .insert({ target_type: 'league', scope: normaliseScope(scope), format });
  return { error: error?.message ?? null };
}

export async function unpinCompetition(scope: string, format: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('competition_pins')
    .delete()
    .eq('target_type', 'league')
    .eq('scope', normaliseScope(scope))
    .eq('format', format);
  return { error: error?.message ?? null };
}
