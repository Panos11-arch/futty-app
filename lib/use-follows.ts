import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { follow, unfollow, type FollowTarget } from '@/lib/community';
import { supabase } from '@/lib/supabase';

function followKey(targetType: FollowTarget, targetId: string) {
  return `${targetType}:${targetId}`;
}

type FollowsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; keys: Set<string> };

/** The signed-in user's own follow state — never anyone else's, since
 *  follower counts and "who follows me" aren't part of this feature. */
export function useFollows() {
  const { user } = useAuth();
  const [state, setState] = useState<FollowsState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!user) return;

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('user_follows')
      .select('target_type, target_id')
      .eq('follower_id', user.id);

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      const keys = new Set((data ?? []).map((row) => followKey(row.target_type, row.target_id)));
      setState({ status: 'ready', keys });
    }
  }, [user]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  const isFollowing = useCallback(
    (targetType: FollowTarget, targetId: string) =>
      state.status === 'ready' && state.keys.has(followKey(targetType, targetId)),
    [state]
  );

  const toggle = useCallback(
    async (targetType: FollowTarget, targetId: string) => {
      if (!user || state.status !== 'ready') return { error: null };

      const key = followKey(targetType, targetId);
      const wasFollowing = state.keys.has(key);
      const priorKeys = state.keys;

      // Optimistic — update in place instead of round-tripping through a
      // 'loading' state, which briefly made every follow button in the list
      // (not just the one tapped) flash back to "Follow" while it reloaded.
      const nextKeys = new Set(priorKeys);
      if (wasFollowing) nextKeys.delete(key);
      else nextKeys.add(key);
      setState({ status: 'ready', keys: nextKeys });

      const { error } = wasFollowing
        ? await unfollow(user.id, targetType, targetId)
        : await follow(user.id, targetType, targetId);

      if (error) setState({ status: 'ready', keys: priorKeys }); // revert
      return { error };
    },
    [user, state]
  );

  return { status: state.status, isFollowing, toggle, reload };
}
