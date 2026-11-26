// S9: the competitions a player pins (competition_pins, owner-only RLS). The
// Pin on LEAGUES and the star on MATCHES are the same row. The server sets
// profile_id; the app sends only what is pinned.
import { normaliseScope, type CompetitionPin } from '@/lib/match/league-directory';
import { supabase } from '@/lib/supabase';

export async function listPins(): Promise<{ pins: CompetitionPin[]; error: string | null }> {
  const { data, error } = await supabase
    .from('competition_pins')
    .select('target_type, scope, format')
    .order('created_at', { ascending: true });
  if (error) return { pins: [], error: error.message };
  return { pins: (data ?? []) as CompetitionPin[], error: null };
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
