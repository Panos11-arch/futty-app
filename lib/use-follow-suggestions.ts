import { useCallback, useEffect, useRef, useState } from 'react';

import { dismissFollowSuggestion, fetchFollowSuggestions, type FollowSuggestion } from '@/lib/community';

type SuggestionsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: FollowSuggestion[] };

/** S7: "Start following some accounts": players the server says you've
 *  played with, that you don't follow and haven't dismissed. */
export function useFollowSuggestions(limit = 20) {
  const [state, setState] = useState<SuggestionsState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });
    const { data, error } = await fetchFollowSuggestions(limit);
    if (requestIdRef.current !== requestId) return;
    setState(error || !data ? { status: 'error' } : { status: 'ready', items: data });
  }, [limit]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  /** Hides the card at once; puts it back if the server refuses. */
  const dismiss = useCallback(
    async (profileId: string) => {
      if (state.status !== 'ready') return { error: null };
      const prior = state.items;
      setState({ status: 'ready', items: prior.filter((s) => s.id !== profileId) });
      const { error } = await dismissFollowSuggestion(profileId);
      if (error) setState({ status: 'ready', items: prior });
      return { error };
    },
    [state],
  );

  return { ...state, reload, dismiss };
}
