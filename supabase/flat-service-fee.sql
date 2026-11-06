-- Flat €0.80 service fee per player (decided Nov 2026), replacing the 8.9%
-- fee that was folded into the whole booking price.
--
-- Run AFTER security-hardening.sql, in the Supabase dashboard:
-- SQL Editor > New query > Run. Safe to re-run.
--
-- How the money works after this:
--   * venue_bookings.amount_cents      = the VENUE's price only (no fee)
--   * venue_bookings.service_fee_cents_per_player = 80 for new bookings,
--     NULL for bookings made before this change
--   * each player's share              = their part of the venue price + €0.80
--     (e.g. a €30 5-a-side: €6.00 + €0.80 = €6.80 each)
--
-- Why a per-booking column rather than just changing the maths: bookings
-- made before this still have the old 8.9% already inside amount_cents.
-- Players who join one of those later must keep paying the old way, not the
-- old price PLUS €0.80. NULL = old booking = old maths.
--
-- €0.80 was chosen so Futty keeps at least €0.40 per player after Stripe's
-- ~1.5% + €0.25 on European cards, for any share up to about €9.20. It is a
-- service fee charged on every booking whatever the payment method, NOT a
-- card surcharge (card surcharges on consumer cards are banned in the EU).
--
-- Both functions below are the LIVE definitions (exported from the
-- database on 6 Nov 2026) with only the fee lines changed, not the older
-- versions in booking-payment-splits.sql / opposition-match-payments.sql.

-- ---------------------------------------------------------------------------
-- 1. The fee, as one named constant.
-- ---------------------------------------------------------------------------
create or replace function public.service_fee_cents()
returns integer
language sql
immutable
as $$ select 80 $$;

revoke execute on function public.service_fee_cents() from public, anon;
grant execute on function public.service_fee_cents() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Remember which bookings use the flat fee.
-- ---------------------------------------------------------------------------
alter table public.venue_bookings add column if not exists service_fee_cents_per_player integer;

-- security-hardening.sql granted SELECT column by column, so a column added
-- afterwards is invisible to the app until granted here.
grant select (service_fee_cents_per_player) on public.venue_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- 3. book_slot: amount_cents is now the venue price only; the booker's share
--    is their part of it (plus the leftover cents from dividing) + €0.80.
-- ---------------------------------------------------------------------------
create or replace function public.book_slot(
  p_venue_id uuid, p_day date, p_start time without time zone, p_end time without time zone,
  p_pitches integer, p_capacity integer, p_format text
)
returns public.venue_bookings
language plpgsql
security definer
set search_path to ''
as $function$
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

  -- Venue price only. The service fee is added per player below.
  v_amount_cents := case
    when v_price is null or v_price = 0 then 0
    else round(v_price * p_pitches * (extract(epoch from (p_end - p_start)) / 3600.0) * 100)::integer
  end;
  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player)
    values
      (p_venue_id, p_day, p_start, p_end, p_pitches, p_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.service_fee_cents() end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  -- Split the venue price evenly across the format's fixed player count
  -- (5/7/9/11); the leftover cents from integer division go to the booker,
  -- per spec. Every player, booker included, then adds the service fee.
  if v_amount_cents > 0 then
    v_format_count := public.format_player_count(p_format);
    v_share_cents := v_amount_cents / v_format_count;
    v_booker_share_cents := v_amount_cents - v_share_cents * (v_format_count - 1)
                            + public.service_fee_cents();

    insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
    values (v_booking.id, auth.uid(), v_booker_share_cents, true, 'pending');
  end if;

  return v_booking;
end;
$function$;

revoke execute on function public.book_slot(uuid, date, time, time, integer, integer, text) from public, anon;
grant execute on function public.book_slot(uuid, date, time, time, integer, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. add_booking_share_internal: a joining player's share is their part of
--    the venue price + the booking's fee. Old bookings (fee NULL) are
--    unchanged: amount_cents already contains their 8.9%.
-- ---------------------------------------------------------------------------
create or replace function public.add_booking_share_internal(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
  v_current_count integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  v_total_needed := public.booking_total_shares_needed(p_booking_id);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id;

  if v_current_count >= v_total_needed then
    return; -- booking already has a share for every slot
  end if;

  v_share_cents := v_booking.amount_cents / v_total_needed
                   + coalesce(v_booking.service_fee_cents_per_player, 0);

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$function$;

revoke execute on function public.add_booking_share_internal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_booking_share_internal(uuid, uuid) to service_role;
