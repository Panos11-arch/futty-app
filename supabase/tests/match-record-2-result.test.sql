-- A2 (docs/specs/match-record.md sections 3 and 5.2, decision 3, decision
-- 1a.5): one captain submits the score, the other side accepts or rejects
-- it; silence for 24 hours after the end confirms it (exactly at the
-- deadline counts as past it); no submission by the deadline is no_result.
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

-- 1. Pickup: the booker submits for Bibs, a Non-bibs player accepts.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(3, now() - interval '1 hour', 'mr2a');
  v_match uuid := tests.mr_create(v_booking.id);
  v_booker uuid := v_booking.created_by;
  v_bibs uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_non_bibs uuid := (tests.player(v_booking.id, 2)).profile_id;
  v_unsided uuid := (tests.player(v_booking.id, 3)).profile_id;
  v_row public.matches;
begin
  assert tests.mr_as(v_bibs, format('select public.choose_match_side(%L, %L)', v_match, 'a')) is null, 'pick Bibs';
  assert tests.mr_as(v_non_bibs, format('select public.choose_match_side(%L, %L)', v_match, 'b')) is null, 'pick Non-bibs';

  assert tests.mr_as(v_bibs, format('select public.submit_match_result(%L, 5, 3)', v_match)) = 'not_captain',
    'a Bibs player who isn''t the booker can''t submit';
  assert tests.mr_as(v_non_bibs, format('select public.submit_match_result(%L, 5, 3)', v_match)) = 'not_captain',
    'nobody submits for Non-bibs in a pickup game';
  assert tests.mr_as(v_booker, format('select public.submit_match_result(%L, -1, 3)', v_match)) = 'invalid_score',
    'a negative score is refused';
  assert tests.mr_as(v_booker, format('select public.submit_match_result(%L, 5, null)', v_match)) = 'invalid_score',
    'a missing score is refused';
  assert tests.mr_as(v_booker, format('select public.submit_match_result(%L, 5, 3)', v_match)) is null, 'the booker submits';
  assert tests.mr_as(v_booker, format('select public.submit_match_result(%L, 6, 3)', v_match)) = 'result_already_submitted',
    'one submission per match';

  assert tests.mr_notified(v_non_bibs, 'match_result_submitted', v_match) = 1, 'Non-bibs is told';
  assert tests.mr_notified(v_booker, 'match_result_submitted', v_match) = 0, 'the submitter isn''t told';

  assert tests.mr_as(v_bibs, format('select public.respond_to_match_result(%L, true)', v_match)) = 'not_allowed',
    'the submitting side can''t accept';
  assert tests.mr_as(v_unsided, format('select public.respond_to_match_result(%L, true)', v_match)) = 'not_allowed',
    'a player with no side can''t accept';
  assert tests.mr_as(v_non_bibs, format('select public.respond_to_match_result(%L, true)', v_match)) is null,
    'any Non-bibs player can accept';

  select * into v_row from public.matches where id = v_match;
  assert v_row.status = 'confirmed', 'accepted: confirmed';
  assert v_row.confirmed_via = 'agreed', 'confirmed_via agreed';
  assert v_row.confirmed_at = now(), 'confirmed now';
  assert v_row.side_a_score = 5 and v_row.side_b_score = 3, 'the submitted score';
  assert (select response from public.match_result_submissions where match_id = v_match) = 'accepted', 'response recorded';
  assert (select responded_by from public.match_result_submissions where match_id = v_match) = v_non_bibs, 'responder recorded';

  assert tests.mr_as(v_non_bibs, format('select public.respond_to_match_result(%L, false)', v_match)) = 'already_answered',
    'answered once';
  assert tests.mr_notified(v_booker, 'match_result_confirmed', v_match) = 1, 'the booker is told it''s confirmed';
  assert tests.mr_notified(v_bibs, 'match_result_confirmed', v_match) = 1, 'Bibs is told';
end $$;

-- 2. Reject: disputed, both sides told.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(2, now() - interval '1 hour', 'mr2b');
  v_match uuid := tests.mr_create(v_booking.id);
  v_booker uuid := v_booking.created_by;
  v_non_bibs uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_row public.matches;
begin
  perform tests.mr_as(v_non_bibs, format('select public.choose_match_side(%L, %L)', v_match, 'b'));
  perform tests.mr_as(v_booker, format('select public.submit_match_result(%L, 2, 2)', v_match));
  assert tests.mr_as(v_non_bibs, format('select public.respond_to_match_result(%L, false)', v_match)) is null, 'rejected';
  select * into v_row from public.matches where id = v_match;
  assert v_row.status = 'disputed', 'a rejection makes it disputed';
  assert v_row.side_a_score is null and v_row.confirmed_at is null, 'no score and not confirmed';
  assert (select response from public.match_result_submissions where match_id = v_match) = 'rejected', 'response recorded';
  assert tests.mr_notified(v_booker, 'match_result_disputed', v_match) = 1, 'the booker is told';
  assert tests.mr_as(v_non_bibs, format('select public.respond_to_match_result(%L, true)', v_match)) = 'already_answered',
    'disputed is final';
  perform tests.mr_tick();
  assert (select status from public.matches where id = v_match) = 'disputed', 'the tick leaves a dispute alone';
end $$;

-- 3. Silence for 24 hours: the submission stands at exactly ends_at + 24h.
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
  assert tests.mr_as(v_due.created_by, format('select public.submit_match_result(%L, 1, 0)', v_due_match)) = 'result_window_closed',
    'exactly at the deadline is past it';
  -- Submitted earlier, before the deadline.
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by, submitted_at)
  values (v_due_match, 'a', 4, 1, v_due.created_by, now() - interval '20 hours');
  assert tests.mr_as(v_early.created_by, format('select public.submit_match_result(%L, 4, 1)', v_early_match)) is null,
    'one second before the deadline a result can still be submitted';

  perform tests.mr_tick();
  select * into v_row from public.matches where id = v_due_match;
  assert v_row.status = 'confirmed', format('silence: confirmed at the deadline, got %s', v_row.status);
  assert v_row.confirmed_via = 'deadline', 'confirmed_via deadline';
  assert v_row.confirmed_at = v_row.result_deadline_at, 'confirmed at the deadline';
  assert v_row.side_a_score = 4 and v_row.side_b_score = 1, 'the submitted score stands';
  assert tests.mr_notified(v_due.created_by, 'match_result_confirmed', v_due_match) = 1, 'the booker is told';

  select * into v_row from public.matches where id = v_early_match;
  assert v_row.status = 'played', format('one second before the deadline: still waiting, got %s', v_row.status);
  update public.match_players set side = 'b' where match_id = v_due_match and profile_id = (tests.player(v_due.id, 1)).profile_id;
  assert tests.mr_as((tests.player(v_due.id, 1)).profile_id,
                     format('select public.respond_to_match_result(%L, false)', v_due_match)) = 'result_window_closed',
    'after the deadline the result can''t be rejected';
end $$;

-- 4. No submission by the deadline: no_result.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, now() - interval '24 hours 30 minutes', 'mr2e');
  v_match uuid := tests.mr_create(v_booking.id);
begin
  perform tests.mr_tick();
  assert (select status from public.matches where id = v_match) = 'no_result', 'nobody submitted: no_result';
  assert (select confirmed_at from public.matches where id = v_match) is null, 'not confirmed';
end $$;

-- 5. Who can submit, and when.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, now() - interval '1 hour', 'mr2f');
  v_match uuid := tests.mr_create(v_booking.id);
  v_future public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '1 day', 'mr2g');
  v_future_match uuid := tests.mr_create(v_future.id);
  v_outsider uuid := tests.create_user('mr2-outsider@futty.test');
  v_left public.booking_payment_shares := tests.player(v_booking.id, 1);
begin
  assert tests.mr_as(v_outsider, format('select public.submit_match_result(%L, 1, 0)', v_match)) = 'not_in_match',
    'a player who wasn''t in the match can''t submit';
  assert tests.mr_as(v_outsider, format('select public.respond_to_match_result(%L, true)', v_match)) = 'not_in_match',
    'nor answer';
  assert tests.mr_as(v_future.created_by, format('select public.submit_match_result(%L, 1, 0)', v_future_match)) = 'result_window_closed',
    'not before kickoff';
  assert tests.mr_as(v_booking.created_by, format('select public.submit_match_result(%L, 1, 0)', gen_random_uuid())) = 'match_not_found',
    'unknown match';
  update public.match_players set left_at = now() - interval '2 hours' where match_id = v_match and profile_id = v_left.profile_id;
  assert tests.mr_as(v_left.profile_id, format('select public.respond_to_match_result(%L, true)', v_match)) = 'not_in_match',
    'a player who left isn''t in the match';
end $$;

-- 6. Named game: the other side's captain answers; their players can't.
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

  assert tests.mr_as(v_away_player, format('select public.submit_match_result(%L, 0, 2)', v_match)) = 'not_captain',
    'a player of side b isn''t its captain';
  assert tests.mr_as(v_away_captain, format('select public.submit_match_result(%L, 0, 2)', v_match)) is null,
    'side b''s team captain can submit, even without a spot';
  assert tests.mr_notified(v_booker, 'match_result_submitted', v_match) = 1, 'side a''s captain is told';
  assert tests.mr_as(v_away_player, format('select public.respond_to_match_result(%L, true)', v_match)) = 'not_allowed',
    'side b can''t answer its own submission';
  assert tests.mr_as(v_booker, format('select public.respond_to_match_result(%L, true)', v_match)) is null,
    'side a''s captain accepts';
  assert (select status from public.matches where id = v_match) = 'confirmed', 'confirmed';
  assert (select side_b_score from public.matches where id = v_match) = 2, 'score kept';
end $$;

select 'match record 2 (result: confirm, reject, silence) passed' as result;

rollback;
