import { useCallback, useEffect, useRef, useState } from 'react';

import { useRealtimeChannelName } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';

/** A team registered in one league row (e.g. a city league's waiting pool). */
export type LeagueTeam = { team_id: string; team_name: string; team_city: string | null };

type LeagueTeamsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: LeagueTeam[] };

/**
 * The teams in one league row, in the order they joined. Names only:
 * standings are computed from fixtures on the server (league_standings),
 * and the old league_teams counters are gone.
 */
export function useLeagueTeams(leagueId: string) {
  const [state, setState] = useState<LeagueTeamsState>({ status: 'loading' });
  const requestIdRef = useRef(0);
  const channelName = useRealtimeChannelName(`league-teams-${leagueId}`);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('league_teams')
      .select('team_id, teams(name, city)')
      .eq('league_id', leagueId)
      .order('joined_at', { ascending: true });

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    const rows: LeagueTeam[] = (data ?? []).map((row) => {
      const team = row.teams as unknown as { name: string; city: string | null } | null;
      return { team_id: row.team_id, team_name: team?.name ?? 'Unknown team', team_city: team?.city ?? null };
    });

    setState({ status: 'ready', rows });
  }, [leagueId]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  // A team joining or leaving this row. Scoped to this leagueId so other
  // leagues' changes don't wake it up.
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'league_teams', filter: `league_id=eq.${leagueId}` },
        () => reload()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, leagueId, reload]);

  return { ...state, reload };
}
