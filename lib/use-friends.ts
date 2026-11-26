// S20: the friends screens' data. Everything is read from the server; a
// request answered here leaves the list at once, and is put back if the
// server refuses.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import {
  acceptFriendRequest,
  declineFriendRequest,
  describeFriendError,
  fetchFriendRequestCount,
  fetchFriends,
  fetchProfileCard,
  type CardLookup,
  type FriendRow,
  type ProfileCard,
} from '@/lib/friends';

export const FRIENDS_LOAD_FAILED = "Friends couldn't load.";

export type FriendsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: FriendRow[] };

/** Community → Friends: requests first, then friends. */
export function useFriends() {
  const [state, setState] = useState<FriendsState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (mode: 'first' | 'refresh') => {
    const mine = ++request.current;
    if (mode === 'refresh') setRefreshing(true);
    else setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    try {
      const rows = await fetchFriends();
      if (request.current === mine) setState({ status: 'ready', rows });
    } catch {
      if (request.current === mine) {
        setState((s) => (s.status === 'ready' && mode === 'refresh' ? s : { status: 'error', message: FRIENDS_LOAD_FAILED }));
      }
    } finally {
      if (request.current === mine) setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load('first');
    }, [load]),
  );

  const removeRequest = (requestId: string) =>
    setState((s) => (s.status === 'ready' ? { ...s, rows: s.rows.filter((r) => r.request_id !== requestId) } : s));

  /** Resolves to the error line, or null with the friend chat's id. */
  async function accept(row: FriendRow): Promise<{ error: string | null; conversationId: string | null }> {
    if (!row.request_id) return { error: describeFriendError(null), conversationId: null };
    const { conversationId, error } = await acceptFriendRequest(row.request_id);
    if (error) return { error: describeFriendError(error), conversationId: null };
    await load('refresh');
    return { error: null, conversationId };
  }

  async function decline(row: FriendRow): Promise<string | null> {
    if (!row.request_id) return describeFriendError(null);
    const before = state;
    removeRequest(row.request_id);
    const { error } = await declineFriendRequest(row.request_id);
    if (error) {
      setState(before);
      return describeFriendError(error);
    }
    return null;
  }

  return {
    state,
    refreshing,
    reload: () => load('first'),
    refresh: () => load('refresh'),
    accept,
    decline,
  };
}

/** The Friends badge in Community: requests waiting for me, read on focus. */
export function useFriendRequestCount(): number {
  const userId = useAuth().user?.id;
  const [count, setCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      fetchFriendRequestCount()
        .then(setCount)
        .catch(() => {});
    }, [userId]),
  );
  return count;
}

export type ProfileCardState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; card: ProfileCard };

export const CARD_LOAD_FAILED = "This card couldn't load.";

/** Another player's card, by username or id; null loads nothing. */
export function useProfileCard(who: CardLookup | null) {
  const key = who ? ('username' in who ? `u:${who.username.toLowerCase()}` : `p:${who.profileId}`) : null;
  const [state, setState] = useState<ProfileCardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const whoRef = useRef(who);
  whoRef.current = who;

  useEffect(() => {
    const current = whoRef.current;
    if (!current) return;
    let live = true;
    setState({ status: 'loading' });
    fetchProfileCard(current)
      .then(({ card, error }) => {
        if (!live) return;
        if (card) setState({ status: 'ready', card });
        else if (error?.message === 'player_not_found') setState({ status: 'not_found' });
        else setState({ status: 'error', message: CARD_LOAD_FAILED });
      })
      .catch(() => {
        if (live) setState({ status: 'error', message: CARD_LOAD_FAILED });
      });
    return () => {
      live = false;
    };
  }, [key, attempt]);

  /** After Add friend, Accept and the rest: the friendship as it is now. */
  const setCard = (card: ProfileCard) => setState({ status: 'ready', card });

  return { state, reload: () => setAttempt((n) => n + 1), setCard };
}
