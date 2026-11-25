-- S13B (decision 1l, decided by Anghelo 25 November): a lone captain (a
-- pickup he booked, or both sides his) can correct the score too, for 24
-- hours after confirmation, through set_match_stats with the new score. A
-- side whose score changed must have its goals redone so they add up. Two
-- captains' agreed score is final (score_locked); so is a Losers pay
-- match's, whose money settles from it (score_locked). The ratings are
-- recomputed; every player is told "Score corrected" once; levels, applied
-- after the window, use the corrected score.
begin;

-- set_match_stats with a score, as p_user: the error, or null.
create function tests.sc_correct(p_user uuid, p_match uuid, p_stats jsonb, p_a integer, p_b integer)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.set_match_stats(%L, %L, %s, %s)', p_match, p_stats, p_a, p_b));
$$;

-- 1. 4-1 becomes 5-1: the extra scorer is needed; ratings change; one
-- "Score corrected" per player; after 24 hours it's refused.
do $$
declare
  g record := tests.s13b_match(3, 2);
  v_before numeric;
  v_n public.notifications;
  v_p uuid;
begin
  perform tests.s13b_log(g.cap_a, g.match, 4, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[3, 1, 0]),
    'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  v_before := tests.s13b_rating(g.match, g.a[3]);

  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[3, 1, 0])), 5, 1) = 'score_mismatch', 'the extra goal needs a scorer';
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'b', tests.s13b_side(g.match, g.b, array[1, 0])), 5, 1) = 'stats_required', 'the changed side must be sent';
  assert (select (side_a_score, side_b_score) from public.matches where id = g.match) = (4, 1), 'still 4-1';

  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[3, 1, 1])), 5, 1) is null, '5-1 with the extra scorer';
  assert (select (side_a_score, side_b_score, status) from public.matches where id = g.match) = (5, 1, 'confirmed'::text),
    'now 5-1, still confirmed';
  assert (select count(*) from public.match_goals where match_id = g.match and side = 'b') = 1, 'side b''s stats stay';
  assert tests.s13b_rating(g.match, g.a[3]) = v_before + 0.8, format('the new scorer''s rating: %s', tests.s13b_rating(g.match, g.a[3]));

  foreach v_p in array g.a[2:3] || g.b loop
    assert (select count(*) from public.notifications
            where profile_id = v_p and type = 'match_result_confirmed' and title = 'Score corrected'
              and data ->> 'matchId' = g.match::text) = 1, 'told once';
  end loop;
  v_n := tests.last_notification(g.b[1], 'match_result_confirmed');
  assert v_n.title = 'Score corrected' and v_n.body = 'Bibs 5–1 Non-bibs', format('the new score: %s / %s', v_n.title, v_n.body);
  assert tests.notified(g.cap_a, 'match_result_confirmed', g.match) = 0, 'not the captain who corrected it';

  -- The same score again changes nothing and tells nobody.
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[3, 1, 1])), 5, 1) is null, 'same score';
  assert (select count(*) from public.notifications where profile_id = g.b[1] and title = 'Score corrected') = 1,
    'no second message';

  update public.matches set confirmed_at = now() - interval '24 hours' where id = g.match;
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[3, 1, 2])), 6, 1) = 'scorers_window_closed', 'after 24 hours';
end $$;

-- 2. Two captains: the agreed score is final.
do $$
declare
  g record := tests.s13b_match(2, 2, false);
begin
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object('a', tests.s13b_side(g.match, g.a, array[2, 0])));
  perform tests.s13b_log(g.cap_b, g.match, 2, 1, jsonb_build_object('b', tests.s13b_side(g.match, g.b, array[1, 0])));
  assert (select status from public.matches where id = g.match) = 'confirmed', 'agreed';
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 1])), 3, 1) = 'score_locked', 'two captains: score locked';
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[1, 1])), 2, 1) is null, 'his own side''s stats can still change';
end $$;

-- 3. Losers pay: the money settles from the score, so it can't change.
do $$
declare
  g record := tests.s13b_match(2, 1);
  v_booking public.venue_bookings := tests.booking_with_players(g.cap_a, tests.create_venue(), 'each_pays_own_spot', 0,
                                                                tests.next_weekday(3));
begin
  perform tests.act_as_postgres();
  update public.venue_bookings set losers_pay = true where id = v_booking.id;
  update public.matches set booking_id = v_booking.id where id = g.match;
  perform tests.s13b_log(g.cap_a, g.match, 1, 0, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[1, 0]), 'b', tests.s13b_side(g.match, g.b, array[0])));
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[1, 1])), 2, 0) = 'score_locked', 'Losers pay: score locked';
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[0, 1])), 1, 0) is null, 'its stats can still change';
end $$;

-- 4. Levels, applied after the window, use the corrected score: a 1-1 draw
-- corrected to a 2-1 win. Even sides at the default 4.0, first match:
-- E = 0.5, K = 0.60, so the winners go to 4.30 (a draw would leave 4.00).
do $$
declare
  g record := tests.s13b_match(2, 2);
begin
  update public.matches set competitive = true where id = g.match;
  perform tests.s13b_log(g.cap_a, g.match, 1, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[1, 0]), 'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  assert tests.sc_correct(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[1, 1])), 2, 1) is null, '2-1 now';
  update public.matches set confirmed_at = now() - interval '25 hours', result_deadline_at = now() - interval '1 hour'
  where id = g.match;
  assert tests.apply_levels(g.match) = 'applied', 'levels applied';
  assert (select level_after from public.player_level_history
          where profile_id = g.a[1] and match_id = g.match and reason = 'result') = 4.30, 'a win: 4.30';
  assert (select level_after from public.player_level_history
          where profile_id = g.b[1] and match_id = g.match and reason = 'result') = 3.70, 'a loss: 3.70';
end $$;

select 'match S13B 7 (a lone captain corrects the score) passed' as result;

rollback;
