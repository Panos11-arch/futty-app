-- Persists the final, agreed score on friendly_matches/league_fixtures
-- themselves, for the home page's "Recent results" card.
--
-- Previously the confirmed score only existed as a side effect (fanned out
-- into teams./league_teams./profiles. aggregate stats) — nothing stored the
-- actual "3-2" anywhere queryable, so the client had no final score to show
-- once both sides had logged it.
--
-- Run AFTER supabase/scores.sql (replaces submit_friendly_score and
-- submit_fixture_score with versions that also persist the score). Run in
-- the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.

alter table public.friendly_matches add column if not exists home_score integer;
alter table public.friendly_matches add column if not exists away_score integer;
alter table public.league_fixtures add column if not exists home_score integer;
alter table public.league_fixtures add column if not exists away_score integer;

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
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.friendly_match_scores;
  v_away_last public.friendly_match_scores;
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
  where id = p_match_id
  returning * into v_match;

  select * into v_home_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    update public.friendly_matches
    set status = 'confirmed', home_score = v_home_last.home_score, away_score = v_home_last.away_score
    where id = p_match_id;

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

grant execute on function public.submit_friendly_score(uuid, integer, integer) to authenticated;

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
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.fixture_score_submissions;
  v_away_last public.fixture_score_submissions;
  v_home_result text;
  v_away_result text;
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

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() < (v_fixture.scheduled_day + v_fixture.scheduled_time + interval '2 hours') then
    raise exception 'too_early';
  end if;

  insert into public.fixture_score_submissions (fixture_id, submitted_by_team_id, home_score, away_score)
  values (p_fixture_id, v_my_team, p_home_score, p_away_score);

  update public.league_fixtures
  set score_attempts = score_attempts + 1
  where id = p_fixture_id
  returning * into v_fixture;

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

    update public.league_fixtures
    set status = 'completed', home_score = v_home_last.home_score, away_score = v_home_last.away_score
    where id = p_fixture_id;

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
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1 where id = v_fixture.home_team_id;
      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.home_team_id and role = 'captain'
      );
    end if;
    if v_away_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1 where id = v_fixture.away_team_id;
      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.away_team_id and role = 'captain'
      );
    end if;
  end if;

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;

grant execute on function public.submit_fixture_score(uuid, integer, integer) to authenticated;
