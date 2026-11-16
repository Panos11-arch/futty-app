// venue-weather (P11): the forecast for a venue's game hours, and the venue
// dashboard's bad-forecast nudge (docs/specs/13-payments-bookings.md
// "Weather, condition warnings and blocking pitches"). See index.ts.
//
// Apple is asked at most once an hour per venue: each venue's hourly
// forecast is cached (weather_cache) with the time it was fetched, and
// Apple's attribution once an hour for everyone. A forecast is only ever
// returned with Apple's mark and data-sources link; without them, nothing.
import { DbError } from '../_shared/db.ts';
import type { AppRules } from '../_shared/rules.ts';
import type { WeatherAttribution, WeatherHour, WeatherSource } from '../_shared/weatherkit.ts';
import { assess, type Forecast, gameSpan } from './assess.ts';

/** How long a forecast is kept (spec 13: fetched at most once an hour). */
const CACHE_MS = 3_600_000;
/** At most this many windows in one request: one screen's worth. */
const MAX_WINDOWS = 20;

export type CacheRow = { fetchedAt: string; body: unknown };

export type Deps = {
  now(): Date;
  weather: WeatherSource;
  /** The venue as the caller sees it (RLS), or null if they can't. */
  loadVenue(venueId: string): Promise<{ latitude: number | null; longitude: number | null } | null>;
  loadRules(): Promise<AppRules>;
  cache: {
    get(key: string): Promise<CacheRow | null>;
    put(key: string, body: unknown, fetchedAt: Date): Promise<void>;
  };
  /** venue_weather_slots, as the caller: throws DbError('not_venue_staff') for anyone else. */
  staffSlots(venueId: string): Promise<StaffSlot[]>;
  log(message: string, err?: unknown): void;
};

/** A game in Cyprus time: '2026-11-20', '18:00', '19:00' (an end of '00:00' is midnight). */
export type GameWindow = { day: string; start: string; end: string };
export type StaffSlot = GameWindow & { booking_id: string; pitch_ids: string[] };

export type WindowResult =
  & GameWindow
  & ({ status: 'forecast'; forecast: Forecast } | { status: 'out_of_range' | 'past' | 'unavailable' });

export type Result = { status: number; body: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
/** Midnight at the end of the day, as the database and the app write it. */
const MIDNIGHT_END = /^24:00(:00)?$/;

function parseWindow(raw: unknown): GameWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.day !== 'string' || !DAY.test(w.day)) return null;
  if (typeof w.start !== 'string' || !TIME.test(w.start)) return null;
  if (typeof w.end !== 'string' || !(TIME.test(w.end) || MIDNIGHT_END.test(w.end))) return null;
  const start = w.start.slice(0, 5);
  const end = w.end.slice(0, 5);
  // An end at or before the start is only allowed as midnight (00:00 or 24:00).
  if (end <= start && end !== '00:00') return null;
  return { day: w.day, start, end };
}

type Request = { venueId: string; windows: GameWindow[] } | { venueId: string; nudges: true };

function parseRequest(raw: unknown): Request | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.venue_id !== 'string' || !UUID.test(r.venue_id)) return null;
  if (r.nudges === true) return { venueId: r.venue_id, nudges: true };
  if (!Array.isArray(r.windows) || r.windows.length === 0 || r.windows.length > MAX_WINDOWS) return null;
  const windows = r.windows.map(parseWindow);
  if (windows.some((w) => w === null)) return null;
  return { venueId: r.venue_id, windows: windows as GameWindow[] };
}

const fresh = (row: CacheRow | null, now: Date) =>
  row !== null && now.getTime() - Date.parse(row.fetchedAt) < CACHE_MS;

type Coordinates = { latitude: number; longitude: number };
type CachedForecast = Coordinates & { hours: WeatherHour[] };

/** The venue's hourly forecast, from the cache when it's under an hour old
 *  and for the same coordinates; otherwise from Apple, then cached. */
async function venueHours(deps: Deps, venueId: string, at: Coordinates, now: Date): Promise<WeatherHour[]> {
  const key = `venue:${venueId}`;
  const row = await deps.cache.get(key);
  const cached = row?.body as CachedForecast | undefined;
  if (fresh(row, now) && cached && cached.latitude === at.latitude && cached.longitude === at.longitude) {
    return cached.hours;
  }
  const hours = await deps.weather.hourly(at.latitude, at.longitude);
  await deps.cache.put(key, { ...at, hours } satisfies CachedForecast, now);
  return hours;
}

async function attribution(deps: Deps, now: Date): Promise<WeatherAttribution> {
  const key = 'attribution:en';
  const row = await deps.cache.get(key);
  if (fresh(row, now)) return row!.body as WeatherAttribution;
  const value = await deps.weather.attribution();
  await deps.cache.put(key, value, now);
  return value;
}

/** Forecast and attribution together, or null: never one without the other. */
async function load(deps: Deps, venueId: string, at: Coordinates, now: Date) {
  try {
    const [hours, mark] = await Promise.all([venueHours(deps, venueId, at, now), attribution(deps, now)]);
    return { hours, mark };
  } catch (err) {
    deps.log(`venue-weather: no forecast for venue ${venueId}`, err);
    return null;
  }
}

function coordinates(venue: { latitude: number | null; longitude: number | null }): Coordinates | null {
  return venue.latitude === null || venue.longitude === null ? null : { latitude: venue.latitude, longitude: venue.longitude };
}

export async function handleWeather(deps: Deps, rawBody: unknown): Promise<Result> {
  const request = parseRequest(rawBody);
  if (!request) return { status: 400, body: { error: 'invalid_request' } };

  const venue = await deps.loadVenue(request.venueId);
  if (!venue) return { status: 404, body: { error: 'venue_not_found' } };
  const at = coordinates(venue);
  const now = deps.now();

  if ('nudges' in request) {
    let slots: StaffSlot[];
    try {
      slots = await deps.staffSlots(request.venueId);
    } catch (err) {
      if (err instanceof DbError && err.message === 'not_venue_staff') {
        return { status: 403, body: { error: 'not_venue_staff' } };
      }
      throw err;
    }
    if (!at || slots.length === 0) return { status: 200, body: { attribution: null, slots: [] } };
    const loaded = await load(deps, request.venueId, at, now);
    if (!loaded) return { status: 200, body: { attribution: null, slots: [] } };
    const rules = await deps.loadRules();
    const bad = slots.flatMap((slot) => {
      const result = assess(loaded.hours, gameSpan(slot.day, slot.start, slot.end), now.getTime(), rules);
      return result.status === 'forecast' && result.forecast.warnings.length > 0 ? [{ ...slot, forecast: result.forecast }] : [];
    });
    return { status: 200, body: { attribution: bad.length > 0 ? loaded.mark : null, slots: bad } };
  }

  const unavailable = () => ({
    status: 200,
    body: { attribution: null, windows: request.windows.map((w) => ({ ...w, status: 'unavailable' })) },
  });
  if (!at) return unavailable();
  const loaded = await load(deps, request.venueId, at, now);
  if (!loaded) return unavailable();
  const rules = await deps.loadRules();

  const windows: WindowResult[] = request.windows.map((w) => ({
    ...w,
    ...assess(loaded.hours, gameSpan(w.day, w.start, w.end), now.getTime(), rules),
  }));
  return { status: 200, body: { attribution: loaded.mark, windows } };
}
