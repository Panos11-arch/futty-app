-- Venue setup: pitches and which combine (docs/specs/13-payments-bookings.md
-- "Venue setup", decided 17 November, Dimitris; for Panos to confirm). A
-- pitch that holds a game (past or future) can't be deleted, only closed;
-- its size and formats can't change while it holds a future game; its name,
-- surface, indoor flag, description and order can always change. Closing a
-- pitch stops new bookings on it; games already on it stay.
begin;

do $$
declare
  v_owner uuid := tests.create_user('pitches-owner@futty.test');
  v_other_owner uuid := tests.create_user('pitches-other-owner@futty.test');
  v_booker uuid := tests.create_user('pitches-booker@futty.test');
  v_second uuid := tests.create_user('pitches-second@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 0);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_other_pitch uuid;
  v_day date := tests.cyprus_today() + 2;
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_d uuid;
  v_combo uuid;
  v_spare_combo uuid;
  v_seven public.venue_bookings;
  v_five public.venue_bookings;
  v_old public.venue_bookings;
  v_setup jsonb;
  v_pitch jsonb;
  v_saved public.pitches;
  v_f uuid;
  v_on_f public.venue_bookings;
begin
  select id into v_other_pitch from public.pitches where venue_id = v_other_venue;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_venue, '7-a-side', 8400);

  -- The owner adds two 5-a-side pitches and says they combine for 7s.
  perform tests.act_as(v_owner);
  v_a := public.save_pitch(v_venue, null, 'Pitch A', '5-a-side', array['5-a-side'], 'Artificial grass', false, 'By the café', 1);
  v_b := public.save_pitch(v_venue, null, 'Pitch B', '5-a-side', array['5-a-side'], 'Artificial grass', true, null, 2);
  v_combo := public.add_pitch_combination(v_venue, '7-a-side', array[v_a, v_b]);
  perform tests.act_as_postgres();
  assert (select indoor from public.pitches where id = v_b), 'saved as indoor';
  assert (select description from public.pitches where id = v_a) = 'By the café', 'saved with its description';

  -- A 7-a-side game uses the new combination.
  perform tests.act_as(v_booker);
  v_seven := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '7-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert (select array_agg(pitch_id order by pitch_id) from public.booking_pitches where booking_id = v_seven.id)
         = (select array_agg(x order by x) from unnest(array[v_a, v_b]) x), 'the combination is used';

  -- Pitch A now holds a future game: its name, surface, indoor flag,
  -- description and order can change, its size and formats can't.
  perform tests.act_as(v_owner);
  perform public.save_pitch(v_venue, v_a, 'Pitch 1', '5-a-side', array['5-a-side'], '4G', true, null, 3);
  perform tests.act_as_postgres();
  assert (select name from public.pitches where id = v_a) = 'Pitch 1', 'renamed';
  assert (select surface from public.pitches where id = v_a) = '4G', 'new surface';
  assert (select sort_order from public.pitches where id = v_a) = 3, 'new order';
  assert (select description from public.pitches where id = v_a) = 'By the café', 'a missing description is kept';

  -- A missing field keeps its saved value, for every field; an empty
  -- surface or description clears it.
  perform tests.act_as(v_owner);
  perform public.save_pitch(v_venue, v_a, null, null, null, null, null, null, null);
  perform tests.act_as_postgres();
  select * into v_saved from public.pitches where id = v_a;
  assert v_saved.name = 'Pitch 1' and v_saved.size = '5-a-side' and v_saved.formats = array['5-a-side']
         and v_saved.surface = '4G' and v_saved.indoor and v_saved.description = 'By the café'
         and v_saved.sort_order = 3, format('nothing sent, nothing changed: %s', to_jsonb(v_saved));
  perform tests.act_as(v_owner);
  perform public.save_pitch(v_venue, v_a, null, null, null, '', null, ' ', null);
  perform tests.act_as_postgres();
  select * into v_saved from public.pitches where id = v_a;
  assert v_saved.surface is null and v_saved.description is null, 'empty surface and description clear them';
  assert v_saved.name = 'Pitch 1' and v_saved.indoor and v_saved.sort_order = 3, 'the rest is kept';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, %L, ' ', null, null, null, null, null, null)$q$, v_venue, v_a))
    = 'invalid_pitch', 'an empty name isn''t a name';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, null, 'Pitch Z', null, null, null, null, null, null)$q$, v_venue))
    = 'invalid_pitch', 'a new pitch needs its size and formats';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, %L, 'Pitch 1', '7-a-side', array['7-a-side'], '4G', true, null, 3)$q$, v_venue, v_a))
    = 'pitch_has_future_bookings', 'no size change with a future game';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, %L, 'Pitch 1', '5-a-side', array['5-a-side', '6-a-side'], '4G', true, null, 3)$q$,
    v_venue, v_a)) = 'pitch_has_future_bookings', 'no format change with a future game';
  assert tests.error_as(v_owner, format($q$select public.delete_pitch(%L)$q$, v_a))
    = 'pitch_has_bookings', 'a pitch with a game can''t be deleted';
  assert (select size from public.pitches where id = v_a) = '5-a-side', 'size unchanged';

  -- Closing pitch B: new 5-a-side games only get pitch A; the 7-a-side game
  -- on both stays on.
  perform tests.act_as(v_owner);
  perform public.set_pitch_open(v_b, false);
  perform tests.act_as(v_second);
  v_five := public.book_slot(v_venue, v_day, '10:00', '11:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_five.id) = v_a, 'the closed pitch isn''t used';
  assert tests.error_as(v_booker, format(
    $q$select public.book_slot(%L, %L, '10:00', '11:00', 1, '5-a-side', 5, 'each_pays_own_spot')$q$, v_venue, v_day))
    = 'slot_full', 'no second 5-a-side while B is closed';
  -- Combined either: the 7-a-side combination of A and B is out while B is closed.
  assert tests.error_as(v_booker, format(
    $q$select public.book_slot(%L, %L, '14:00', '15:00', 1, '7-a-side', 5, 'each_pays_own_spot')$q$, v_venue, v_day))
    = 'slot_full', 'no 7-a-side on a combination with a closed pitch';
  assert (select status from public.venue_bookings where id = v_seven.id) <> 'cancelled', 'the game on B stays on';
  assert exists (select 1 from public.booking_pitches where booking_id = v_seven.id and pitch_id = v_b), 'and keeps B';
  perform tests.act_as(v_owner);
  perform public.set_pitch_open(v_b, true);
  perform tests.act_as_postgres();
  assert (select is_open from public.pitches where id = v_b), 'reopened';

  -- A pitch with only a past game: its size can change, but it can't be deleted.
  perform tests.act_as(v_owner);
  v_d := public.save_pitch(v_venue, null, 'Pitch D', '5-a-side', array['5-a-side'], null, false, null, 4);
  perform public.set_pitch_open(v_a, false);
  perform public.set_pitch_open(v_b, false);
  perform tests.act_as(v_second);
  v_old := public.book_slot(v_venue, v_day, '20:00', '21:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_old.id) = v_d, 'booked on D';
  update public.venue_bookings set booking_day = tests.cyprus_today() - 3 where id = v_old.id;
  update public.booking_pitches set slot = public.booking_slot_range(tests.cyprus_today() - 3, '20:00', '21:00')
  where booking_id = v_old.id;
  perform tests.act_as(v_owner);
  perform public.save_pitch(v_venue, v_d, 'Pitch D', '7-a-side', array['7-a-side'], null, false, null, 4);
  perform tests.act_as_postgres();
  assert (select size from public.pitches where id = v_d) = '7-a-side', 'size changes with only a past game';
  assert tests.error_as(v_owner, format($q$select public.delete_pitch(%L)$q$, v_d))
    = 'pitch_has_bookings', 'a pitch with a past game can''t be deleted';

  -- A pitch whose only game was cancelled holds none: it can be deleted.
  -- (A and B are closed and D is now a 7-a-side pitch, so the game goes on F.)
  perform tests.act_as(v_owner);
  v_f := public.save_pitch(v_venue, null, 'Pitch F', '5-a-side', array['5-a-side'], null, false, null, 6);
  perform tests.act_as(v_second);
  v_on_f := public.book_slot(v_venue, v_day, '15:00', '16:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_on_f.id) = v_f, 'booked on F';
  assert tests.error_as(v_owner, format($q$select public.delete_pitch(%L)$q$, v_f))
    = 'pitch_has_bookings', 'F holds a game';
  perform tests.cancel(v_on_f.id, 'whole_team', v_second);
  assert (select status from public.venue_bookings where id = v_on_f.id) = 'cancelled', 'the game on F is cancelled';
  perform tests.act_as(v_owner);
  perform public.delete_pitch(v_f);
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.pitches where id = v_f), 'a pitch whose only game was cancelled is deleted';

  -- An unused pitch can be deleted, with its combinations.
  perform tests.act_as(v_owner);
  v_c := public.save_pitch(v_venue, null, 'Pitch C', '5-a-side', array['5-a-side'], null, false, null, 5);
  v_spare_combo := public.add_pitch_combination(v_venue, '7-a-side', array[v_b, v_c]);
  v_setup := public.venue_setup(v_venue);
  perform public.delete_pitch(v_c);
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.pitches where id = v_c), 'deleted';
  assert not exists (select 1 from public.pitch_combinations where id = v_spare_combo), 'its combination went with it';
  assert exists (select 1 from public.pitch_combinations where id = v_combo), 'other combinations stay';

  -- venue_setup flags what the app should grey out.
  select p into v_pitch from jsonb_array_elements(v_setup -> 'pitches') p where (p ->> 'id')::uuid = v_a;
  assert (v_pitch ->> 'has_bookings')::boolean and (v_pitch ->> 'has_future_bookings')::boolean, 'A: future game';
  assert (v_pitch ->> 'is_open') = 'false', 'A: shown closed';
  select p into v_pitch from jsonb_array_elements(v_setup -> 'pitches') p where (p ->> 'id')::uuid = v_d;
  assert (v_pitch ->> 'has_bookings')::boolean and not (v_pitch ->> 'has_future_bookings')::boolean, 'D: past game only';
  select p into v_pitch from jsonb_array_elements(v_setup -> 'pitches') p where (p ->> 'id')::uuid = v_c;
  assert not (v_pitch ->> 'has_bookings')::boolean, 'C: no games';
  assert jsonb_array_length(v_setup -> 'combinations') = 2, 'venue_setup shows the combinations';

  -- Removing a combination leaves the game that used it alone.
  perform tests.act_as(v_owner);
  perform public.remove_pitch_combination(v_combo);
  perform tests.act_as_postgres();
  assert (select count(*) from public.booking_pitches where booking_id = v_seven.id) = 2, 'the 7-a-side game keeps its pitches';

  -- Bad pitches and combinations are refused.
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, null, 'Pitch B', '5-a-side', array['5-a-side'], null, false, null, 0)$q$, v_venue))
    = 'pitch_name_taken', 'the same name twice';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, null, '  ', '5-a-side', array['5-a-side'], null, false, null, 0)$q$, v_venue))
    = 'invalid_pitch', 'no name';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, null, 'Pitch E', 'futsal', array['5-a-side'], null, false, null, 0)$q$, v_venue))
    = 'invalid_pitch', 'not a size';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, null, 'Pitch E', '5-a-side', array[]::text[], null, false, null, 0)$q$, v_venue))
    = 'invalid_pitch', 'no format';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, null, 'Pitch E', '5-a-side', array['5-a-side', 'futsal'], null, false, null, 0)$q$,
    v_venue)) = 'invalid_pitch', 'not a format';
  assert tests.error_as(v_owner, format(
    $q$select public.save_pitch(%L, %L, 'Pitch E', '5-a-side', array['5-a-side'], null, false, null, 0)$q$,
    v_venue, gen_random_uuid())) = 'pitch_not_found', 'no such pitch';
  assert tests.error_as(v_owner, format(
    $q$select public.add_pitch_combination(%L, '7-a-side', array[%L]::uuid[])$q$, v_venue, v_a))
    = 'invalid_combination', 'one pitch doesn''t combine';
  assert tests.error_as(v_owner, format(
    $q$select public.add_pitch_combination(%L, '7-a-side', array[%L, %L]::uuid[])$q$, v_venue, v_a, v_a))
    = 'invalid_combination', 'the same pitch twice';
  assert tests.error_as(v_owner, format(
    $q$select public.add_pitch_combination(%L, '7-a-side', array[%L, %L]::uuid[])$q$, v_venue, v_a, v_other_pitch))
    = 'invalid_combination', 'a pitch of another venue';
  assert tests.error_as(v_owner, format(
    $q$select public.add_pitch_combination(%L, 'futsal', array[%L, %L]::uuid[])$q$, v_venue, v_a, v_b))
    = 'invalid_format', 'not a format';
  assert tests.error_as(v_owner, format($q$select public.remove_pitch_combination(%L)$q$, gen_random_uuid()))
    = 'combination_not_found', 'no such combination';
  assert tests.error_as(v_owner, format($q$select public.set_pitch_open(%L, null)$q$, v_a))
    = 'invalid_setting', 'open or closed, not null';
end;
$$;

rollback;
