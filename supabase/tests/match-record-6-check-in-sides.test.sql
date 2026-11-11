-- A2 (docs/specs/match-record.md section 5.4, decisions 1a.1, 1a.4, 1a.5):
-- the venue's staff get the per-match QR code; a player checks in with it
-- from 60 minutes before kickoff until 1 hour after the end; a captain ticks
-- their side's players until the result deadline. Pickup players pick
-- their side, the booker moves anyone, and sides lock once a result is in.
begin;

create function tests.mr_booking(p_others integer, p_owner uuid, p_label text default 'mr')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booker uuid := tests.create_user(format('%s-booker-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)));
  v_venue uuid := tests.create_venue(p_owner => p_owner);
  v_booking public.venue_bookings;
begin
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', p_others, tests.next_weekday(3),
                                          '12:00', '13:00', p_label);
  perform tests.act_as_postgres();
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

-- Moves a match (tests only): kickoff, end and the deadline 24 hours after it.
create function tests.mr_times(p_match uuid, p_kickoff timestamptz, p_ends timestamptz)
returns void
language sql
as $$
  update public.matches set kickoff_at = p_kickoff, ends_at = p_ends, result_deadline_at = p_ends + interval '24 hours'
  where id = p_match;
$$;

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

create function tests.mr_code(p_user uuid, p_match uuid)
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  perform tests.act_as(p_user);
  v_code := public.get_match_check_in_code(p_match);
  perform tests.act_as_postgres();
  return v_code;
end;
$$;

-- 1. The code: venue staff only.
do $$
declare
  v_owner uuid := tests.create_user('mr6-owner@futty.test');
  v_other_owner uuid := tests.create_user('mr6-other-owner@futty.test');
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner);
  v_booking public.venue_bookings := tests.mr_booking(2, v_owner, 'mr6a');
  v_match uuid := tests.mr_create(v_booking.id);
  v_code text;
begin
  v_code := tests.mr_code(v_owner, v_match);
  assert v_code is not null and length(v_code) >= 16, 'staff get the code';
  assert v_code = (select code from public.match_check_in_codes where match_id = v_match), 'the stored code';
  assert tests.mr_code(v_owner, v_match) = v_code, 'the same code every time';
  assert tests.mr_as(v_booking.created_by, format('select public.get_match_check_in_code(%L)', v_match)) = 'not_venue_staff',
    'the booker isn''t staff';
  assert tests.mr_as(v_other_owner, format('select public.get_match_check_in_code(%L)', v_match)) = 'not_venue_staff',
    'another venue''s staff aren''t either';
  -- Another match gets another code.
  assert tests.mr_code(v_owner, tests.mr_create((tests.mr_booking(0, v_owner, 'mr6b')).id)) <> v_code, 'one code per match';
end $$;

-- 2. Checking in with the code, inside the window.
do $$
declare
  v_owner uuid := tests.create_user('mr6-qr-owner@futty.test');
  v_booking public.venue_bookings := tests.mr_booking(2, v_owner, 'mr6c');
  v_match uuid := tests.mr_create(v_booking.id);
  v_player uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_outsider uuid := tests.create_user('mr6-outsider@futty.test');
  v_code text := tests.mr_code(v_owner, v_match);
  v_sql text := format('select public.check_in_to_match(%L, %L)', v_match, v_code);
begin
  -- Kickoff in 60 minutes and one second: too early.
  perform tests.mr_times(v_match, now() + interval '60 minutes 1 second', now() + interval '2 hours');
  assert tests.mr_as(v_player, v_sql) = 'check_in_closed', 'not more than 60 minutes before kickoff';
  -- Kickoff in exactly 60 minutes: open.
  perform tests.mr_times(v_match, now() + interval '60 minutes', now() + interval '90 minutes');
  assert tests.mr_as(v_player, format('select public.check_in_to_match(%L, %L)', v_match, 'wrong')) = 'invalid_code',
    'the wrong code is refused';
  assert tests.mr_as(v_outsider, v_sql) = 'not_in_match', 'a player who isn''t in the match can''t check in';
  assert tests.mr_as(v_player, v_sql) is null, 'checked in 60 minutes before kickoff';
  assert tests.mr_as(v_player, v_sql) is null, 'checking in again is fine';
  assert (select count(*) from public.match_attendance where match_id = v_match and profile_id = v_player) = 1, 'one row';
  assert (select method || ':' || (checked_in_by = v_player) from public.match_attendance
          where match_id = v_match and profile_id = v_player) = 'qr:true', 'by QR, by themselves';

  -- The end was 1 hour ago less one second: still open. Exactly 1 hour: closed.
  perform tests.mr_times(v_match, now() - interval '2 hours', now() - interval '1 hour' + interval '1 second');
  assert tests.mr_as(v_booking.created_by, v_sql) is null, 'open until 1 hour after the end';
  perform tests.mr_times(v_match, now() - interval '2 hours', now() - interval '1 hour');
  assert tests.mr_as((tests.player(v_booking.id, 2)).profile_id, v_sql) = 'check_in_closed', 'closed 1 hour after the end';

  perform tests.mr_times(v_match, now() - interval '10 minutes', now() + interval '20 minutes');
  update public.matches set status = 'void' where id = v_match;
  assert tests.mr_as((tests.player(v_booking.id, 2)).profile_id, v_sql) = 'check_in_closed', 'not for a void match';
end $$;

-- 3. Captains tick their side's players, until the result deadline.
do $$
declare
  v_owner uuid := tests.create_user('mr6-cap-owner@futty.test');
  v_booking public.venue_bookings := tests.mr_booking(3, v_owner, 'mr6d');
  v_match uuid := tests.mr_create(v_booking.id);
  v_booker uuid := v_booking.created_by;
  v_bibs uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_non_bibs uuid := (tests.player(v_booking.id, 2)).profile_id;
  v_unsided uuid := (tests.player(v_booking.id, 3)).profile_id;
begin
  update public.match_players set side = 'a' where match_id = v_match and profile_id = v_bibs;
  update public.match_players set side = 'b' where match_id = v_match and profile_id = v_non_bibs;

  perform tests.mr_times(v_match, now() + interval '61 minutes', now() + interval '91 minutes');
  assert tests.mr_as(v_booker, format('select public.captain_mark_attendance(%L, %L)', v_match, array[v_bibs])) = 'check_in_closed',
    'not more than 60 minutes before kickoff';

  -- The deadline is one second away.
  perform tests.mr_times(v_match, now() - interval '24 hours 30 minutes' + interval '1 second', now() - interval '24 hours' + interval '1 second');
  assert tests.mr_as(v_bibs, format('select public.captain_mark_attendance(%L, %L)', v_match, array[v_bibs])) = 'not_captain',
    'only a captain';
  assert tests.mr_as(v_booker, format('select public.captain_mark_attendance(%L, %L)', v_match, array[v_bibs, v_non_bibs])) = 'not_in_match',
    'only players on the captain''s side';
  assert tests.mr_as(v_booker, format('select public.captain_mark_attendance(%L, %L)', v_match, array[v_unsided])) = 'not_in_match',
    'a player with no side isn''t on the captain''s side';
  assert not exists (select 1 from public.match_attendance where match_id = v_match), 'nothing written on an error';
  assert tests.mr_as(v_booker, format('select public.captain_mark_attendance(%L, %L)', v_match, array[v_bibs, v_booker])) is null,
    'the captain ticks their side up to the deadline';
  assert (select count(*) from public.match_attendance where match_id = v_match and method = 'captain' and checked_in_by = v_booker) = 2,
    'ticked by the captain';
  assert tests.mr_as(v_booker, format('select public.captain_mark_attendance(%L, %L)', v_match, array[v_bibs])) is null,
    'ticking again is fine';

  -- Exactly at the deadline: closed.
  perform tests.mr_times(v_match, now() - interval '24 hours 30 minutes', now() - interval '24 hours');
  assert tests.mr_as(v_booker, format('select public.captain_mark_attendance(%L, %L)', v_match, array[v_bibs])) = 'check_in_closed',
    'closed at the deadline';
end $$;

-- 4. Pickup sides.
do $$
declare
  v_owner uuid := tests.create_user('mr6-sides-owner@futty.test');
  v_booking public.venue_bookings := tests.mr_booking(3, v_owner, 'mr6e');
  v_match uuid := tests.mr_create(v_booking.id);
  v_booker uuid := v_booking.created_by;
  v_p1 uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_p2 uuid := (tests.player(v_booking.id, 2)).profile_id;
  v_p2_row uuid;
  v_outsider uuid := tests.create_user('mr6-sides-outsider@futty.test');
  v_foreign_row uuid;
begin
  select id into v_p2_row from public.match_players where match_id = v_match and profile_id = v_p2;
  assert tests.mr_as(v_p1, format('select public.choose_match_side(%L, %L)', v_match, 'b')) is null, 'a player picks Non-bibs';
  assert (select side from public.match_players where match_id = v_match and profile_id = v_p1) = 'b', 'picked';
  assert tests.mr_as(v_p1, format('select public.choose_match_side(%L, %L)', v_match, 'a')) is null, 'and can change it';
  assert tests.mr_as(v_p1, format('select public.choose_match_side(%L, %L)', v_match, 'c')) = 'invalid_side', 'a or b';
  assert tests.mr_as(v_outsider, format('select public.choose_match_side(%L, %L)', v_match, 'a')) = 'not_in_match',
    'only players of the match';
  assert tests.mr_as(v_booker, format('select public.choose_match_side(%L, %L)', v_match, 'b')) = 'invalid_side',
    'the booker stays on Bibs';

  assert tests.mr_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, v_p2_row, 'b')) is null,
    'the booker moves a player';
  assert (select side from public.match_players where id = v_p2_row) = 'b', 'moved';
  assert tests.mr_as(v_booker, format('select public.set_match_player_side(%L, %L, null)', v_match, v_p2_row)) is null,
    'or takes them off a side';
  assert tests.mr_as(v_p1, format('select public.set_match_player_side(%L, %L, %L)', v_match, v_p2_row, 'b')) = 'not_booker',
    'only the booker moves others';
  select id into v_foreign_row from public.match_players
  where match_id = tests.mr_create((tests.mr_booking(1, v_owner, 'mr6f')).id) limit 1;
  assert tests.mr_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, v_foreign_row, 'b')) = 'not_in_match',
    'only rows of this match';

  -- Locked once a result is submitted.
  perform tests.mr_times(v_match, now() - interval '1 hour', now() - interval '30 minutes');
  assert tests.mr_as(v_booker, format('select public.submit_match_result(%L, 3, 3)', v_match)) is null, 'submitted';
  assert tests.mr_as(v_p1, format('select public.choose_match_side(%L, %L)', v_match, 'b')) = 'sides_locked',
    'no side changes after a submission';
  assert tests.mr_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, v_p2_row, 'b')) = 'sides_locked',
    'not by the booker either';
end $$;

-- 5. Named games don't choose sides.
do $$
declare
  v_booker uuid := tests.create_user('mr6-named-booker@futty.test');
  v_home uuid;
  v_away uuid;
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings;
  v_post uuid;
  v_match uuid;
begin
  insert into public.teams (name) values ('Reds') returning id into v_home;
  insert into public.teams (name) values ('Blues') returning id into v_away;
  insert into public.team_members (team_id, profile_id, role) values (v_home, v_booker, 'captain');
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.next_weekday(5));
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed', team_id = v_home where id = v_booking.id;
  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id)
  values ('opposition', v_home, v_venue, v_booking.id, v_booker, v_away) returning id into v_post;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id) values (v_post, v_home, v_away);
  v_match := tests.mr_create(v_booking.id);
  assert tests.mr_as(v_booker, format('select public.choose_match_side(%L, %L)', v_match, 'b')) = 'not_pickup',
    'sides come from the teams';
end $$;

select 'match record 6 (check-in, attendance, sides) passed' as result;

rollback;
