-- P11 Weather (docs/specs/13-payments-bookings.md "Weather, condition
-- warnings and blocking pitches"; 05 Product section 14).
--
-- The forecast itself comes from Apple WeatherKit through the venue-weather
-- Edge Function, which checks it against the thresholds in app_rules. This
-- migration gives it what it needs:
--
--   * venues.latitude / longitude: where to ask for. Both or neither; a venue
--     without them shows no forecast. (Who fills them is TO CONFIRM: the
--     venue sheet has only Google Maps place links.)
--   * app_rules.weather_nudge_hours: the dashboard nudges the venue about a
--     bad forecast only while kickoff is at least this far away (spec 13:
--     12 hours), so warnings come early enough to use.
--   * weather_cache: each venue's forecast (and Apple's attribution), kept
--     for an hour so Apple is asked at most once an hour per venue. Only the
--     Edge Function (service_role) reads or writes it.
--   * venue_weather_slots: the booked app games the nudge checks, for that
--     venue's staff only.

alter table public.venues
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint venues_coordinates_together check ((latitude is null) = (longitude is null));

alter table public.app_rules
  add column weather_nudge_hours integer not null default 12 check (weather_nudge_hours between 0 and 240);

create table public.weather_cache (
  -- 'venue:<venue id>' for a venue's hourly forecast; 'attribution:<language>' for Apple's mark.
  cache_key text primary key,
  fetched_at timestamptz not null,
  body jsonb not null
);

alter table public.weather_cache enable row level security;
revoke all on public.weather_cache from public, anon, authenticated;
grant select, insert, update, delete on public.weather_cache to service_role;

-- A venue's booked app games that start at least weather_nudge_hours from
-- now (Cyprus time) and that no live condition flag covers yet. Walk-in and
-- phone bookings have no app players to warn, so they're left out. The Edge
-- Function checks each against the forecast.
create or replace function public.venue_weather_slots(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;

  select r.weather_nudge_hours into v_lead from public.app_rules_now() r;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'booking_id', b.id,
             'day', b.booking_day,
             'start', to_char(b.start_time, 'HH24:MI'),
             'end', to_char(b.end_time, 'HH24:MI'),
             'pitch_ids', coalesce((select jsonb_agg(bp.pitch_id order by bp.pitch_id)
                                    from public.booking_pitches bp where bp.booking_id = b.id), '[]'::jsonb))
           order by b.booking_day, b.start_time)
    from public.venue_bookings b
    where b.venue_id = p_venue_id
      and b.booking_type = 'user_booking'
      and b.status <> 'cancelled'
      -- Kickoff (Cyprus wall-clock) as a real instant, so the lead is real
      -- hours even across a clock change.
      and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' >= now() + make_interval(hours => v_lead)
      and not exists (
        select 1 from public.venue_condition_flags f
        where f.venue_id = b.venue_id
          and f.flag_day = b.booking_day
          and f.cleared_at is null
          and (f.starts_at is null or (b.start_time < f.ends_at and b.end_time > f.starts_at))
          and (f.pitch_id is null
               or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = f.pitch_id))
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.venue_weather_slots(uuid) from public, anon;
grant execute on function public.venue_weather_slots(uuid) to authenticated, service_role;
