// S17: "Around me" and the venues map (Book a pitch, image 02; Playtomic 01, 05).
//
// The player's location is asked for only when they tap "Around me". It is
// rounded on the phone to about 1 km (two decimal places) before anything
// else sees it, used on the phone to sort venues by distance, and never sent
// to the server or kept: the forecast is for the venue, at the venue's own
// coordinates (venue-weather reads them itself).
//
// Venue coordinates are the venues' own (spec 13 "Coordinates"), read as the
// player, so RLS shows only venues they can see.
import * as Location from 'expo-location';
import { useCallback } from 'react';

import { useLoad } from '@/lib/booking-search';
import { supabase } from '@/lib/supabase';

export type Coordinates = { latitude: number; longitude: number };

/** A map region (react-native-maps' Region). */
export type MapRegion = Coordinates & { latitudeDelta: number; longitudeDelta: number };

/** All of Cyprus, for a map with no pins. */
export const CYPRUS_REGION: MapRegion = { latitude: 35.05, longitude: 33.3, latitudeDelta: 1.6, longitudeDelta: 2.6 };

/** A lone pin's map: a few kilometres across. */
const ONE_PIN_DELTA = 0.05;
/** Room around the pins so none sits on the edge. */
const PADDING = 1.4;

/** About 1 km: two decimal places of a degree. */
export function roundToKm(c: Coordinates): Coordinates {
  const round = (n: number) => Math.round(n * 100) / 100;
  return { latitude: round(c.latitude), longitude: round(c.longitude) };
}

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line distance (haversine). */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** "3 km": whole kilometres, as precise as the rounded location allows. */
export function distanceLabel(km: number): string {
  return `${Math.max(1, Math.round(km))} km`;
}

/** Nearest first. Venues without coordinates go last, in the order given. */
export function sortByDistance<T extends { venue_id: string }>(
  rows: T[],
  coords: Record<string, Coordinates>,
  here: Coordinates,
): T[] {
  const away = (r: T) => (coords[r.venue_id] ? distanceKm(here, coords[r.venue_id]) : Infinity);
  return rows
    .map((row, i) => ({ row, i, km: away(row) }))
    .sort((a, b) => (a.km === b.km ? a.i - b.i : a.km - b.km))
    .map((x) => x.row);
}

/** The coordinates of these venues that have them. Any failure reads as none:
 *  the map and the distances just leave those venues out. */
export async function fetchVenueCoordinates(ids: string[]): Promise<Record<string, Coordinates>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('venues')
    .select('id, latitude, longitude')
    .in('id', ids)
    .not('latitude', 'is', null);
  if (error || !data) return {};
  const out: Record<string, Coordinates> = {};
  for (const v of data as { id: string; latitude: number | null; longitude: number | null }[]) {
    if (v.latitude !== null && v.longitude !== null) out[v.id] = { latitude: v.latitude, longitude: v.longitude };
  }
  return out;
}

/** One venue's coordinates (its page's map); null until read, or without any. */
export function useVenueCoordinates(venueId: string | null | undefined): Coordinates | null {
  const load = useCallback(() => fetchVenueCoordinates(venueId ? [venueId] : []), [venueId]);
  const { state } = useLoad(venueId ? `venue-coordinates:${venueId}` : null, load);
  return venueId && state.status === 'ready' ? (state.data[venueId] ?? null) : null;
}

export type LocateResult = { status: 'ready'; here: Coordinates } | { status: 'denied' } | { status: 'failed' };

/** "Around me": asks for permission (only now, on the tap), then a rough
 *  position, rounded to about 1 km. */
export async function locateMe(): Promise<LocateResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
    // Low accuracy (about 1 km) is all distances need, and it's quicker.
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    return { status: 'ready', here: roundToKm(position.coords) };
  } catch {
    return { status: 'failed' };
  }
}

/** A region that shows every pin; all of Cyprus without any. */
export function mapRegion(points: Coordinates[]): MapRegion {
  if (points.length === 0) return CYPRUS_REGION;
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * PADDING, ONE_PIN_DELTA),
    longitudeDelta: Math.max((maxLon - minLon) * PADDING, ONE_PIN_DELTA),
  };
}
