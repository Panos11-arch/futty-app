-- F8 (decided 22 November): import_venue takes the venue sheet's confirmed
-- pitches, combinations and prices, and the Venues tab's coordinates
-- (spec 13, "Venue pages and the venue data import"). The script only sends
-- confirmed rows; these tests check what the database does with them.
begin;

-- A venue payload as the import script sends it, with F8's keys added.
create function tests.ip_venue(p_key text, p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'import_key', p_key,
    'name', 'Pitch import arena ' || p_key,
    'photo_permission', false,
    'hours', '[]'::jsonb, 'amenities', '[]'::jsonb, 'photos', '[]'::jsonb, 'items', '[]'::jsonb
  ) || p_extra;
$$;

create function tests.ip_import(p_venue jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.act_as_service_role();
  v_id := public.import_venue(p_venue);
  perform tests.act_as_postgres();
  return v_id;
end;
$$;

create function tests.ip_pitch(p_name text, p_size text, p_formats text[], p_indoor boolean default false,
                               p_surface text default 'artificial grass')
returns jsonb
language sql
as $$
  select jsonb_build_object('name', p_name, 'size', p_size, 'formats', to_jsonb(p_formats),
                            'surface', p_surface, 'indoor', p_indoor);
$$;

-- What the venue holds, for comparing a re-import with the first one.
create function tests.ip_state(p_venue uuid)
returns text
language sql
as $$
  select concat_ws(' | ',
    (select string_agg(format('%s %s %s %s %s', name, size, formats, surface, indoor), '; ' order by name)
     from public.pitches where venue_id = p_venue),
    (select string_agg(format('%s %s', c.format,
              (select string_agg(p.name, '+' order by p.name) from public.pitches p where p.id = any (c.pitch_ids))),
            '; ' order by c.format)
     from public.pitch_combinations c where c.venue_id = p_venue),
    (select string_agg(format('%s %s', format, price_cents), '; ' order by format)
     from public.price_rules where venue_id = p_venue),
    (select format('%s,%s', latitude, longitude) from public.venues where id = p_venue));
$$;

-- 1. Pitches, a combination and prices imported; coordinates inside Cyprus.
do $$
declare
  v_id uuid := tests.ip_import(tests.ip_venue('V901', jsonb_build_object(
    'latitude', 35.1594, 'longitude', 33.3501,
    'pitches', jsonb_build_array(tests.ip_pitch('Pitch 1', '5-a-side', array['5-a-side', '6-a-side']),
                                 tests.ip_pitch('Pitch 2', '5-a-side', array['5-a-side'], true, null)),
    'combinations', jsonb_build_array(jsonb_build_object('format', '7-a-side', 'pitch_names', jsonb_build_array('Pitch 1', 'Pitch 2'))),
    'prices', jsonb_build_array(jsonb_build_object('format', '5-a-side', 'price_cents', 6000),
                                jsonb_build_object('format', '7-a-side', 'price_cents', 8450)))));
  v_first text;
begin
  assert (select count(*) from public.pitches where venue_id = v_id) = 2, 'two pitches';
  assert (select formats from public.pitches where venue_id = v_id and name = 'Pitch 1') = array['5-a-side', '6-a-side'],
    'formats as the sheet says';
  assert (select indoor and surface is null from public.pitches where venue_id = v_id and name = 'Pitch 2'),
    'indoor read, a blank surface stays empty';
  assert (select count(*) from public.pitch_combinations where venue_id = v_id and format = '7-a-side'
          and cardinality(pitch_ids) = 2) = 1, 'the combination joins both pitches';
  assert (select price_cents from public.price_rules where venue_id = v_id and format = '5-a-side') = 6000, '5s price';
  assert (select price_cents from public.price_rules where venue_id = v_id and format = '7-a-side') = 8450, '7s price';
  assert (select latitude = 35.1594 and longitude = 33.3501 from public.venues where id = v_id), 'coordinates';

  -- 2. Running it again gives the same data (no second combination, no new pitch).
  v_first := tests.ip_state(v_id);
  perform tests.ip_import(tests.ip_venue('V901', jsonb_build_object(
    'latitude', 35.1594, 'longitude', 33.3501,
    'pitches', jsonb_build_array(tests.ip_pitch('Pitch 1', '5-a-side', array['5-a-side', '6-a-side']),
                                 tests.ip_pitch('Pitch 2', '5-a-side', array['5-a-side'], true, null)),
    'combinations', jsonb_build_array(jsonb_build_object('format', '7-a-side', 'pitch_names', jsonb_build_array('Pitch 1', 'Pitch 2'))),
    'prices', jsonb_build_array(jsonb_build_object('format', '5-a-side', 'price_cents', 6000),
                                jsonb_build_object('format', '7-a-side', 'price_cents', 8450)))));
  assert tests.ip_state(v_id) = v_first, format('idempotent: %s vs %s', tests.ip_state(v_id), v_first);

  -- 3. A payload without F8's keys changes none of it (as before F8).
  perform tests.ip_import(tests.ip_venue('V901'));
  assert tests.ip_state(v_id) = v_first, 'no pitch, combination, price or coordinate keys: nothing changes';
end $$;

-- 4. Bad combinations are skipped: a pitch the venue doesn't have, too few
--    pitches, or a format the pitches can't host. The rest still imports.
do $$
declare
  v_id uuid := tests.ip_import(tests.ip_venue('V902', jsonb_build_object(
    'pitches', jsonb_build_array(tests.ip_pitch('Pitch 1', '5-a-side', array['5-a-side']),
                                 tests.ip_pitch('Pitch 2', '7-a-side', array['7-a-side'])),
    'combinations', jsonb_build_array(
      jsonb_build_object('format', '9-a-side', 'pitch_names', jsonb_build_array('Pitch 1', 'Pitch 9')),
      jsonb_build_object('format', '9-a-side', 'pitch_names', jsonb_build_array('Pitch 1')),
      jsonb_build_object('format', '7-a-side', 'pitch_names', jsonb_build_array('Pitch 1', 'Pitch 2')),
      jsonb_build_object('format', '9-a-side', 'pitch_names', jsonb_build_array('Pitch 1', 'Pitch 2'))))));
begin
  assert (select count(*) from public.pitches where venue_id = v_id) = 2, 'pitches imported';
  assert (select array_agg(format) from public.pitch_combinations where venue_id = v_id) = array['9-a-side'],
    'only the 9-a-side combination of a 5 and a 7 is kept';
end $$;

-- 5. A pitch from another venue is never used in a combination.
do $$
declare
  v_other uuid := tests.ip_import(tests.ip_venue('V903', jsonb_build_object(
    'pitches', jsonb_build_array(tests.ip_pitch('Far pitch', '5-a-side', array['5-a-side'])))));
  v_id uuid := tests.ip_import(tests.ip_venue('V904', jsonb_build_object(
    'pitches', jsonb_build_array(tests.ip_pitch('Pitch 1', '5-a-side', array['5-a-side'])),
    'combinations', jsonb_build_array(jsonb_build_object('format', '7-a-side',
                                                         'pitch_names', jsonb_build_array('Pitch 1', 'Far pitch'))))));
begin
  assert v_other is not null;
  assert not exists (select 1 from public.pitch_combinations where venue_id = v_id), 'another venue''s pitch refused';
end $$;

-- 6. Coordinates outside Cyprus, or only one of the pair, are refused.
do $$
begin
  assert tests.error_of(format('select tests.ip_import(%L::jsonb)',
    tests.ip_venue('V905', '{"latitude": 51.5072, "longitude": -0.1276}'))) ~ 'invalid_coordinates', 'London refused';
  assert tests.error_of(format('select tests.ip_import(%L::jsonb)',
    tests.ip_venue('V905', '{"latitude": 35.1594}'))) ~ 'invalid_coordinates', 'half a pair refused';
  assert tests.error_of(format('select tests.ip_import(%L::jsonb)',
    tests.ip_venue('V905', jsonb_build_object('prices', jsonb_build_array(
      jsonb_build_object('format', '5-a-side', 'price_cents', 0)))))) ~ 'invalid_price', 'a €0 price refused';
end $$;

-- 7. A pitch holding a game keeps its size and formats; nothing is deleted,
--    and a pitch missing from the tab stays.
do $$
declare
  v_owner uuid := tests.create_user('ip-owner@futty.test');
  v_booker uuid := tests.create_user('ip-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);  -- "Pitch 1" and "Pitch 2", 5-a-side
  v_booking public.venue_bookings;
  v_pitch uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'ip');
  select bp.pitch_id into v_pitch from public.booking_pitches bp where bp.booking_id = v_booking.id limit 1;
  assert v_pitch is not null, 'the booking holds a pitch';

  -- The sheet now says every pitch is a 7-a-side, and lists only "Pitch 1".
  perform tests.ip_import(tests.ip_venue('V906', jsonb_build_object(
    'existing_venue_id', v_venue,
    'pitches', jsonb_build_array(
      tests.ip_pitch((select name from public.pitches where id = v_pitch), '7-a-side', array['7-a-side'], true, 'grass')))));

  assert (select size = '5-a-side' and formats = array['5-a-side'] and indoor and surface = 'grass'
          from public.pitches where id = v_pitch),
    'the booked pitch keeps its size and formats; surface and indoor follow the sheet';
  assert (select count(*) from public.pitches where venue_id = v_venue) = 2, 'no pitch deleted';
  assert exists (select 1 from public.booking_pitches where booking_id = v_booking.id and pitch_id = v_pitch),
    'the game keeps its pitch';
end $$;

-- 8. import_venue stays service_role only.
do $$
begin
  assert not has_function_privilege('authenticated', 'public.import_venue(jsonb)', 'execute'), 'not for players';
  assert not has_function_privilege('anon', 'public.import_venue(jsonb)', 'execute'), 'not for anon';
end $$;

select 'pay import pitches passed' as result;

rollback;
