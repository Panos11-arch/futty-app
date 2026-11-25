import { useCallback, useEffect, useRef, useState } from 'react';

import { FEED_PAGE_SIZE, fetchFeed, type FeedItem, type FeedScope } from '@/lib/community';
import { mergePages, nextCursor } from '@/lib/community-feed';

export type FeedState = {
  status: 'loading' | 'error' | 'ready';
  items: FeedItem[];
  /** Pull to refresh in progress (the list stays on screen). */
  refreshing: boolean;
  loadingMore: boolean;
  /** False once a page came back short. */
  hasMore: boolean;
};

const START: FeedState = { status: 'loading', items: [], refreshing: false, loadingMore: false, hasMore: true };

/** S7: one scope of the Community feed, newest first, paged by the server. */
export function useCommunityFeed(scope: FeedScope) {
  const [state, setState] = useState<FeedState>(START);
  const requestIdRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadFirst = useCallback(
    async (mode: 'load' | 'refresh') => {
      const requestId = ++requestIdRef.current;
      setState((s) => (mode === 'refresh' && s.status === 'ready' ? { ...s, refreshing: true } : START));
      const { data, error } = await fetchFeed(scope);
      if (requestIdRef.current !== requestId) return;
      if (error || !data) {
        setState((s) =>
          mode === 'refresh' && s.status === 'ready' ? { ...s, refreshing: false } : { ...START, status: 'error' },
        );
        return;
      }
      setState({
        status: 'ready',
        items: data,
        refreshing: false,
        loadingMore: false,
        hasMore: data.length >= FEED_PAGE_SIZE,
      });
    },
    [scope],
  );

  useEffect(() => {
    loadFirst('load');
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'ready' || current.loadingMore || current.refreshing || !current.hasMore) return;
    const requestId = requestIdRef.current;
    setState((s) => ({ ...s, loadingMore: true }));
    const { data, error } = await fetchFeed(scope, nextCursor(current.items));
    if (requestIdRef.current !== requestId) return;
    if (error || !data) {
      // Keep what's shown; scrolling to the end again retries.
      setState((s) => ({ ...s, loadingMore: false }));
      return;
    }
    setState((s) => ({
      ...s,
      items: mergePages(s.items, data),
      loadingMore: false,
      hasMore: data.length >= FEED_PAGE_SIZE,
    }));
  }, [scope]);

  const reload = useCallback(() => loadFirst('load'), [loadFirst]);
  const refresh = useCallback(() => loadFirst('refresh'), [loadFirst]);

  return { ...state, reload, refresh, loadMore };
}
