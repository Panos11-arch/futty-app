-- Enables Supabase Realtime (postgres_changes) for the tables the app
-- subscribes to live: Squads posts/join-counts, fixture chat, and league
-- standings/fixture status. Run in the Supabase dashboard: SQL Editor > New
-- query > Run. Safe to re-run — each ADD TABLE is guarded, since running
-- `alter publication ... add table` on something already in it is an error,
-- not a no-op.
--
-- Equivalent to toggling "Enable Realtime" for each table in
-- Database > Replication in the dashboard, if you'd rather do it there —
-- this is the same setting, just scripted.
--
-- RLS still applies over Realtime: a client only receives postgres_changes
-- events for rows it could SELECT anyway. fixture_messages' own policy
-- ("Captains can read their fixture chat", supabase/legacy/league-fixtures.sql)
-- already scopes that to just the two teams' captains — nothing extra
-- needed for "updates live for both sides" to also mean "and nobody else".

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'squad_posts'
  ) then
    alter publication supabase_realtime add table public.squad_posts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'squad_post_joiners'
  ) then
    alter publication supabase_realtime add table public.squad_post_joiners;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fixture_messages'
  ) then
    alter publication supabase_realtime add table public.fixture_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'league_teams'
  ) then
    alter publication supabase_realtime add table public.league_teams;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'league_fixtures'
  ) then
    alter publication supabase_realtime add table public.league_fixtures;
  end if;
end $$;
