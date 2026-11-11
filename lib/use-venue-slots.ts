// Book on the venue model (P3): which formats a venue hosts (its pitches
// and pitch combinations) and the free slots for a day (venue_free_slots,
// which applies opening hours, closures, blocks, pitches already booked,
// Cyprus time and the price rules). The app doesn't work any of that out.
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatsOffered, isoWeekday, slotGrid, type FreeSlot, type Slot } from '@/lib/booking';
import { supabase } from '@/lib/supabase';

export type VenueFormatsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; formats: string[]; pitchCount: number };

/** The formats a venue can be booked for, from its pitches and combinations. */
export function useVenueFormats(venueId: string | null) {
  const [state, setState] = useState<VenueFormatsState>({ status: 'idle' });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (!venueId) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });
    const [pitches, combinations] = await Promise.all([
      supabase.from('pitches').select('formats, is_open').eq('venue_id', venueId),
      supabase.from('pitch_combinations').select('format').eq('venue_id', venueId),
    ]);
    if (requestRef.current !== request) return;
    const error = pitches.error ?? combinations.error;
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    const rows = pitches.data ?? [];
    setState({
      status: 'ready',
      formats: formatsOffered(rows, combinations.data ?? []),
      pitchCount: rows.filter((p) => p.is_open).length,
    });
  }, [venueId]);

  useEffect(() => {
    reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  return state;
}

export type VenueSlotsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'closed' }
  | { status: 'ready'; slots: Slot[] };

/** The day's slots for a format: the opening hours as a grid, free where the server says. */
export function useVenueSlots(venueId: string | null, day: string | null, format: string | null, minutes: number) {
  const [state, setState] = useState<VenueSlotsState>({ status: 'idle' });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (!venueId || !day || !format) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });
    const [hours, closures, free] = await Promise.all([
      supabase.from('opening_hours').select('opens, closes').eq('venue_id', venueId).eq('weekday', isoWeekday(day)).maybeSingle(),
      supabase.from('venue_closures').select('id').eq('venue_id', venueId).lte('starts_on', day).gte('ends_on', day),
      supabase.rpc('venue_free_slots', { p_venue_id: venueId, p_day: day, p_format: format, p_minutes: minutes }),
    ]);
    if (requestRef.current !== request) return;
    const error = hours.error ?? closures.error ?? free.error;
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    if (!hours.data || (closures.data ?? []).length > 0) {
      setState({ status: 'closed' });
      return;
    }
    setState({ status: 'ready', slots: slotGrid(hours.data, (free.data ?? []) as FreeSlot[], minutes) });
  }, [venueId, day, format, minutes]);

  useEffect(() => {
    reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  return { state, reload };
}
