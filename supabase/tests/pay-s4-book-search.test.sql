-- S4: Book a pitch (docs/specs/15-design.md section 0, image 02). The
-- offered game lengths (spec 13: 60, 90 or 120, 60 by default), book_search
-- (up to 3 days, a time window, the free times each card shows and the
-- cheapest per-player price among them, priced by the same internal
-- function as venues_free_at), favourite venues (owner only) and "Missing a
-- venue?" requests (players insert, at most 5 a Cyprus day; only the service
-- role reads).
begin;

-- Only these tests' venues are live, so the answers don't depend on seed data.
update public.venues set is_live = false;

-- 1. The offered lengths come from the server.
do $$
declare
  v_player uuid := tests.create_user('s4-lengths@futty.test');
  o jsonb;
begin
  perform tests.act_as(v_player);
  o := public.booking_search_options();
  assert o -> 'game_lengths' = '[60, 90, 120]'::jsonb, format('lengths 60, 90, 120, got %s', o -> 'game_lengths');
  assert (o ->> 'default_game_length')::int = 60, '60 by default';
  -- What it returned before S4 is unchanged.
  assert (o ->> 'window_days')::int = 7 and (o ->> 'today')::date = tests.cyprus_today()
     and not (o ->> 'is_premium')::boolean and o ? 'six_on_five_available', 'the old fields are kept';
  perform tests.act_as_postgres();
end $$;

-- 2. book_search: slots, window, prices, filters, order.
do $$
declare
  v_player uuid := tests.create_user('s4-search@futty.test');
  v_booker uuid := tests.create_user('s4-booker@futty.test');
  v_cheap uuid := tests.create_venue(p_pitches => 1);
  v_dear uuid := tests.create_venue(p_pitches => 1);
  v_six uuid := tests.create_venue(p_pitches => 1);
  v_full uuid := tests.create_venue(p_pitches => 1);
  v_off uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  v_day2 date := tests.cyprus_today() + 4;
  r record;
  v_ids uuid[];
  v_names text[];
  v_slots jsonb;
  v_free record;
  v_checked integer := 0;
begin
  perform tests.set_price(v_cheap, '5-a-side', 5000);
  perform tests.set_price(v_dear, '5-a-side', 6000);
  perform tests.set_price(v_six, '5-a-side', 6000);
  perform tests.set_price(v_full, '5-a-side', 6000);
  perform tests.set_price(v_off, '5-a-side', 6000);
  update public.venues set name = 'A cheap', city = 'Limassol (Kamares)' where id = v_cheap;
  update public.venues set name = 'B dear', city = 'Nicosia' where id = v_dear;
  update public.venues set name = 'C six', city = 'Limassol', allows_6v6_on_5s = true where id = v_six;
  update public.venues set name = 'D full', city = 'Larnaca' where id = v_full;
  update public.venues set is_live = false where id = v_off;
  update public.pitches set indoor = true where venue_id = v_dear;
  insert into public.venue_amenities (venue_id, kind) values (v_cheap, 'parking'), (v_cheap, 'cafe_or_bar');
  insert into public.venue_photos (venue_id, storage_path, sort_order) values (v_cheap, 'S4/b.jpg', 2), (v_cheap, 'S4/a.jpg', 1);

  -- D full's 12:00 hour is booked.
  perform tests.act_as(v_booker);
  perform public.book_slot(v_full, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');

  perform tests.act_as(v_player);

  -- Evening on one day, 5 v 5, 60 minutes: the free live venues, by name.
  select array_agg(s.name) into v_names from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5) s;
  assert v_names = array['A cheap', 'B dear', 'C six', 'D full'], format('the free live venues by name, got %s', v_names);

  select * into r from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5) s where s.venue_id = v_cheap;
  assert r.town = 'Limassol' and r.area = 'Kamares', format('town and area, got %s / %s', r.town, r.area);
  assert r.photo_path = 'S4/a.jpg', 'the first photo';
  assert r.amenities = array['cafe_or_bar', 'parking'], format('amenities, got %s', r.amenities);
  assert not r.is_favourite, 'not a favourite yet';
  -- The free times inside the window, 8 at most, in time order (the venue closes at 23:00).
  assert jsonb_array_length(r.slots) = 8, format('8 times at most, got %s', jsonb_array_length(r.slots));
  assert r.slots -> 0 ->> 'start' = '18:00:00' and r.slots -> 0 ->> 'end' = '19:00:00'
     and (r.slots -> 0 ->> 'day')::date = v_day, format('the first time, got %s', r.slots -> 0);
  assert r.slots -> 7 ->> 'start' = '21:30:00', format('the eighth time, got %s', r.slots -> 7);
  -- Spec 13: EUR 50 5-a-side, each paying their own spot by card: 580 per player.
  assert r.from_player_cents = 580, format('from 580, got %s', r.from_player_cents);
  assert (r.slots -> 0 ->> 'player_cents')::int = 580, 'each time carries its price';
  select * into r from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5) s where s.venue_id = v_dear;
  assert r.from_player_cents = 680 and r.town = 'Nicosia' and r.area is null, format('EUR 60: 680, got %s', row(r.*));

  -- The same slot gives the same player_cents as venues_free_at, venue by venue.
  for v_free in select * from public.venues_free_at(v_day, '19:00', 60, '5-a-side', 5) loop
    select s.slots into v_slots from public.book_search(array[v_day], '19:00', '19:30', 60, '5-a-side', 5) s
    where s.venue_id = v_free.venue_id;
    assert (v_slots -> 0 ->> 'player_cents')::int = v_free.player_cents,
      format('book_search and venues_free_at agree for %s: %s vs %s', v_free.venue_id, v_slots -> 0 ->> 'player_cents', v_free.player_cents);
    v_checked := v_checked + 1;
  end loop;
  assert v_checked = 4, format('compared every free venue, got %s', v_checked);
  select s.slots into v_slots from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 6) s;
  assert (v_slots -> 0 ->> 'player_cents')::int
         = (select f.player_cents from public.venues_free_at(v_day, '18:00', 60, '5-a-side', 6) f),
    'and for 6 v 6';

  -- 6 v 6 on a 5-a-side: only the venue that allows it, at 580 (spec 13).
  select array_agg(s.venue_id) into v_ids from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 6) s;
  assert v_ids = array[v_six], format('6 v 6: only C six, got %s', v_ids);
  assert (select s.from_player_cents from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 6) s) = 580,
    '6 v 6 on EUR 60: 580';

  -- Two days, given in any order: times from both, in day order.
  select s.slots into v_slots from public.book_search(array[v_day2, v_day], '22:00', '24:00', 60, '5-a-side', 5) s
  where s.venue_id = v_cheap;
  assert jsonb_array_length(v_slots) = 2
     and (v_slots -> 0 ->> 'day')::date = v_day and (v_slots -> 1 ->> 'day')::date = v_day2,
    format('22:00 on both days, got %s', v_slots);

  -- 90 minutes: the end moves with the length.
  select s.slots into v_slots from public.book_search(array[v_day], '18:00', '18:30', 90, '5-a-side', 5) s where s.venue_id = v_cheap;
  assert v_slots -> 0 ->> 'end' = '19:30:00', format('90 minutes end at 19:30, got %s', v_slots);

  -- Place: a town (every area in it), or one venue.
  select array_agg(s.venue_id) into v_ids
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_town => 'Limassol') s;
  assert v_ids = array[v_cheap, v_six], format('Limassol, got %s', v_ids);
  select array_agg(s.venue_id) into v_ids
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_venue_id => v_dear) s;
  assert v_ids = array[v_dear], format('one venue, got %s', v_ids);

  -- Type: indoor or outdoor pitches for the format.
  select array_agg(s.venue_id) into v_ids
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_types => array['indoor']) s;
  assert v_ids = array[v_dear], format('indoor, got %s', v_ids);
  select array_agg(s.venue_id) into v_ids
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_types => array['outdoor']) s;
  assert v_ids = array[v_cheap, v_six, v_full], format('outdoor, got %s', v_ids);

  -- No free time: left out, unless asked for (then no times and no price).
  assert not exists (select 1 from public.book_search(array[v_day], '12:00', '12:30', 60, '5-a-side', 5) s where s.venue_id = v_full),
    'a venue with no free time is left out';
  select * into r from public.book_search(array[v_day], '12:00', '12:30', 60, '5-a-side', 5, p_include_unavailable => true) s
  where s.venue_id = v_full;
  assert r.venue_id = v_full and r.slots = '[]'::jsonb and r.from_player_cents is null,
    format('shown without times when asked, got %s', row(r.*));
  assert not exists (select 1 from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_include_unavailable => true) s
                     where s.venue_id = v_off), 'never a venue that is not live';

  -- Favourites first; favourites only.
  insert into public.favourite_venues (profile_id, venue_id) values (v_player, v_six);
  select array_agg(s.venue_id) into v_ids from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5) s;
  assert v_ids[1] = v_six, format('favourites first, got %s', v_ids);
  assert (select s.is_favourite from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5) s where s.venue_id = v_six),
    'marked as a favourite';
  select array_agg(s.venue_id) into v_ids
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_favourites_only => true) s;
  assert v_ids = array[v_six], format('favourites only, got %s', v_ids);

  -- Refusals.
  assert tests.error_of($q$ select * from public.book_search(array[]::date[], '18:00', '24:00', 60, '5-a-side', 5) $q$)
         = 'invalid_days', 'no day';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L, %L, %L, %L]::date[], '18:00', '24:00', 60, '5-a-side', 5) $q$,
                               v_day, v_day + 1, v_day + 2, v_day + 3)) = 'invalid_days', 'four days';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '18:00', '24:00', 60, '5-a-side', 5) $q$,
                               tests.cyprus_today() - 1)) = 'invalid_days', 'a past day';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '18:00', '24:00', 60, '5-a-side', 5) $q$,
                               tests.cyprus_today() + 8)) = 'beyond_booking_window', 'beyond the window';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '20:00', '18:00', 60, '5-a-side', 5) $q$, v_day))
         = 'invalid_time_range', 'a window that ends before it starts';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '18:00', '24:00', 45, '5-a-side', 5) $q$, v_day))
         = 'invalid_game_length', 'only the offered lengths';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '18:00', '24:00', 150, '5-a-side', 5) $q$, v_day))
         = 'invalid_game_length', '150 is not offered';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '18:00', '24:00', 60, '4-a-side', 5) $q$, v_day))
         = 'invalid_format', 'an unknown format';
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '18:00', '24:00', 60, '5-a-side', 7) $q$, v_day))
         = 'invalid_players_per_side', '5 or 6 per side';

  perform tests.act_as_anon();
  assert tests.error_of(format($q$ select * from public.book_search(array[%L]::date[], '18:00', '24:00', 60, '5-a-side', 5) $q$, v_day))
         like 'permission denied%', 'anon cannot search';
  perform tests.act_as_postgres();
end $$;

-- 3. The shared per-player price and the lengths rule are internal.
do $$
declare
  v_player uuid := tests.create_user('s4-internal@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
begin
  perform tests.act_as(v_player);
  assert tests.error_of(format($q$ select * from public.search_slot_price(%L, %L, '18:00', '19:00', '5-a-side', 5, false) $q$,
                               v_venue, tests.cyprus_today() + 3)) like 'permission denied%', 'players cannot call search_slot_price';
  assert tests.error_of($q$ select public.rule_game_lengths() $q$) like 'permission denied%', 'players cannot call rule_game_lengths';
  perform tests.act_as_service_role();
  assert public.rule_game_lengths() = array[60, 90, 120], 'the service role can';
  perform tests.act_as_postgres();
end $$;

-- 4. Favourite venues: the owner only.
do $$
declare
  v_me uuid := tests.create_user('s4-fav-me@futty.test');
  v_other uuid := tests.create_user('s4-fav-other@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
begin
  perform tests.act_as(v_me);
  -- The app sends only the venue; the row is the caller's.
  insert into public.favourite_venues (venue_id) values (v_venue);
  assert (select profile_id from public.favourite_venues) = v_me, 'I see my favourite, as mine';
  assert tests.error_of(format($q$ insert into public.favourite_venues (venue_id) values (%L) $q$, v_venue))
         like '%duplicate key%', 'once per venue';

  perform tests.act_as(v_other);
  assert (select count(*) from public.favourite_venues) = 0, 'another player sees none of mine';
  assert tests.error_of(format($q$ insert into public.favourite_venues (profile_id, venue_id) values (%L, %L) $q$, v_me, v_venue))
         like '%row-level security%', 'cannot add a favourite for someone else';
  delete from public.favourite_venues where profile_id = v_me;
  perform tests.act_as(v_me);
  assert (select count(*) from public.favourite_venues) = 1, 'another player cannot delete mine';
  delete from public.favourite_venues where venue_id = v_venue;
  assert (select count(*) from public.favourite_venues) = 0, 'I can remove mine';

  perform tests.act_as_anon();
  assert tests.error_of($q$ select * from public.favourite_venues $q$) like 'permission denied%', 'anon cannot read';
  perform tests.act_as_postgres();
end $$;

-- 5. "Missing a venue?": players insert their own, 5 a Cyprus day; only the service role reads.
do $$
declare
  v_me uuid := tests.create_user('s4-req-me@futty.test');
  v_other uuid := tests.create_user('s4-req-other@futty.test');
begin
  perform tests.act_as(v_me);
  insert into public.venue_requests (venue_name, town) values ('Kamares Arena', 'Limassol');
  assert tests.error_of($q$ select count(*) from public.venue_requests $q$) like 'permission denied%', 'players cannot read requests';
  assert tests.error_of(format($q$ insert into public.venue_requests (profile_id, venue_name, town) values (%L, 'X', 'Y') $q$, v_other))
         like '%row-level security%', 'cannot send one as someone else';
  assert tests.error_of($q$ insert into public.venue_requests (venue_name, town) values ('  ', 'Limassol') $q$)
         like '%violates check constraint%', 'a name is needed';
  assert tests.error_of($q$ insert into public.venue_requests (venue_name, town) values ('Arena', '') $q$)
         like '%violates check constraint%', 'a town is needed';
  assert tests.error_of(format($q$ insert into public.venue_requests (venue_name, town) values (%L, 'Limassol') $q$, repeat('x', 101)))
         like '%violates check constraint%', 'a name of at most 100 characters';
  insert into public.venue_requests (venue_name, town) values ('Two', 'Nicosia'), ('Three', 'Larnaca'), ('Four', 'Paphos'), ('Five', 'Ayia Napa');
  assert tests.error_of($q$ insert into public.venue_requests (venue_name, town) values ('Six', 'Paralimni') $q$)
         = 'venue_request_limit', 'the sixth in a day is refused';

  -- Another player has their own 5.
  perform tests.act_as(v_other);
  insert into public.venue_requests (venue_name, town) values ('Other', 'Limassol');

  -- Yesterday's requests (Cyprus) don't count.
  perform tests.act_as_postgres();
  update public.venue_requests set created_at = now() - interval '1 day' where profile_id = v_me;
  perform tests.act_as(v_me);
  insert into public.venue_requests (venue_name, town) values ('Next day', 'Limassol');

  perform tests.act_as_anon();
  assert tests.error_of($q$ insert into public.venue_requests (venue_name, town) values ('Anon', 'Limassol') $q$)
         like 'permission denied%', 'anon cannot send';

  perform tests.act_as_service_role();
  assert (select count(*) from public.venue_requests where profile_id = v_me) = 6, 'the founders read them';
  perform tests.act_as_postgres();
end $$;

rollback;
