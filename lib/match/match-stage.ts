// S10A: whether a match is a tournament knockout game, so Log the score asks
// for the penalty shootout when its score is level. Read with the caller's
// own access: a player in the match reads it (matches RLS can_view_match),
// and signed-in players read tournament fixtures. The server decides again
// on every log (shootout_required, shootout_not_allowed).
import { supabase } from '@/lib/supabase';

export async function getMatchKnockout(matchId: string): Promise<{ knockout: boolean; error: string | null }> {
  const { data: match, error } = await supabase
    .from('matches')
    .select('tournament_fixture_id')
    .eq('id', matchId)
    .maybeSingle();
  if (error) return { knockout: false, error: error.message };
  const fixtureId = (match as { tournament_fixture_id: string | null } | null)?.tournament_fixture_id ?? null;
  if (!fixtureId) return { knockout: false, error: null };
  const { data: fixture, error: fixtureError } = await supabase
    .from('tournament_fixtures')
    .select('stage')
    .eq('id', fixtureId)
    .maybeSingle();
  if (fixtureError) return { knockout: false, error: fixtureError.message };
  const stage = (fixture as { stage: string } | null)?.stage ?? null;
  return { knockout: stage !== null && stage !== 'group', error: null };
}
