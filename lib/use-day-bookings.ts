import { useCallback, useEffect, useRef, useState } from 'react';

import type { BookingWindow } from '@/lib/booking';
import { supabase } from '@/lib/supabase';

/**
 * Booking statuses that should NOT consume pitch capacity.
 *
 * Assumed rather than verified: venue_bookings.status is a free-text column and
 * the table was empty when this was written, so the real vocabulary is unknown.
 * If your statuses differ (say "canceled", or "pending" also shouldn't hold a
 * pitch), this is the one place to change.
 */
export const IGNORED_BOOKING_STATUSES = ['cancelled'];

type DayBookingsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bookings: BookingWindow[] };

/** Bookings for one venue on one day, as the slot grid needs them. */
export function useDayBookings(venueId: string | null, dateKey: string) {
  const [state, setState] = useState<DayBookingsState>({ status: 'idle' });
  // Bumped on every reload() call (including ones triggered by venueId/dateKey
  // changing) and on unmount, so a slow response for a since-superseded
  // venue/day can't land after a newer one and show the wrong slots as free.
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!venueId) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'loading' });

    let query = supabase
      .from('venue_bookings')
      .select('start_time, end_time, pitches')
      .eq('venue_id', venueId)
      .eq('booking_day', dateKey);

    for (const ignored of IGNORED_BOOKING_STATUSES) {
      query = query.neq('status', ignored);
    }

    const { data, error } = await query;

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      setState({ status: 'ready', bookings: data ?? [] });
    }
  }, [venueId, dateKey]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}
