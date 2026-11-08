-- Production settings that live outside the public schema, so
-- `supabase db dump --schema public` (the baseline before this file) can't
-- capture them. Every statement is idempotent: production already has all of
-- this, so applying it there changes nothing.
--
-- Deliberately NOT here: the pg_cron jobs from supabase/legacy/
-- (booking-payments.sql, booking-payment-splits.sql,
-- gipedo-pano-payments.sql, settle-gipedo-pano-cron.sql). Two of them POST to
-- the production Edge Function URL with a cron secret, and a local
-- `db reset` must never schedule calls against production.

-- 1. The database runs on Cyprus time (supabase/legacy/cyprus-time.sql).
--    Only connections opened after this see it.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Nicosia');
end $$;

-- 2. Every new auth user gets a profile (supabase/legacy/schema.sql).
--    public.handle_new_user() itself is in the baseline.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Realtime for the tables the app subscribes to (supabase/legacy/realtime.sql).
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array[
    'squad_posts', 'squad_post_joiners', 'fixture_messages', 'league_teams', 'league_fixtures'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
