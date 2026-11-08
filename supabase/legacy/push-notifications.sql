-- Push tokens: where a signed-in user's device(s) can be reached. Run in the
-- Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- This table alone does not send anything — it's just the address book. The
-- actual sending happens in a Supabase Edge Function
-- (supabase/functions/notify-squad-post/index.ts) triggered by a Database
-- Webhook, both of which need to be deployed/configured by hand — see the
-- comments in that function's source for the exact steps.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

-- One row per (user, token) — a user with two devices gets two rows, and
-- re-registering the same device just refreshes updated_at via upsert.
create unique index if not exists push_tokens_unique on public.push_tokens (profile_id, token);

alter table public.push_tokens enable row level security;

drop policy if exists "Users manage their own push tokens" on public.push_tokens;
create policy "Users manage their own push tokens"
  on public.push_tokens for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
