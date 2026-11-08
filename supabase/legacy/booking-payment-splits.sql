-- Per-player payment splitting (item 13): instead of the booker paying the
-- whole amount, the total (venue price + service fee) is split evenly
-- across the format's player count, and each player pays their own share.
-- Run AFTER supabase/legacy/booking-payments.sql and supabase/legacy/squads.sql. Run in
-- the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Flow: book_slot (redefined below) now folds in a service fee and creates
-- the booker's own share row alongside the booking. Other players' shares
-- are added either automatically (joining the linked "need players" squad
-- post — see the trigger at the bottom) or manually by the booker
-- (add_booking_player). The booking is reserved ('confirmed') as soon as
-- the BOOKER's own share is paid — see stripe-webhook's updated handling —
-- with everyone else's shares independently 'pending' until they each pay
-- via their own PaymentIntent (create-share-payment Edge Function).
--
-- Deadline: cancel-unpaid-bookings (Edge Function, scheduled via pg_cron +
-- pg_net at the bottom of this file) cancels the whole booking and refunds
-- everyone who already paid if any share is still 'pending' 3 hours before
-- kickoff — voiding the reservation itself, not just the unpaid portion, so
-- every already-collected payment is refunded in full.

-- No real service fee existed anywhere before this — book_slot only ever
-- charged the bare venue price. 8.9% reproduces the worked example this was
-- speced against exactly (a €30 venue price becomes €32.67 total), and is
-- deliberately a single named constant rather than scattered arithmetic, so
-- changing the rate later is a one-line edit.
create or replace function public.service_fee_rate()
returns numeric
language sql
immutable
as $$ select 0.089 $$;

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
    else 10 -- shouldn't happen; matches book_slot's own format/capacity pairing
  end;
$$;

create table if not exists public.booking_payment_shares (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.venue_bookings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null,
  is_booker boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'cancelled')),
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (booking_id, profile_id)
);

create index if not exists booking_payment_shares_booking_idx on public.booking_payment_shares (booking_id);
create index if not exists booking_payment_shares_profile_idx on public.booking_payment_shares (profile_id);
create unique index if not exists booking_payment_shares_intent_unique
  on public.booking_payment_shares (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table public.booking_payment_shares enable row level security;

-- Read your own share, or every share on a booking you made — the booker
-- needs to see everyone's paid/pending status, a player only ever needs
-- their own.
drop policy if exists "Read own share or own booking's shares" on public.booking_payment_shares;
create policy "Read own share or own booking's shares"
  on public.booking_payment_shares for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.venue_bookings b
      where b.id = booking_payment_shares.booking_id and b.created_by = auth.uid()
    )
  );

-- No insert/update/delete policy at all — every write goes through the
-- functions below (booker's own share via book_slot, everyone else's via
-- add_booking_player/the squad-join trigger) or the create-share-payment /
-- cancel-unpaid-bookings Edge Functions (service role, unaffected by RLS).

-- Redefines book_slot from supabase/legacy/booking-payments.sql: same signature and
-- capacity/locking logic, now also applying the service fee and inserting
-- the booker's own payment share.
create or replace function public.book_slot(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitches integer,
  p_capacity integer,
  p_format text
)
returns public.venue_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_pitches integer;
  v_price numeric;
  v_used integer;
  v_amount_cents integer;
  v_status text;
  v_booking public.venue_bookings;
  v_format_count integer;
  v_share_cents integer;
  v_booker_share_cents integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_day < current_date or (p_day = current_date and p_start <= current_time) then
    raise exception 'slot_in_past';
  end if;

  select base_pitches, price_per_pitch_hour into v_base_pitches, v_price
  from public.venues
  where id = p_venue_id
  for update;

  if v_base_pitches is null then
    raise exception 'venue_not_found';
  end if;

  select coalesce(sum(pitches), 0) into v_used
  from public.venue_bookings
  where venue_id = p_venue_id
    and booking_day = p_day
    and status <> 'cancelled'
    and start_time < p_end
    and end_time > p_start;

  if v_base_pitches - v_used < p_pitches then
    raise exception 'slot_full';
  end if;

  v_amount_cents := case
    when v_price is null or v_price = 0 then 0
    else round(
      v_price * p_pitches * (extract(epoch from (p_end - p_start)) / 3600.0) * 100
      * (1 + public.service_fee_rate())
    )::integer
  end;
  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, amount_cents)
    values
      (p_venue_id, p_day, p_start, p_end, p_pitches, p_capacity, p_format, v_status, auth.uid(), v_amount_cents)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  -- Split evenly across the format's fixed player count (5/7/9/11), not
  -- however many players happen to be confirmed yet — the leftover pence
  -- from integer division goes to the booker, per spec.
  if v_amount_cents > 0 then
    v_format_count := public.format_player_count(p_format);
    v_share_cents := v_amount_cents / v_format_count;
    v_booker_share_cents := v_amount_cents - v_share_cents * (v_format_count - 1);

    insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
    values (v_booking.id, auth.uid(), v_booker_share_cents, true, 'pending');
  end if;

  return v_booking;
end;
$$;

grant execute on function public.book_slot(uuid, date, time, time, integer, integer, text) to authenticated;

-- Internal-only: adds one non-booker player's share at the fixed per-share
-- amount. No auth.uid() ownership check here — callers (below) are
-- responsible for authorizing the caller before reaching this; a trigger
-- firing off another player's own squad_post_joiners insert is a legitimate
-- caller that is NOT the booker, which is exactly why this is split out from
-- add_booking_player rather than sharing its auth check.
create or replace function public.add_booking_share_internal(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_format_count integer;
  v_share_cents integer;
  v_current_count integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  v_format_count := public.format_player_count(v_booking.format);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id;

  if v_current_count >= v_format_count then
    return; -- booking already has a share for every slot in the format
  end if;

  v_share_cents := v_booking.amount_cents / v_format_count;

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$$;

revoke all on function public.add_booking_share_internal(uuid, uuid) from authenticated, anon;

-- Public RPC: the booker manually adding a player by username (the "or added
-- manually" half of the spec — the automatic half is the trigger below).
create or replace function public.add_booking_player(p_booking_id uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_profile_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;

  select id into v_profile_id from public.profiles where lower(username) = lower(p_username);
  if v_profile_id is null then
    raise exception 'player_not_found';
  end if;

  perform public.add_booking_share_internal(p_booking_id, v_profile_id);
end;
$$;

grant execute on function public.add_booking_player(uuid, text) to authenticated;

-- Automatic half: joining a "need players" post that's linked to a booking
-- (venue_booking_id set — see supabase/legacy/booking-actions.sql/squads.sql for
-- how a post gets that link) adds that joiner's payment share too, with no
-- extra step from the booker.
create or replace function public.auto_add_booking_share_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  select * into v_post from public.squad_posts where id = new.post_id;

  if v_post.id is not null and v_post.venue_booking_id is not null and v_post.type = 'players' then
    perform public.add_booking_share_internal(v_post.venue_booking_id, new.profile_id);
  end if;

  return new;
end;
$$;

drop trigger if exists on_squad_post_joiner_add_share on public.squad_post_joiners;
create trigger on_squad_post_joiner_add_share
  after insert on public.squad_post_joiners
  for each row execute function public.auto_add_booking_share_on_join();

-- Lets a payment share double as a notification target for
-- supabase/legacy/notifications.sql's checked `type` column.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled'));

-- Read helper for app/booking-payment.tsx: the table's own RLS policy above
-- already lets the booker read every share row on their booking, but a plain
-- PostgREST embed of profiles(username) would additionally need read access
-- to OTHER players' profiles rows, which profiles' own RLS (supabase/legacy/
-- schema.sql) restricts to your own row only. This resolves usernames
-- server-side instead, the same reasoning as list_players in
-- supabase/legacy/community.sql.
create or replace function public.list_booking_shares(p_booking_id uuid)
returns table (
  id uuid,
  profile_id uuid,
  username text,
  amount_cents integer,
  is_booker boolean,
  status text,
  paid_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.booking_payment_shares s
    join public.venue_bookings b on b.id = s.booking_id
    where s.booking_id = p_booking_id
      and (s.profile_id = auth.uid() or b.created_by = auth.uid())
  ) then
    raise exception 'not_authorized';
  end if;

  return query
    select s.id, s.profile_id, p.username, s.amount_cents, s.is_booker, s.status, s.paid_at
    from public.booking_payment_shares s
    join public.profiles p on p.id = s.profile_id
    where s.booking_id = p_booking_id
    order by s.is_booker desc, p.username;
end;
$$;

grant execute on function public.list_booking_shares(uuid) to authenticated;

-- Read-only helper for cancel-unpaid-bookings (service role only — this is
-- internal scheduling logic, not something a client needs to query) — keeps
-- the timezone-sensitive "how close to kickoff is this" math in SQL, same as
-- cancel_booking's 30-minute cutoff (supabase/legacy/booking-payments.sql), rather
-- than duplicating it in the Edge Function.
create or replace function public.bookings_needing_share_cancellation()
returns table (booking_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select distinct b.id
  from public.venue_bookings b
  join public.booking_payment_shares s on s.booking_id = b.id
  where b.status = 'confirmed'
    and s.status = 'pending'
    and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' <= now() + interval '3 hours';
$$;

revoke all on function public.bookings_needing_share_cancellation() from authenticated, anon;

-- Scheduled cancellation: requires pg_cron AND pg_net (Database > Extensions
-- — pg_net specifically is what lets a cron job call an Edge Function, since
-- the actual Stripe refunds can only happen there, never in plain SQL).
-- Skipped with a notice if either isn't enabled, same as
-- cancel-stale-pending-bookings in supabase/legacy/booking-payments.sql.
--
-- Replace <CRON_SECRET> below before running with whatever you set via
--   supabase secrets set CRON_SECRET=<same-value>
-- (see supabase/functions/cancel-unpaid-bookings/index.ts's deployment
-- notes) — this is the same "shared secret" pattern notify-squad-post's
-- webhook uses, just for a cron trigger instead of a database webhook. The
-- project ref in the URL (ospztpemchfpvvostisw) is read from this repo's own
-- supabase/.temp/project-ref — update it too if this file is ever reused
-- against a different project.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cancel-unpaid-booking-shares';

  perform cron.schedule(
    'cancel-unpaid-booking-shares',
    '*/10 * * * *',
    $sql$
    select net.http_post(
      url := 'https://ospztpemchfpvvostisw.supabase.co/functions/v1/cancel-unpaid-bookings',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
      body := '{}'::jsonb
    );
    $sql$
  );
exception when undefined_table or undefined_function or invalid_schema_name then
  raise notice 'pg_cron/pg_net not enabled — enable both under Database > Extensions, fill in the secret placeholder above, then re-run this file.';
end $$;
