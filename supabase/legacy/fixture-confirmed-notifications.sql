-- Notifies both captains when a league fixture reaches 'agreed' status, so
-- tapping it can open the same Fixture Confirmed popup a matched "need
-- opposition" squad post already opens (item 3). Run AFTER
-- supabase/legacy/notifications.sql and supabase/legacy/league-fixtures.sql. Run in the
-- Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- The existing 'squad_post' notification for a matched "need opposition"
-- post (notify_squad_post_matched in supabase/legacy/notifications.sql) already
-- covers that half of item 3 — this file only adds the league-fixture half.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed'));

create or replace function public.notify_fixture_agreed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_home_name text;
  v_away_name text;
begin
  if new.status <> 'agreed' or old.status is not distinct from new.status then
    return new;
  end if;

  select name into v_home_name from public.teams where id = new.home_team_id;
  select name into v_away_name from public.teams where id = new.away_team_id;

  for v_recipient in
    select profile_id from public.team_members
    where team_id in (new.home_team_id, new.away_team_id) and role = 'captain'
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      v_recipient,
      'fixture_agreed',
      'Fixture confirmed',
      coalesce(v_home_name, 'Home') || ' vs ' || coalesce(v_away_name, 'Away') || ' is locked in.',
      jsonb_build_object('fixtureId', new.id)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists on_fixture_agreed_notify on public.league_fixtures;
create trigger on_fixture_agreed_notify
  after update on public.league_fixtures
  for each row execute function public.notify_fixture_agreed();
