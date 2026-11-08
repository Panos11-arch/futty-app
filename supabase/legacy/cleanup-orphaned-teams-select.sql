-- Candidates for the item 4 cleanup — SELECT ONLY, run this first and review
-- before ever running a DELETE. "Orphaned/incomplete team registration" is
-- defined here as: a team created more than 24h ago that was never
-- registered into any league (no league_teams row) AND never finished
-- filling its main roster (fewer members with role in ('captain','player')
-- than its own roster_size) — i.e. an abandoned draft from the
-- create-team-then-fill-roster flow, not a real team someone is using.
--
-- League team registration itself has no payment step (only Team Premium,
-- a separate purchase, gates 9/11-a-side formats) — so "no successful
-- payment" from the spec doesn't map onto a real column here; this instead
-- uses "never actually registered" as the equivalent signal of abandonment.
select
  t.id,
  t.name,
  t.city,
  t.created_at,
  t.created_by,
  t.roster_size,
  (select count(*) from public.team_members tm where tm.team_id = t.id and tm.role in ('captain','player')) as main_members,
  exists (select 1 from public.venue_bookings vb where vb.team_id = t.id) as has_bookings,
  exists (select 1 from public.squad_posts sp where sp.team_id = t.id or sp.matched_team_id = t.id) as has_squad_posts
from public.teams t
where t.created_at < now() - interval '24 hours'
  and not exists (select 1 from public.league_teams lt where lt.team_id = t.id)
  and (select count(*) from public.team_members tm where tm.team_id = t.id and tm.role in ('captain','player')) < t.roster_size
order by t.created_at;
