import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/teams';

export type MyTeam = { team: Team; role: string };

type MyTeamsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; teams: MyTeam[] };

/** Every team the signed-in user belongs to — a profile can be captain of one
 *  team and a player on another, registered for different leagues. */
export function useMyTeams() {
  const { user } = useAuth();
  const [state, setState] = useState<MyTeamsState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!user) return;

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('team_members')
      .select('role, teams(*)')
      .eq('profile_id', user.id)
      .order('joined_at');

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      const teams = (data ?? [])
        .filter((row) => row.teams)
        .map((row) => ({ team: row.teams as unknown as Team, role: row.role }));
      setState({ status: 'ready', teams });
    }
  }, [user]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}
