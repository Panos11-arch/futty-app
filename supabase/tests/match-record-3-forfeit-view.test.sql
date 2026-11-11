-- A2 (docs/specs/match-record.md section 5.1 and 6.2, decision 5):
-- record_match_forfeit and the match_result_confirmed view (contract 3),
-- which Gipedo Pano (P8) and collection (P4c) settle from.
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

create function tests.mr_service(p_sql text)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  perform tests.act_as_service_role();
  v_error := tests.error_of(p_sql);
  perform tests.act_as_postgres();
  return v_error;
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

-- The view's row for a match, read as service_role (the only reader).
create function tests.mr_view(p_match uuid)
returns public.match_result_confirmed
language plpgsql
as $$
declare
  v_row public.match_result_confirmed;
begin
  perform tests.act_as_service_role();
  select * into v_row from public.match_result_confirmed where match_id = p_match;
  perform tests.act_as_postgres();
  return v_row;
end;
$$;

do $$
declare
  v_forfeit public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '3 hours', 'mr3a');
  v_forfeit_match uuid := tests.mr_create(v_forfeit.id);
  v_played public.venue_bookings := tests.mr_booking(1, now() - interval '2 hours', 'mr3b');
  v_played_match uuid := tests.mr_create(v_played.id);
  v_draw public.venue_bookings := tests.mr_booking(1, now() - interval '3 hours', 'mr3c');
  v_draw_match uuid := tests.mr_create(v_draw.id);
  v_open public.venue_bookings := tests.mr_booking(1, now() - interval '4 hours', 'mr3d');
  v_open_match uuid := tests.mr_create(v_open.id);
  v_view public.match_result_confirmed;
  v_row public.matches;
  v_error text;
begin
  -- Input checks.
  assert tests.mr_service(format('select public.record_match_forfeit(%L, %L, %L)', v_forfeit_match, 'c', 'no_show')) = 'invalid_side',
    'side a or b only';
  assert tests.mr_service(format('select public.record_match_forfeit(%L, %L, %L)', v_forfeit_match, 'b', 'late')) = 'invalid_reason',
    'pulled_out or no_show only';
  assert tests.mr_service(format('select public.record_match_forfeit(%L, %L, %L)', gen_random_uuid(), 'b', 'no_show')) = 'match_not_found',
    'unknown match';

  -- A Gipedo Pano pull-out: side b forfeits; side a wins.
  assert tests.mr_service(format('select public.record_match_forfeit(%L, %L, %L)', v_forfeit_match, 'b', 'pulled_out')) is null,
    'forfeit recorded';
  select * into v_row from public.matches where id = v_forfeit_match;
  assert v_row.status = 'confirmed' and v_row.confirmed_via = 'forfeit' and v_row.confirmed_at = now(), 'confirmed by forfeit';
  assert v_row.forfeit_side = 'b' and v_row.forfeit_reason = 'pulled_out', 'side and reason kept';
  assert v_row.side_a_score is null and v_row.side_b_score is null, 'a forfeit has no score';
  assert tests.mr_service(format('select public.record_match_forfeit(%L, %L, %L)', v_forfeit_match, 'a', 'no_show')) = 'match_closed',
    'a confirmed match is closed';

  v_view := tests.mr_view(v_forfeit_match);
  assert v_view.match_id = v_forfeit_match and v_view.booking_id = v_forfeit.id and v_view.venue_id = v_forfeit.venue_id, 'ids';
  assert v_view.outcome = 'side_a_won', format('the other side wins a forfeit, got %s', v_view.outcome);
  assert v_view.result_status = 'confirmed' and not v_view.disputed, 'confirmed, not disputed';
  assert v_view.confirmed_via = 'forfeit', 'via forfeit';
  assert v_view.forfeit_side = 'b' and v_view.forfeit_reason = 'pulled_out', 'forfeit side and reason';
  assert v_view.side_a_score is null and v_view.side_b_score is null, 'no score';
  assert v_view.side_a_team_id is null and v_view.side_b_team_id is null, 'pickup: no teams';
  assert v_view.settled_at = now(), 'settled when confirmed';
  -- Kickoff and end in Cyprus wall-clock time: the booking's own day and times.
  assert v_view.kickoff_local = (v_forfeit.booking_day + v_forfeit.start_time), 'kickoff_local is the Cyprus time of the booking';
  assert v_view.ends_local = (v_forfeit.booking_day + v_forfeit.end_time), 'ends_local likewise';
  assert v_view.kickoff_at = v_row.kickoff_at and v_view.ends_at = v_row.ends_at, 'instants';

  -- A played match with an agreed score: side b won 2-4.
  update public.matches set status = 'confirmed', side_a_score = 2, side_b_score = 4, confirmed_via = 'agreed',
    confirmed_at = now() - interval '5 minutes' where id = v_played_match;
  v_view := tests.mr_view(v_played_match);
  assert v_view.outcome = 'side_b_won' and v_view.side_a_score = 2 and v_view.side_b_score = 4, 'side b won';
  assert v_view.forfeit_side is null and v_view.forfeit_reason is null, 'no forfeit';
  assert v_view.settled_at = now() - interval '5 minutes', 'settled when confirmed';

  -- A draw, and a dispute.
  update public.matches set status = 'confirmed', side_a_score = 1, side_b_score = 1, confirmed_via = 'deadline',
    confirmed_at = result_deadline_at where id = v_draw_match;
  assert (tests.mr_view(v_draw_match)).outcome = 'draw', 'draw';

  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by, submitted_at,
                                               response, responded_by, responded_at)
  values (v_open_match, 'a', 3, 0, v_open.created_by, now() - interval '2 hours', 'rejected',
          (tests.player(v_open.id, 1)).profile_id, now() - interval '1 hour');
  update public.matches set status = 'disputed' where id = v_open_match;
  v_view := tests.mr_view(v_open_match);
  assert v_view.result_status = 'disputed' and v_view.disputed, 'disputed flag';
  assert v_view.outcome is null and v_view.side_a_score is null and v_view.confirmed_via is null, 'no outcome or score';
  assert v_view.settled_at = now() - interval '1 hour', 'settled when rejected';

  -- no_result: settled at the deadline. Unsettled matches aren't listed.
  update public.matches set status = 'no_result' where id = v_draw_match;
  v_view := tests.mr_view(v_draw_match);
  assert v_view.result_status = 'no_result' and v_view.outcome is null and v_view.side_a_score is null, 'no_result';
  assert v_view.settled_at = (select result_deadline_at from public.matches where id = v_draw_match), 'settled at the deadline';
  update public.matches set status = 'played' where id = v_draw_match;
  assert (tests.mr_view(v_draw_match)).match_id is null, 'played: not listed';
  update public.matches set status = 'void' where id = v_draw_match;
  assert (tests.mr_view(v_draw_match)).match_id is null, 'void: not listed';
  assert tests.mr_service(format('select public.record_match_forfeit(%L, %L, %L)', v_draw_match, 'a', 'no_show')) = 'match_closed',
    'a void match is closed';

  -- Only service_role reads the view; the app can't record a forfeit.
  perform tests.act_as(v_forfeit.created_by);
  v_error := tests.error_of('select count(*) from public.match_result_confirmed');
  assert v_error like 'permission denied%', format('players can''t read the view, got %s', v_error);
  v_error := tests.error_of(format('select public.record_match_forfeit(%L, %L, %L)', v_played_match, 'a', 'no_show'));
  assert v_error like 'permission denied%', format('players can''t record a forfeit, got %s', v_error);
  perform tests.act_as_anon();
  v_error := tests.error_of('select count(*) from public.match_result_confirmed');
  assert v_error like 'permission denied%', 'anon can''t read the view';
  perform tests.act_as_postgres();
end $$;

-- The view has exactly contract 3's columns, in order (P4c's stub has the same).
do $$
declare
  v_columns text;
begin
  select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into v_columns
  from pg_attribute where attrelid = 'public.match_result_confirmed'::regclass and attnum > 0 and not attisdropped;
  assert v_columns = 'match_id uuid, booking_id uuid, venue_id uuid, friendly_match_id uuid, league_fixture_id uuid, '
    'side_a_team_id uuid, side_b_team_id uuid, side_a_score integer, side_b_score integer, outcome text, result_status text, '
    'disputed boolean, confirmed_via text, forfeit_side text, forfeit_reason text, kickoff_at timestamp with time zone, '
    'ends_at timestamp with time zone, kickoff_local timestamp without time zone, ends_local timestamp without time zone, '
    'settled_at timestamp with time zone', format('columns: %s', v_columns);
end $$;

select 'match record 3 (forfeit, match_result_confirmed) passed' as result;

rollback;
