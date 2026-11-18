-- A7a (docs/specs/match-record.md section 7, decision 1g.1): leaderboards
-- per venue and per city for a calendar year (stats_leaderboards).
--   Only players with stats_min_appearances() (5) or more appearances in that
--   venue or city count. A city is venues.city compared without case or
--   spaces. Ranks are shared on ties; the win-rate board breaks ties by
--   appearances.
begin;

do $$
declare
  v1 uuid := tests.create_venue();
  v2 uuid := tests.create_venue();
  v3 uuid := tests.create_venue();
  a uuid := tests.create_user('a7s3-a@futty.test');
  b uuid := tests.create_user('a7s3-b@futty.test');
  c uuid := tests.create_user('a7s3-c@futty.test');
  reader uuid := tests.create_user('a7s3-reader@futty.test');
  v_m uuid;
  i integer;
  v_row public.stats_leaderboards;
begin
  update public.venues set city = 'Nicosia' where id = v1;
  update public.venues set city = ' nicosia ' where id = v2;
  update public.venues set city = 'Limassol' where id = v3;

  -- a: 5 matches at v1, 4 won, 3 goals.
  for i in 1..5 loop
    v_m := tests.form_match(make_timestamptz(2026, 3, i, 18, 0, 0, 'UTC'), 'confirmed',
                            case when i <= 4 then 1 else 0 end, case when i <= 4 then 0 else 1 end, p_venue => v1);
    perform tests.form_player(v_m, a, 'a', true, true);
    if i <= 3 then
      insert into public.match_goals (match_id, side, sort, scorer_player_id, entered_by)
      values (v_m, 'a', 1, tests.player_id(v_m, a), a);
    end if;
  end loop;
  -- b: 3 matches at v1 and 2 at v2, all won, 3 goals.
  for i in 1..5 loop
    v_m := tests.form_match(make_timestamptz(2026, 4, i, 18, 0, 0, 'UTC'), 'confirmed', 2, 0,
                            p_venue => case when i <= 3 then v1 else v2 end);
    perform tests.form_player(v_m, b, 'a', true, true);
    if i <= 3 then
      insert into public.match_goals (match_id, side, sort, scorer_player_id, entered_by)
      values (v_m, 'a', 1, tests.player_id(v_m, b), b);
    end if;
  end loop;
  -- c: 4 matches at v1 and 1 at v3 (another city): not enough anywhere.
  for i in 1..5 loop
    v_m := tests.form_match(make_timestamptz(2026, 5, i, 18, 0, 0, 'UTC'), 'confirmed', 5, 0,
                            p_venue => case when i <= 4 then v1 else v3 end);
    perform tests.form_player(v_m, c, 'a', true, true);
  end loop;
  -- a's 5 matches in 2025 don't make a 2026 appearance.
  for i in 1..5 loop
    v_m := tests.form_match(make_timestamptz(2025, 3, i, 18, 0, 0, 'UTC'), 'confirmed', 1, 0, p_venue => v3);
    perform tests.form_player(v_m, a, 'a', true, true);
  end loop;

  perform tests.act_as(reader);
  assert public.stats_min_appearances() = 5, 'decision 1g.1: 5 appearances';

  -- v1: only a has 5 appearances there.
  assert (select array_agg(profile_id) from public.stats_leaderboards
          where scope = 'venue' and scope_key = v1::text and season_year = 2026) = array[a],
    'v1 2026: a only (b has 3, c has 4)';
  select * into v_row from public.stats_leaderboards
  where scope = 'venue' and scope_key = v1::text and season_year = 2026 and profile_id = a;
  assert (v_row.appearances, v_row.goals, v_row.won, v_row.win_pct, v_row.min_appearances) = (5, 3, 4, 80, 5),
    format('a at v1, got %s', v_row);
  assert v_row.scope_name = (select name from public.venues where id = v1), 'the venue''s name';

  -- Nicosia: a and b (b's 5 are across v1 and v2); tied on goals.
  assert (select count(*) from public.stats_leaderboards where scope = 'city' and scope_key = 'nicosia'
          and season_year = 2026) = 2, 'Nicosia 2026: a and b';
  select * into v_row from public.stats_leaderboards
  where scope = 'city' and scope_key = 'nicosia' and season_year = 2026 and profile_id = b;
  assert (v_row.goals_rank, v_row.win_rate_rank, v_row.win_pct) = (1, 1, 100), format('b: joint top scorer, best win rate, got %s', v_row);
  assert lower(v_row.scope_name) = 'nicosia', format('the city''s name, got %s', v_row.scope_name);
  select * into v_row from public.stats_leaderboards
  where scope = 'city' and scope_key = 'nicosia' and season_year = 2026 and profile_id = a;
  assert (v_row.goals_rank, v_row.win_rate_rank, v_row.motm_rank) = (1, 2, 1), format('a: joint top scorer, second on win rate, got %s', v_row);

  -- Limassol 2026: nobody; Limassol 2025: a.
  assert not exists (select 1 from public.stats_leaderboards where scope = 'city' and scope_key = 'limassol'
                     and season_year = 2026), 'Limassol 2026: c has 1';
  assert (select array_agg(profile_id) from public.stats_leaderboards where scope = 'city' and scope_key = 'limassol'
          and season_year = 2025) = array[a], 'Limassol 2025: a';
  perform tests.act_as_postgres();
end $$;

-- Ties on win rate go to more appearances.
do $$
declare
  v uuid := tests.create_venue();
  x uuid := tests.create_user('a7s3t-x@futty.test');
  y uuid := tests.create_user('a7s3t-y@futty.test');
  v_m uuid;
  i integer;
begin
  for i in 1..6 loop
    v_m := tests.form_match(make_timestamptz(2026, 6, i, 18, 0, 0, 'UTC'), 'confirmed', 1, 0, p_venue => v);
    perform tests.form_player(v_m, x, 'a', true, true);
    if i <= 5 then
      perform tests.form_player(v_m, y, 'a', true, true);
    end if;
  end loop;
  perform tests.act_as(x);
  assert (select array_agg(profile_id order by win_rate_rank) from public.stats_leaderboards
          where scope = 'venue' and scope_key = v::text and season_year = 2026) = array[x, y],
    'both 100%: x (6 appearances) ahead of y (5)';
  perform tests.act_as_postgres();
end $$;

rollback;
