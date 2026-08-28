-- Backs the account menu's Your Payments > Payment Methods screen. Stripe's
-- own PaymentSheet already knows how to list/add/remove a customer's saved
-- cards when given a Customer + ephemeral key — this just gives every
-- profile a stable Stripe Customer id to attach cards to, so "saved cards"
-- persist across bookings instead of Stripe creating a fresh anonymous
-- customer every time. Run AFTER supabase/booking-payments.sql. Run in the
-- Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- "All Transactions" (app/account/payments/transactions.tsx) needs no new
-- schema — it just lists the signed-in user's own venue_bookings, which RLS
-- (supabase/venues.sql) already lets them read.

alter table public.profiles add column if not exists stripe_customer_id text;

-- Same column-level lockdown as is_premium (supabase/premium-payments.sql):
-- only the create-setup-intent Edge Function (service role) may set this —
-- a client claiming someone else's Stripe customer id would let it charge/see
-- that customer's saved cards.
revoke update (stripe_customer_id) on public.profiles from authenticated;
