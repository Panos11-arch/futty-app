-- S14b power ranking (match-record.md decision 1m): the list. A team is
-- listed after 3 counted games in that format and hidden after 60 days
-- without one (its points kept). ▲▼ is the change since Monday 00:00
-- Cyprus time. The history keeps a row per team per game for the breakdown.
begin;

do $$
declare
  -- A Thursday; that week starts Monday 8 June 00:00 Cyprus time.
  v_now timestamptz := '2026-06-11 12:00 Asia/Nicosia';
  a uuid := tests.create_team('PR4 A');
  b uuid := tests.create_team('PR4 B');
  c uuid := tests.create_team('PR4 C');
  d uuid := tests.create_team('PR4 D');
  e uuid := tests.create_team('PR4 E');
  f uuid := tests.create_team('PR4 F');
  v_ba uuid;
  v_list record;
  v_ids uuid[];
  v_hist record;
  i integer;
begin
  -- Last week: A beats D three times, B beats C three times.
  for i in 1..3 loop
    perform tests.pr_match(a, d, 2, 0, format('2026-06-0%s 20:00 Asia/Nicosia', i)::timestamptz, '6-a-side');
    perform tests.pr_match(b, c, 2, 0, format('2026-06-0%s 21:00 Asia/Nicosia', i)::timestamptz, '6-a-side');
  end loop;
  -- E and F: only two games.
  perform tests.pr_match(e, f, 1, 0, '2026-06-02 19:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_match(e, f, 1, 0, '2026-06-03 19:00 Asia/Nicosia', '6-a-side');
  -- This week: B beats A.
  v_ba := tests.pr_match(b, a, 1, 0, '2026-06-09 10:00 Asia/Nicosia', '6-a-side');

  perform tests.pr_tick(v_now);

  select array_agg(l.team_id order by l.rank) into v_ids from public.power_ranking_list('6-a-side', v_now) l;
  assert v_ids = array[b, a, c, d], format('order: %s', v_ids);
  assert not e = any (v_ids) and not f = any (v_ids), 'two games: not listed';

  select * into v_list from public.power_ranking_list('6-a-side', v_now) l where l.team_id = b;
  assert v_list.rank = 1 and v_list.rank_change = 1, format('B up one: %s', v_list);
  assert v_list.matches = 4 and v_list.team_name = 'PR4 B' and v_list.points = tests.pr_points(b, '6-a-side'),
    format('B: %s', v_list);
  assert v_list.last_results = array['W', 'W', 'W'], format('B form: %s', v_list.last_results);
  select * into v_list from public.power_ranking_list('6-a-side', v_now) l where l.team_id = a;
  assert v_list.rank = 2 and v_list.rank_change = -1, format('A down one: %s', v_list);
  assert v_list.last_results = array['L', 'W', 'W'], format('A form, latest first: %s', v_list.last_results);
  select * into v_list from public.power_ranking_list('6-a-side', v_now) l where l.team_id = c;
  assert v_list.rank_change = 0, 'C unchanged';

  -- A third game for E: listed, new to the list since Monday.
  perform tests.pr_match(e, f, 1, 0, '2026-06-09 19:00 Asia/Nicosia', '6-a-side');
  perform tests.pr_tick(v_now);
  select * into v_list from public.power_ranking_list('6-a-side', v_now) l where l.team_id = e;
  assert v_list.rank is not null and v_list.rank_change is null, format('E listed, new: %s', v_list);

  -- The breakdown: B's latest game first.
  select * into v_hist from public.get_power_ranking_history(b, '6-a-side', 2) h limit 1;
  assert v_hist.game_id = v_ba and v_hist.opponent_team_id = a and v_hist.opponent_name = 'PR4 A'
         and v_hist.category = 'non_league' and v_hist.result = 'W' and v_hist.goals_for = 1
         and v_hist.goals_against = 0 and v_hist.expected = 0.5
         and v_hist.points_after = v_hist.points_before + v_hist.change and v_hist.change = 10,
    format('B beat A as equals: %s', v_hist);
  assert (select count(*) from public.get_power_ranking_history(b, '6-a-side', 2)) = 2, 'limit';
  assert (select count(*) from public.power_ranking_history h where h.team_id = b and h.format = '6-a-side') = 4,
    'a row per game';
end $$;

-- Inactive after 60 days without a counted game: hidden, points kept,
-- back after the next game.
do $$
declare
  v_now timestamptz := '2026-06-11 12:00 Asia/Nicosia';
  g uuid := tests.create_team('PR4 G');
  h uuid := tests.create_team('PR4 H');
  v_points numeric;
  i integer;
begin
  for i in 1..3 loop
    perform tests.pr_match(g, h, 1, 0, format('2026-03-0%s 20:00 Asia/Nicosia', i)::timestamptz, '11-a-side');
  end loop;
  perform tests.pr_tick(v_now);
  v_points := tests.pr_points(g, '11-a-side');
  assert v_points > 1000, 'G has points';
  assert not exists (select 1 from public.power_ranking_list('11-a-side', v_now) l where l.team_id in (g, h)),
    '60 days without a game: hidden';
  assert exists (select 1 from public.power_ranking_list('11-a-side', '2026-04-29 12:00 Asia/Nicosia') l
                 where l.team_id = g),
    'within 60 days: listed';

  perform tests.pr_match(g, h, 0, 0, '2026-06-09 20:00 Asia/Nicosia', '11-a-side');
  perform tests.pr_tick(v_now);
  assert exists (select 1 from public.power_ranking_list('11-a-side', v_now) l where l.team_id = g and l.rank = 1),
    'back after a new game';
  assert (select h2.points_before from public.power_ranking_history h2
          where h2.team_id = g and h2.kickoff_at = '2026-06-09 20:00 Asia/Nicosia') = v_points,
    'from the points it kept';
end $$;

rollback;
