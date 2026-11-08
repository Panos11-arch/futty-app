-- Real billing for Team Premium (supabase/legacy/team-premium.sql). Same shape as
-- supabase/legacy/premium-payments.sql for Personal Premium: takes away the
-- client's ability to grant premium_9aside/premium_11aside for free, and
-- hands writes to it exclusively to the verify-team-purchase and
-- apple-server-notifications Edge Functions, based on a purchase Apple
-- actually confirmed.
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to
-- re-run. Run AFTER supabase/legacy/team-premium.sql.
--
-- Modeled as non-consumable (buy once, own it), not a subscription:
-- premium_9aside/premium_11aside have no expiry today — a plain boolean,
-- exactly matching what set_team_premium already did. That means no
-- separate renewal check is needed the way Personal Premium needs one, only
-- refund handling — apple-server-notifications already receives REFUND
-- notifications for every product type, not just subscriptions.

create table if not exists public.team_premium_purchases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  format text not null check (format in ('9-a-side', '11-a-side')),
  product_id text not null,
  original_transaction_id text not null,
  purchased_by uuid references public.profiles (id) on delete set null,
  status text not null check (status in ('active', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists team_premium_purchases_transaction_unique
  on public.team_premium_purchases (original_transaction_id);

create index if not exists team_premium_purchases_team_idx
  on public.team_premium_purchases (team_id);

alter table public.team_premium_purchases enable row level security;

-- Any member of the team can see what's been bought for it, not just the
-- captain who bought it — same "read your own team's stuff" shape
-- team_members already gives everyone on the roster.
drop policy if exists "Team members can read their team's purchases" on public.team_premium_purchases;
create policy "Team members can read their team's purchases"
  on public.team_premium_purchases for select
  to authenticated
  using (
    exists (
      select 1 from public.team_members
      where team_id = team_premium_purchases.team_id and profile_id = auth.uid()
    )
  );

-- No insert/update/delete policy for authenticated — only the service role
-- (verify-team-purchase / apple-server-notifications) writes here.

-- The actual lockdown: set_team_premium was the only write path to
-- premium_9aside/premium_11aside (teams has no UPDATE policy of its own),
-- and let any captain flip it on with nothing behind it. Revoking execute
-- removes that path entirely for regular users; the service role used by
-- Edge Functions is unaffected.
revoke execute on function public.set_team_premium(uuid, text, boolean) from authenticated;
