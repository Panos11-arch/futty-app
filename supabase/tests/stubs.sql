-- Stand-ins for the parts of the live Supabase database that the SQL tests
-- touch, so the tests can run in CI against an empty Postgres.
--
-- Only what the tests need lives here: the Supabase roles, auth.uid(), and
-- the columns of the tables the functions under test read and write.
-- format_player_count and service_fee_cents are copied from their real
-- definitions (booking-payment-splits.sql and flat-service-fee.sql).
--
-- When a test needs more of the schema, add it here. A later step replaces
-- this file with a dump of the live schema, so tests can't drift from it.

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;

-- Supabase's auth.uid() reads the signed-in user from the request's JWT.
-- Tests set it with: select set_config('request.jwt.claim.sub', '<uuid>', false);
create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  base_pitches integer,
  price_per_pitch_hour numeric
);

create table if not exists public.venue_bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues (id),
  booking_day date not null,
  start_time time not null,
  end_time time not null,
  pitches integer not null default 1,
  capacity integer,
  format text,
  status text not null,
  created_by uuid,
  amount_cents integer not null default 0,
  service_fee_cents_per_player integer
);

create table if not exists public.booking_payment_shares (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.venue_bookings (id),
  profile_id uuid not null,
  amount_cents integer not null,
  is_booker boolean not null default false,
  status text not null,
  unique (booking_id, profile_id)
);

create or replace function public.format_player_count(p_format text)
returns integer
language sql
immutable
as $$
  select case p_format
    when '5-a-side' then 5
    when '7-a-side' then 7
    when '9-a-side' then 9
    when '11-a-side' then 11
    else 10
  end;
$$;

create or replace function public.service_fee_cents()
returns integer
language sql
immutable
as $$ select 80 $$;
