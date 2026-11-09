import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type Venue = {
  id: string;
  name: string;
  city: string;
  surface: string | null;
  base_pitches: number;
  /** Postgres `time`, e.g. "15:00:00". */
  open_time: string;
  close_time: string;
  price_per_pitch_hour: number | null;
  /** False for a venue Futty has switched off; book_slot refuses it (venue_not_live). */
  is_live: boolean;
};

/** Best-effort Google Maps link for a venue. There's no stored address or
 *  lat/lng (adding those now would mean guessing real-world coordinates for
 *  the seeded venues, which is worse than not having them), so this is a
 *  name+city search URL rather than a precise pin — Google's own search
 *  still resolves a real, named venue correctly most of the time. */
export function mapsUrlForVenue(venue: Pick<Venue, 'name' | 'city'>) {
  const query = encodeURIComponent(`${venue.name}, ${venue.city}, Cyprus`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

type VenuesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; venues: Venue[] };

export function useVenues() {
  const [state, setState] = useState<VenuesState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('venues')
      .select('id, name, city, surface, base_pitches, open_time, close_time, price_per_pitch_hour, is_live')
      .order('city')
      .order('name');

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
    } else {
      setState({ status: 'ready', venues: data ?? [] });
    }
  }, []);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  /** Cities present in the data, rather than a hardcoded list. */
  const cities = useMemo(() => {
    if (state.status !== 'ready') return [];
    return [...new Set(state.venues.map((venue) => venue.city))].sort();
  }, [state]);

  return { ...state, cities, reload };
}
