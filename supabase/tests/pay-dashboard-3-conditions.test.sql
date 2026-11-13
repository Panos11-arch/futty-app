-- Venue condition warning (docs/specs/13-payments-bookings.md "Venue
-- condition warning"; 05 section 12 launch item 6): staff flag "conditions
-- may be unsuitable" for a day or a time slot (one pitch or the whole
-- venue). Every player booked then is notified, once per flag, with the
-- words decided on 13 November. Normal cancellation rules apply: nothing is
-- cancelled and no money moves.
begin;

do $$
declare
  v_owner uuid := tests.create_user('cond-owner@futty.test');
  v_booker_a uuid := tests.create_user('cond-booker-a@futty.test');
  v_booker_b uuid := tests.create_user('cond-booker-b@futty.test');
  v_booker_c uuid := tests.create_user('cond-booker-c@futty.test');
  v_booker_x uuid := tests.create_user('cond-booker-x@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_name text;
  v_day date := tests.cyprus_today() + 2;
  v_a public.venue_bookings;
  v_b public.venue_bookings;
  v_c public.venue_bookings;
  v_x public.venue_bookings;
  v_left public.booking_payment_shares;
  v_flag uuid;
  v_note public.notifications;
  v_ledger_before integer;
  v_statuses_before text;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  select name into v_name from public.venues where id = v_venue;
  v_a := tests.booking_with_players(v_booker_a, v_venue, 'each_pays_own_spot', 2, v_day, '12:00', '13:00', 'cond-a');
  v_b := tests.booking_with_players(v_booker_b, v_venue, 'each_pays_own_spot', 1, v_day, '18:00', '19:00', 'cond-b');
  -- Cancelled game: nobody in it is told.
  v_c := tests.booking_with_players(v_booker_c, v_venue, 'each_pays_own_spot', 1, v_day, '20:00', '21:00', 'cond-c');
  update public.venue_bookings set status = 'cancelled' where id = v_c.id;
  -- Another day: not told.
  v_x := tests.booking_with_players(v_booker_x, v_venue, 'each_pays_own_spot', 0, v_day + 1, '12:00', '13:00', 'cond-x');
  -- A player who left game A isn't told.
  v_left := tests.player(v_a.id, 2);
  update public.booking_payment_shares set status = 'cancelled' where id = v_left.id;
  -- An owner block and a walk-in: no players to tell.
  perform tests.act_as(v_owner);
  perform public.add_counter_booking(v_venue, v_day, '15:00', '16:00', '5-a-side', 'walk_in', 'A', null);
  perform tests.act_as_postgres();

  select count(*) into v_ledger_before from public.money_ledger;
  select string_agg(b.status || '/' || coalesce((select string_agg(s.status, ',' order by s.id)
                                                  from public.booking_payment_shares s where s.booking_id = b.id), ''),
                    ';' order by b.id)
  into v_statuses_before from public.venue_bookings b where b.venue_id = v_venue;

  -- The whole day.
  perform tests.act_as(v_owner);
  v_flag := public.flag_conditions(v_venue, v_day, null, null, null, 'Waterlogged');
  perform tests.act_as_postgres();

  assert (select count(*) from public.notifications where type = 'venue_condition_warning') = 4,
    format('booker A, A''s player still in, booker B, B''s player: got %s',
           (select count(*) from public.notifications where type = 'venue_condition_warning'));
  assert (select count(*) from public.notifications where type = 'venue_condition_warning' and profile_id = v_booker_a) = 1,
    'the booker (who also holds a share) is told once';
  assert not exists (select 1 from public.notifications where type = 'venue_condition_warning'
                     and profile_id in (v_booker_c, v_booker_x, v_left.profile_id, v_owner)), 'nobody else';

  select * into v_note from public.notifications where type = 'venue_condition_warning' and profile_id = v_booker_b;
  assert v_note.title = 'Conditions may be unsuitable', format('title, got %s', v_note.title);
  assert v_note.body = format('%s says conditions may be unsuitable on %s at 18:00. Normal cancellation rules apply: '
                              || 'cancel at least 6 hours before kickoff to keep your money as credit at %s.',
                              v_name, to_char(v_day, 'FMDay FMDD FMMonth'), v_name),
    format('the decided words, got %s', v_note.body);
  assert v_note.data @> jsonb_build_object('bookingId', v_b.id, 'venueId', v_venue, 'flagId', v_flag),
    format('links to the booking, got %s', v_note.data);

  -- Nothing cancelled, no money moved.
  assert (select count(*) from public.money_ledger) = v_ledger_before, 'no money moves';
  assert (select string_agg(b.status || '/' || coalesce((select string_agg(s.status, ',' order by s.id)
                                                         from public.booking_payment_shares s where s.booking_id = b.id), ''),
                           ';' order by b.id)
          from public.venue_bookings b where b.venue_id = v_venue) = v_statuses_before,
    'games and players stay as they were';
  assert (select flag_day = v_day and starts_at is null and pitch_id is null and note = 'Waterlogged'
                 and created_by = v_owner and cleared_at is null
          from public.venue_condition_flags where id = v_flag), 'the flag is kept';
end $$;

-- A time slot tells only the games it overlaps; a pitch only its games.
do $$
declare
  v_owner uuid := tests.create_user('cond-slot-owner@futty.test');
  v_early uuid := tests.create_user('cond-slot-early@futty.test');
  v_late uuid := tests.create_user('cond-slot-late@futty.test');
  v_side uuid := tests.create_user('cond-slot-side@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 2;
  v_early_b public.venue_bookings;
  v_side_b public.venue_bookings;
  v_side_pitch uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_early_b := tests.booking_with_players(v_early, v_venue, 'each_pays_own_spot', 0, v_day, '12:00', '13:00', 'cs-e');
  perform tests.booking_with_players(v_late, v_venue, 'each_pays_own_spot', 0, v_day, '13:00', '14:00', 'cs-l');
  -- Same time as the early game, so on the other pitch.
  v_side_b := tests.booking_with_players(v_side, v_venue, 'each_pays_own_spot', 0, v_day, '12:00', '13:00', 'cs-s');
  select pitch_id into v_side_pitch from public.booking_pitches where booking_id = v_side_b.id;
  assert v_side_pitch <> (select pitch_id from public.booking_pitches where booking_id = v_early_b.id), 'two pitches';

  perform tests.act_as(v_owner);
  perform public.flag_conditions(v_venue, v_day, '12:30', '13:00', null, null);
  perform tests.act_as_postgres();
  assert exists (select 1 from public.notifications where type = 'venue_condition_warning' and profile_id = v_early)
     and exists (select 1 from public.notifications where type = 'venue_condition_warning' and profile_id = v_side),
    'both 12:00 games overlap 12:30-13:00';
  assert not exists (select 1 from public.notifications where type = 'venue_condition_warning' and profile_id = v_late),
    'a game starting at 13:00 doesn''t';

  delete from public.notifications where type = 'venue_condition_warning';
  perform tests.act_as(v_owner);
  perform public.flag_conditions(v_venue, v_day, null, null, v_side_pitch, null);
  perform tests.act_as_postgres();
  assert (select array_agg(profile_id) from public.notifications where type = 'venue_condition_warning') = array[v_side],
    'only the game on that pitch';

  -- A second flag is a new warning; told again.
  perform tests.act_as(v_owner);
  perform public.flag_conditions(v_venue, v_day, '12:00', '14:00', v_side_pitch, 'Storm');
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications where type = 'venue_condition_warning' and profile_id = v_side) = 2,
    'once per flag';
end $$;

-- Checks, and clearing a flag.
do $$
declare
  v_owner uuid := tests.create_user('cond-check-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_pitches => 1);
  v_other_pitch uuid;
  v_flag uuid;
begin
  select id into v_other_pitch from public.pitches where venue_id = v_other_venue;
  perform tests.act_as(v_owner);
  assert tests.error_of(format('select public.flag_conditions(%L, %L, null, null, null, null)',
                               v_venue, tests.cyprus_today() - 1)) = 'day_in_past', 'not a past day';
  assert tests.error_of(format($q$ select public.flag_conditions(%L, %L, '14:00', null, null, null) $q$,
                               v_venue, tests.cyprus_today() + 1)) = 'invalid_time_range', 'both times or neither';
  assert tests.error_of(format($q$ select public.flag_conditions(%L, %L, '14:00', '13:00', null, null) $q$,
                               v_venue, tests.cyprus_today() + 1)) = 'invalid_time_range', 'ends after it starts';
  assert tests.error_of(format('select public.flag_conditions(%L, %L, null, null, %L, null)',
                               v_venue, tests.cyprus_today() + 1, v_other_pitch)) = 'invalid_pitch', 'its own pitches';
  v_flag := public.flag_conditions(v_venue, tests.cyprus_today(), null, null, null, null);
  perform public.clear_conditions(v_flag);
  perform public.clear_conditions(v_flag);
  perform tests.act_as_postgres();
  assert (select cleared_at is not null from public.venue_condition_flags where id = v_flag), 'cleared (today is fine)';
end $$;

rollback;
