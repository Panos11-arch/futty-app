// The venue a dashboard screen opened from the dashboard is for (P6d): the
// `venueId` route param, only if the signed-in user owns it. Never another
// of their venues in its place. The server checks staff again on every call
// the screen makes; this only decides what the screen shows.
import { useCallback } from 'react';

import { useAuth } from '@/lib/auth';
import { useLoad } from '@/lib/booking-search';
import { supabase } from '@/lib/supabase';

export type OwnedVenue = { id: string; name: string };

export type OwnedVenueState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** No venueId, a malformed one, or a venue this user doesn't own. */
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; venue: OwnedVenue };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const VENUE_LOAD_ERROR = 'Your venue couldn’t be loaded. Try again.';

export function useOwnedVenue(venueId: string | undefined): { state: OwnedVenueState; reload: () => void } {
  const { user, initializing } = useAuth();
  const userId = user?.id ?? null;
  const validId = venueId !== undefined && UUID.test(venueId) ? venueId : null;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('venues')
      .select('id, name')
      .eq('id', validId as string)
      .eq('owner_profile_id', userId as string);
    if (error) throw new Error(VENUE_LOAD_ERROR);
    return ((data ?? []) as OwnedVenue[])[0] ?? null;
  }, [validId, userId]);
  // Nothing is asked for until there's a user and a well-formed id.
  const { state, reload } = useLoad(userId && validId ? `${userId}|${validId}` : null, load);

  if (initializing) return { state: { status: 'loading' }, reload };
  if (!userId) return { state: { status: 'signed_out' }, reload };
  if (!validId) return { state: { status: 'not_found' }, reload };
  if (state.status === 'ready') {
    return { state: state.data ? { status: 'ready', venue: state.data } : { status: 'not_found' }, reload };
  }
  return { state, reload };
}
