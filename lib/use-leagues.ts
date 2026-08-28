import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { League } from '@/lib/leagues';

type LeaguesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; leagues: League[] };

/** Every league row — standard leagues, Open League hubs, and any divisions
 *  formed under them. Small enough at this scale to fetch in one go and let
 *  the screen filter/group client-side, same as the venues screen. */
export function useLeagues() {
  const [state, setState] = useState<LeaguesState>({ status: 'loading' });

  const reload = useCallback(async () => {
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('leagues')
      .select('id, name, format, scope, stage, start_date, season_weeks, capacity, parent_league_id')
      .order('format')
      .order('scope');

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      setState({ status: 'ready', leagues: data ?? [] });
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}
