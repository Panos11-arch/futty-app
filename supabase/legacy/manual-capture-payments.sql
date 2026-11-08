-- Switches split booking payments (supabase/legacy/booking-payment-splits.sql) from
-- "charge immediately, refund the whole booking if it falls through" to
-- authorize-then-capture (item 6): each player's card is only put on hold
-- (a manual-capture Stripe PaymentIntent) at join/book time, real money only
-- moves once every share in the booking is authorized (the roster is full),
-- and an authorization that never gets there is voided, never charged.
--
-- New status: 'authorized' — a share whose PaymentIntent succeeded
-- authorization (capture_method: 'manual') but hasn't been captured yet.
-- 'paid' now means "actually captured", not "authorization succeeded".
-- 'pending' still means "no successful PaymentIntent yet at all".
--
-- Run AFTER supabase/legacy/booking-payment-splits.sql. Run in the Supabase
-- dashboard: SQL Editor > New query > Run. Safe to re-run.

alter table public.booking_payment_shares drop constraint if exists booking_payment_shares_status_check;
alter table public.booking_payment_shares add constraint booking_payment_shares_status_check
  check (status in ('pending', 'authorized', 'paid', 'refunded', 'cancelled'));

-- The 3-hours-before-kickoff deadline (supabase/functions/cancel-unpaid-bookings)
-- now needs to catch 'authorized'-but-not-yet-captured shares too, not just
-- 'pending' ones — an authorization that never turns into a full roster
-- still needs to be voided before kickoff, exactly like a share nobody ever
-- started paying.
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
    and s.status in ('pending', 'authorized')
    and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' <= now() + interval '3 hours';
$$;
