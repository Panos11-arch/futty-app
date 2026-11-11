-- A2 follow-up (docs/specs/match-record.md decision 1b.1, 11 November,
-- agreed with Panos): when create_match_for_booking is called again for a
-- booking that is now linked to a friendly, a pickup match becomes a named
-- game. Side a = the booker's team and every player holding a spot; side
-- b = the opponent team and all its members; picked sides are replaced;
-- check-ins are kept. Only before kickoff and before any result
-- submission; otherwise nothing changes and no error is raised. A booking
-- named on its first call gets the same roster.
begin;

create function tests.mr_booking(p_others integer, p_label text)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booker uuid := tests.create_user(format('%s-booker-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)));
  v_owner uuid := tests.create_user(format('%s-owner-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)));
  v_venue uuid := tests.create_venue(p_owner => v_owner);
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

-- Two teams for a booking: the booker's (the booker is a plain player on
-- it, with another captain) and an opponent with a captain, a player and a
-- substitute, none of whom hold a spot. The booking is made for the
-- booker's team. Returns {home, away, away captain, away player, away sub}.
create function tests.mr_teams(p_booking public.venue_bookings, p_label text)
returns uuid[]
language plpgsql
as $$
declare
  v_home uuid;
  v_away uuid;
  v_home_captain uuid := tests.create_user(format('%s-home-captain@futty.test', p_label));
  v_away_captain uuid := tests.create_user(format('%s-away-captain@futty.test', p_label));
  v_away_player uuid := tests.create_user(format('%s-away-player@futty.test', p_label));
  v_away_sub uuid := tests.create_user(format('%s-away-sub@futty.test', p_label));
begin
  insert into public.teams (name) values (p_label || ' Home') returning id into v_home;
  insert into public.teams (name) values (p_label || ' Away') returning id into v_away;
  insert into public.team_members (team_id, profile_id, role) values
    (v_home, p_booking.created_by, 'player'), (v_home, v_home_captain, 'captain'),
    (v_away, v_away_captain, 'captain'), (v_away, v_away_player, 'player'), (v_away, v_away_sub, 'substitute');
  update public.venue_bookings set team_id = v_home where id = p_booking.id;
  return array[v_home, v_away, v_away_captain, v_away_player, v_away_sub];
end;
$$;

-- The friendly is agreed: the booking's squad post led to a friendly match.
create function tests.mr_friendly(p_booking public.venue_bookings, p_home uuid, p_away uuid)
returns uuid
language plpgsql
as $$
declare
  v_post uuid;
  v_friendly uuid;
begin
  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id)
  values ('opposition', p_home, p_booking.venue_id, p_booking.id, p_booking.created_by, p_away) returning id into v_post;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id)
  values (v_post, p_home, p_away) returning id into v_friendly;
  return v_friendly;
end;
$$;

-- Everything the sync could touch, as one string.
create function tests.mr_snapshot(p_match uuid)
returns text
language sql
as $$
  select concat_ws(' | ',
    (select concat_ws(',', kind, friendly_match_id, status, kickoff_at, ends_at) from public.matches where id = p_match),
    (select string_agg(concat_ws(',', side, team_id, label, captain_profile_id), ';' order by side)
     from public.match_sides where match_id = p_match),
    (select string_agg(concat_ws(',', id, profile_id, side, share_id, left_at is null), ';' order by profile_id)
     from public.match_players where match_id = p_match),
    (select string_agg(concat_ws(',', profile_id, method, checked_in_at), ';' order by profile_id)
     from public.match_attendance where match_id = p_match),
    (select code from public.match_check_in_codes where match_id = p_match));
$$;

create function tests.mr_side(p_match uuid, p_profile uuid)
returns text
language sql
as $$
  select side from public.match_players where match_id = p_match and profile_id = p_profile and left_at is null;
$$;

-- 1 and 2. Confirmed as a pickup, then the friendly is agreed.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(4, 'mr8a');
  v_booker uuid := v_booking.created_by;
  v_unsided uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_picked_b uuid := (tests.player(v_booking.id, 2)).profile_id;
  v_both uuid := (tests.player(v_booking.id, 3)).profile_id;
  v_away_spot uuid := (tests.player(v_booking.id, 4)).profile_id;
  v_match uuid;
  v_again uuid;
  v_teams uuid[];
  v_friendly uuid;
  v_code text;
  v_before text;
begin
  v_match := tests.mr_create(v_booking.id);
  assert (select kind from public.matches where id = v_match) = 'pickup', 'no friendly yet: pickup';
  assert tests.mr_as(v_picked_b, format('select public.choose_match_side(%L, %L)', v_match, 'b')) is null, 'picks Non-bibs';
  assert tests.mr_as(v_away_spot, format('select public.choose_match_side(%L, %L)', v_match, 'b')) is null, 'picks Non-bibs';
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  values (v_match, v_unsided, 'captain', v_booker);
  select code into v_code from public.match_check_in_codes where match_id = v_match;

  v_teams := tests.mr_teams(v_booking, 'mr8a');
  insert into public.team_members (team_id, profile_id, role) values
    (v_teams[1], v_both, 'player'), (v_teams[2], v_both, 'player'), (v_teams[2], v_away_spot, 'player');
  v_friendly := tests.mr_friendly(v_booking, v_teams[1], v_teams[2]);

  v_again := tests.mr_create(v_booking.id);
  assert v_again = v_match, 'the same match';
  assert (select kind from public.matches where id = v_match) = 'named', 'the pickup becomes a named game';
  assert (select friendly_match_id from public.matches where id = v_match) = v_friendly, 'linked to the friendly';
  assert (select status from public.matches where id = v_match) = 'scheduled', 'still scheduled';

  assert (select team_id from public.match_sides where match_id = v_match and side = 'a') = v_teams[1], 'side a = the booker''s team';
  assert (select label from public.match_sides where match_id = v_match and side = 'a') = 'mr8a Home', 'labelled with its name';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'a') = v_booker,
    'the booker captains side a';
  assert (select team_id from public.match_sides where match_id = v_match and side = 'b') = v_teams[2], 'side b = the opponent';
  assert (select label from public.match_sides where match_id = v_match and side = 'b') = 'mr8a Away', 'labelled with its name';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'b') = v_teams[3],
    'the opponent''s team captain captains side b';

  assert tests.mr_side(v_match, v_booker) = 'a', 'the booker on a';
  assert tests.mr_side(v_match, v_unsided) = 'a', 'a spot holder with no side goes to a';
  assert tests.mr_side(v_match, v_picked_b) = 'a', 'a picked side is replaced: spot holders play on a';
  assert tests.mr_side(v_match, v_both) = 'a', 'a player in both teams stays on the side they booked with';
  assert tests.mr_side(v_match, v_away_spot) = 'b', 'a spot holder only on the opponent team plays on b';
  assert tests.mr_side(v_match, v_teams[3]) = 'b', 'the opponent''s captain plays on b';
  assert tests.mr_side(v_match, v_teams[4]) = 'b', 'the opponent''s player plays on b';
  assert tests.mr_side(v_match, v_teams[5]) = 'b', 'the opponent''s substitute plays on b';
  assert (select share_id from public.match_players where match_id = v_match and profile_id = v_teams[4]) is null,
    'opponent members without a spot have no share';
  assert (select share_id from public.match_players where match_id = v_match and profile_id = v_away_spot)
         = (tests.player(v_booking.id, 4)).id, 'a spot holder keeps their share';
  assert (select count(*) from public.match_players where match_id = v_match and left_at is null) = 8,
    '5 spot holders and 3 opponent members';
  assert not exists (select 1 from public.match_players mp where mp.match_id = v_match
                     and mp.profile_id = (select profile_id from public.team_members
                                          where team_id = v_teams[1] and role = 'captain')),
    'the booker''s team members without a spot aren''t added';

  assert (select count(*) from public.match_attendance where match_id = v_match and profile_id = v_unsided) = 1,
    'check-ins are kept';
  assert (select code from public.match_check_in_codes where match_id = v_match) = v_code, 'the check-in code is kept';

  -- 2. Idempotent.
  v_before := tests.mr_snapshot(v_match);
  assert tests.mr_create(v_booking.id) = v_match, 'the same id again';
  assert tests.mr_snapshot(v_match) = v_before, 'calling it twice gives the same result';
  assert tests.mr_as(v_teams[5], format('select public.choose_match_side(%L, %L)', v_match, 'a')) = 'not_pickup',
    'named sides aren''t chosen';
end $$;

-- 3. After a result submission nothing changes, with no error.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(2, 'mr8b');
  v_match uuid := tests.mr_create(v_booking.id);
  v_p1 uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_teams uuid[];
  v_before text;
begin
  assert tests.mr_as(v_p1, format('select public.choose_match_side(%L, %L)', v_match, 'b')) is null, 'picks Non-bibs';
  update public.matches set kickoff_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes',
    result_deadline_at = now() + interval '23 hours 30 minutes' where id = v_match;
  assert tests.mr_as(v_booking.created_by, format('select public.submit_match_result(%L, 2, 1)', v_match)) is null,
    'the booker submits for Bibs';
  v_before := tests.mr_snapshot(v_match);

  v_teams := tests.mr_teams(v_booking, 'mr8b');
  perform tests.mr_friendly(v_booking, v_teams[1], v_teams[2]);
  assert tests.mr_create(v_booking.id) = v_match, 'no error, same id';
  assert tests.mr_snapshot(v_match) = v_before, 'after a submission nothing changes';
  assert (select kind from public.matches where id = v_match) = 'pickup', 'still a pickup';
end $$;

-- 4. A submission blocks the change even before kickoff.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, 'mr8c');
  v_match uuid := tests.mr_create(v_booking.id);
  v_teams uuid[];
  v_before text;
begin
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
  values (v_match, 'a', 1, 0, v_booking.created_by);
  v_before := tests.mr_snapshot(v_match);
  v_teams := tests.mr_teams(v_booking, 'mr8c');
  perform tests.mr_friendly(v_booking, v_teams[1], v_teams[2]);
  assert tests.mr_create(v_booking.id) = v_match, 'no error';
  assert tests.mr_snapshot(v_match) = v_before, 'a submitted result blocks the change';
end $$;

-- 5. A closed match never changes.
do $$
declare
  v_status text;
  v_booking public.venue_bookings;
  v_match uuid;
  v_teams uuid[];
  v_before text;
begin
  foreach v_status in array array['confirmed', 'disputed', 'no_result', 'void'] loop
    v_booking := tests.mr_booking(1, 'mr8d-' || v_status);
    v_match := tests.mr_create(v_booking.id);
    update public.matches
    set status = v_status,
        confirmed_at = case when v_status = 'confirmed' then now() end,
        confirmed_via = case when v_status = 'confirmed' then 'agreed' end,
        side_a_score = case when v_status = 'confirmed' then 1 end,
        side_b_score = case when v_status = 'confirmed' then 1 end
    where id = v_match;
    v_before := tests.mr_snapshot(v_match);
    v_teams := tests.mr_teams(v_booking, 'mr8d-' || v_status);
    perform tests.mr_friendly(v_booking, v_teams[1], v_teams[2]);
    assert tests.mr_create(v_booking.id) = v_match, format('%s: no error', v_status);
    assert tests.mr_snapshot(v_match) = v_before, format('%s: nothing changes', v_status);
  end loop;
end $$;

-- 6 and 7. Named on the first call: the same roster; an opponent member who
-- leaves the team leaves the match.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, 'mr8e');
  v_p1 uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_teams uuid[] := tests.mr_teams(v_booking, 'mr8e');
  v_match uuid;
begin
  perform tests.mr_friendly(v_booking, v_teams[1], v_teams[2]);
  v_match := tests.mr_create(v_booking.id);
  assert (select kind from public.matches where id = v_match) = 'named', 'named from the start';
  assert tests.mr_side(v_match, v_booking.created_by) = 'a', 'the booker on a';
  assert tests.mr_side(v_match, v_p1) = 'a', 'a spot holder on a';
  assert tests.mr_side(v_match, v_teams[3]) = 'b' and tests.mr_side(v_match, v_teams[4]) = 'b'
         and tests.mr_side(v_match, v_teams[5]) = 'b', 'every opponent member on b';
  assert (select count(*) from public.match_players where match_id = v_match and share_id is null) = 3,
    'opponent members hold no share';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'b') = v_teams[3],
    'the opponent captain captains b';

  delete from public.team_members where team_id = v_teams[2] and profile_id = v_teams[5];
  perform tests.mr_create(v_booking.id);
  assert (select left_at from public.match_players where match_id = v_match and profile_id = v_teams[5]) is not null,
    'a member who left the opponent team leaves the match';
  assert tests.mr_side(v_match, v_teams[4]) = 'b', 'the others stay';
  assert (select count(*) from public.match_players where match_id = v_match and left_at is null) = 4, 'four left playing';
end $$;

select 'match record 8 (friendly sync) passed' as result;

rollback;
