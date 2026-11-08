-- Real billing for Futty Premium. Builds on supabase/legacy/premium.sql (which adds
-- profiles.is_premium as a free-standing toggle) by taking away the client's
-- ability to write that column directly, and giving only the verify-purchase
-- and apple-server-notifications Edge Functions (service role) a way
-- to set it, based on a purchase Apple/Google actually confirmed.
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- iOS only for now — Android (Google Play Billing + Real-time Developer
-- Notifications) is the same shape of work but for a Play Store submission
-- that hasn't started yet. platform/product_id below are already general
-- enough that adding Android later is additive, not a rewrite.

create table if not exists public.premium_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  original_transaction_id text not null,
  status text not null check (status in ('active', 'expired', 'cancelled', 'refunded')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per real-world subscription, so the renewal webhook can look up
-- "which profile does this transaction belong to" without trusting anything
-- the client says at renewal time (there is no client involved at renewal).
create unique index if not exists premium_subscriptions_transaction_unique
  on public.premium_subscriptions (platform, original_transaction_id);

create index if not exists premium_subscriptions_profile_idx
  on public.premium_subscriptions (profile_id);

alter table public.premium_subscriptions enable row level security;

-- Read-only for the owning user (so the app could show "renews on X" later);
-- deliberately no insert/update/delete policy for authenticated at all — only
-- the service role (Edge Functions) writes here.
drop policy if exists "Users can read their own subscription" on public.premium_subscriptions;
create policy "Users can read their own subscription"
  on public.premium_subscriptions for select
  to authenticated
  using (profile_id = auth.uid());

-- The actual lockdown: column-level privileges are independent of RLS. This
-- doesn't touch the existing "Users can update their own profile" RLS policy
-- (still needed for username/phone/bio/etc.) — it just removes is_premium
-- specifically from what a client-authenticated UPDATE is allowed to touch.
-- Attempting to write it via supabase.from('profiles').update({ is_premium })
-- as a regular user now fails with a permission error. The service role used
-- by Edge Functions is unaffected — it bypasses grants entirely.
revoke update (is_premium) on public.profiles from authenticated;
