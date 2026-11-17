// The forecast for a venue's game hours from Apple WeatherKit, and the venue
// dashboard's bad-forecast nudge (P11; docs/specs/13-payments-bookings.md
// "Weather, condition warnings and blocking pitches"). The logic is in
// handler.ts; thresholds are read from public.app_rules on every request.
//
// Signed-in users only (it spends Futty's WeatherKit calls). The venue is
// read as the caller, so a venue hidden from them (not live) is not found.
//
// Body, for players (venue page, checkout, booking detail):
//   { venue_id, windows: [{ day: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }] }   (Cyprus time)
//   -> { attribution, windows: [{ day, start, end, status, forecast? }] }
// Body, for venue staff (the Today screen's nudge):
//   { venue_id, nudges: true }
//   -> { attribution, slots: [{ booking_id, day, start, end, pitch_ids, forecast }] }
//
// Secrets (Supabase Edge Function secrets, set by Panos):
//   APPLE_TEAM_ID             Apple Developer Team ID (already set for Sign in with Apple)
//   WEATHERKIT_KEY_ID         Key ID of the WeatherKit key
//   WEATHERKIT_SERVICE_ID     The WeatherKit service identifier
//   WEATHERKIT_PRIVATE_KEY    The WeatherKit .p8 key's contents
//
// Deploy (Panos):
//   supabase functions deploy venue-weather

import { createClient } from 'npm:@supabase/supabase-js@2';

import { dbFromSupabase, DbError } from '../_shared/db.ts';
import { loadRules } from '../_shared/rules.ts';
import { createWeatherKit } from '../_shared/weatherkit.ts';
import { handleWeather, type StaffSlot } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const weather = createWeatherKit({
  teamId: Deno.env.get('APPLE_TEAM_ID') ?? '',
  keyId: Deno.env.get('WEATHERKIT_KEY_ID') ?? '',
  serviceId: Deno.env.get('WEATHERKIT_SERVICE_ID') ?? '',
  privateKeyPem: Deno.env.get('WEATHERKIT_PRIVATE_KEY') ?? '',
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'not_authenticated' });
  const asCaller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: user } = await asCaller.auth.getUser();
  if (!user.user) return json(401, { error: 'not_authenticated' });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => null);

  try {
    const result = await handleWeather(
      {
        now: () => new Date(),
        weather,
        async loadVenue(id) {
          const { data, error } = await asCaller.from('venues').select('latitude, longitude').eq('id', id).maybeSingle();
          if (error) throw new Error(error.message);
          return data;
        },
        loadRules: () => loadRules(dbFromSupabase(admin)),
        cache: {
          async get(key) {
            const { data, error } = await admin.from('weather_cache').select('fetched_at, body').eq('cache_key', key).maybeSingle();
            if (error) throw new Error(error.message);
            return data ? { fetchedAt: data.fetched_at, body: data.body } : null;
          },
          async put(key, value, fetchedAt) {
            const { error } = await admin
              .from('weather_cache')
              .upsert({ cache_key: key, fetched_at: fetchedAt.toISOString(), body: value });
            if (error) throw new Error(error.message);
          },
        },
        async staffSlots(id) {
          const { data, error } = await asCaller.rpc('venue_weather_slots', { p_venue_id: id });
          if (error) throw new DbError(error.message);
          return (data ?? []) as StaffSlot[];
        },
        log: (message, err) => (err === undefined ? console.warn(message) : console.error(message, err)),
      },
      body,
    );
    return json(result.status, result.body);
  } catch (err) {
    console.error('venue-weather failed', err);
    return json(500, { error: 'weather_failed' });
  }
});
