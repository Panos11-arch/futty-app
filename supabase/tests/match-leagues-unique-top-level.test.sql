-- One top-level league per city and format (Panos, 26 November). Divisions
-- are child rows (parent_league_id = the hub) with the hub's format and
-- scope, so the uniqueness covers top-level rows only
-- (leagues_format_scope_top_level_key).
begin;

-- 1. Splitting a league into Division 1 and Division 2 works.
do $$
declare
  v_cap1 uuid := tests.create_user('ut-cap1@futty.test');
  v_cap2 uuid := tests.create_user('ut-cap2@futty.test');
  v_team1 uuid := tests.create_team('UT Lions');
  v_team2 uuid := tests.create_team('UT Tigers');
  v_hub uuid;
  v_error text;
begin
  perform tests.join_team(v_team1, v_cap1, 'captain');
  perform tests.join_team(v_team2, v_cap2, 'captain');
  -- S10: a season is a child row of the hub, and its divisions are
  -- children of the next season.
  insert into public.leagues (format, scope, name, stage, capacity)
  values ('7-a-side', 'UT City', 'UT City 7s', 'signup', 8) returning id into v_hub;
  insert into public.league_teams (league_id, team_id) values (v_hub, v_team1), (v_hub, v_team2);
  v_error := tests.error_as(v_cap1, format('select public.start_league_season(%L)', v_hub));
  assert v_error is null, 'the season starts, got ' || coalesce(v_error, '');

  v_error := tests.error_as(v_cap1, format('select public.end_season_to_divisions(%L)', v_hub));
  assert v_error is null, 'the split succeeds, got ' || coalesce(v_error, '');

  assert (select array_agg(d.name order by d.name) from public.leagues d
          join public.leagues s on s.id = d.parent_league_id
          where s.parent_league_id = v_hub and s.season_number = 2)
         = array['Division 1', 'Division 2'], 'two divisions under Season 2';
  assert not exists (
    select 1 from public.leagues d join public.leagues s on s.id = d.parent_league_id
    where s.parent_league_id = v_hub and (d.format <> '7-a-side' or d.scope <> 'UT City')
  ), 'the divisions keep the hub''s format and scope';
  assert (select stage from public.leagues where id = v_hub) = 'divisions', 'the hub moves to divisions';
end $$;

-- 2. A second top-level league for the same city and format is refused.
do $$
declare
  v_error text;
begin
  insert into public.leagues (format, scope, name, capacity) values ('9-a-side', 'UT Town', 'UT Town 9s', 8);
  v_error := tests.error_of($q$
    insert into public.leagues (format, scope, name, capacity) values ('9-a-side', 'UT Town', 'Another', 8)
  $q$);
  assert v_error like '%leagues_format_scope_top_level_key%', 'a second top-level league is refused, got ' || coalesce(v_error, 'no error');
end $$;

-- 3. A child row with the same city and format is allowed.
do $$
declare
  v_hub uuid;
  v_error text;
begin
  insert into public.leagues (format, scope, name, capacity) values ('11-a-side', 'UT Village', 'UT Village 11s', 8)
  returning id into v_hub;
  v_error := tests.error_of(format($q$
    insert into public.leagues (format, scope, name, capacity, parent_league_id)
    values ('11-a-side', 'UT Village', 'Division 1', 0, %L)
  $q$, v_hub));
  assert v_error is null, 'a child row with the hub''s format and scope is allowed, got ' || coalesce(v_error, '');
end $$;

rollback;
