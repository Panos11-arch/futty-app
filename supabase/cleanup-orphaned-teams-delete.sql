-- Item 4 cleanup — run once, reviewed and approved via
-- supabase/cleanup-orphaned-teams-select.sql first. Deletes abandoned draft
-- teams (>24h old, never registered to a league, roster never finished) that
-- have no venue_bookings or squad_posts referencing them, so the NO ACTION
-- foreign keys on those tables are never hit. team_members and
-- team_premium_purchases rows for these teams cascade automatically.
delete from public.teams t
where t.created_at < now() - interval '24 hours'
  and not exists (select 1 from public.league_teams lt where lt.team_id = t.id)
  and (select count(*) from public.team_members tm where tm.team_id = t.id and tm.role in ('captain','player')) < t.roster_size
  and not exists (select 1 from public.venue_bookings vb where vb.team_id = t.id)
  and not exists (select 1 from public.squad_posts sp where sp.team_id = t.id or sp.matched_team_id = t.id)
returning id, name;
