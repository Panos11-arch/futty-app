-- S13B: two captains' scores. The first matching pair confirms the match; a
-- pair that differs is a failed try (both captains told); after 3 failed
-- tries (app_rules.match_score_tries) the match is disputed. A captain who
-- changes his own side's score logs his side's goals again; changing only
-- the other side's keeps them. At the deadline a mismatch is disputed and a
-- single score stands. A disputed Losers pay game still settles 50/50
-- through the existing settlement.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

-- p_cap logs p_a:p_b; with p_stats his side's goals all go to p_scorer.
create function tests.s13b3_log(p_cap uuid, p_match uuid, p_side text, p_scorer uuid, p_a integer, p_b integer,
                                p_stats boolean default true)
returns jsonb
language sql
as $$
  select tests.s13b_log(p_cap, p_match, p_a, p_b,
    case when p_stats
         then jsonb_build_object(p_side, tests.s13b_side(p_match, array[p_scorer],
                                                         array[case p_side when 'a' then p_a else p_b end]))
         else '{}' end);
$$;

create function tests.s13b3_state(p_match uuid)
returns text
language sql
as $$ select status || '/' || score_tries from public.matches where id = p_match $$;

-- Matching on try 1.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
begin
  assert tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 2, 1) ->> 'status' = 'waiting', 'one score: waiting';
  assert tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 2, 1) ->> 'status' = 'confirmed', 'the same score';
  assert tests.s13b3_state(s.match) = 'confirmed/1', tests.s13b3_state(s.match);
  assert (select (side_a_score, side_b_score) from public.matches where id = s.match) = (2, 1), '2–1';
end $$;

-- Matching on try 2. The mismatch tells both captains. Captain a changes his
-- own side's score (4–1 → 5–1): he must log his side's goals again.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
  r jsonb;
begin
  perform tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 4, 1);
  r := tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 5, 1);
  assert r ->> 'status' = 'mismatch' and (r ->> 'tries')::integer = 1 and (r ->> 'maxTries')::integer = 3,
    format('try 1 differs (%s)', r);
  assert tests.notified(s.cap_a, 'match_score_mismatch', s.match) = 1
         and tests.notified(s.cap_b, 'match_score_mismatch', s.match) = 1, 'both captains are told';
  assert tests.notified(s.a[3], 'match_score_mismatch', s.match) = 0, 'players aren''t';

  -- After the mismatch each captain sees the other's score.
  perform tests.act_as(s.cap_a);
  assert public.get_match_log(s.match) -> 'theirEntry' = '{"a": 5, "b": 1}'::jsonb, 'he sees theirs';
  perform tests.act_as_postgres();

  assert tests.s13b_log_error(s.cap_a, s.match, 5, 1, '{}') = 'stats_required', 'his own side changed: goals again';
  assert tests.s13b_log_error(s.cap_a, s.match, 5, 1,
           jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[2]], array[4]))) = 'score_mismatch',
    'and they add up to 5';
  r := tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 5, 1);
  assert r ->> 'status' = 'confirmed', format('try 2 matches (%s)', r);
  assert tests.s13b3_state(s.match) = 'confirmed/2', tests.s13b3_state(s.match);
  assert public.match_side_goal_count(s.match, 'a') = 5, 'his extra scorer is logged';
end $$;

-- Matching on try 3. Changing only the other side's number keeps his goals.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
begin
  perform tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 2, 0);
  assert tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 3, 1) ->> 'status' = 'mismatch', 'try 1';
  assert tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 2, 2) ->> 'status' = 'mismatch', 'try 2';
  -- Unchanged numbers with new stats are no new try.
  assert (tests.s13b_log(s.cap_a, s.match, 2, 0,
            jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[3]], array[2])))) ->> 'tries' = '2',
    'only stats changed: still 2 tries';
  assert tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 2, 2, false) ->> 'status' = 'confirmed', 'try 3 matches; side a''s goals kept';
  assert tests.s13b3_state(s.match) = 'confirmed/3', tests.s13b3_state(s.match);
  assert (select scorer_player_id from public.match_goals where match_id = s.match and side = 'a' limit 1)
         = tests.player_id(s.match, s.a[3]), 'his goals as he last logged them';
end $$;

-- Three failed tries: disputed, both told; nothing more can be logged.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
  r jsonb;
begin
  perform tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 1, 0);
  assert tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 0, 1) ->> 'status' = 'mismatch', 'try 1';
  assert tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 1, 1, false) ->> 'status' = 'mismatch', 'try 2';
  r := tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 2, 1);
  assert r ->> 'status' = 'disputed', format('try 3 fails: disputed (%s)', r);
  assert tests.s13b3_state(s.match) = 'disputed/3', tests.s13b3_state(s.match);
  assert tests.notified(s.a[4], 'match_result_disputed', s.match) = 1, 'everyone is told';
  assert tests.s13b_log_error(s.cap_b, s.match, 2, 1, '{}') = 'result_window_closed', 'closed';
  assert not exists (select 1 from public.match_player_ratings where match_id = s.match), 'no ratings';
  assert (select response from public.match_result_submissions where match_id = s.match) = 'rejected',
    'the submission row says so (settlement view)';
end $$;

-- The deadline: a mismatch is disputed, a single score stands, none is no_result.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
  t record := tests.s13b_match(5, 5, false);
  u record := tests.s13b_match(5, 5, false);
  r jsonb;
begin
  perform tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 1, 0);
  perform tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 0, 0);
  perform tests.s13b3_log(t.cap_b, t.match, 'b', t.b[2], 0, 3);
  update public.matches set result_deadline_at = now() - interval '1 minute' where id in (s.match, t.match, u.match);
  perform tests.act_as_service_role();
  r := public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert tests.s13b3_state(s.match) = 'disputed/1', 'a mismatch at the deadline is disputed';
  assert (select (status, side_a_score, side_b_score, confirmed_via) from public.matches where id = t.match)
         = ('confirmed'::text, 0, 3, 'deadline'::text), 'one captain''s score stands';
  assert (select status from public.matches where id = u.match) = 'no_result', 'no score: no result';
  assert (r ->> 'disputed')::integer >= 1 and (r ->> 'confirmed')::integer >= 1, format('counts: %s', r);
  assert exists (select 1 from public.match_player_ratings where match_id = t.match), 'the confirmed one is rated';
end $$;

-- Losers pay: a dispute from the captains settles 50/50 through the
-- existing settlement (spec 13: captains disagree = split).
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_a uuid := tests.create_user('s13b3-lp-a-' || gen_random_uuid() || '@futty.test');
  v_b uuid := tests.create_user('s13b3-lp-b-' || gen_random_uuid() || '@futty.test');
  v public.venue_bookings;
  v_post public.squad_posts;
  r jsonb;
  s record;
begin
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(v_a);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all',
                        p_kind => 'half', p_losers_pay => true);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v.id, v_a)).id, 'pi_s13b3_a_' || gen_random_uuid());
  perform tests.act_as(v_a);
  v_post := public.publish_booking(v.id, 'opposition');
  perform tests.act_as(v_b);
  r := public.accept_opposition_post(v_post.id, 'pay_all', p_losers_pay => true);
  perform tests.act_as_postgres();
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_s13b3_b_' || gen_random_uuid());

  select m.id as match, v_a as cap_a, v_b as cap_b, array[v_a, v_a] as a, array[v_b, v_b] as b into s
  from public.matches m where m.booking_id = v.id;
  assert (select kind from public.matches where id = s.match) = 'named', 'two captains: a named game';
  update public.matches
  set kickoff_at = now() - interval '2 hours', ends_at = now() - interval '1 hour', status = 'played',
      result_deadline_at = now() + interval '23 hours'
  where id = s.match;

  perform tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 1, 0);
  perform tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 0, 1);
  perform tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 1, 1, false);
  perform tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 2, 1);
  assert (select status from public.matches where id = s.match) = 'disputed', 'disputed after 3 tries';

  assert public.losers_pay_settle_from_results() = 2, 'both holds settle';
  assert (select array_agg(g.reason order by g.profile_id = v_a) from public.gipedo_settlements g
          where g.booking_id = v.id and g.guarantee_id is null) = array['split', 'split'], 'a dispute: half each';
  assert (select array_agg(g.capture_cents) from public.gipedo_settlements g where g.booking_id = v.id) = array[2275, 2275],
    'half of each €45.50 hold';
end $$;

-- The number of tries is a rule.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
begin
  update public.app_rules set match_score_tries = 1 where id;
  perform tests.s13b3_log(s.cap_a, s.match, 'a', s.a[2], 1, 0);
  assert tests.s13b3_log(s.cap_b, s.match, 'b', s.b[2], 0, 1) ->> 'status' = 'disputed', 'one try only';
  update public.app_rules set match_score_tries = 3 where id;
end $$;

rollback;
