import { useRef } from 'react';

/**
 * A channel name unique to this specific hook/component instance, not just
 * to the table it's watching. supabase-js hands back the SAME channel
 * object to every caller that names the same channel — so if two screens
 * that can be mounted at once (e.g. two tabs, or the Leagues screen's
 * several StandingsTable instances) reused a name like "league-teams",
 * whichever one unmounts first would call removeChannel() and silently kill
 * the subscription still needed by the other. Computed once via useRef, not
 * on every render, so it stays the same channel for this instance's whole
 * lifetime.
 */
export function useRealtimeChannelName(prefix: string) {
  return useRef(`${prefix}-${Math.random().toString(36).slice(2)}`).current;
}
