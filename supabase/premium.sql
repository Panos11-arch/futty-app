-- Personal Premium flag.
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Real billing now exists — see supabase/premium-payments.sql, which revokes
-- client UPDATE access to this column and hands writes to it exclusively to
-- the verify-purchase and apple-server-notifications Edge Functions.
-- Run that file too; it depends on this one having run first.

alter table public.profiles add column if not exists is_premium boolean not null default false;
