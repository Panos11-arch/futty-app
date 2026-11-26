import { useCallback, useEffect, useRef, useState } from 'react';

import { haptic } from '@/lib/haptics';
import { competitionKey, normaliseScope, type CompetitionPin } from '@/lib/match/league-directory';
import { listPins, pinCompetition, unpinCompetition } from '@/lib/match/pins';

type PinsState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

/** My pinned competitions, shared by both tabs of the Leagues screen. A
 *  toggle shows at once and is put back if the server refuses it. */
export function useCompetitionPins() {
  const [state, setState] = useState<PinsState>({ status: 'loading' });
  const [pins, setPins] = useState<CompetitionPin[]>([]);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const latest = useRef(pins);
  latest.current = pins;

  const reload = useCallback(async () => {
    const result = await listPins();
    if (result.error) {
      setState({ status: 'error', message: result.error });
      return;
    }
    setPins(result.pins);
    setState({ status: 'ready' });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isPinned = useCallback(
    (scope: string, format: string) => {
      const key = competitionKey(scope, format);
      return pins.some((p) => competitionKey(p.scope, p.format) === key);
    },
    [pins],
  );

  const toggle = useCallback(async (rawScope: string, format: string) => {
    const scope = normaliseScope(rawScope);
    const key = competitionKey(scope, format);
    const before = latest.current;
    const wasPinned = before.some((p) => competitionKey(p.scope, p.format) === key);
    haptic.tap();
    setToggleError(null);
    setPins(
      wasPinned
        ? before.filter((p) => competitionKey(p.scope, p.format) !== key)
        : [...before, { target_type: 'league', scope, format }],
    );
    const { error } = wasPinned ? await unpinCompetition(scope, format) : await pinCompetition(scope, format);
    if (error) {
      setPins(before);
      setToggleError('Could not save your pin. Try again.');
    }
  }, []);

  return {
    status: state.status,
    message: state.status === 'error' ? state.message : null,
    pins,
    isPinned,
    toggle,
    toggleError,
    reload,
  };
}
