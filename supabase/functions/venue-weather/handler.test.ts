// venue-weather with a fake WeatherKit (_shared/weatherkit-fake.ts) and an
// in-memory cache: spec 13 "Weather" thresholds from app_rules, the hourly
// cache, the forecast range, and the dashboard nudge.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';

import { DbError } from '../_shared/db.ts';
import { SPEC_RULES } from '../_shared/rules.fixtures.ts';
import type { AppRules } from '../_shared/rules.ts';
import { createWeatherKitFake, FAKE_ATTRIBUTION, hourly } from '../_shared/weatherkit-fake.ts';
import type { WeatherHour } from '../_shared/weatherkit.ts';
import { type CacheRow, type Deps, handleWeather, type StaffSlot } from './handler.ts';

const VENUE = '6f1c2a4e-1111-4b7a-9c3d-000000000001';
const OTHER_VENUE = '6f1c2a4e-1111-4b7a-9c3d-000000000002';
// 20 November 2026, 08:00 in Cyprus (UTC+2 in winter).
const NOW = new Date('2026-11-20T06:00:00Z');
// A game that evening, 18:00 to 19:00 Cyprus time = 16:00 to 17:00 UTC.
const GAME = { day: '2026-11-20', start: '18:00', end: '19:00' };
const GAME_HOUR = '2026-11-20T16:00:00.000Z';

type Setup = {
  rules?: AppRules;
  hours?: WeatherHour[];
  venues?: Record<string, { latitude: number | null; longitude: number | null }>;
  slots?: StaffSlot[] | Error;
};

function setup(options: Setup = {}) {
  const kit = createWeatherKitFake({ hours: options.hours ?? hourly(NOW, 240) });
  const cache = new Map<string, CacheRow>();
  const logs: string[] = [];
  const clock = { now: NOW };
  const venues = options.venues ?? {
    [VENUE]: { latitude: 35.1856, longitude: 33.3823 },
    [OTHER_VENUE]: { latitude: 34.7071, longitude: 33.0226 },
  };
  const deps: Deps = {
    now: () => clock.now,
    weather: kit.source,
    loadVenue: (id) => Promise.resolve(venues[id] ?? null),
    loadRules: () => Promise.resolve(options.rules ?? SPEC_RULES),
    cache: {
      get: (key) => Promise.resolve(cache.get(key) ?? null),
      put: (key, body, fetchedAt) => {
        cache.set(key, { body: structuredClone(body), fetchedAt: fetchedAt.toISOString() });
        return Promise.resolve();
      },
    },
    staffSlots: () => (options.slots instanceof Error ? Promise.reject(options.slots) : Promise.resolve(options.slots ?? [])),
    log: (message) => logs.push(message),
  };
  return { kit, cache, logs, clock, deps };
}

/** The forecast with one hour of the game changed. */
function gameHour(change: Partial<WeatherHour>): WeatherHour[] {
  return hourly(NOW, 240, (start) => (start.toISOString() === GAME_HOUR ? change : {}));
}

async function windowFor(options: Setup, window = GAME) {
  const { deps } = setup(options);
  const result = await handleWeather(deps, { venue_id: VENUE, windows: [window] });
  strictEqual(result.status, 200, JSON.stringify(result.body));
  return (result.body as { windows: Record<string, unknown>[] }).windows[0];
}

// ---- Thresholds ------------------------------------------------------------

Deno.test('each threshold on its own warns (spec 13 confirmed thresholds, from app_rules)', async () => {
  const cases: [string, Partial<WeatherHour>][] = [
    ['rain_chance', { conditionCode: 'Rain', precipitationChance: 0.6 }],
    ['heavy_rain', { conditionCode: 'HeavyRain', precipitationChance: 0.3, precipitationAmount: 8 }],
    ['wind', { conditionCode: 'Windy', windSpeed: 40 }],
    ['thunderstorm', { conditionCode: 'IsolatedThunderstorms' }],
    ['heat', { conditionCode: 'Hot', temperature: 38 }],
  ];
  for (const [warning, change] of cases) {
    const w = await windowFor({ hours: gameHour(change) });
    strictEqual(w.status, 'forecast', warning);
    deepStrictEqual((w.forecast as { warnings: string[] }).warnings, [warning], warning);
  }
});

Deno.test('every thunderstorm condition counts as a thunderstorm', async () => {
  for (const code of ['Thunderstorm', 'Thunderstorms', 'IsolatedThunderstorms', 'ScatteredThunderstorms', 'SevereThunderstorm', 'StrongStorms']) {
    const w = await windowFor({ hours: gameHour({ conditionCode: code }) });
    deepStrictEqual((w.forecast as { warnings: string[] }).warnings, ['thunderstorm'], code);
  }
});

Deno.test('just below every threshold: no warning', async () => {
  const w = await windowFor({
    hours: gameHour({ conditionCode: 'Rain', precipitationChance: 0.59, precipitationAmount: 2, windSpeed: 39.4, temperature: 37.4 }),
  });
  strictEqual(w.status, 'forecast');
  deepStrictEqual(w.forecast, {
    rain_chance_pct: 59,
    rain_mm: 2,
    wind_kmh: 39,
    temp_min_c: 37,
    temp_max_c: 37,
    thunderstorm: false,
    heavy_rain: false,
    warnings: [],
  });
});

Deno.test('the thresholds are read from app_rules: changing them changes the warning, with no code change', async () => {
  const hours = gameHour({ conditionCode: 'HeavyRain', precipitationChance: 0.55, windSpeed: 30, temperature: 30 });
  const spec = await windowFor({ hours });
  deepStrictEqual((spec.forecast as { warnings: string[] }).warnings, ['heavy_rain']);

  const changed = await windowFor({
    hours,
    rules: { ...SPEC_RULES, weather_rain_chance_pct: 50, weather_heavy_rain: false, weather_wind_kmh: 30, weather_heat_c: 30 },
  });
  deepStrictEqual((changed.forecast as { warnings: string[] }).warnings, ['rain_chance', 'wind', 'heat']);

  const noThunder = await windowFor({
    hours: gameHour({ conditionCode: 'Thunderstorms' }),
    rules: { ...SPEC_RULES, weather_thunderstorms: false },
  });
  deepStrictEqual((noThunder.forecast as { warnings: string[] }).warnings, []);
});

Deno.test('only the match hours count, in Cyprus time', async () => {
  // Bad weather at 18:00 UTC = 20:00 in Cyprus, an hour after the game ends.
  const after = await windowFor({
    hours: hourly(NOW, 240, (s) => (s.toISOString() === '2026-11-20T18:00:00.000Z' ? { precipitationChance: 0.9 } : {})),
  });
  deepStrictEqual((after.forecast as { warnings: string[] }).warnings, []);

  // A 17:30 to 18:30 game takes in the 17:00 hour (15:00 UTC).
  const halfPast = await windowFor(
    { hours: hourly(NOW, 240, (s) => (s.toISOString() === '2026-11-20T15:00:00.000Z' ? { windSpeed: 45 } : {})) },
    { day: '2026-11-20', start: '17:30', end: '18:30' },
  );
  deepStrictEqual((halfPast.forecast as { warnings: string[] }).warnings, ['wind']);
});

Deno.test('summer time: Cyprus is UTC+3', async () => {
  const { deps } = setup({
    hours: hourly(new Date('2026-07-10T00:00:00Z'), 48, (s) =>
      s.toISOString() === '2026-07-10T15:00:00.000Z' ? { temperature: 39 } : {}),
  });
  deps.now = () => new Date('2026-07-10T05:00:00Z');
  const result = await handleWeather(deps, { venue_id: VENUE, windows: [{ day: '2026-07-10', start: '18:00', end: '19:00' }] });
  const w = (result.body as { windows: { forecast: { warnings: string[] } }[] }).windows[0];
  deepStrictEqual(w.forecast.warnings, ['heat']);
});

Deno.test('a game ending at midnight takes in its last hour', async () => {
  // 23:00 to 00:00 in Cyprus = 21:00 to 22:00 UTC.
  const w = await windowFor(
    { hours: hourly(NOW, 240, (s) => (s.toISOString() === '2026-11-20T21:00:00.000Z' ? { precipitationChance: 0.7 } : {})) },
    { day: '2026-11-20', start: '23:00', end: '00:00' },
  );
  deepStrictEqual((w.forecast as { warnings: string[] }).warnings, ['rain_chance']);
});

Deno.test('review fix: midnight as the app and database write it (24:00) is accepted', async () => {
  for (const end of ['24:00', '24:00:00']) {
    const w = await windowFor(
      { hours: hourly(NOW, 240, (s) => (s.toISOString() === '2026-11-20T21:00:00.000Z' ? { windSpeed: 50 } : {})) },
      { day: '2026-11-20', start: '23:00', end },
    );
    strictEqual(w.status, 'forecast', end);
    deepStrictEqual((w.forecast as { warnings: string[] }).warnings, ['wind'], end);
  }
});

Deno.test('review fix: a value that only reaches a threshold when rounded does not warn ("or more")', async () => {
  const w = await windowFor({
    hours: gameHour({ conditionCode: 'Rain', precipitationChance: 0.595, windSpeed: 39.6, temperature: 37.6 }),
  });
  deepStrictEqual((w.forecast as { warnings: string[] }).warnings, []);
});

Deno.test('the summary is the worst of the match hours', async () => {
  const w = await windowFor(
    {
      hours: hourly(NOW, 240, (s) =>
        s.toISOString() === GAME_HOUR
          ? { precipitationChance: 0.234, precipitationAmount: 0.46, windSpeed: 12.6, temperature: 17.6 }
          : s.toISOString() === '2026-11-20T17:00:00.000Z'
          ? { precipitationChance: 0.3, precipitationAmount: 1.04, windSpeed: 20.2, temperature: 15.4 }
          : {}),
    },
    { day: '2026-11-20', start: '18:00', end: '20:00' },
  );
  deepStrictEqual(w.forecast, {
    rain_chance_pct: 30,
    rain_mm: 1,
    wind_kmh: 20,
    temp_min_c: 15,
    temp_max_c: 18,
    thunderstorm: false,
    heavy_rain: false,
    warnings: [],
  });
});

// ---- The cache -------------------------------------------------------------

Deno.test('the cache stops a second call to Apple within the hour', async () => {
  const { deps, kit, clock } = setup();
  await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  clock.now = new Date(NOW.getTime() + 59 * 60_000);
  const second = await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  strictEqual(second.status, 200);
  strictEqual(kit.hourlyCalls.length, 1, 'one call to Apple for two requests within the hour');
  strictEqual(kit.attributionCalls, 1, 'the attribution is cached too');
  strictEqual((second.body as { windows: { status: string }[] }).windows[0].status, 'forecast');
});

Deno.test('after the hour, Apple is asked again', async () => {
  const { deps, kit, clock } = setup();
  await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  clock.now = new Date(NOW.getTime() + 60 * 60_000);
  await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  strictEqual(kit.hourlyCalls.length, 2);
});

Deno.test('the cache is per venue', async () => {
  const { deps, kit } = setup();
  await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  await handleWeather(deps, { venue_id: OTHER_VENUE, windows: [GAME] });
  await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  deepStrictEqual(kit.hourlyCalls, [{ latitude: 35.1856, longitude: 33.3823 }, { latitude: 34.7071, longitude: 33.0226 }]);
});

Deno.test('a venue that moved is asked again at once', async () => {
  const venues = { [VENUE]: { latitude: 35.1856, longitude: 33.3823 } };
  const { deps, kit } = setup({ venues });
  await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  venues[VENUE] = { latitude: 35.17, longitude: 33.36 };
  await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  strictEqual(kit.hourlyCalls.length, 2);
});

Deno.test('several windows for one venue take one call', async () => {
  const { deps, kit } = setup();
  const result = await handleWeather(deps, {
    venue_id: VENUE,
    windows: [GAME, { day: '2026-11-21', start: '10:00', end: '11:00' }],
  });
  strictEqual((result.body as { windows: unknown[] }).windows.length, 2);
  strictEqual(kit.hourlyCalls.length, 1);
});

// ---- Range and availability -----------------------------------------------

Deno.test('beyond the forecast range: out of range ("Forecast available closer to the date")', async () => {
  // The fake reaches 240 hours (10 days); a game 12 days out is beyond it.
  const w = await windowFor({}, { day: '2026-12-02', start: '18:00', end: '19:00' });
  deepStrictEqual(w, { day: '2026-12-02', start: '18:00', end: '19:00', status: 'out_of_range' });
});

Deno.test('a game whose last hour is past the forecast\'s end is out of range too', async () => {
  // The forecast ends at 16:00 UTC (18:00 Cyprus); the game runs to 19:00.
  const w = await windowFor({ hours: hourly(NOW, 10) });
  strictEqual(w.status, 'out_of_range');
});

Deno.test('a game that has ended has no forecast', async () => {
  const w = await windowFor({}, { day: '2026-11-19', start: '18:00', end: '19:00' });
  strictEqual(w.status, 'past');
});

Deno.test('a venue without coordinates shows no forecast and Apple isn\'t asked', async () => {
  const { deps, kit } = setup({ venues: { [VENUE]: { latitude: null, longitude: null } } });
  const result = await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  deepStrictEqual(result.body, { attribution: null, windows: [{ ...GAME, status: 'unavailable' }] });
  strictEqual(kit.hourlyCalls.length, 0);
});

Deno.test('Apple failing: no forecast, logged, nothing cached', async () => {
  const { deps, kit, logs, cache } = setup();
  kit.fail = new Error('weatherkit_500');
  const result = await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  strictEqual(result.status, 200);
  deepStrictEqual(result.body, { attribution: null, windows: [{ ...GAME, status: 'unavailable' }] });
  strictEqual(logs.length > 0, true);
  strictEqual(cache.size, 0);
});

Deno.test('no forecast without Apple\'s mark: if the attribution fails, nothing is shown', async () => {
  const { deps, kit } = setup({ hours: gameHour({ precipitationChance: 0.9 }) });
  kit.failAttribution = new Error('weatherkit_attribution_invalid');
  const result = await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  deepStrictEqual(result.body, { attribution: null, windows: [{ ...GAME, status: 'unavailable' }] });
});

Deno.test('every forecast comes with Apple\'s mark and the data-sources link', async () => {
  const { deps } = setup();
  const result = await handleWeather(deps, { venue_id: VENUE, windows: [GAME] });
  deepStrictEqual((result.body as { attribution: unknown }).attribution, FAKE_ATTRIBUTION);
});

Deno.test('a venue the caller can\'t see is not found', async () => {
  const { deps, kit } = setup();
  const result = await handleWeather(deps, { venue_id: '6f1c2a4e-1111-4b7a-9c3d-0000000000ff', windows: [GAME] });
  strictEqual(result.status, 404);
  strictEqual(kit.hourlyCalls.length, 0);
});

Deno.test('a malformed request is refused before anything is read', async () => {
  const bad: unknown[] = [
    null,
    {},
    { venue_id: 'not-a-uuid', windows: [GAME] },
    { venue_id: VENUE },
    { venue_id: VENUE, windows: [] },
    { venue_id: VENUE, windows: [{ day: '20-11-2026', start: '18:00', end: '19:00' }] },
    { venue_id: VENUE, windows: [{ day: '2026-11-20', start: '25:00', end: '19:00' }] },
    { venue_id: VENUE, windows: [{ day: '2026-11-20', start: '18:00', end: '18:00' }] },
    { venue_id: VENUE, windows: Array.from({ length: 21 }, () => GAME) },
  ];
  for (const body of bad) {
    const { deps, kit } = setup();
    const result = await handleWeather(deps, body);
    strictEqual(result.status, 400, JSON.stringify(body));
    strictEqual(kit.hourlyCalls.length, 0);
  }
});

// ---- The dashboard nudge ---------------------------------------------------

const BAD_SLOT: StaffSlot = { booking_id: 'b-bad', day: '2026-11-20', start: '18:00', end: '19:00', pitch_ids: ['p1'] };
const GOOD_SLOT: StaffSlot = { booking_id: 'b-good', day: '2026-11-21', start: '18:00', end: '19:00', pitch_ids: ['p2'] };
const FAR_SLOT: StaffSlot = { booking_id: 'b-far', day: '2026-12-03', start: '18:00', end: '19:00', pitch_ids: ['p1'] };

Deno.test('nudge: a booked slot 12h+ ahead with a bad forecast is listed; a good one isn\'t', async () => {
  // venue_weather_slots (SQL) returns only slots at least weather_nudge_hours
  // ahead and not yet flagged (supabase/tests/pay-weather-1.test.sql); here
  // each one it returns is checked against the forecast.
  const { deps } = setup({ hours: gameHour({ conditionCode: 'HeavyRain' }), slots: [BAD_SLOT, GOOD_SLOT, FAR_SLOT] });
  const result = await handleWeather(deps, { venue_id: VENUE, nudges: true });
  strictEqual(result.status, 200);
  deepStrictEqual(result.body, {
    attribution: FAKE_ATTRIBUTION,
    slots: [{
      ...BAD_SLOT,
      forecast: {
        rain_chance_pct: 10,
        rain_mm: 0,
        wind_kmh: 10,
        temp_min_c: 20,
        temp_max_c: 20,
        thunderstorm: false,
        heavy_rain: true,
        warnings: ['heavy_rain'],
      },
    }],
  });
});

Deno.test('nudge: nothing to check, Apple isn\'t asked', async () => {
  const { deps, kit } = setup({ slots: [] });
  const result = await handleWeather(deps, { venue_id: VENUE, nudges: true });
  deepStrictEqual(result.body, { attribution: null, slots: [] });
  strictEqual(kit.hourlyCalls.length, 0);
});

Deno.test('nudge: only the venue\'s staff', async () => {
  const { deps, kit } = setup({ slots: new DbError('not_venue_staff') });
  const result = await handleWeather(deps, { venue_id: VENUE, nudges: true });
  strictEqual(result.status, 403);
  strictEqual(kit.hourlyCalls.length, 0);
});

Deno.test('nudge: no forecast, no nudges', async () => {
  const { deps, kit } = setup({ hours: gameHour({ conditionCode: 'HeavyRain' }), slots: [BAD_SLOT] });
  kit.fail = new Error('down');
  const result = await handleWeather(deps, { venue_id: VENUE, nudges: true });
  deepStrictEqual(result.body, { attribution: null, slots: [] });
});
