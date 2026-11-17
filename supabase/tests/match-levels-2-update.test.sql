-- A5a (docs/specs/match-record.md decision 1f, sections 4.8, 7): the level
-- update after a confirmed competitive match.
--   E = 1 / (1 + 10^((opp_avg - own_avg) / 2)), S = 1 / 0.5 / 0,
--   move = K * (S - E) * (1 - reliability / 200), K = 0.40 for the first 10
--   competitive matches then 0.20; reliability = min(100, 5 * matches);
--   provisional until 5. Only checked-in players count (1b.2). Casual,
--   forfeit, disputed, no_result and void never move levels. It runs once
--   both the ratings window (confirmed_at + 24h) and the check-in window
--   (result_deadline_at) have closed, and only once per match.
begin;

-- A match played 30 hours ago (window closed), with checked-in players on
-- each side. Named (competitive by default) when p_named.
create function tests.lv_game(p_a uuid[], p_b uuid[], p_score_a integer, p_score_b integer,
                              p_named boolean default true, p_status text default 'confirmed',
                              p_forfeit text default null)
returns uuid
language plpgsql
as $$
declare
  v_m uuid;
  v_p uuid;
begin
  if p_named then
    v_m := tests.form_match(now() - interval '30 hours', p_status, p_score_a, p_score_b,
                            tests.create_team('LV A ' || gen_random_uuid()), tests.create_team('LV B ' || gen_random_uuid()),
                            p_forfeit, case when p_forfeit is not null then 'no_show' end);
  else
    v_m := tests.form_match(now() - interval '30 hours', p_status, p_score_a, p_score_b,
                            p_forfeit_side => p_forfeit, p_forfeit_reason => case when p_forfeit is not null then 'no_show' end);
  end if;
  foreach v_p in array p_a loop
    perform tests.form_player(v_m, v_p, 'a', true, true);
  end loop;
  foreach v_p in array p_b loop
    perform tests.form_player(v_m, v_p, 'b', true, true);
  end loop;
  return v_m;
end;
$$;

-- n fresh users at level p_level with p_matches competitive matches.
create function tests.lv_users(p_label text, p_n integer, p_level numeric, p_matches integer default 0)
returns uuid[]
language plpgsql
as $$
declare
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  for i in 1..p_n loop
    v_id := tests.create_user(format('%s-%s-%s@futty.test', p_label, i, left(gen_random_uuid()::text, 6)));
    perform tests.set_level(v_id, p_level, p_matches);
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;

do $$
declare
  v_xp_before text := (select coalesce(sum(xp), 0)::text from public.profiles)
                   || '/' || (select coalesce(sum(xp), 0)::text from public.teams);
  a uuid[];
  b uuid[];
  a2 uuid[];
  b2 uuid[];
  v_m uuid;
  v_m2 uuid;
  v_row public.player_levels;
  v_x uuid;
  v_y uuid;
  v_z uuid;
  v_q uuid;
  v_left uuid;
  v_none uuid;
  v_unsided uuid;
  v_tick integer;
begin
  -- 1. A casual match changes nothing.
  a := tests.lv_users('lv2-cas-a', 2, 3.0);
  b := tests.lv_users('lv2-cas-b', 2, 3.0);
  v_m := tests.lv_game(a, b, 5, 0, p_named => false);
  assert not (select is_competitive from public.matches where id = v_m), 'a pickup is casual by default';
  assert tests.apply_levels(v_m) = 'skipped', 'casual: skipped';
  assert tests.level_of(a[1]) = 3.0 and tests.level_of(b[1]) = 3.0, 'casual: unchanged';
  assert (select competitive_matches from public.player_levels where profile_id = a[1]) = 0, 'casual: not counted';
  assert not exists (select 1 from public.player_level_history where match_id = v_m), 'casual: no history';
  assert (select levels_applied_at from public.matches where id = v_m) is not null, 'casual: done';

  -- 2. A forfeit, a disputed, a no_result and a void match change nothing.
  v_m := tests.lv_game(a, b, null, null, p_forfeit => 'b');
  assert tests.apply_levels(v_m) = 'skipped', 'forfeit: skipped';
  foreach v_m in array array[tests.lv_game(a, b, null, null, p_status => 'disputed'),
                             tests.lv_game(a, b, null, null, p_status => 'no_result'),
                             tests.lv_game(a, b, null, null, p_status => 'void')] loop
    assert tests.apply_levels(v_m) = 'skipped', 'final but not confirmed: skipped';
    assert not exists (select 1 from public.player_level_history where match_id = v_m), 'no history';
  end loop;
  assert tests.level_of(a[1]) = 3.0 and tests.level_of(b[2]) = 3.0, 'forfeit and the rest: unchanged';
  assert (select competitive_matches from public.player_levels where profile_id = b[1]) = 0, 'not counted';

  -- 3. Even sides, first match: the winners +0.20, the losers -0.20.
  a := tests.lv_users('lv2-even-a', 2, 3.0);
  b := tests.lv_users('lv2-even-b', 2, 3.0);
  v_m := tests.lv_game(a, b, 3, 1);
  assert (select is_competitive from public.matches where id = v_m), 'a named game is competitive by default';
  assert tests.apply_levels(v_m) = 'applied', 'applied';
  assert tests.level_of(a[1]) = 3.20 and tests.level_of(a[2]) = 3.20, format('winners 3.20, got %s', tests.level_of(a[1]));
  assert tests.level_of(b[1]) = 2.80 and tests.level_of(b[2]) = 2.80, format('losers 2.80, got %s', tests.level_of(b[1]));
  select * into v_row from public.player_levels where profile_id = a[1];
  assert v_row.competitive_matches = 1 and v_row.reliability_pct = 5 and v_row.provisional,
    format('one match, 5%%, provisional: %s', row_to_json(v_row));
  assert exists (select 1 from public.player_level_history
                 where profile_id = b[1] and match_id = v_m and reason = 'result'
                   and level_before = 3.00 and level_after = 2.80), 'history row';
  -- Running it twice changes nothing the second time.
  assert tests.apply_levels(v_m) = 'already', 'second run';
  assert tests.level_of(a[1]) = 3.20 and (select competitive_matches from public.player_levels where profile_id = a[1]) = 1,
    'second run: unchanged';
  assert (select count(*) from public.player_level_history where match_id = v_m) = 4, 'one row each';

  -- A draw between even sides: no move, but it counts.
  a := tests.lv_users('lv2-draw-a', 1, 3.0);
  b := tests.lv_users('lv2-draw-b', 1, 3.0);
  assert tests.apply_levels(tests.lv_game(a, b, 2, 2)) = 'applied', 'draw';
  assert tests.level_of(a[1]) = 3.00 and tests.level_of(b[1]) = 3.00, 'draw: no move';
  assert (select competitive_matches from public.player_levels where profile_id = a[1]) = 1, 'draw: counted';

  -- 4. An upset moves more than an expected result. Side a (2.0) v side b
  -- (3.0): E for a = 1 / (1 + 10^0.5) = 0.2403.
  a := tests.lv_users('lv2-up-a', 2, 2.0);
  b := tests.lv_users('lv2-up-b', 2, 3.0);
  assert tests.apply_levels(tests.lv_game(a, b, 4, 2)) = 'applied', 'upset';
  assert tests.level_of(a[1]) = 2.30, format('upset winner +0.30, got %s', tests.level_of(a[1]));
  assert tests.level_of(b[1]) = 2.70, format('upset loser -0.30, got %s', tests.level_of(b[1]));
  a2 := tests.lv_users('lv2-exp-a', 2, 2.0);
  b2 := tests.lv_users('lv2-exp-b', 2, 3.0);
  assert tests.apply_levels(tests.lv_game(a2, b2, 1, 4)) = 'applied', 'expected';
  assert tests.level_of(b2[1]) = 3.10, format('expected winner +0.10, got %s', tests.level_of(b2[1]));
  assert tests.level_of(a2[1]) = 1.90, format('expected loser -0.10, got %s', tests.level_of(a2[1]));
  assert tests.level_of(a[1]) - 2.0 > tests.level_of(b2[1]) - 3.0, 'the upset moved more';

  -- 5. Provisional until 5 competitive matches.
  v_x := (tests.lv_users('lv2-prov', 1, 3.0))[1];
  for i in 1..5 loop
    assert (select provisional from public.player_levels where profile_id = v_x), format('provisional before match %s', i);
    assert tests.apply_levels(tests.lv_game(array[v_x], tests.lv_users('lv2-prov-opp', 1, 3.0), 1, 1)) = 'applied', 'played';
  end loop;
  select * into v_row from public.player_levels where profile_id = v_x;
  assert not v_row.provisional and v_row.competitive_matches = 5 and v_row.reliability_pct = 25,
    format('not provisional after 5: %s', row_to_json(v_row));

  -- 6. Bigger moves in the first 10 matches. y: 9 before (K 0.40, 45%):
  -- 0.4 * 0.5 * 0.775 = 0.155. z: 10 before (K 0.20, 50%): 0.075.
  v_y := (tests.lv_users('lv2-k-y', 1, 3.0, 9))[1];
  v_z := (tests.lv_users('lv2-k-z', 1, 3.0, 10))[1];
  b := tests.lv_users('lv2-k-opp', 2, 3.0, 20);
  assert tests.apply_levels(tests.lv_game(array[v_y, v_z], b, 2, 0)) = 'applied', 'K';
  assert tests.level_of(v_y) = 3.16, format('9 before: +0.155, got %s', tests.level_of(v_y));
  assert tests.level_of(v_z) = 3.08, format('10 before: +0.075, got %s', tests.level_of(v_z));
  -- 100% reliability halves the move: 0.2 * 0.5 * 0.5.
  assert tests.level_of(b[1]) = 2.95, format('established loser -0.05, got %s', tests.level_of(b[1]));

  -- 7. Only checked-in players count, in the averages and in the moves.
  a := tests.lv_users('lv2-in-a', 1, 3.0);
  b := tests.lv_users('lv2-in-b', 1, 3.0);
  v_q := (tests.lv_users('lv2-in-q', 1, 7.0))[1];
  v_left := (tests.lv_users('lv2-in-left', 1, 3.0))[1];
  v_unsided := (tests.lv_users('lv2-in-unsided', 1, 3.0))[1];
  v_m := tests.lv_game(a, b, 1, 0);
  perform tests.form_player(v_m, v_q, 'a', true, false);
  perform tests.form_player(v_m, v_left, 'a', true, true, true);
  perform tests.form_player(v_m, v_unsided, null, true, true);
  perform tests.guest_player(v_m, 'b', 'Guest');
  assert tests.apply_levels(v_m) = 'applied', 'applied';
  assert tests.level_of(a[1]) = 3.20, format('the 7.0 not checked in is left out of the average, got %s', tests.level_of(a[1]));
  assert tests.level_of(v_q) = 7.0 and tests.level_of(v_left) = 3.0 and tests.level_of(v_unsided) = 3.0, 'not counted: unchanged';
  assert (select count(*) from public.player_level_history where match_id = v_m) = 2, 'two players counted';

  -- A side with nobody checked in: nothing moves.
  a := tests.lv_users('lv2-empty-a', 1, 3.0);
  v_m := tests.form_match(now() - interval '30 hours', 'confirmed', 2, 0,
                          tests.create_team('LV E1'), tests.create_team('LV E2'));
  perform tests.form_player(v_m, a[1], 'a', true, true);
  perform tests.form_player(v_m, (tests.lv_users('lv2-empty-b', 1, 3.0))[1], 'b', true, false);
  assert tests.apply_levels(v_m) = 'skipped', 'one side empty';
  assert tests.level_of(a[1]) = 3.0, 'unchanged';

  -- 8. Someone who never answered the questions starts at a default 3.0.
  v_none := tests.create_user('lv2-none@futty.test');
  assert tests.apply_levels(tests.lv_game(array[v_none], tests.lv_users('lv2-none-opp', 1, 3.0), 1, 0)) = 'applied', 'applied';
  select * into v_row from public.player_levels where profile_id = v_none;
  assert v_row.source = 'default' and v_row.level = 3.20 and v_row.competitive_matches = 1,
    format('default 3.0, then +0.20: %s', row_to_json(v_row));

  -- 9. Not before both windows have closed.
  a := tests.lv_users('lv2-early-a', 1, 3.0);
  b := tests.lv_users('lv2-early-b', 1, 3.0);
  v_m := tests.form_match(now() - interval '3 hours', 'confirmed', 1, 0, tests.create_team('LV W1'), tests.create_team('LV W2'));
  perform tests.form_player(v_m, a[1], 'a', true, true);
  perform tests.form_player(v_m, b[1], 'b', true, true);
  assert tests.apply_levels(v_m) = 'not_yet', 'ratings window open';
  -- confirmed_at + 24h has passed but result_deadline_at hasn't.
  update public.matches set confirmed_at = now() - interval '25 hours' where id = v_m;
  assert tests.apply_levels(v_m) = 'not_yet', 'check-in window open';
  assert (select levels_applied_at from public.matches where id = v_m) is null, 'not marked';
  v_m2 := tests.form_match(now() + interval '3 hours', 'scheduled');
  assert tests.apply_levels(v_m2) = 'not_yet', 'scheduled';
  assert tests.level_of(a[1]) = 3.0, 'unchanged';

  -- 10. The job: runs each match once, and only once its windows closed.
  update public.matches set result_deadline_at = now() - interval '1 second' where id = v_m;
  perform tests.act_as_service_role();
  v_tick := public.match_levels_tick();
  perform tests.act_as_postgres();
  assert v_tick = 1, format('one match due, got %s', v_tick);
  assert tests.level_of(a[1]) = 3.20, 'applied by the job';
  perform tests.act_as_service_role();
  v_tick := public.match_levels_tick();
  assert (public.match_jobs_tick() ->> 'levels')::integer = 0, 'match_jobs_tick runs it too';
  perform tests.act_as_postgres();
  assert v_tick = 0, 'second run: nothing';
  assert tests.level_of(a[1]) = 3.20, 'second run: unchanged';

  -- 11. XP is never touched.
  assert v_xp_before = (select coalesce(sum(xp), 0)::text from public.profiles)
                     || '/' || (select coalesce(sum(xp), 0)::text from public.teams), 'XP unchanged';
  assert not exists (select 1 from public.profiles where email like 'lv2-%' and xp <> 0), 'no XP for new players';
  assert not exists (select 1 from public.teams where name like 'LV %' and xp <> 0), 'no XP for new teams';
end $$;

rollback;
