import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import type { ResultMatch } from '@/lib/match/result';
import {
  emptyMatchLinks,
  findMatchLinks,
  getResultMatch,
  listMyOpenResultMatches,
  type MatchLinkCandidates,
  type MatchLinks,
} from '@/lib/match/results-api';

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & T);

/** Runs `load` on mount and on reload(); a superseded response is dropped. */
function useLoad<T>(load: (() => Promise<{ value: T } | { error: string }>) | null, key: string) {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' });
  const requestIdRef = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const run = loadRef.current;
    if (!run) return;
    const requestId = ++requestIdRef.current;
    const result = await run();
    if (requestIdRef.current !== requestId) return;
    if ('error' in result) setState({ status: 'error', message: result.error });
    else setState({ status: 'ready', ...result.value });
  }, []);

  // A new key (new ids) starts from loading, so nothing is shown from the
  // previous answer; a plain reload() keeps showing it until the new one lands.
  useEffect(() => {
    setState({ status: 'loading' });
    reload();
  }, [reload, key]);

  useEffect(
    () => () => {
      requestIdRef.current++;
    },
    []
  );

  return { state, reload };
}

/** One match for the result screen; `match` is null when it doesn't exist or isn't the viewer's. */
export function useResultMatch(matchId: string | undefined) {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const { state, reload } = useLoad<{ match: ResultMatch | null }>(
    viewerId && matchId
      ? async () => {
          const { match, error } = await getResultMatch(matchId, viewerId);
          return error ? { error: error.message } : { value: { match } };
        }
      : null,
    `${viewerId}|${matchId}`
  );
  return { ...state, viewerId, reload };
}

/** The viewer's matches whose result can still be entered or answered. */
export function useOpenResultMatches() {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const { state, reload } = useLoad<{ matches: ResultMatch[] }>(
    viewerId
      ? async () => {
          const { matches, error } = await listMyOpenResultMatches(viewerId);
          return error ? { error: error.message } : { value: { matches } };
        }
      : null,
    viewerId ?? ''
  );
  return { ...state, viewerId, reload };
}

/** Which of these games already have a match (made since A2). Until it has
 *  loaded, `links` is empty, so callers hide nothing yet. */
export function useMatchLinks(candidates: MatchLinkCandidates) {
  const key = [
    (candidates.bookingIds ?? []).join(','),
    (candidates.friendlyMatchIds ?? []).join(','),
    (candidates.leagueFixtureIds ?? []).join(','),
  ].join('|');
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  const { state, reload } = useLoad<{ links: MatchLinks }>(async () => {
    const { links, error } = await findMatchLinks(candidatesRef.current);
    return error ? { error: error.message } : { value: { links } };
  }, key);

  return {
    status: state.status,
    links: state.status === 'ready' ? state.links : emptyMatchLinks(),
    reload,
  };
}
