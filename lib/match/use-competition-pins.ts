import { useCallback, useEffect, useRef, useState } from 'react';

import { haptic } from '@/lib/haptics';
import { competitionKey, normaliseScope, type CompetitionPin } from '@/lib/match/league-directory';
import { listPins, pinCompetition, pinTournament, unpinCompetition, unpinTournament } from '@/lib/match/pins';

/** A league pin's key; null for a tournament pin. */
function leagueKeyOf(p: CompetitionPin): string | null {
  return p.target_type === 'league' ? competitionKey(p.scope, p.format) : null;
}

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
      return pins.some((p) => leagueKeyOf(p) === key);
    },
    [pins],
  );

  const isTournamentPinned = useCallback(
    (tournamentId: string) => pins.some((p) => p.target_type === 'tournament' && p.tournament_id === tournamentId),
    [pins],
  );

  const toggle = useCallback(async (rawScope: string, format: string) => {
    const scope = normaliseScope(rawScope);
    const key = competitionKey(scope, format);
    const before = latest.current;
    const wasPinned = before.some((p) => leagueKeyOf(p) === key);
    haptic.tap();
    setToggleError(null);
    setPins(
      wasPinned
        ? before.filter((p) => leagueKeyOf(p) !== key)
        : [...before, { target_type: 'league', scope, format }],
    );
    const { error } = wasPinned ? await unpinCompetition(scope, format) : await pinCompetition(scope, format);
    if (error) {
      setPins(before);
      setToggleError('Could not save your pin. Try again.');
    }
  }, []);

  /** S10A: the same, for a tournament (tournament_pins). */
  const toggleTournament = useCallback(async (tournamentId: string) => {
    const before = latest.current;
    const mine = (p: CompetitionPin) => p.target_type === 'tournament' && p.tournament_id === tournamentId;
    const wasPinned = before.some(mine);
    haptic.tap();
    setToggleError(null);
    setPins(wasPinned ? before.filter((p) => !mine(p)) : [...before, { target_type: 'tournament', tournament_id: tournamentId }]);
    const { error } = wasPinned ? await unpinTournament(tournamentId) : await pinTournament(tournamentId);
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
    isTournamentPinned,
    toggleTournament,
    toggleError,
    reload,
  };
}
