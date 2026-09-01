import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { toDateKey } from '@/lib/days';
import { supabase } from '@/lib/supabase';

export type MyBooking = {
  id: string;
  venue_id: string;
  booking_day: string;
  start_time: string;
  end_time: string;
  pitches: number;
  capacity: number;
  format: string;
};

type MyBookingsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bookings: MyBooking[] };

export function useMyBookings() {
  const { user } = useAuth();
  const [state, setState] = useState<MyBookingsState>({ status: 'loading' });
  // Bumped on every reload() call and on unmount, so a response for a
  // superseded request (or one that lands after the component is gone)
  // doesn't overwrite newer state.
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!user) return;

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('venue_bookings')
      .select('id, venue_id, booking_day, start_time, end_time, pitches, capacity, format')
      .eq('created_by', user.id)
      // A venue owner's own recurring training blocks (booking_type =
      // 'owner_block') also have created_by = their own id, so without this
      // they'd show up as if they were a real game the owner had booked to
      // play — this is "your next game", not the venue's internal schedule.
      .eq('booking_type', 'user_booking')
      // Only 'confirmed' (item 2) — a booking still 'pending_payment' never
      // had its own authorization succeed (or it's free and was confirmed
      // outright at creation), so it isn't a real game yet and shouldn't
      // show here as if it were, even though the row already exists.
      .eq('status', 'confirmed')
      .gte('booking_day', toDateKey(new Date()))
      .order('booking_day')
      .order('start_time');

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    // The day filter above can still include a booking from earlier today
    // whose end time has already passed — otherwise a past booking would
    // sit in bookings[0] forever and "Your next game" would never move on.
    const now = new Date();
    const upcoming = (data ?? []).filter(
      (booking) => new Date(`${booking.booking_day}T${booking.end_time}`) > now
    );

    setState({ status: 'ready', bookings: upcoming });
  }, [user]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}

/** Bookings you made that have ended but have no result logged yet — feeds
 *  the "log a result" prompt on the home screen. Deliberately a separate
 *  query from useMyBookings rather than reusing its result: that one
 *  excludes anything whose end time has already passed (by design, so "Your
 *  next game" moves on to the next one), which is exactly the set this needs. */
export function useMyUnscoredBookings() {
  const { user } = useAuth();
  const [state, setState] = useState<MyBookingsState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!user) return;

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('venue_bookings')
      .select('id, venue_id, booking_day, start_time, end_time, pitches, capacity, format')
      .eq('created_by', user.id)
      .eq('booking_type', 'user_booking')
      .eq('status', 'confirmed')
      .is('result', null)
      .order('booking_day')
      .order('start_time');

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    const now = new Date();
    const ended = (data ?? []).filter(
      (booking) => new Date(`${booking.booking_day}T${booking.end_time}`) <= now
    );

    setState({ status: 'ready', bookings: ended });
  }, [user]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}
