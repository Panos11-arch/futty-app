import { useCallback, useEffect, useState } from 'react';

import { listLeagueFixturesOnDay, type DayFixture } from '@/lib/match/day-fixtures';

type DayFixturesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fixtures: DayFixture[] };

/** League fixtures on one Cyprus day; `refreshing` is a pull to refresh,
 *  which keeps the list on screen while it reloads. */
export function useDayFixtures(dayKey: string) {
  const [state, setState] = useState<DayFixturesState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (mode: 'load' | 'refresh') => {
      if (mode === 'load') setState({ status: 'loading' });
      else setRefreshing(true);
      const { fixtures, error } = await listLeagueFixturesOnDay(dayKey);
      setRefreshing(false);
      setState(error ? { status: 'error', message: error } : { status: 'ready', fixtures });
    },
    [dayKey],
  );

  useEffect(() => {
    void load('load');
  }, [load]);

  const reload = useCallback(() => load('load'), [load]);
  const refresh = useCallback(() => load('refresh'), [load]);

  return { ...state, refreshing, reload, refresh };
}
