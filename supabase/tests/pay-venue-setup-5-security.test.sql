-- Venue setup security (docs/specs/13-payments-bookings.md "Venue setup" and
-- "Server-side checks"): only a venue's own staff can edit its setup, through
-- the setup functions only. Staff of venue B get nothing done on venue A,
-- even by passing A's row ids with B's venue id; players and signed-out
-- callers are refused; the tables still can't be written directly; the
-- notice helper and its table are Futty's own.
begin;

do $$
declare
  v_owner_a uuid := tests.create_user('setup-sec-owner-a@futty.test');
  v_owner_b uuid := tests.create_user('setup-sec-owner-b@futty.test');
  v_player uuid := tests.create_user('setup-sec-player@futty.test');
  v_venue_a uuid := tests.create_venue(p_owner => v_owner_a, p_pitches => 2);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b, p_pitches => 2);
  v_day date := tests.cyprus_today() + 3;
  v_pitch_a uuid;
  v_pitch_a2 uuid;
  v_pitch_b uuid;
  v_closure_a uuid;
  v_combo_a uuid;
  v_before jsonb;
  v_after jsonb;
  v_call text;
  v_error text;
begin
  select id into v_pitch_a from public.pitches where venue_id = v_venue_a order by sort_order limit 1;
  select id into v_pitch_a2 from public.pitches where venue_id = v_venue_a order by sort_order offset 1 limit 1;
  select id into v_pitch_b from public.pitches where venue_id = v_venue_b order by sort_order limit 1;
  select id into v_combo_a from public.pitch_combinations where venue_id = v_venue_a limit 1;
  perform tests.act_as(v_owner_a);
  v_closure_a := public.add_venue_closure(v_venue_a, v_day, v_day, 'Works');
  v_before := public.venue_setup(v_venue_a);
  perform tests.act_as_postgres();

  -- Staff of venue B, and a player, get not_venue_staff on every function.
  foreach v_call in array array[
    format($q$select public.venue_setup(%L)$q$, v_venue_a),
    format($q$select public.set_venue_hours(%L, '[]')$q$, v_venue_a),
    format($q$select public.add_venue_closure(%L, %L, %L, null)$q$, v_venue_a, v_day, v_day),
    format($q$select public.remove_venue_closure(%L)$q$, v_closure_a),
    format($q$select public.set_price_rule(%L, '5-a-side', 1, null, null, null, null, null, null)$q$, v_venue_a),
    format($q$select public.remove_price_rule(%L, '5-a-side')$q$, v_venue_a),
    format($q$select public.save_pitch(%L, null, 'Sneaky', '5-a-side', array['5-a-side'], null, false, null, 0)$q$, v_venue_a),
    format($q$select public.save_pitch(%L, %L, 'Sneaky', '5-a-side', array['5-a-side'], null, false, null, 0)$q$,
           v_venue_a, v_pitch_a),
    format($q$select public.set_pitch_open(%L, false)$q$, v_pitch_a),
    format($q$select public.delete_pitch(%L)$q$, v_pitch_a),
    format($q$select public.add_pitch_combination(%L, '7-a-side', array[%L, %L]::uuid[])$q$, v_venue_a, v_pitch_a, v_pitch_a2),
    format($q$select public.remove_pitch_combination(%L)$q$, v_combo_a)
  ]
  loop
    v_error := tests.error_as(v_owner_b, v_call);
    assert v_error = 'not_venue_staff', format('venue B staff: %s gave %s', v_call, v_error);
    v_error := tests.error_as(v_player, v_call);
    assert v_error = 'not_venue_staff', format('a player: %s gave %s', v_call, v_error);
    perform tests.act_as_anon();
    v_error := tests.error_of(v_call);
    perform tests.act_as_postgres();
    assert v_error like 'permission denied%', format('signed out: %s gave %s', v_call, v_error);
  end loop;

  -- B's venue id with A's row ids gets nowhere either.
  assert tests.error_as(v_owner_b, format(
    $q$select public.save_pitch(%L, %L, 'Sneaky', '5-a-side', array['5-a-side'], null, false, null, 0)$q$,
    v_venue_b, v_pitch_a)) = 'pitch_not_found', 'B''s venue, A''s pitch';
  assert tests.error_as(v_owner_b, format(
    $q$select public.add_pitch_combination(%L, '7-a-side', array[%L, %L]::uuid[])$q$, v_venue_b, v_pitch_b, v_pitch_a))
    = 'invalid_combination', 'B''s venue, A''s pitch in a combination';

  -- Nothing at A changed.
  perform tests.act_as(v_owner_a);
  v_after := public.venue_setup(v_venue_a);
  perform tests.act_as_postgres();
  assert v_after = v_before, 'venue A''s setup is unchanged';

  -- Even A's owner can't write the tables directly: only the functions. An
  -- insert is refused (no grant, or no RLS policy allows it); an update or
  -- delete either is refused or, with no RLS policy, reaches no row. Either
  -- way nothing changes (checked below).
  foreach v_call in array array[
    format($q$insert into public.pitches (venue_id, name, size, formats) values (%L, 'Direct', '5-a-side', '{5-a-side}')$q$, v_venue_a),
    format($q$update public.pitches set name = 'Direct' where id = %L$q$, v_pitch_a),
    format($q$delete from public.pitches where id = %L$q$, v_pitch_a),
    format($q$insert into public.opening_hours (venue_id, weekday, opens, closes) values (%L, 1, '08:00', '09:00')$q$, v_venue_a),
    format($q$update public.opening_hours set closes = '09:00' where venue_id = %L$q$, v_venue_a),
    format($q$delete from public.opening_hours where venue_id = %L$q$, v_venue_a),
    format($q$insert into public.venue_closures (venue_id, starts_on, ends_on) values (%L, %L, %L)$q$, v_venue_a, v_day, v_day),
    format($q$delete from public.venue_closures where venue_id = %L$q$, v_venue_a),
    format($q$update public.price_rules set price_cents = 1 where venue_id = %L$q$, v_venue_a),
    format($q$insert into public.price_rules (venue_id, format, price_cents) values (%L, '6-a-side', 1)$q$, v_venue_a),
    format($q$delete from public.price_rules where venue_id = %L$q$, v_venue_a),
    format($q$insert into public.pitch_combinations (venue_id, format, pitch_ids) values (%L, '9-a-side', array[%L, %L]::uuid[])$q$,
           v_venue_a, v_pitch_a, v_pitch_a2),
    format($q$delete from public.pitch_combinations where venue_id = %L$q$, v_venue_a)
  ]
  loop
    v_error := tests.error_as(v_owner_a, v_call);
    assert v_call not like 'insert%' or v_error like 'permission denied%' or v_error like 'new row violates row-level security%',
      format('direct insert: %s gave %s', v_call, v_error);
    assert v_error is null or v_error like 'permission denied%' or v_error like 'new row violates row-level security%',
      format('direct: %s gave %s', v_call, v_error);
  end loop;

  -- The notice record and its helper are Futty's own.
  foreach v_call in array array[
    'select * from public.venue_closed_notices',
    'insert into public.venue_closed_notices (booking_id, profile_id) values (gen_random_uuid(), gen_random_uuid())',
    format($q$select public.notify_closed_new_bookings(%L, array[]::uuid[])$q$, v_venue_a),
    format($q$select public.pitch_has_bookings(%L, false)$q$, v_pitch_a)
  ]
  loop
    v_error := tests.error_as(v_owner_a, v_call);
    assert v_error like 'permission denied%', format('Futty''s own: %s gave %s', v_call, v_error);
  end loop;

  perform tests.act_as(v_owner_a);
  v_after := public.venue_setup(v_venue_a);
  perform tests.act_as_postgres();
  assert v_after = v_before, 'still unchanged';
end;
$$;

rollback;
