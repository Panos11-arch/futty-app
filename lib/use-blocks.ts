import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { blockUser, listMyBlocks, unblockUser } from '@/lib/moderation';

type BlocksState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; blockedIds: Set<string> };

/** The signed-in user's own block list — same shape as useFollows, since
 *  it's the same "toggle a personal relationship to another profile"
 *  pattern. list_players() already excludes blocked users server-side; this
 *  is what drives the button state (Block vs Blocked) in the UI. */
export function useBlocks() {
  const { user } = useAuth();
  const [state, setState] = useState<BlocksState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!user) return;

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await listMyBlocks(user.id);

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      setState({ status: 'ready', blockedIds: new Set((data ?? []).map((row) => row.blocked_id)) });
    }
  }, [user]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  const isBlocked = useCallback(
    (targetId: string) => state.status === 'ready' && state.blockedIds.has(targetId),
    [state]
  );

  const toggle = useCallback(
    async (targetId: string) => {
      if (!user || state.status !== 'ready') return { error: null };

      const wasBlocked = state.blockedIds.has(targetId);
      const priorIds = state.blockedIds;

      // Optimistic — same fix as useFollows.toggle: avoids a 'loading'
      // round-trip that would otherwise flicker every block button in the
      // list, not just the one tapped.
      const nextIds = new Set(priorIds);
      if (wasBlocked) nextIds.delete(targetId);
      else nextIds.add(targetId);
      setState({ status: 'ready', blockedIds: nextIds });

      const { error } = wasBlocked
        ? await unblockUser(user.id, targetId)
        : await blockUser(user.id, targetId);

      if (error) setState({ status: 'ready', blockedIds: priorIds }); // revert
      return { error };
    },
    [user, state]
  );

  return { status: state.status, isBlocked, toggle, reload };
}
