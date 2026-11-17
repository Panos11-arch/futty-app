// Loads venue_setup for one of the P6e setup screens, and runs its writes:
// after the server accepts a change the screen reloads quietly (what it
// shows stays on screen meanwhile); a refusal comes back in words.
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeSetupError, fetchVenueSetup, type VenueSetup } from '@/lib/venue-setup';

export type SetupState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; setup: VenueSetup };

type Result = PromiseLike<{ error: { message: string } | null }>;

export function useVenueSetup(venueId: string) {
  const [state, setState] = useState<SetupState>({ status: 'loading' });
  const request = useRef(0);

  const reload = useCallback(async () => {
    const id = ++request.current;
    const { data, error } = await fetchVenueSetup(venueId);
    if (id !== request.current) return;
    setState(
      error || !data
        ? { status: 'error', message: describeSetupError(error?.message ?? '') }
        : { status: 'ready', setup: data as VenueSetup },
    );
  }, [venueId]);

  useEffect(() => {
    setState({ status: 'loading' });
    reload();
    return () => {
      request.current += 1;
    };
  }, [reload]);

  /** Null when the server accepted it (and the screen reloads), or its refusal in words. */
  const write = useCallback(
    async (result: Result): Promise<string | null> => {
      const { error } = await result;
      if (error) return describeSetupError(error.message);
      reload();
      return null;
    },
    [reload],
  );

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    reload();
  }, [reload]);

  return { state, write, retry };
}
