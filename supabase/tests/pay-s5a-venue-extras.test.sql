-- S5A: venue extras.
--   1. Three new amenities: restaurant, vending machines and shop. Staff
--      can pick them (set_venue_amenities) and the import can load them; an
--      unknown kind is still refused.
--   2. Book a pitch's Amenities filter (book_search p_amenities): only
--      venues that have every amenity picked; an unknown amenity is refused;
--      no filter is as before.
--   3. The dashboard's "Set up your venue" checklist (venue_setup_status):
--      photos, amenities, food & drink, opening hours, phone and website,
--      pitches and prices, each done once the venue has entered it; staff of
--      that venue only. "Phone and website" is done with a phone: the
--      website is optional (Panos, 24 November).
begin;

update public.venues set is_live = false;

-- 1. The amenity list.
do $$
declare
  v_owner uuid := tests.create_user('s5a-amenities@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_kinds text[];
begin
  perform tests.act_as(v_owner);
  perform public.set_venue_amenities(v_venue, '[{"kind": "restaurant"}, {"kind": "vending_machines", "note": "Drinks"},
                                                {"kind": "shop"}, {"kind": "parking"}]');
  perform tests.act_as_postgres();
  select array_agg(kind order by kind) into v_kinds from public.venue_amenities where venue_id = v_venue;
  assert v_kinds = array['parking', 'restaurant', 'shop', 'vending_machines'], format('the new kinds are saved, got %s', v_kinds);
  assert (select note from public.venue_amenities where venue_id = v_venue and kind = 'vending_machines') = 'Drinks', 'with a note';

  perform tests.act_as(v_owner);
  assert tests.error_of(format('select public.set_venue_amenities(%L, %L)', v_venue, '[{"kind": "cinema"}]'))
         = 'invalid_amenities', 'an unknown kind is refused';
  perform tests.act_as_postgres();
  assert tests.error_of(format('insert into public.venue_amenities (venue_id, kind) values (%L, ''cinema'')', v_venue))
         is not null, 'the table refuses it too';

  -- The import loads the new kinds.
  perform tests.act_as_service_role();
  v_venue := public.import_venue(jsonb_build_object('import_key', 'V951', 'name', 'S5A import',
               'amenities', jsonb_build_array(jsonb_build_object('kind', 'restaurant'), jsonb_build_object('kind', 'shop'))));
  perform tests.act_as_postgres();
  select array_agg(kind order by kind) into v_kinds from public.venue_amenities where venue_id = v_venue;
  assert v_kinds = array['restaurant', 'shop'], format('the import loads them, got %s', v_kinds);
end $$;

-- 2. The Amenities filter.
do $$
declare
  v_player uuid := tests.create_user('s5a-filter@futty.test');
  v_both uuid := tests.create_venue(p_pitches => 1);
  v_cafe uuid := tests.create_venue(p_pitches => 1);
  v_none uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  v_names text[];
begin
  update public.venues set is_live = false;
  perform tests.set_price(v_both, '5-a-side', 6000);
  perform tests.set_price(v_cafe, '5-a-side', 6000);
  perform tests.set_price(v_none, '5-a-side', 6000);
  update public.venues set is_live = true, name = 'A both' where id = v_both;
  update public.venues set is_live = true, name = 'B cafe' where id = v_cafe;
  update public.venues set is_live = true, name = 'C none' where id = v_none;
  insert into public.venue_amenities (venue_id, kind) values
    (v_both, 'cafe_or_bar'), (v_both, 'restaurant'), (v_both, 'parking'), (v_cafe, 'cafe_or_bar');

  perform tests.act_as(v_player);
  select array_agg(s.name order by s.name) into v_names
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5) s;
  assert v_names = array['A both', 'B cafe', 'C none'], format('no filter: every venue, got %s', v_names);

  select array_agg(s.name order by s.name) into v_names
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_amenities => array['cafe_or_bar']) s;
  assert v_names = array['A both', 'B cafe'], format('café or bar, got %s', v_names);

  select array_agg(s.name order by s.name) into v_names
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5,
                          p_amenities => array['cafe_or_bar', 'restaurant']) s;
  assert v_names = array['A both'], format('every amenity picked, got %s', v_names);

  select array_agg(s.name order by s.name) into v_names
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_amenities => '{}') s;
  assert cardinality(v_names) = 3, 'an empty list is no filter';

  select array_agg(s.name) into v_names
  from public.book_search(array[v_day], '18:00', '24:00', 60, '5-a-side', 5, p_amenities => array['showers']) s;
  assert v_names is null, 'no venue has showers';

  assert tests.error_of(format('select * from public.book_search(array[%L::date], ''18:00'', ''24:00'', 60, ''5-a-side'', 5, p_amenities => array[''cinema''])',
                               v_day)) = 'invalid_amenity', 'an unknown amenity is refused';
  perform tests.act_as_anon();
  assert tests.error_of(format('select * from public.book_search(array[%L::date], ''18:00'', ''24:00'', 60, ''5-a-side'', 5)', v_day))
         is not null, 'signed out';
  perform tests.act_as_postgres();
  assert not has_function_privilege('anon', 'public.book_search(date[], time, time, integer, text, integer, text, uuid, text[], boolean, boolean, text[])', 'execute'),
    'anon can''t call it';
  assert (select count(*) from pg_proc where proname = 'book_search' and pronamespace = 'public'::regnamespace) = 1,
    'one book_search, no overload';
end $$;

-- 3. The setup checklist.
do $$
declare
  v_owner uuid := tests.create_user('s5a-setup@futty.test');
  v_other uuid := tests.create_user('s5a-setup-other@futty.test');
  v_player uuid := tests.create_user('s5a-setup-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 0);
  v_other_venue uuid := tests.create_venue(p_owner => v_other, p_pitches => 0);
  s jsonb;
begin
  delete from public.opening_hours where venue_id = v_venue;
  delete from public.price_rules where venue_id = v_venue;
  -- A website alone isn't enough: the phone is what's needed.
  update public.venues set phone = null, website = 'https://s5a.example.com' where id = v_venue;

  perform tests.act_as(v_owner);
  s := public.venue_setup_status(v_venue);
  assert s = jsonb_build_object('photos', false, 'amenities', false, 'menu', false, 'hours', false, 'contact', false,
                                'pitches', false, 'prices', false, 'complete', false),
    format('nothing entered yet, got %s', s);

  perform tests.act_as_postgres();
  insert into public.venue_photos (venue_id, storage_path) values (v_venue, 'S5A/a.jpg');
  insert into public.venue_amenities (venue_id, kind) values (v_venue, 'shop');
  insert into public.venue_menu_items (venue_id, name, price_cents, active) values (v_venue, 'Old pie', 300, false);
  insert into public.opening_hours (venue_id, weekday, opens, closes) values (v_venue, 1, '08:00', '23:00');
  -- A phone with no website: done (the website is optional).
  update public.venues set phone = '+357 25 123456', website = null where id = v_venue;
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);

  perform tests.act_as(v_owner);
  s := public.venue_setup_status(v_venue);
  assert (s ->> 'photos')::boolean and (s ->> 'amenities')::boolean and (s ->> 'hours')::boolean
     and (s ->> 'pitches')::boolean, format('the parts entered are done, got %s', s);
  assert not (s ->> 'menu')::boolean, 'a switched-off item doesn''t count';
  assert (s ->> 'contact')::boolean, 'a phone is enough, no website needed';
  assert not (s ->> 'prices')::boolean and not (s ->> 'complete')::boolean, 'no price yet, not complete';

  perform tests.act_as_postgres();
  insert into public.venue_menu_items (venue_id, name, price_cents) values (v_venue, 'Frappé', 350);
  perform tests.set_price(v_venue, '5-a-side', 6000);

  perform tests.act_as(v_owner);
  s := public.venue_setup_status(v_venue);
  assert s = jsonb_build_object('photos', true, 'amenities', true, 'menu', true, 'hours', true, 'contact', true,
                                'pitches', true, 'prices', true, 'complete', true),
    format('everything entered, no website: complete, got %s', s);

  -- Refused: another venue's staff, a player, signed out.
  perform tests.act_as(v_other);
  assert tests.error_of(format('select public.venue_setup_status(%L)', v_venue)) = 'not_venue_staff', 'another venue''s staff';
  assert (public.venue_setup_status(v_other_venue) ->> 'complete') = 'false', 'their own venue works';
  perform tests.act_as(v_player);
  assert tests.error_of(format('select public.venue_setup_status(%L)', v_venue)) = 'not_venue_staff', 'a player';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.venue_setup_status(%L)', v_venue)) is not null, 'signed out';
  perform tests.act_as_postgres();
  assert not has_function_privilege('anon', 'public.venue_setup_status(uuid)', 'execute'), 'anon can''t call it';
end $$;

rollback;
