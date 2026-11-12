-- P5: booking_search_options and venues_free_at, the Book flow
-- (docs/specs/15-design.md section 5, "Book"; spec 13, decided 12
-- November): the booking window by account, "Players per side" only when a
-- live venue allows 6 v 6 on a 5-a-side pitch, and live venues free at a
-- time with the price per player from the server.
begin;

-- Only these tests' venues are live, so the answers don't depend on seed data.
update public.venues set is_live = false;

do $$
declare
  v_player uuid := tests.create_user('search-player@futty.test');
  v_premium uuid := tests.create_user('search-premium@futty.test');
  v_cheap uuid := tests.create_venue(p_pitches => 1);
  v_six uuid := tests.create_venue(p_pitches => 1);
  v_off uuid := tests.create_venue(p_pitches => 1);
  v_full uuid := tests.create_venue(p_pitches => 1);
  v_booker uuid := tests.create_user('search-booker@futty.test');
  v_day date := tests.cyprus_today() + 3;
  o jsonb;
  r record;
  v_ids uuid[];
begin
  perform tests.set_price(v_cheap, '5-a-side', 5000);
  perform tests.set_price(v_six, '5-a-side', 6000);
  perform tests.set_price(v_off, '5-a-side', 6000);
  perform tests.set_price(v_full, '5-a-side', 6000);
  update public.venues set is_live = false where id = v_off;
  insert into public.venue_photos (venue_id, storage_path, sort_order) values (v_cheap, 'V900/b.jpg', 2), (v_cheap, 'V900/a.jpg', 1);
  perform tests.make_premium(v_premium);

  perform tests.act_as(v_booker);
  perform public.book_slot(v_full, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');

  -- No live venue allows 6 v 6 yet.
  perform tests.act_as(v_player);
  o := public.booking_search_options();
  assert (o ->> 'window_days')::int = 7, 'standard accounts book 7 days ahead';
  assert (o ->> 'today')::date = tests.cyprus_today(), 'today in Cyprus';
  assert not (o ->> 'six_on_five_available')::boolean, 'no players-per-side choice when no venue allows it';
  perform tests.act_as(v_premium);
  assert (public.booking_search_options() ->> 'window_days')::int = 14, 'Premium books 14 days ahead';

  perform tests.act_as_postgres();
  update public.venues set allows_6v6_on_5s = true where id = v_six;
  perform tests.act_as(v_player);
  assert (public.booking_search_options() ->> 'six_on_five_available')::boolean,
    'the choice shows once a live venue allows 6 v 6';

  -- 5 v 5 at 12:00: the cheap and the 6 v 6 venues; not the switched-off one or the booked one.
  select array_agg(f.venue_id order by f.player_cents) into v_ids
  from public.venues_free_at(v_day, '12:00', 60, '5-a-side', 5) f;
  assert v_ids = array[v_cheap, v_six], format('free venues, cheapest first, got %s', v_ids);

  select * into r from public.venues_free_at(v_day, '12:00', 60, '5-a-side', 5) f where f.venue_id = v_cheap;
  assert r.pitch_cents = 5000 and r.player_cents = 580, format('EUR 50: 580 per player, got %s', row(r.*));
  assert r.photo_path = 'V900/a.jpg', 'the first photo';
  assert r.next_starts = array['12:30', '13:00', '13:30']::time[], format('the next free times, got %s', r.next_starts);

  select * into r from public.venues_free_at(v_day, '12:00', 60, '5-a-side', 5) f where f.venue_id = v_six;
  assert r.player_cents = 680, 'EUR 60 5 v 5: 680 per player';

  -- 6 v 6 lists only the venue that allows it, at 580.
  select array_agg(f.venue_id) into v_ids from public.venues_free_at(v_day, '12:00', 60, '5-a-side', 6) f;
  assert v_ids = array[v_six], format('6 v 6: only the venue that allows it, got %s', v_ids);
  assert (select f.player_cents from public.venues_free_at(v_day, '12:00', 60, '5-a-side', 6) f) = 580, '6 v 6: 580';

  -- Beyond the window is refused; the past and nonsense list nothing.
  assert tests.error_of(format($q$ select * from public.venues_free_at(%L, '12:00', 60, '5-a-side', 5) $q$,
                               tests.cyprus_today() + 8)) = 'beyond_booking_window', 'beyond 7 days is refused';
  assert not exists (select 1 from public.venues_free_at(tests.cyprus_today() - 1, '12:00', 60, '5-a-side', 5)),
    'nothing in the past';
  assert not exists (select 1 from public.venues_free_at(v_day, '23:30', 60, '5-a-side', 5)),
    'a game must end by closing time';
  assert tests.error_of(format($q$ select * from public.venues_free_at(%L, '12:00', 45, '5-a-side', 5) $q$, v_day))
         = 'invalid_time_range', 'games last whole half hours';

  -- Signed out: nothing.
  perform tests.act_as_anon();
  assert tests.error_of($q$ select public.booking_search_options() $q$) like 'permission denied%',
    'anon cannot call booking_search_options';
  assert tests.error_of(format($q$ select * from public.venues_free_at(%L, '12:00', 60, '5-a-side', 5) $q$, v_day))
         like 'permission denied%', 'anon cannot call venues_free_at';
  perform tests.act_as_postgres();
end $$;

-- venue_page says whether 6 v 6 is allowed.
do $$
declare
  v_player uuid := tests.create_user('search-page@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
begin
  perform tests.act_as(v_player);
  assert not (public.venue_page(v_venue) -> 'venue' ->> 'allows_6v6_on_5s')::boolean, 'not allowed by default';
  perform tests.act_as_postgres();
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  perform tests.act_as(v_player);
  assert (public.venue_page(v_venue) -> 'venue' ->> 'allows_6v6_on_5s')::boolean, 'allowed once the venue turns it on';
  perform tests.act_as_postgres();
end $$;

rollback;
