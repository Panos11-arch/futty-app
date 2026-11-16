# P11 Weather: plan

Spec: docs/specs/13-payments-bookings.md "Weather, condition warnings and blocking pitches", 05 Product section 14,
15 Design section 5, 14 Prompts P11 (plus the dashboard nudge P6 left out). Built test-first, with a fake WeatherKit.

## How it works

1. **Server only talks to Apple.** A new Edge Function `venue-weather` signs a WeatherKit JWT (ES256, key from
   Supabase secrets) and fetches `forecastHourly` for the venue's coordinates. The app never holds a key.
2. **Cache per venue for an hour.** `public.weather_cache` (service_role only) keeps the venue's hourly forecast
   with `fetched_at`; a request within the hour reads the row and never calls Apple. Apple's attribution (the
   "Apple Weather" mark URLs) is cached the same way, as one row.
3. **Thresholds from app_rules only.** Each request loads `app_rules_now()` and checks every match hour against
   `weather_rain_chance_pct`, `weather_heavy_rain`, `weather_wind_kmh`, `weather_thunderstorms`, `weather_heat_c`.
   No number is written in code; a test greps the weather files for the spec's numbers.
4. **What comes back** for each window `{ day, start, end }` (Cyprus wall-clock times, converted to UTC instants on
   the server):
   - `forecast`: highest rain chance (%), highest rain amount (mm in an hour: WeatherKit's `precipitationAmount`,
     its hourly rain intensity), highest wind (km/h), lowest and highest temperature (°C), thunderstorm risk, heavy
     rain, and `warnings` (which thresholds are met);
   - `out_of_range`: the forecast doesn't reach these hours yet ("Forecast available closer to the date");
   - `unavailable`: no coordinates, Apple failed, or no attribution to show (no forecast without Apple's mark).
5. **Dashboard nudge.** A staff-only SQL function `venue_weather_slots(venue)` lists the venue's booked app games
   that start at least `weather_nudge_hours` (new app_rules column, default 12) from now and haven't been flagged.
   `venue-weather` with `{ venue_id, nudges: true }` checks them against the forecast and returns the bad ones.
   The Today screen lists them, each with a one-tap **Flag conditions** for that slot (existing `flag_conditions`).
6. **Futty AI.** Spec 13 says P11 replaces the "coming soon" line with its own lines; the prompt states the
   thresholds from app_rules.

## Files

- `supabase/migrations/*_pay_weather.sql`: `venues.latitude/longitude`, `app_rules.weather_nudge_hours`,
  `weather_cache`, `venue_weather_slots`. Test: `supabase/tests/pay-weather-1.test.sql`.
- `supabase/functions/_shared/weatherkit.ts` (JWT, fetch, attribution), `weatherkit-fake.ts`, tests.
- `supabase/functions/venue-weather/` (`index.ts`, `handler.ts`, `assess.ts`, tests).
- `supabase/functions/futty-ai-chat/prompt.ts` and its test (weather lines).
- `lib/weather.ts` (types, call, words) + test; `lib/use-weather.ts`.
- `components/venue/weather-strip.tsx` (strip, banner, Apple mark, data-sources link) + test;
  `components/venue/weather-nudges.tsx` + test.
- A `weather` slot prop on `checkout-view.tsx` and `booking-detail-view.tsx`; the venue page's existing slot.
- Screens: `app/venue/[id].tsx` (and `app/book.tsx` passes the chosen time), `app/booking-payment.tsx`,
  `app/booking/[id].tsx`, `app/venue-dashboard.tsx`.

## Tests (fake WeatherKit)

- each threshold alone triggers the banner (rain chance, heavy rain, wind, thunderstorm, heat);
- just below every threshold: no banner;
- a second request within the hour doesn't call Apple; after the hour it does;
- hours past the forecast's end give "Forecast available closer to the date";
- nudge: a bad slot 12h+ ahead is listed, a good one isn't, one under 12h isn't, a flagged one isn't;
- thresholds and the nudge lead come from app_rules (changing them changes the result, no code change);
- the Apple Weather mark and the data-sources link appear wherever forecast data appears.

## TO CONFIRM (Dimitris/Panos)

- Coordinates: venues have none today; who fills `latitude/longitude` (the venue sheet or by hand)?
  Until then a venue shows no forecast.
- Venue page without a chosen time (opened directly, not from Book): no strip.
- "Heavy rain" = Apple's `HeavyRain` condition (no mm/h number invented); thunderstorms = Apple's thunderstorm
  conditions; wind = sustained wind, not gusts; heat = air temperature, not "feels like".
- Nudge only while kickoff is 12h+ away (the spec's "at least 12 hours before kickoff"); hidden once flagged.
- One banner wording for every threshold (the spec's only wording).
