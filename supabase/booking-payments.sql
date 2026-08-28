-- Real payment for pitch bookings, via Stripe (not Apple/Google IAP — a
-- pitch booking is a real-world service, and Apple's guidelines require
-- those to use a normal payment processor, not in-app purchase). Run AFTER
-- supabase/booking-actions.sql. Run in the Supabase dashboard: SQL Editor >
-- New query > Run. Safe to re-run.
--
-- Flow: book_slot now reserves the slot immediately as 'pending_payment'
-- (still counts toward capacity, so nobody else can grab it mid-payment) and
-- records the exact amount owed. The client then calls the
-- create-booking-payment Edge Function to get a Stripe PaymentIntent for
-- that exact amount, and Stripe's own Payment Sheet collects the card. Only
-- stripe-webhook (triggered by Stripe itself confirming the charge, never
-- the client's own say-so) flips the booking to 'confirmed' — same
-- never-trust-the-client principle as the whole Apple IAP setup. A venue
-- with no price (price_per_pitch_hour null/0) skips all of this and is
-- confirmed immediately, same as before.
--
-- Cancellation (cancel_booking below) now enforces the same 30-minutes-
-- before-kickoff cutoff cancel_opposition_offer (supabase/scores.sql)
-- already uses, and can only be called from the cancel-booking Edge
-- Function now (see the revoke at the bottom) — that function is what
-- actually issues the Stripe refund alongside the cancellation.

alter table public.venue_bookings add column if not exists created_at timestamptz not null default now();
alter table public.venue_bookings add column if not exists stripe_payment_intent_id text;
alter table public.venue_bookings add column if not exists amount_cents integer not null default 0;

create unique index if not exists venue_bookings_payment_intent_unique
  on public.venue_bookings (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

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
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_day < current_date or (p_day = current_date and p_start <= current_time) then
    raise exception 'slot_in_past';
  end if;

  -- Locks the venue row for the rest of this transaction, so a second,
  -- concurrent call for the same venue waits here rather than reading the
  -- same "used" count and double-booking the last free pitch.
  select base_pitches, price_per_pitch_hour into v_base_pitches, v_price
  from public.venues
  where id = p_venue_id
  for update;

  if v_base_pitches is null then
    raise exception 'venue_not_found';
  end if;

  -- Excludes only 'cancelled' — a 'pending_payment' reservation still holds
  -- its pitch (this is what stops two people paying for the same slot),
  -- same as 'confirmed'. cancel-stale-pending-bookings (bottom of this
  -- file) is what stops an abandoned payment holding it forever.
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
    else round(v_price * p_pitches * (extract(epoch from (p_end - p_start)) / 3600.0) * 100)::integer
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

  return v_booking;
end;
$$;

grant execute on function public.book_slot(uuid, date, time, time, integer, integer, text) to authenticated;

-- Now enforces the 30-minutes-before-kickoff cutoff (previously had none),
-- and is no longer directly callable by clients — see the revoke below. The
-- cancel-booking Edge Function calls this (as the authenticated caller, via
-- their own JWT) to get the ownership/cutoff check and status flip, then
-- separately issues the Stripe refund if the booking was paid.
create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;

  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;

  -- The 30-minute cutoff is about not backing out of a game you (and your
  -- opponent) already committed to right before kickoff — it doesn't apply
  -- to a 'pending_payment' reservation, since nothing was ever paid or
  -- promised. Releasing an unpaid hold on a near-term slot should always be
  -- allowed, immediately — otherwise abandoning payment on a slot starting
  -- soon would leave it stuck reserved with no way to free it up. Same
  -- Cyprus-local-time reasoning as book_slot's slot_in_past and
  -- log_booking_result's too_early checks for the cutoff itself.
  if v_booking.status = 'confirmed'
     and now() >= ((v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia') - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  update public.venue_bookings
  set status = 'cancelled'
  where id = p_booking_id;
end;
$$;

-- Revoked: cancelling a paid booking must go through the cancel-booking Edge
-- Function so the Stripe refund actually happens — a direct RPC call would
-- cancel the slot but leave the customer's money uncharged-back. The Edge
-- Function still calls this exact function (via the caller's own JWT, which
-- is unaffected by this revoke since Edge Functions there use a per-request
-- client authenticated as the user, not the service role) for the
-- ownership/cutoff/status-flip logic — only *direct* client calls are
-- blocked.
revoke execute on function public.cancel_booking(uuid) from authenticated;

-- Requires the pg_cron extension (Database > Extensions > pg_cron — enabled
-- by default on most Supabase projects, but not universally). Releases
-- pitches held by abandoned payments after 15 minutes, so someone who backs
-- out of paying doesn't permanently lock a slot nobody else can book. If
-- pg_cron isn't enabled, this whole block is skipped with a notice rather
-- than failing the rest of the file — enable the extension and re-run this
-- file to pick it up later.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cancel-stale-pending-bookings';

  perform cron.schedule(
    'cancel-stale-pending-bookings',
    '*/5 * * * *',
    $sql$
    update public.venue_bookings
    set status = 'cancelled'
    where status = 'pending_payment' and created_at < now() - interval '15 minutes';
    $sql$
  );
exception when undefined_table or undefined_function or invalid_schema_name then
  raise notice 'pg_cron not enabled — enable it under Database > Extensions, then re-run this file to schedule the stale-booking cleanup.';
end $$;
