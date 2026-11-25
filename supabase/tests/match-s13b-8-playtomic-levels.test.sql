-- S13B: levels like Playtomic (decided by Panos 25 November; match-record.md
-- decision 1l item 11, spec 05 section 4 items 2, 5 and 6).
--   * Every game is Competitive by default. Before kickoff the booker (in a
--     named game either captain) can switch it to Friendly; it locks at
--     kickoff. A Friendly game never moves levels.
--   * A pickup's score (one captain) is checked by the players who played on
--     the side the booker isn't on (everyone who played but him, if he
--     didn't): "Check the score", Accept or Reject. The first answer settles
--     it; no answer in 24 hours counts as accepted; an accepted score is
--     locked. A Reject tells the booker; his correction sends the card
--     again and restarts the 24 hours; still rejected when his window ends:
--     no level moves (stats and ratings stay).
--   * Levels move only when both sides have a Futty player who played (a
--     profile, not a guest, not "Didn't play"); otherwise no card either.
--   * Levels still run once, when the game is final (decided by Anghelo 25
--     November): an Accept settles the score but doesn't move them sooner.
begin;

-- s13b_match with nobody checked in yet (the captain's log ticks them in).
create function tests.pt_match(p_a integer, p_b integer, p_pickup boolean default true,
                               out match uuid, out cap_a uuid, out cap_b uuid, out a uuid[], out b uuid[])
language plpgsql
as $$
declare
  g record := tests.s13b_match(p_a, p_b, p_pickup);
begin
  match := g.match; cap_a := g.cap_a; cap_b := g.cap_b; a := g.a; b := g.b;
  delete from public.match_attendance where match_attendance.match_id = g.match;
end;
$$;

-- One side's stats listing p_profiles: p_goals each, played false for p_out.
create function tests.pt_side(p_match uuid, p_profiles uuid[], p_goals integer[], p_out uuid[] default '{}',
                              p_own integer default 0)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'players', coalesce(jsonb_agg(jsonb_build_object(
                 'playerId', tests.player_id(p_match, x.profile),
                 'goals', x.goals,
                 'assists', 0,
                 'played', not (x.profile = any (p_out))) order by x.n), '[]'),
    'ownGoals', p_own)
  from unnest(p_profiles, p_goals) with ordinality x(profile, goals, n);
$$;

-- respond_to_match_score as p_user.
create function tests.pt_answer(p_user uuid, p_match uuid, p_accept boolean)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  v := public.respond_to_match_score(p_match, p_accept);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.pt_answer_error(p_user uuid, p_match uuid, p_accept boolean)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.respond_to_match_score(%L, %L)', p_match, p_accept));
$$;

create function tests.pt_switch_error(p_user uuid, p_match uuid, p_competitive boolean)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.set_match_competitive(%L, %L::boolean)', p_match, p_competitive));
$$;

create function tests.pt_correct_error(p_user uuid, p_match uuid, p_stats jsonb, p_a integer, p_b integer)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.set_match_stats(%L, %L, %s, %s)', p_match, p_stats, p_a, p_b));
$$;

-- The game is final: confirmed 25 hours ago, deadline passed. The card's
-- 24 hours are moved only when p_card_too.
create function tests.pt_final(p_match uuid, p_card_too boolean default false)
returns void
language sql
as $$
  update public.matches
  set confirmed_at = now() - interval '25 hours', result_deadline_at = now() - interval '1 hour',
      score_check_since = case when p_card_too then score_check_since - interval '25 hours' else score_check_since end
  where id = p_match;
$$;

create function tests.pt_history(p_match uuid)
returns integer
language sql
stable
as $$
  select count(*)::integer from public.player_level_history where match_id = p_match;
$$;

create function tests.pt_result_level(p_match uuid, p_profile uuid)
returns numeric
language sql
stable
as $$
  select level_after from public.player_level_history
  where match_id = p_match and profile_id = p_profile and reason = 'result';
$$;

create function tests.pt_cards(p_user uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  v := public.get_my_scores_to_check();
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- 1. Competitive by default, pickups included.
do $$
declare
  p record := tests.s13b_match(2, 2);
  n record := tests.s13b_match(2, 2, false);
begin
  assert (select competitive and is_competitive from public.matches where id = p.match), 'a new pickup is competitive';
  assert (select competitive and is_competitive from public.matches where id = n.match), 'a new named game is competitive';
end $$;

-- 2. Switching to Friendly: the booker (either captain in a named game),
-- before kickoff only; nobody else; never null.
do $$
declare
  p record := tests.s13b_match(2, 2);
  n record := tests.s13b_match(2, 2, false);
begin
  update public.matches
  set status = 'scheduled', kickoff_at = now() + interval '1 day', ends_at = now() + interval '1 day 1 hour',
      result_deadline_at = now() + interval '2 days 1 hour'
  where id in (p.match, n.match);

  assert tests.pt_switch_error(p.a[2], p.match, false) = 'not_captain', 'a player on the booker''s side';
  assert tests.pt_switch_error(p.b[1], p.match, false) = 'not_captain', 'a player on the other side';
  assert tests.pt_switch_error(p.cap_a, p.match, null) = 'invalid_answer', 'null is refused';
  assert tests.pt_switch_error(p.cap_a, p.match, false) is null, 'the booker switches to Friendly';
  assert not (select is_competitive from public.matches where id = p.match), 'Friendly';
  assert tests.pt_switch_error(p.cap_a, p.match, true) is null, 'and back';

  assert tests.pt_switch_error(n.cap_b, n.match, false) is null, 'side b''s captain in a named game';
  assert not (select is_competitive from public.matches where id = n.match), 'named: Friendly';
  assert tests.pt_switch_error(n.cap_a, n.match, true) is null, 'side a''s captain in a named game';
  assert tests.pt_switch_error(n.a[2], n.match, false) = 'not_captain', 'a named game''s player';

  update public.matches set kickoff_at = now() - interval '1 minute' where id in (p.match, n.match);
  assert tests.pt_switch_error(p.cap_a, p.match, false) = 'competitive_locked', 'locked at kickoff';
  assert tests.pt_switch_error(n.cap_b, n.match, false) = 'competitive_locked', 'locked at kickoff (named)';
  assert (select is_competitive from public.matches where id = p.match), 'still Competitive';
end $$;

-- 3. Friendly never moves levels, and sends no card.
do $$
declare
  g record := tests.s13b_match(2, 2);
begin
  update public.matches set competitive = false where id = g.match;
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0]), 'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  assert (select score_check from public.matches where id = g.match) is null, 'no card';
  assert tests.notified(g.b[1], 'match_score_check', g.match) = 0, 'no push';
  perform tests.pt_final(g.match);
  assert tests.apply_levels(g.match) = 'skipped', 'Friendly: skipped';
  assert tests.pt_history(g.match) = 0, 'no level moved';
  assert tests.s13b_rating(g.match, g.a[1]) is not null, 'ratings stay';
end $$;

-- 4. A pickup accepted: the other side's players get the card; an Accept
-- settles the score (locked) but levels wait until the game is final.
do $$
declare
  g record := tests.s13b_match(3, 2);
  v jsonb;
  v_page jsonb;
begin
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0, 0]), 'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  assert (select score_check from public.matches where id = g.match) = 'pending', 'the card is open';
  assert tests.notified(g.b[1], 'match_score_check', g.match) = 1, 'b1 told';
  assert tests.notified(g.b[2], 'match_score_check', g.match) = 1, 'b2 told';
  assert tests.notified(g.a[2], 'match_score_check', g.match) = 0, 'not the booker''s side';
  assert tests.notified(g.cap_a, 'match_score_check', g.match) = 0, 'not the booker';
  assert (select title from public.notifications where profile_id = g.b[1] and type = 'match_score_check') = 'Check the score',
    'its title';

  v := tests.pt_cards(g.b[1]);
  assert jsonb_array_length(v) = 1 and v -> 0 ->> 'matchId' = g.match::text, format('b1''s Home card: %s', v);
  assert (v -> 0 ->> 'sideAScore')::integer = 2 and (v -> 0 ->> 'sideBScore')::integer = 1, 'with the score';
  assert jsonb_array_length(tests.pt_cards(g.a[2])) = 0, 'no Home card on the booker''s side';
  assert jsonb_array_length(tests.pt_cards(g.cap_a)) = 0, 'no Home card for the booker';
  v_page := tests.page_as(g.b[1], g.match);
  assert (v_page -> 'scoreCheck' ->> 'canAnswer')::boolean, format('b1 can answer on the page: %s', v_page -> 'scoreCheck');
  assert v_page -> 'scoreCheck' ->> 'state' = 'pending', 'pending on the page';
  assert not (tests.page_as(g.a[2], g.match) -> 'scoreCheck' ->> 'canAnswer')::boolean, 'a2 can''t answer';

  v := tests.pt_answer(g.b[1], g.match, true);
  assert v ->> 'status' = 'accepted' and not (v ->> 'ignored')::boolean, format('accepted: %s', v);
  assert (select (score_check, score_check_by) from public.matches where id = g.match) = ('accepted'::text, g.b[1]),
    'accepted by b1';
  assert jsonb_array_length(tests.pt_cards(g.b[2])) = 0, 'the card closes for everyone';

  assert tests.apply_levels(g.match) = 'not_yet', 'levels wait until the game is final';
  assert tests.pt_correct_error(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 1, 0])), 3, 1) = 'score_locked', 'an accepted score is locked';
  assert tests.pt_correct_error(g.cap_a, g.match, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[1, 1, 0])), 2, 1) is null, 'its stats can still change';

  perform tests.pt_final(g.match);
  assert tests.apply_levels(g.match) = 'applied', 'applied once final';
  assert tests.pt_result_level(g.match, g.a[1]) = 4.30, 'a win: 4.30';
  assert tests.pt_result_level(g.match, g.b[1]) = 3.70, 'a loss: 3.70';
end $$;

-- 5. No answer within 24 hours counts as accepted.
do $$
declare
  g record := tests.s13b_match(2, 2);
begin
  perform tests.s13b_log(g.cap_a, g.match, 1, 0, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[1, 0]), 'b', tests.s13b_side(g.match, g.b, array[0, 0])));
  perform tests.pt_final(g.match);
  update public.matches set score_check_since = now() - interval '23 hours' where id = g.match;
  assert tests.apply_levels(g.match) = 'not_yet', 'the card is still open';
  assert jsonb_array_length(tests.pt_cards(g.b[1])) = 1, 'still on Home';

  update public.matches set score_check_since = now() - interval '24 hours' where id = g.match;
  assert jsonb_array_length(tests.pt_cards(g.b[1])) = 0, 'gone from Home after 24 hours';
  assert (tests.pt_answer(g.b[1], g.match, false) ->> 'ignored')::boolean, 'a late Reject is ignored';
  assert tests.apply_levels(g.match) = 'applied', 'silence counts as accepted';
  assert (select (score_check, score_check_by) from public.matches where id = g.match) = ('accepted'::text, null::uuid),
    'accepted by silence';
  assert tests.pt_result_level(g.match, g.a[1]) = 4.30, 'the win counts';
end $$;

-- 6. Rejected, then corrected and accepted.
do $$
declare
  g record := tests.s13b_match(2, 2);
  v jsonb;
begin
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0]), 'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  v := tests.pt_answer(g.b[1], g.match, false);
  assert v ->> 'status' = 'rejected', format('rejected: %s', v);
  assert tests.notified(g.cap_a, 'match_score_rejected', g.match) = 1, 'the booker is told';
  assert (select (title, body) from public.notifications where profile_id = g.cap_a and type = 'match_score_rejected')
         = ('Your score was rejected'::text, 'Check it and fix it.'::text), 'its words';
  assert tests.notified(g.b[2], 'match_score_rejected', g.match) = 0, 'only the booker';
  assert (tests.pt_answer(g.b[2], g.match, true) ->> 'ignored')::boolean, 'a later Accept is ignored';
  assert (select score_check from public.matches where id = g.match) = 'rejected', 'still rejected';

  update public.matches set score_check_since = now() - interval '2 hours' where id = g.match;
  assert tests.pt_correct_error(g.cap_a, g.match, jsonb_build_object(
    'b', tests.s13b_side(g.match, g.b, array[1, 1])), 2, 2) is null, 'corrected to 2-2';
  assert (select (score_check, score_check_by, score_check_at) from public.matches where id = g.match)
         = ('pending'::text, null::uuid, null::timestamptz), 'the card is open again, answers cleared';
  assert (select score_check_since from public.matches where id = g.match) = now(), 'the 24 hours start again';
  assert tests.notified(g.b[1], 'match_score_check', g.match) = 2, 'sent again to b1';
  assert tests.notified(g.b[2], 'match_score_check', g.match) = 2, 'sent again to b2';

  assert tests.pt_answer(g.b[2], g.match, true) ->> 'status' = 'accepted', 'b2 accepts the new score';
  perform tests.pt_final(g.match);
  assert tests.apply_levels(g.match) = 'applied', 'applied';
  assert tests.pt_result_level(g.match, g.a[1]) = 4.00, 'the corrected draw: 4.00';
end $$;

-- 7. Rejected and never fixed: no level moves; stats and ratings stay.
do $$
declare
  g record := tests.s13b_match(2, 2);
begin
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0]), 'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  perform tests.pt_answer(g.b[1], g.match, false);
  update public.matches set confirmed_at = now() - interval '23 hours', result_deadline_at = now() - interval '1 hour'
  where id = g.match;
  assert tests.apply_levels(g.match) = 'not_yet', 'the booker can still fix it';
  perform tests.pt_final(g.match, true);
  assert tests.apply_levels(g.match) = 'skipped', 'still rejected when his window ends';
  assert tests.pt_history(g.match) = 0, 'no level moved';
  assert tests.s13b_rating(g.match, g.a[1]) is not null and tests.s13b_rating(g.match, g.b[1]) is not null, 'ratings stay';
  assert (select count(*) from public.match_goals where match_id = g.match) = 3, 'stats stay';
  assert (select (side_a_score, side_b_score, status) from public.matches where id = g.match) = (2, 1, 'confirmed'::text),
    'the score stays';
end $$;

-- 8. The first answer wins: an Accept, then a Reject.
do $$
declare
  g record := tests.s13b_match(2, 2);
  v jsonb;
begin
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0]), 'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  perform tests.pt_answer(g.b[1], g.match, true);
  v := tests.pt_answer(g.b[2], g.match, false);
  assert (v ->> 'ignored')::boolean and v ->> 'status' = 'accepted', format('Reject ignored: %s', v);
  assert (select (score_check, score_check_by) from public.matches where id = g.match) = ('accepted'::text, g.b[1]),
    'still b1''s Accept';
  assert tests.notified(g.cap_a, 'match_score_rejected', g.match) = 0, 'the booker isn''t told';
end $$;

-- 9. Who can't answer: the booker's side, the booker, a "Didn't play"
-- player and anyone outside the match.
do $$
declare
  g record := tests.pt_match(2, 3);
  v_outsider uuid := tests.create_user('pt-outsider@futty.test');
begin
  perform tests.s13b_log(g.cap_a, g.match, 1, 1, jsonb_build_object(
    'a', tests.pt_side(g.match, g.a, array[1, 0]), 'b', tests.pt_side(g.match, g.b, array[1, 0, 0], array[g.b[3]])));
  assert tests.pt_answer_error(g.a[2], g.match, false) = 'cannot_check_score', 'the booker''s side';
  assert tests.pt_answer_error(g.cap_a, g.match, true) = 'cannot_check_score', 'the booker';
  assert tests.pt_answer_error(g.b[3], g.match, false) = 'cannot_check_score', 'a "Didn''t play" player';
  assert tests.pt_answer_error(v_outsider, g.match, true) = 'not_in_match', 'outside the match';
  assert tests.notified(g.b[3], 'match_score_check', g.match) = 0, 'no push for "Didn''t play"';
  assert jsonb_array_length(tests.pt_cards(g.b[3])) = 0, 'no Home card for "Didn''t play"';
  assert (select score_check from public.matches where id = g.match) = 'pending', 'still open';
  assert tests.pt_answer(g.b[2], g.match, true) ->> 'status' = 'accepted', 'b2 played: can answer';
end $$;

-- 10. The booker didn't play: everyone who played but him gets the card.
do $$
declare
  g record := tests.pt_match(3, 2);
begin
  perform tests.s13b_log(g.cap_a, g.match, 1, 1, jsonb_build_object(
    'a', tests.pt_side(g.match, g.a, array[0, 1, 0], array[g.cap_a]), 'b', tests.pt_side(g.match, g.b, array[1, 0])));
  assert tests.notified(g.a[2], 'match_score_check', g.match) = 1, 'his side too';
  assert tests.notified(g.b[1], 'match_score_check', g.match) = 1, 'the other side';
  assert tests.notified(g.cap_a, 'match_score_check', g.match) = 0, 'not the booker';
  assert tests.pt_answer_error(g.cap_a, g.match, true) = 'cannot_check_score', 'the booker can''t answer';
  assert tests.pt_answer(g.a[3], g.match, true) ->> 'status' = 'accepted', 'a player on his side answers';
end $$;

-- 11. Both sides need a Futty player who played.
-- One side only guests: no card, no level change, ratings stay.
do $$
declare
  g record := tests.s13b_match(2, 0);
begin
  perform tests.guest_player(g.match, 'b', 'Guest one');
  perform tests.guest_player(g.match, 'b', 'Guest two');
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0]), 'b', jsonb_build_object('players', '[]'::jsonb, 'ownGoals', 1)));
  assert (select score_check from public.matches where id = g.match) is null, 'guests only: no card';
  perform tests.pt_final(g.match);
  assert tests.apply_levels(g.match) = 'skipped', 'guests only: skipped';
  assert tests.pt_history(g.match) = 0, 'guests only: no level moved';
  assert tests.s13b_rating(g.match, g.a[1]) is not null, 'guests only: ratings stay';
end $$;

-- One side's only Futty player marked "Didn't play": no level change.
do $$
declare
  g record := tests.pt_match(2, 1);
begin
  perform tests.guest_player(g.match, 'b', 'Guest');
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.pt_side(g.match, g.a, array[2, 0]), 'b', tests.pt_side(g.match, g.b, array[0], array[g.b[1]], 1)));
  assert (select score_check from public.matches where id = g.match) is null, '"Didn''t play": no card';
  assert tests.notified(g.b[1], 'match_score_check', g.match) = 0, '"Didn''t play": no push';
  perform tests.pt_final(g.match);
  assert tests.apply_levels(g.match) = 'skipped', '"Didn''t play": skipped';
  assert tests.pt_history(g.match) = 0, '"Didn''t play": no level moved';
  assert tests.s13b_rating(g.match, g.a[1]) is not null, '"Didn''t play": ratings stay';
end $$;

-- Both sides with a Futty player (and a guest): levels move as normal.
do $$
declare
  g record := tests.s13b_match(2, 1);
begin
  perform tests.guest_player(g.match, 'b', 'Guest');
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0]), 'b', tests.s13b_side(g.match, g.b, array[0], null, 1)));
  assert tests.pt_answer(g.b[1], g.match, true) ->> 'status' = 'accepted', 'b1 accepts';
  perform tests.pt_final(g.match);
  assert tests.apply_levels(g.match) = 'applied', 'both sides: applied';
  assert tests.pt_result_level(g.match, g.a[1]) = 4.30, 'a1 wins';
  assert tests.pt_result_level(g.match, g.b[1]) = 3.70, 'b1 loses';
end $$;

-- 12. Named games are unchanged: no card; levels once final.
do $$
declare
  g record := tests.s13b_match(2, 2, false);
begin
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object('a', tests.s13b_side(g.match, g.a, array[2, 0])));
  perform tests.s13b_log(g.cap_b, g.match, 2, 1, jsonb_build_object('b', tests.s13b_side(g.match, g.b, array[1, 0])));
  assert (select (status, score_check) from public.matches where id = g.match) = ('confirmed'::text, null::text),
    'agreed, no card';
  perform tests.pt_final(g.match);
  assert tests.apply_levels(g.match) = 'applied', 'named: applied';
end $$;

select 'match S13B 8 (levels like Playtomic) passed' as result;

rollback;
