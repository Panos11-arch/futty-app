-- A block's cancels don't free the slot (decided 18 November): a booking
-- cancelled by venue_add_block is in a slot that is now blocked, so it never
-- sends a saved-search "slot freed" alert. The same venue cancel made on its
-- own (no block) still does.
begin;

-- Events earlier test files left in the queue are matched first.
select public.saved_searches_tick();

create function tests.bc_search(p_profile uuid, p_day date, p_city text)
returns void
language plpgsql
as $$
begin
  perform tests.act_as(p_profile);
  insert into public.saved_searches (day, weekday, from_local, to_local, minutes, format, city, area)
  values (p_day, null, '17:00', '21:00', 60, '5-a-side', p_city, null);
  perform tests.act_as_postgres();
end;
$$;

create function tests.bc_matches(p_profile uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.notifications where profile_id = p_profile and type = 'saved_search_match'
$$;

do $$
declare
  v_owner uuid := tests.create_user('bc7-owner@futty.test');
  -- Two pitches each, so a free pitch is left beside the game.
  v_blocked_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_control_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 2;
  v_blocked_searcher uuid := tests.create_user('bc7-blocked@futty.test');
  v_control_searcher uuid := tests.create_user('bc7-control@futty.test');
  v_game public.venue_bookings;
  v_control public.venue_bookings;
  v_pitch uuid;
  v_list jsonb;
begin
  update public.venues set city = 'Paphos' where id = v_blocked_venue;
  update public.venues set city = 'Larnaca' where id = v_control_venue;
  perform tests.set_price(v_blocked_venue, '5-a-side', 6000);
  perform tests.set_price(v_control_venue, '5-a-side', 6000);
  v_game := tests.booking_with_players(tests.create_user('bc7-g@futty.test'), v_blocked_venue, 'each_pays_own_spot', 0,
                                       v_day, '19:00', '20:00', 'bc7g');
  v_control := tests.booking_with_players(tests.create_user('bc7-c@futty.test'), v_control_venue, 'each_pays_own_spot',
                                          0, v_day, '19:00', '20:00', 'bc7c');
  -- Both pitches taken at 19:00, so only a cancel could free the hour.
  perform tests.booking_with_players(tests.create_user('bc7-g2@futty.test'), v_blocked_venue, 'each_pays_own_spot', 0,
                                     v_day, '19:00', '20:00', 'bc7g2');
  perform tests.booking_with_players(tests.create_user('bc7-c2@futty.test'), v_control_venue, 'each_pays_own_spot', 0,
                                     v_day, '19:00', '20:00', 'bc7c2');
  perform tests.bc_search(v_blocked_searcher, v_day, 'Paphos');
  perform tests.bc_search(v_control_searcher, v_day, 'Larnaca');
  select pitch_id into v_pitch from public.booking_pitches where booking_id = v_game.id;

  perform tests.act_as(v_owner);
  -- The block: cancels the game on its pitch.
  v_list := public.venue_block_clashes(v_blocked_venue, v_pitch, v_day, '19:00', '20:00');
  perform public.venue_add_block(v_blocked_venue, v_pitch, v_day, '19:00', '20:00', null, v_list ->> 'quote');
  -- The control: the same venue cancel, without a block.
  perform tests.act_as_service_role();
  perform public.cancel_booking_internal(v_control.id, 'venue', v_owner,
                                         tests.plan(v_control.id, 'venue', v_owner) ->> 'quote');
  perform tests.act_as_postgres();

  assert (select status from public.venue_bookings where id = v_game.id) = 'cancelled', 'the blocked game is cancelled';
  assert not exists (select 1 from public.saved_search_events where booking_id = v_game.id),
    'no slot-freed event for the block''s cancel';
  assert exists (select 1 from public.saved_search_events where booking_id = v_control.id and processed_at is null),
    'the plain venue cancel queues one';

  perform public.saved_searches_tick();
  assert tests.bc_matches(v_blocked_searcher) = 0, 'no alert for a slot that is now blocked';
  assert tests.bc_matches(v_control_searcher) = 1, 'the plain venue cancel still alerts';
end $$;

select 'pay block clashes 7 (saved searches) passed' as result;

rollback;
