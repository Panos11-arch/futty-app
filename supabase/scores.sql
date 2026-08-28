-- Score logging: friendly matches (from a matched Squads "opposition" post)
-- and league fixtures. Run AFTER supabase/squads.sql, supabase/teams.sql,
-- and supabase/league-fixtures.sql. Run in the Supabase dashboard: SQL
-- Editor > New query > Run. Safe to re-run.
--
-- friendly_matches / friendly_match_scores / fixture_score_submissions /
-- profiles.xp+played+won+drawn+lost+goals / teams.dispute_count all already
-- existed in your database (see your build guide) — this wires them up.
--
-- Shared "3 tries" model for both friendly and league scores: score_attempts
-- is ONE counter per match/fixture (not per side) — the total number of
-- submissions from either side, kept as a full history rather than
-- overwritten in place. Once attempts hit 3 without the two sides' latest
-- numbers matching, a side is "at fault" only if it submitted more than one
-- DISTINCT score among its own submissions (i.e. it kept changing) — a side
-- that only ever submitted once isn't penalised just for disagreeing.
--
-- Neither table tracks a match duration, so "not before or during the
-- match" is enforced as kickoff + 2 hours.

-- 1. Individually-attributed friendly score submissions — the table only
-- tracked which TEAM submitted before; the per-dispute XP penalty needs the
-- specific profile.
alter table public.friendly_match_scores add column if not exists submitted_by_profile_id uuid references public.profiles (id);

alter table public.friendly_matches enable row level security;
alter table public.friendly_match_scores enable row level security;
alter table public.fixture_score_submissions enable row level security;

-- Same "browsable" reasoning as fixtures/teams — read is open to any
-- signed-in user; every write goes through the RPCs below.
drop policy if exists "Authenticated users can read friendly matches" on public.friendly_matches;
create policy "Authenticated users can read friendly matches"
  on public.friendly_matches for select to authenticated using (true);

drop policy if exists "Authenticated users can read friendly match scores" on public.friendly_match_scores;
create policy "Authenticated users can read friendly match scores"
  on public.friendly_match_scores for select to authenticated using (true);

drop policy if exists "Authenticated users can read fixture score submissions" on public.fixture_score_submissions;
create policy "Authenticated users can read fixture score submissions"
  on public.fixture_score_submissions for select to authenticated using (true);

-- 2. Fans out a confirmed result's played/won/drawn/lost/goals to every
-- member of one team (any role) — shared by both the friendly and league
-- paths below. p_goals is 0 for the "couldn't agree a day" league outcome,
-- since no game actually happened.
create or replace function public.apply_personal_match_stats(p_team_id uuid, p_result text, p_goals integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set played = played + 1,
      won = won + case when p_result = 'won' then 1 else 0 end,
      drawn = drawn + case when p_result = 'drawn' then 1 else 0 end,
      lost = lost + case when p_result = 'lost' then 1 else 0 end,
      goals = goals + p_goals
  where id in (select profile_id from public.team_members where team_id = p_team_id);
end;
$$;

-- 3. Applies a confirmed friendly result to both teams (teams.played/won/
-- drawn/lost/goals) and fans it out to every player on both rosters.
create or replace function public.apply_friendly_match_result(
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_home_score integer,
  p_away_score integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home_result text;
  v_away_result text;
begin
  if p_home_score > p_away_score then
    v_home_result := 'won'; v_away_result := 'lost';
  elsif p_away_score > p_home_score then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'drawn'; v_away_result := 'drawn';
  end if;

  update public.teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_home_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end,
      goals = goals + p_home_score
  where id = p_home_team_id;

  update public.teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_away_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end,
      goals = goals + p_away_score
  where id = p_away_team_id;

  perform public.apply_personal_match_stats(p_home_team_id, v_home_result, p_home_score);
  perform public.apply_personal_match_stats(p_away_team_id, v_away_result, p_away_score);
end;
$$;

-- 4. A matched opposition post now also creates its friendly_matches row —
-- supersedes the version in squads.sql (same signature, new body).
create or replace function public.offer_opposition(p_post_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  if v_post.team_id = p_team_id then
    raise exception 'cannot_offer_own_post';
  end if;

  update public.squad_posts
  set status = 'matched', matched_team_id = p_team_id
  where id = p_post_id;

  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
  values (p_post_id, v_post.team_id, p_team_id, 'pending_score', 0);
end;
$$;

grant execute on function public.offer_opposition(uuid, uuid) to authenticated;

-- One-time backfill: creates the friendly_matches row for any opposition
-- post that was already matched before this file existed — the old
-- offer_opposition (supabase/squads.sql) never created one. Safe to re-run;
-- skips posts that already have a match.
insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
select sp.id, sp.team_id, sp.matched_team_id, 'pending_score', 0
from public.squad_posts sp
where sp.type = 'opposition'
  and sp.status = 'matched'
  and sp.matched_team_id is not null
  and not exists (
    select 1 from public.friendly_matches fm where fm.squad_post_id = sp.id
  );

-- 5. Compares both sides' latest friendly_match_scores rows and decides the
-- outcome — factored out of submit_friendly_score so the "what happens after
-- a submission" rule lives in one independently-callable place. No
-- team-level penalty here (unlike check_fixture_score_match below): a
-- friendly has no league_teams/pts_adjustment to touch, and
-- submitted_by_profile_id already names the exact person who submitted, so
-- the XP penalty was always individual, never "every captain of the team".
create or replace function public.check_friendly_score_match(p_match_id uuid)
returns public.friendly_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.friendly_matches;
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.friendly_match_scores;
  v_away_last public.friendly_match_scores;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match_not_found';
  end if;

  select * into v_home_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    update public.friendly_matches set status = 'confirmed' where id = p_match_id;

    perform public.apply_friendly_match_result(
      v_match.home_team_id, v_match.away_team_id, v_home_last.home_score, v_home_last.away_score
    );

  elsif v_match.score_attempts >= 3 then
    update public.friendly_matches set status = 'locked' where id = p_match_id;

    select count(distinct (home_score, away_score)) > 1 into v_home_changed
    from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id;

    select count(distinct (home_score, away_score)) > 1 into v_away_changed
    from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id;

    if v_home_changed then
      update public.profiles set xp = xp - 20 where id = v_home_last.submitted_by_profile_id;
    end if;
    if v_away_changed then
      update public.profiles set xp = xp - 20 where id = v_away_last.submitted_by_profile_id;
    end if;
  end if;

  select * into v_match from public.friendly_matches where id = p_match_id;
  return v_match;
end;
$$;

-- Deliberately no `grant ... to authenticated` here: this only re-derives
-- outcome from whatever submissions already exist, with no idea whether
-- it's already been run for the current state. submit_friendly_score can
-- still call it (a security-definer function runs as its owner, so it
-- doesn't need its own grant to call another one) — but if a client could
-- invoke it directly, calling it twice against an already-'confirmed' match
-- would apply_friendly_match_result a second time and double-count stats.

-- 6. Friendly score submission — any member of either team (not
-- captain-only, unlike the league fixture below).
create or replace function public.submit_friendly_score(
  p_match_id uuid,
  p_home_score integer,
  p_away_score integer
)
returns public.friendly_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_my_team uuid;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match_not_found';
  end if;
  if v_match.status <> 'pending_score' then
    raise exception 'score_not_open';
  end if;

  select tm.team_id into v_my_team
  from public.team_members tm
  where tm.profile_id = auth.uid()
    and tm.team_id in (v_match.home_team_id, v_match.away_team_id)
  limit 1;
  if v_my_team is null then
    raise exception 'not_on_team';
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.scheduled_at is null or now() < v_post.scheduled_at + interval '2 hours' then
    raise exception 'too_early';
  end if;

  insert into public.friendly_match_scores
    (friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score)
  values (p_match_id, v_my_team, auth.uid(), p_home_score, p_away_score);

  update public.friendly_matches
  set score_attempts = score_attempts + 1
  where id = p_match_id;

  return public.check_friendly_score_match(p_match_id);
end;
$$;

grant execute on function public.submit_friendly_score(uuid, integer, integer) to authenticated;

-- 7. Compares both sides' latest fixture_score_submissions rows and decides
-- the outcome — factored out of submit_fixture_score for the same reason as
-- check_friendly_score_match above. Unlike the friendly version, a repeat
-- offender also costs the team standings points: once a team's OWN
-- dispute_count (incremented on every locked dispute it's on the hook for)
-- passes 2 — i.e. this is its 3rd+ dispute — it additionally takes a -6
-- pts_adjustment in the specific league it's disputing in.
create or replace function public.check_fixture_score_match(p_fixture_id uuid)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.fixture_score_submissions;
  v_away_last public.fixture_score_submissions;
  v_home_result text;
  v_away_result text;
  v_home_dispute_count integer;
  v_away_dispute_count integer;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  select * into v_home_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    if v_home_last.home_score > v_home_last.away_score then
      v_home_result := 'won'; v_away_result := 'lost';
    elsif v_home_last.away_score > v_home_last.home_score then
      v_home_result := 'lost'; v_away_result := 'won';
    else
      v_home_result := 'drawn'; v_away_result := 'drawn';
    end if;

    update public.league_fixtures set status = 'completed' where id = p_fixture_id;

    update public.league_teams
    set played = played + 1,
        won = won + case when v_home_result = 'won' then 1 else 0 end,
        drawn = drawn + case when v_home_result = 'drawn' then 1 else 0 end,
        lost = lost + case when v_home_result = 'lost' then 1 else 0 end,
        goals_for = goals_for + v_home_last.home_score,
        goals_against = goals_against + v_home_last.away_score
    where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;

    update public.league_teams
    set played = played + 1,
        won = won + case when v_away_result = 'won' then 1 else 0 end,
        drawn = drawn + case when v_away_result = 'drawn' then 1 else 0 end,
        lost = lost + case when v_away_result = 'lost' then 1 else 0 end,
        goals_for = goals_for + v_home_last.away_score,
        goals_against = goals_against + v_home_last.home_score
    where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;

    perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home_result, v_home_last.home_score);
    perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away_result, v_home_last.away_score);

  elsif v_fixture.score_attempts >= 3 then
    update public.league_fixtures set score_locked = true where id = p_fixture_id;

    select count(distinct (home_score, away_score)) > 1 into v_home_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id;

    select count(distinct (home_score, away_score)) > 1 into v_away_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id;

    if v_home_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.home_team_id
      returning dispute_count into v_home_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.home_team_id and role = 'captain'
      );

      if v_home_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;
      end if;
    end if;
    if v_away_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.away_team_id
      returning dispute_count into v_away_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.away_team_id and role = 'captain'
      );

      if v_away_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;
      end if;
    end if;
  end if;

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;

-- Same reasoning as check_friendly_score_match above: no grant to
-- authenticated on purpose, so the only way in is through
-- submit_fixture_score, which only calls it once per genuinely new
-- submission (already gated by already_completed/score_locked before the
-- insert). A directly-callable version could double-apply league_teams and
-- the dispute penalties against an unchanged state.

-- 8. League fixture score submission — captain-only.
create or replace function public.submit_fixture_score(
  p_fixture_id uuid,
  p_home_score integer,
  p_away_score integer
)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;
  if v_fixture.status = 'completed' then
    raise exception 'already_completed';
  end if;
  if v_fixture.score_locked then
    raise exception 'score_locked';
  end if;
  if v_fixture.status <> 'agreed' then
    raise exception 'schedule_not_agreed';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  -- scheduled_day/scheduled_time are plain date/time (Cyprus wall-clock, no
  -- zone attached). Combining them gives a naive timestamp, and comparing
  -- that to now() (timestamptz) implicitly casts it using the database
  -- session's timezone — UTC on Supabase — which would judge "2 hours after
  -- an 18:00 match" against 18:00 UTC instead of 18:00 Cyprus time, staying
  -- "too early" for however many hours UTC is behind Cyprus.
  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() < ((v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia') + interval '2 hours' then
    raise exception 'too_early';
  end if;

  insert into public.fixture_score_submissions (fixture_id, submitted_by_team_id, home_score, away_score)
  values (p_fixture_id, v_my_team, p_home_score, p_away_score);

  update public.league_fixtures
  set score_attempts = score_attempts + 1
  where id = p_fixture_id;

  return public.check_fixture_score_match(p_fixture_id);
end;
$$;

grant execute on function public.submit_fixture_score(uuid, integer, integer) to authenticated;

-- 9. "Couldn't agree a day within the week" resolution — callable by either
-- captain once 7 days have passed since the fixture was generated with no
-- agreed schedule. Whichever side made at least one proposal in that window
-- is judged "available"; neither/both proposing (but never converging)
-- counts as both being available, hence a draw.
create or replace function public.resolve_unscheduled_fixture(p_fixture_id uuid)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_home_proposed boolean;
  v_away_proposed boolean;
  v_home_result text;
  v_away_result text;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  if public.captain_team_for_fixture(v_fixture) is null then
    raise exception 'not_captain';
  end if;

  if v_fixture.status in ('agreed', 'completed') then
    raise exception 'already_scheduled';
  end if;

  if now() < v_fixture.created_at + interval '7 days' then
    raise exception 'window_not_elapsed';
  end if;

  select exists (
    select 1 from public.fixture_schedule_proposals
    where fixture_id = p_fixture_id and proposed_by_team_id = v_fixture.home_team_id
  ) into v_home_proposed;

  select exists (
    select 1 from public.fixture_schedule_proposals
    where fixture_id = p_fixture_id and proposed_by_team_id = v_fixture.away_team_id
  ) into v_away_proposed;

  if v_home_proposed and not v_away_proposed then
    v_home_result := 'won'; v_away_result := 'lost';
  elsif v_away_proposed and not v_home_proposed then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'drawn'; v_away_result := 'drawn';
  end if;

  update public.league_fixtures set status = 'completed' where id = p_fixture_id;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_home_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end
  where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_away_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end
  where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;

  perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away_result, 0);

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;

grant execute on function public.resolve_unscheduled_fixture(uuid) to authenticated;

-- 10. Lets either captain back out of a matched opposition post — undoes what
-- offer_opposition did above (status back to 'open', matched_team_id
-- cleared, the friendly_matches row removed). Blocked from 30 minutes before
-- kickoff onward: by then the other side may already be on their way, and
-- scoring can't open until kickoff + 2 hours anyway (submit_friendly_score),
-- so there's no window where both a cancellation and a score submission
-- could ever be racing each other.
create or replace function public.cancel_opposition_offer(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;

  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;

  if v_post.status <> 'matched' then
    raise exception 'not_matched';
  end if;

  if not exists (
    select 1 from public.team_members
    where profile_id = auth.uid()
      and role = 'captain'
      and team_id in (v_post.team_id, v_post.matched_team_id)
  ) then
    raise exception 'not_captain';
  end if;

  if v_post.scheduled_at is null or now() >= v_post.scheduled_at - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  delete from public.friendly_matches where squad_post_id = p_post_id;

  update public.squad_posts
  set status = 'open', matched_team_id = null
  where id = p_post_id;
end;
$$;

grant execute on function public.cancel_opposition_offer(uuid) to authenticated;