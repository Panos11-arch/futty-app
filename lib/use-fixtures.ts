import { useCallback, useEffect, useState } from 'react';

import { type Fixture, listFixturesForTeams } from '@/lib/fixtures';
import { useRealtimeChannelName } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { useMyTeams } from '@/lib/use-my-teams';

type FixturesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fixtures: Fixture[] };

/** Every fixture involving any team the signed-in user belongs to, in any
 *  role — captains additionally get to propose/agree a schedule (gated in
 *  the UI, enforced server-side), but any teammate can see the fixture list. */
export function useMyFixtures() {
  const myTeams = useMyTeams();
  const [state, setState] = useState<FixturesState>({ status: 'loading' });
  const channelName = useRealtimeChannelName('league-fixtures');

  const teamIds = myTeams.status === 'ready' ? myTeams.teams.map(({ team }) => team.id) : [];
  const teamIdsKey = teamIds.join(',');

  const reload = useCallback(async () => {
    if (myTeams.status !== 'ready') return;

    setState({ status: 'loading' });
    const { data, error } = await listFixturesForTeams(teamIds);

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      setState({ status: 'ready', fixtures: data });
    }
    // teamIdsKey (not teamIds) is the real dependency — a new array with the
    // same ids shouldn't trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeams.status, teamIdsKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  // A fixture's status/score fields change live (schedule agreed, score
  // confirmed via check_fixture_score_match, or locked after a dispute).
  // Unfiltered — "my fixtures" is an OR across two id lists, which
  // postgres_changes can't express as a single column filter, so this just
  // re-runs the already-correctly-scoped reload() on any change table-wide
  // rather than trying to replicate that membership test in a filter string.
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_fixtures' }, () => reload())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, reload]);

  return { ...state, reload };
}

/** Team ids the signed-in user captains — the subset allowed to propose or
 *  agree a fixture's schedule. */
export function useMyCaptainTeamIds() {
  const myTeams = useMyTeams();
  if (myTeams.status !== 'ready') return new Set<string>();
  return new Set(myTeams.teams.filter(({ role }) => role === 'captain').map(({ team }) => team.id));
}
