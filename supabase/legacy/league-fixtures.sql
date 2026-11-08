-- League fixtures — works with the league_fixtures / fixture_schedule_proposals
-- / fixture_messages tables you already built (see your own build guide);
-- this only adds RLS, the auto-round-robin generator, and the
-- propose/chat RPCs. Run AFTER supabase/legacy/leagues.sql and supabase/legacy/venues.sql.
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Scheduling model matches your own design: each captain independently
-- PROPOSES a day/time/venue into fixture_schedule_proposals (one row per
-- proposal — a full history, not a single mutable slot). When the two
-- teams' latest proposals match exactly, the fixture auto-flips to
-- 'agreed' — there's no separate "accept" action; matching the other
-- side's numbers back to them IS the accept.
--
-- Deliberately does NOT touch fixture_score_submissions / score_attempts /
-- score_locked — that's a separate, not-yet-built score-dispute feature.

alter table public.league_fixtures enable row level security;
alter table public.fixture_schedule_proposals enable row level security;
alter table public.fixture_messages enable row level security;

-- Same "browsable like a catalogue" reasoning as teams/leagues — who plays
-- whom, when, and where isn't sensitive.
drop policy if exists "Authenticated users can read fixtures" on public.league_fixtures;
create policy "Authenticated users can read fixtures"
  on public.league_fixtures for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read schedule proposals" on public.fixture_schedule_proposals;
create policy "Authenticated users can read schedule proposals"
  on public.fixture_schedule_proposals for select
  to authenticated
  using (true);

-- No direct write policy on either table above — league_fixtures is only
-- ever written by sync_league_fixtures() (creation) and
-- propose_fixture_schedule() (scheduling); fixture_schedule_proposals only
-- by propose_fixture_schedule() — both security definer.

drop policy if exists "Captains can read their fixture chat" on public.fixture_messages;
create policy "Captains can read their fixture chat"
  on public.fixture_messages for select
  to authenticated
  using (
    exists (
      select 1
      from public.league_fixtures lf
      join public.team_members tm on tm.team_id in (lf.home_team_id, lf.away_team_id)
      where lf.id = fixture_messages.fixture_id
        and tm.profile_id = auth.uid()
        and tm.role = 'captain'
    )
  );

-- No insert policy — sending a message always goes through
-- send_fixture_message() below, so sender_team_id can't be spoofed.

-- Needed for ON CONFLICT DO NOTHING in sync_league_fixtures below — this
-- pairing constraint didn't exist on the pre-built table.
create unique index if not exists league_fixtures_unique_pairing
  on public.league_fixtures (league_id, home_team_id, away_team_id);

-- Idempotent, additive: fills in any missing pairing for the league's
-- CURRENT team list, never touches existing rows. Safe to call any time a
-- league's team list changes (new registration, promotion/relegation,
-- division split/pool-forming) rather than needing a single "season start"
-- moment — which standard (always-open) leagues don't really have.
--
-- home/away here is just a stable, arbitrary assignment (lower team id =
-- home) so a pair is never inserted twice under swapped order — this app
-- has no per-team home venue, so it isn't a real fixture advantage.
create or replace function public.sync_league_fixtures(p_league_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.league_fixtures (league_id, home_team_id, away_team_id, status)
  select t1.league_id, t1.team_id, t2.team_id, 'unscheduled'
  from public.league_teams t1
  join public.league_teams t2 on t1.league_id = t2.league_id and t1.team_id < t2.team_id
  where t1.league_id = p_league_id
  on conflict (league_id, home_team_id, away_team_id) do nothing;
$$;

-- Resolves which of the two fixture teams (if any) the caller captains —
-- shared by the scheduling and chat RPCs below.
create or replace function public.captain_team_for_fixture(p_fixture public.league_fixtures)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select tm.team_id
  from public.team_members tm
  where tm.profile_id = auth.uid()
    and tm.role = 'captain'
    and tm.team_id in (p_fixture.home_team_id, p_fixture.away_team_id)
  limit 1;
$$;

-- Records the caller's proposal, then checks whether the OTHER team's most
-- recent proposal for this fixture matches it exactly (day, time, venue) —
-- if so, the fixture is agreed right here, no separate step needed.
create or replace function public.propose_fixture_schedule(
  p_fixture_id uuid,
  p_day date,
  p_time time,
  p_venue_id uuid
)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
  v_other_team uuid;
  v_other_latest public.fixture_schedule_proposals;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if p_day < current_date or p_day > current_date + 7 then
    raise exception 'date_out_of_range';
  end if;
  if not exists (select 1 from public.venues where id = p_venue_id) then
    raise exception 'venue_not_found';
  end if;

  insert into public.fixture_schedule_proposals
    (fixture_id, proposed_by_team_id, venue_id, proposed_day, proposed_time)
  values (p_fixture_id, v_my_team, p_venue_id, p_day, p_time);

  update public.league_fixtures
  set status = 'proposed'
  where id = p_fixture_id and status = 'unscheduled';

  v_other_team := case
    when v_my_team = v_fixture.home_team_id then v_fixture.away_team_id
    else v_fixture.home_team_id
  end;

  select * into v_other_latest
  from public.fixture_schedule_proposals
  where fixture_id = p_fixture_id and proposed_by_team_id = v_other_team
  order by created_at desc
  limit 1;

  if v_other_latest.id is not null
     and v_other_latest.proposed_day = p_day
     and v_other_latest.proposed_time = p_time
     and v_other_latest.venue_id = p_venue_id then
    update public.league_fixtures
    set scheduled_day = p_day, scheduled_time = p_time, venue_id = p_venue_id, status = 'agreed'
    where id = p_fixture_id;
  end if;

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;

grant execute on function public.propose_fixture_schedule(uuid, date, time, uuid) to authenticated;

-- Captain-only chat per fixture, to negotiate/finalize date & pitch details.
-- Resolves sender_team_id server-side (from the caller's own captaincy)
-- rather than trusting a client-supplied value.
create or replace function public.send_fixture_message(p_fixture_id uuid, p_message text)
returns public.fixture_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
  v_row public.fixture_messages;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if nullif(trim(p_message), '') is null then
    raise exception 'message_required';
  end if;

  insert into public.fixture_messages (fixture_id, sender_team_id, message)
  values (p_fixture_id, v_my_team, trim(p_message))
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.send_fixture_message(uuid, text) to authenticated;

-- One-time backfill: generates fixtures for every league that already has
-- teams registered — covers teams that joined before this file (or the
-- sync_league_fixtures() calls in leagues.sql) existed. sync_league_fixtures
-- is additive/idempotent, so this is safe to run again later too.
do $$
declare
  v_league_id uuid;
begin
  for v_league_id in select distinct league_id from public.league_teams loop
    perform public.sync_league_fixtures(v_league_id);
  end loop;
end $$;
