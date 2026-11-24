-- A2 (docs/specs/match-record.md sections 3 and 5.2, decision 3), as
-- changed by S13B: only a captain logs the score (log_match_result). In a
-- pickup the booker is the only captain and his score is final; in a named
-- game the first matching pair of captains' scores confirms it. A single
-- captain's score stands at the deadline (exactly at the deadline counts as
-- past it); nothing logged by the deadline is no_result. The mismatch rules
-- are in match-s13b-3-mismatch.
begin;

create function tests.mr_booking(p_others integer, p_kickoff timestamptz, p_label text default 'mr')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booker uuid := tests.create_user(format('%s-booker-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)));
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings;
begin
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', p_others, tests.next_weekday(3),
                                          '12:00', '13:00', p_label);
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, p_kickoff);
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id returning * into v_booking;
  return v_booking;
end;
$$;

create function tests.mr_create(p_booking uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.act_as_service_role();
  v_id := public.create_match_for_booking(p_booking);
  perform tests.act_as_postgres();
  return v_id;
end;
$$;

-- Runs p_sql as p_user and returns the error it raised (null = none).
create function tests.mr_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  perform tests.act_as(p_user);
  v_error := tests.error_of(p_sql);
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

create function tests.mr_tick()
returns jsonb
language plpgsql
as $$
declare
  v_counts jsonb;
begin
  perform tests.act_as_service_role();
  v_counts := public.match_jobs_tick();
  perform tests.act_as_postgres();
  return v_counts;
end;
$$;

create function tests.mr_notified(p_profile uuid, p_type text, p_match uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.notifications
  where profile_id = p_profile and type = p_type and data ->> 'matchId' = p_match::text;
$$;

-- 1. Pickup: only the booker logs; his score is final.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(3, now() - interval '1 hour', 'mr2a');
  v_match uuid := tests.mr_create(v_booking.id);
  v_booker uuid := v_booking.created_by;
  v_bibs uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_non_bibs uuid := (tests.player(v_booking.id, 2)).profile_id;
  v_row public.matches;
begin
  assert tests.mr_as(v_bibs, format('select public.choose_match_side(%L, %L)', v_match, 'a')) is null, 'pick Bibs';
  assert tests.mr_as(v_non_bibs, format('select public.choose_match_side(%L, %L)', v_match, 'b')) is null, 'pick Non-bibs';

  assert tests.mr_as(v_bibs, format('select public.log_match_result(%L, 5, 3, %L)', v_match, '{}')) = 'not_captain',
    'a Bibs player who isn''t the booker can''t log';
  assert tests.mr_as(v_non_bibs, format('select public.log_match_result(%L, 5, 3, %L)', v_match, '{}')) = 'not_captain',
    'nobody logs for Non-bibs in a pickup game';
  assert tests.mr_as(v_booker, format('select public.log_match_result(%L, -1, 3, %L)', v_match, '{}')) = 'invalid_score',
    'a negative score is refused';
  assert tests.mr_as(v_booker, format('select public.log_match_result(%L, 5, null, %L)', v_match, '{}')) = 'invalid_score',
    'a missing score is refused';

  assert tests.log_result(v_booker, v_match, 5, 3) ->> 'status' = 'confirmed', 'the booker logs';
  select * into v_row from public.matches where id = v_match;
  assert v_row.status = 'confirmed', 'final at once';
  assert v_row.confirmed_via = 'agreed', 'confirmed_via agreed';
  assert v_row.confirmed_at = now(), 'confirmed now';
  assert v_row.side_a_score = 5 and v_row.side_b_score = 3, 'his score';
  assert (select response from public.match_result_submissions where match_id = v_match) = 'accepted', 'response recorded';
  assert tests.mr_as(v_booker, format('select public.log_match_result(%L, 6, 3, %L)', v_match, '{}')) = 'result_window_closed',
    'final: no second score';
  assert tests.mr_notified(v_non_bibs, 'match_result_confirmed', v_match) = 1, 'Non-bibs is told';
  assert tests.mr_notified(v_bibs, 'match_result_confirmed', v_match) = 1, 'Bibs is told';
  assert tests.mr_notified(v_booker, 'match_result_confirmed', v_match) = 0, 'the booker isn''t told his own score';
  perform tests.mr_tick();
  assert (select status from public.matches where id = v_match) = 'confirmed', 'the tick leaves it alone';
end $$;

-- 2. A single captain's score stands at exactly ends_at + 24h.
do $$
declare
  -- Ends exactly 24 hours ago (30-minute bookings): the deadline is now.
  v_due public.venue_bookings := tests.mr_booking(1, now() - interval '24 hours 30 minutes', 'mr2c');
  v_due_match uuid := tests.mr_create(v_due.id);
  -- Ends 24 hours ago less one second: the deadline is one second away.
  v_early public.venue_bookings := tests.mr_booking(1, now() - interval '24 hours 30 minutes' + interval '1 second', 'mr2d');
  v_early_match uuid := tests.mr_create(v_early.id);
  v_row public.matches;
begin
  assert (select result_deadline_at from public.matches where id = v_due_match) = now(), 'deadline is now';
  assert tests.mr_as(v_due.created_by, format('select public.log_match_result(%L, 1, 0, %L)', v_due_match, '{}'))
         = 'result_window_closed', 'exactly at the deadline is past it';
  -- Logged earlier by one captain, before the deadline (as in a named game).
  insert into public.match_score_entries (match_id, side, entered_by, side_a_score, side_b_score, entered_at)
  values (v_due_match, 'a', v_due.created_by, 4, 1, now() - interval '20 hours');
  assert tests.log_result(v_early.created_by, v_early_match, 4, 1) ->> 'status' = 'confirmed',
    'one second before the deadline a result can still be logged';

  perform tests.mr_tick();
  select * into v_row from public.matches where id = v_due_match;
  assert v_row.status = 'confirmed', format('one captain: confirmed at the deadline, got %s', v_row.status);
  assert v_row.confirmed_via = 'deadline', 'confirmed_via deadline';
  assert v_row.confirmed_at = v_row.result_deadline_at, 'confirmed at the deadline';
  assert v_row.side_a_score = 4 and v_row.side_b_score = 1, 'his score stands';
  assert tests.mr_notified((tests.player(v_due.id, 1)).profile_id, 'match_result_confirmed', v_due_match) = 1, 'players are told';
end $$;

-- 3. Nothing logged by the deadline: no_result.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, now() - interval '24 hours 30 minutes', 'mr2e');
  v_match uuid := tests.mr_create(v_booking.id);
begin
  perform tests.mr_tick();
  assert (select status from public.matches where id = v_match) = 'no_result', 'nobody logged: no_result';
  assert (select confirmed_at from public.matches where id = v_match) is null, 'not confirmed';
end $$;

-- 4. Who can log, and when.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, now() - interval '1 hour', 'mr2f');
  v_match uuid := tests.mr_create(v_booking.id);
  v_future public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '1 day', 'mr2g');
  v_future_match uuid := tests.mr_create(v_future.id);
  v_outsider uuid := tests.create_user('mr2-outsider@futty.test');
  v_left public.booking_payment_shares := tests.player(v_booking.id, 1);
begin
  assert tests.mr_as(v_outsider, format('select public.log_match_result(%L, 1, 0, %L)', v_match, '{}')) = 'not_in_match',
    'a player who wasn''t in the match can''t log';
  assert tests.mr_as(v_future.created_by, format('select public.log_match_result(%L, 1, 0, %L)', v_future_match, '{}'))
         = 'result_window_closed', 'not before kickoff';
  assert tests.mr_as(v_booking.created_by, format('select public.log_match_result(%L, 1, 0, %L)', gen_random_uuid(), '{}'))
         = 'match_not_found', 'unknown match';
  update public.match_players set left_at = now() - interval '2 hours' where match_id = v_match and profile_id = v_left.profile_id;
  assert tests.mr_as(v_left.profile_id, format('select public.log_match_result(%L, 1, 0, %L)', v_match, '{}')) = 'not_in_match',
    'a player who left isn''t in the match';
end $$;

-- 5. Named game: each team's captain logs; their players can't. The same
--    score from both confirms it.
do $$
declare
  v_booker uuid := tests.create_user('mr2-named-booker@futty.test');
  v_away_captain uuid := tests.create_user('mr2-away-captain@futty.test');
  v_away_player uuid := tests.create_user('mr2-away-player@futty.test');
  v_home uuid;
  v_away uuid;
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings;
  v_post uuid;
  v_match uuid;
begin
  insert into public.teams (name) values ('Lions') returning id into v_home;
  insert into public.teams (name) values ('Tigers') returning id into v_away;
  insert into public.team_members (team_id, profile_id, role) values
    (v_home, v_booker, 'captain'), (v_away, v_away_captain, 'captain'), (v_away, v_away_player, 'player');
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.next_weekday(5));
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed', team_id = v_home where id = v_booking.id;
  perform public.add_booking_share_internal(v_booking.id, v_away_player);
  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id)
  values ('opposition', v_home, v_venue, v_booking.id, v_booker, v_away) returning id into v_post;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id) values (v_post, v_home, v_away);
  -- The friendly is agreed before kickoff, as in the app; then the game is played.
  perform tests.set_kickoff(v_booking.id, now() - interval '1 hour');
  v_match := tests.mr_create(v_booking.id);

  assert tests.mr_as(v_away_player, format('select public.log_match_result(%L, 0, 2, %L)', v_match, '{}')) = 'not_captain',
    'a player of side b isn''t its captain';
  assert tests.log_result(v_away_captain, v_match, 0, 2) ->> 'status' = 'waiting',
    'side b''s team captain logs, even without a spot';
  assert tests.mr_notified(v_booker, 'match_result_submitted', v_match) = 1, 'side a''s captain is asked to log';
  assert tests.log_result(v_booker, v_match, 0, 2) ->> 'status' = 'confirmed', 'the same score: confirmed';
  assert (select side_b_score from public.matches where id = v_match) = 2, 'score kept';
end $$;

select 'match record 2 (result: one captain, two captains, deadline) passed' as result;

rollback;
