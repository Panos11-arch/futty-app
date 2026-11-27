-- A deleted team (teams.deleted_at, S20A) is hidden from every power
-- ranking: the app-wide list, a team's place per format, and a
-- competition's or tournament's Power rankings tab. Nothing is replayed:
-- the other teams keep their points, history and order.
begin;

-- App-wide.
do $$
declare
  -- A Thursday; that week starts Monday 8 June 00:00 Cyprus time.
  v_now timestamptz := '2026-06-11 12:00 Asia/Nicosia';
  a uuid := tests.create_team('PR6 A');
  b uuid := tests.create_team('PR6 B');
  c uuid := tests.create_team('PR6 C');
  d uuid := tests.create_team('PR6 D');
  v_ids uuid[];
  v_ranks integer[];
  v_points numeric[];
  v_after_points numeric[];
  v_history integer;
  v_row record;
begin
  -- Last week, a round robin: A beats everyone, B beats C and D, C beats D.
  perform tests.pr_match(a, b, 2, 0, '2026-06-01 20:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_match(c, d, 2, 0, '2026-06-01 21:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_match(a, c, 2, 0, '2026-06-02 20:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_match(b, d, 2, 0, '2026-06-02 21:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_match(a, d, 2, 0, '2026-06-03 20:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_match(b, c, 2, 0, '2026-06-03 21:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_tick(v_now);

  select array_agg(l.team_id order by l.rank) into v_ids from public.power_ranking_list('6-a-side', v_now) l;
  assert v_ids = array[a, b, c, d], format('before: %s', v_ids);
  v_points := array[tests.pr_points(a, '6-a-side'), tests.pr_points(c, '6-a-side'), tests.pr_points(d, '6-a-side')];
  select count(*) into v_history from public.power_ranking_history;

  update public.teams set deleted_at = v_now where id = b;
  perform tests.pr_tick(v_now);

  select array_agg(l.team_id order by l.rank), array_agg(l.rank order by l.rank),
         array_agg(l.points order by l.rank)
    into v_ids, v_ranks, v_after_points
  from public.power_ranking_list('6-a-side', v_now) l;
  assert v_ids = array[a, c, d], format('B hidden, the others in the same order: %s', v_ids);
  assert v_ranks = array[1, 2, 3], format('ranks close up: %s', v_ranks);
  assert v_after_points = v_points, format('the list shows the same points: %s, was %s', v_after_points, v_points);
  assert array[tests.pr_points(a, '6-a-side'), tests.pr_points(c, '6-a-side'), tests.pr_points(d, '6-a-side')]
         = v_points, 'no team''s points change';
  assert (select count(*) from public.power_ranking_history) = v_history, 'history kept, nothing replayed';
  assert exists (select 1 from public.power_ranking_history h where h.team_id = b),
    'the deleted team''s own history stays';

  for v_row in select * from public.power_ranking_list('6-a-side', v_now) loop
    assert v_row.rank_change = 0, format('no move since Monday from the hidden team: %s', v_row);
  end loop;

  assert not exists (select 1 from public.team_power_ranking(b, v_now)), 'no place on the deleted team''s profile';
  assert (select t.rank from public.team_power_ranking(c, v_now) t where t.format = '6-a-side') = 2,
    'C moves up one place';
end $$;

-- A competition's (and so a tournament's) Power rankings tab.
do $$
declare
  t_a uuid := tests.s10_team('PR6 S A', tests.create_user('pr6-s-a@futty.test'));
  t_b uuid := tests.s10_team('PR6 S B', tests.create_user('pr6-s-b@futty.test'));
  t_c uuid := tests.s10_team('PR6 S C', tests.create_user('pr6-s-c@futty.test'));
  viewer uuid := tests.create_user('pr6-s-viewer@futty.test');
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_a, t_b, t_c]);
  v_today date := tests.cyprus_today();
  v_f uuid;
  v_before uuid[];
  v_after uuid[];
  v_points numeric[];
begin
  -- A beats B, B beats C.
  v_f := tests.s10_fixture(v_season, t_a, t_b);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_a then
    perform tests.s10_score(v_f, 1, 0, v_today - 1);
  else
    perform tests.s10_score(v_f, 0, 1, v_today - 1);
  end if;
  v_f := tests.s10_fixture(v_season, t_b, t_c);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_b then
    perform tests.s10_score(v_f, 1, 0, v_today - 1);
  else
    perform tests.s10_score(v_f, 0, 1, v_today - 1);
  end if;
  perform tests.pr_tick(now());

  perform tests.act_as(viewer);
  select array_agg(r.team_id order by r."position") into v_before from public.get_competition_power_ranking(v_season) r;
  select array_agg(r.points order by r."position") into v_points
  from public.get_competition_power_ranking(v_season) r where r.team_id <> t_b;
  perform tests.act_as_postgres();
  assert t_b = any (v_before), 'B listed before';

  -- Raw update: delete_team refuses while the season is running, so this
  -- stands for a finished season.
  update public.teams set deleted_at = now() where id = t_b;
  perform tests.pr_tick(now());

  perform tests.act_as(viewer);
  select array_agg(r.team_id order by r."position") into v_after from public.get_competition_power_ranking(v_season) r;
  assert v_after = array_remove(v_before, t_b), format('B hidden, order kept: %s, was %s', v_after, v_before);
  assert (select array_agg(r."position" order by r."position") from public.get_competition_power_ranking(v_season) r)
         = array[1, 2], 'positions close up';
  assert (select array_agg(r.points order by r."position") from public.get_competition_power_ranking(v_season) r)
         = v_points, 'the others keep their points';
  perform tests.act_as_postgres();
end $$;

rollback;
