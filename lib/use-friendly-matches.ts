import { useCallback, useEffect, useState } from 'react';

import { type FriendlyMatch, listFriendlyMatchesForTeams } from '@/lib/friendly-matches';
import { useMyTeams } from '@/lib/use-my-teams';

type FriendlyMatchesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; matches: FriendlyMatch[] };

/** Every friendly match (from a matched Squads opposition post) involving
 *  any team the signed-in user belongs to, in any role. */
export function useMyFriendlyMatches() {
  const myTeams = useMyTeams();
  const [state, setState] = useState<FriendlyMatchesState>({ status: 'loading' });

  const teamIds = myTeams.status === 'ready' ? myTeams.teams.map(({ team }) => team.id) : [];
  const teamIdsKey = teamIds.join(',');

  const reload = useCallback(async () => {
    if (myTeams.status !== 'ready') return;

    setState({ status: 'loading' });
    const { data, error } = await listFriendlyMatchesForTeams(teamIds);

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      setState({ status: 'ready', matches: data });
    }
    // teamIdsKey (not teamIds) is the real dependency — a new array with the
    // same ids shouldn't trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeams.status, teamIdsKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}
