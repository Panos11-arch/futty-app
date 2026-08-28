import { useCallback, useEffect, useRef, useState } from 'react';

import { sortStandings, type LeagueTeamRow } from '@/lib/leagues';
import { useRealtimeChannelName } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';

export type StandingsRow = LeagueTeamRow & { team_name: string; team_city: string | null };

type StandingsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: StandingsRow[] };

export function useLeagueStandings(leagueId: string) {
  const [state, setState] = useState<StandingsState>({ status: 'loading' });
  const requestIdRef = useRef(0);
  const channelName = useRealtimeChannelName(`league-teams-${leagueId}`);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('league_teams')
      .select(
        'id, league_id, team_id, played, won, drawn, lost, goals_for, goals_against, pts_adjustment, teams(name, city)'
      )
      .eq('league_id', leagueId);

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    const rows: StandingsRow[] = (data ?? []).map((row) => {
      const team = row.teams as unknown as { name: string; city: string | null } | null;
      return {
        ...row,
        team_name: team?.name ?? 'Unknown team',
        team_city: team?.city ?? null,
      };
    });

    setState({ status: 'ready', rows: sortStandings(rows) });
  }, [leagueId]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  // played/won/drawn/lost/goals/pts_adjustment all change the instant a
  // score is confirmed (or a dispute locks) via check_fixture_score_match —
  // scoped to this leagueId so switching Format/city chips on the Leagues
  // screen doesn't wake up every division's standings for every update.
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
