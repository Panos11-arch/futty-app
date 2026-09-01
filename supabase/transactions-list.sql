-- "All Transactions" screen (app/account/payments/transactions.tsx) fixes:
-- 1. a still-pending share now carries its booking's venue/day/time/format
--    inline, so the client can link straight back to app/booking-payment.tsx
--    for it ("Finish payment") without a second fetch.
-- 2. Expired pending shares (kickoff already passed) are filtered out
--    server-side, as a display-layer safeguard alongside the real
--    cancel-unpaid-bookings cleanup (supabase/booking-payment-splits.sql) —
--    same 'Asia/Nicosia' timezone-aware comparison that job already uses via
--    bookings_needing_share_cancellation, so both agree on what "expired"
--    means. A share is 'pending' specifically meaning "not yet paid" (there
--    is no manual-capture/authorize-then-capture PaymentIntent flow in this
--    codebase — every PaymentIntent here uses Stripe's default automatic
--    capture — so this is the only "awaiting payment" state that exists).
-- 3. Every non-pending share (paid, refunded, cancelled) is always
--    returned regardless of age — the filter in (2) only ever excludes
--    'pending' rows.
--
-- Run AFTER supabase/booking-payment-splits.sql. Run in the Supabase
-- dashboard: SQL Editor > New query > Run. Safe to re-run.

create or replace function public.list_my_transactions()
returns table (
  id uuid,
  booking_id uuid,
  amount_cents integer,
  status text,
  paid_at timestamptz,
  is_booker boolean,
  venue_id uuid,
  booking_day date,
  start_time time,
  format text
)
language sql
security definer
set search_path = ''
stable
as $$
  select s.id, s.booking_id, s.amount_cents, s.status, s.paid_at, s.is_booker,
         b.venue_id, b.booking_day, b.start_time, b.format
  from public.booking_payment_shares s
  join public.venue_bookings b on b.id = s.booking_id
  where s.profile_id = auth.uid()
    and (
      s.status <> 'pending'
      or (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' > now()
    )
  order by s.paid_at desc nulls last, b.booking_day desc, b.start_time desc;
$$;

grant execute on function public.list_my_transactions() to authenticated;
