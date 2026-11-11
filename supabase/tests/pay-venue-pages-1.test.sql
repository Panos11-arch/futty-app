-- P9: venue pages and the venue data import (spec 13, "Venue pages and the
-- venue data import", decided 11 November). import_venue loads one venue
-- from the sheet: idempotent on the import key, never live, photos only
-- with permission, blank cells stay empty, never a price or a pitch. A venue
-- that isn't live is hidden from players; venue_page shows only active
-- items; a venue with no price can't be booked.
begin;

-- One venue as the import script sends it (test-only, this transaction).
create function tests.vp_venue(p_key text, p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'import_key', p_key,
    'name', 'Import arena ' || p_key,
    'city', 'Nicosia (Strovolos)',
    'address', '2 Aristidou Street, Latsia',
    'google_maps_link', 'https://www.google.com/maps/place/?q=place_id:abc',
    'phone', '+357 99 530500',
    'website', null,
    'instagram', '@arena',
    'pitches_summary', '6x 5x5, 3x 7x7 (half)',
    'sheet_status', 'prospect',
    'notes', 'Source: Google Maps.',
    'photo_permission', true,
    'hours', jsonb_build_array(
      jsonb_build_object('weekday', 1, 'opens', '15:00', 'closes', '22:30'),
      jsonb_build_object('weekday', 6, 'opens', '08:00', 'closes', '23:59:59')),
    'amenities', jsonb_build_array(
      jsonb_build_object('kind', 'parking', 'note', 'free'),
      jsonb_build_object('kind', 'cafe_or_bar', 'note', null)),
    'photos', jsonb_build_array(
      jsonb_build_object('storage_path', p_key || '-photo-1.jpg', 'sort_order', 1),
      jsonb_build_object('storage_path', p_key || '-photo-2.jpg', 'sort_order', 2)),
    'items', jsonb_build_array(
      jsonb_build_object('name', 'Lemonade', 'category', 'drink', 'description', 'Fresh lemonade, 500 ml',
                         'price_cents', 300, 'available_from', '15:00', 'available_to', '22:30',
                         'available_weekdays', jsonb_build_array(1, 2, 3, 4, 5, 6, 7), 'is_post_match_offer', true,
                         'offer_text', 'Lemonade after your match', 'offer_price_cents', 250,
                         'photo_path', 'items/lemonade.jpg', 'dietary_tags', jsonb_build_array('vegan'), 'active', true),
      jsonb_build_object('name', 'Old pie', 'category', 'food', 'price_cents', 450, 'is_post_match_offer', true,
                         'offer_text', 'Pie deal', 'active', false))
  ) || p_extra;
$$;

create function tests.vp_import(p_venue jsonb)
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

-- Everything an import writes for one venue, as text, to compare runs.
create function tests.vp_snapshot(p_venue uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select concat_ws(' | ',
    (select row(v.id, v.name, v.city, v.address, v.google_maps_link, v.phone, v.website, v.instagram, v.import_key,
                v.is_live, v.base_pitches, v.open_time, v.close_time, v.price_per_pitch_hour)::text
     from public.venues v where v.id = p_venue),
    (select row(d.pitches_summary, d.sheet_status, d.notes, d.photo_permission)::text
     from public.venue_import_details d where d.venue_id = p_venue),
    (select string_agg(row(h.weekday, h.opens, h.closes)::text, ',' order by h.weekday)
     from public.opening_hours h where h.venue_id = p_venue),
    (select string_agg(row(a.kind, a.note)::text, ',' order by a.kind) from public.venue_amenities a where a.venue_id = p_venue),
    (select string_agg(row(p.id, p.storage_path, p.sort_order)::text, ',' order by p.storage_path)
     from public.venue_photos p where p.venue_id = p_venue),
    (select string_agg(row(i.id, i.name, i.category, i.description, i.price_cents, i.available_from, i.available_to,
                           i.available_weekdays, i.is_post_match_offer, i.offer_text, i.offer_price_cents, i.photo_path,
                           i.dietary_tags, i.active)::text, ',' order by i.name)
     from public.venue_menu_items i where i.venue_id = p_venue),
    (select count(*)::text from public.pitches where venue_id = p_venue),
    (select count(*)::text from public.price_rules where venue_id = p_venue));
$$;

-- 1. An import creates the venue, not live, with exactly what the sheet says;
--    no price, no pitch, and no made-up legacy values.
do $$
declare
  v_id uuid := tests.vp_import(tests.vp_venue('V901'));
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = v_id;
  assert v_venue.import_key = 'V901' and v_venue.name = 'Import arena V901', 'created under its key';
  assert not v_venue.is_live, 'an imported venue is not live';
  assert v_venue.address = '2 Aristidou Street, Latsia' and v_venue.website is null, 'blank cells stay empty';
  assert v_venue.base_pitches is null and v_venue.open_time is null and v_venue.close_time is null
         and v_venue.price_per_pitch_hour is null, 'no legacy values made up';
  assert not exists (select 1 from public.price_rules where venue_id = v_id), 'no price';
  assert not exists (select 1 from public.pitches where venue_id = v_id), 'no pitch';
  assert (select pitches_summary from public.venue_import_details where venue_id = v_id) = '6x 5x5, 3x 7x7 (half)',
    'the pitch text kept for our own use';
  assert (select count(*) from public.opening_hours where venue_id = v_id) = 2, 'only the days with hours';
  assert (select closes from public.opening_hours where venue_id = v_id and weekday = 6) = '23:59:59', 'midnight close';
  assert (select count(*) from public.venue_photos where venue_id = v_id) = 2, 'photos with permission';
  assert (select price_cents from public.venue_menu_items where venue_id = v_id and name = 'Lemonade') = 300
         and (select offer_price_cents from public.venue_menu_items where venue_id = v_id and name = 'Lemonade') = 250,
    'item prices in cents';
end $$;

-- 2. Importing twice gives the same data (same ids, same rows).
do $$
declare
  v_first uuid := tests.vp_import(tests.vp_venue('V902'));
  v_before text := tests.vp_snapshot(v_first);
  v_second uuid := tests.vp_import(tests.vp_venue('V902'));
begin
  assert v_second = v_first, 'the same venue';
  assert tests.vp_snapshot(v_second) = v_before, format('same data, before %s, after %s', v_before, tests.vp_snapshot(v_second));
  assert (select count(*) from public.venues where import_key = 'V902') = 1, 'one venue';
end $$;

-- 3. A changed sheet: the venue follows it. An item that's gone is switched
--    off, not deleted; a cell emptied is emptied.
do $$
declare
  v_id uuid := tests.vp_import(tests.vp_venue('V903'));
  v_lemonade uuid;
begin
  select id into v_lemonade from public.venue_menu_items where venue_id = v_id and name = 'Lemonade';
  perform tests.vp_import(tests.vp_venue('V903', jsonb_build_object(
    'phone', null, 'hours', '[]'::jsonb, 'amenities', '[]'::jsonb, 'items', '[]'::jsonb)));
  assert (select phone from public.venues where id = v_id) is null, 'emptied';
  assert not exists (select 1 from public.opening_hours where venue_id = v_id), 'no hours';
  assert not exists (select 1 from public.venue_amenities where venue_id = v_id), 'no amenities';
  assert (select active from public.venue_menu_items where id = v_lemonade) = false, 'item switched off, same row';
end $$;

-- 4. A photo without permission isn't imported, but its venue is.
do $$
declare
  v_id uuid := tests.vp_import(tests.vp_venue('V904', '{"photo_permission": false}'));
begin
  assert v_id is not null and exists (select 1 from public.venues where id = v_id), 'the venue is imported';
  assert not exists (select 1 from public.venue_photos where venue_id = v_id), 'no photos without permission';
  assert (select photo_path from public.venue_menu_items where venue_id = v_id and name = 'Lemonade') is null,
    'no item photos either';
  assert (select photo_permission from public.venue_import_details where venue_id = v_id) = false, 'recorded';

  -- Permission not given at all (blank cell): the same.
  v_id := tests.vp_import(tests.vp_venue('V905') - 'photo_permission');
  assert not exists (select 1 from public.venue_photos where venue_id = v_id), 'blank permission: no photos';

  -- Permission withdrawn after an import with it: the photos go.
  v_id := tests.vp_import(tests.vp_venue('V906'));
  assert (select count(*) from public.venue_photos where venue_id = v_id) = 2, 'with permission';
  perform tests.vp_import(tests.vp_venue('V906', '{"photo_permission": false}'));
  assert not exists (select 1 from public.venue_photos where venue_id = v_id), 'withdrawn: removed';
end $$;

-- 5. Every imported venue is not live, and an import never changes is_live
--    of a venue that already exists (going live is a separate step).
do $$
declare
  v_id uuid;
  v_mapped uuid := tests.create_venue();
begin
  for i in 1 .. 3 loop
    perform tests.vp_import(tests.vp_venue(format('V91%s', i)));
  end loop;
  assert not exists (select 1 from public.venues where import_key like 'V9%' and is_live), 'none is live';

  v_id := (select id from public.venues where import_key = 'V911');
  update public.venues set is_live = true where id = v_id;
  perform tests.vp_import(tests.vp_venue('V911'));
  assert (select is_live from public.venues where id = v_id), 'a re-import leaves a live venue live';

  -- The mapping file names an existing venue: it's updated, never duplicated.
  perform tests.vp_import(tests.vp_venue('V920', jsonb_build_object('existing_venue_id', v_mapped)));
  assert (select import_key from public.venues where id = v_mapped) = 'V920', 'mapped by id';
  assert (select count(*) from public.venues where import_key = 'V920') = 1, 'no duplicate';
  assert (select is_live from public.venues where id = v_mapped), 'its is_live is left as it was';
  assert (select price_per_pitch_hour from public.venues where id = v_mapped) = 60, 'existing legacy values kept';
end $$;

-- 6. Refusals: bad key, no name, a mapping that doesn't fit; the import is
--    the service role's only.
do $$
declare
  v_user uuid := tests.create_user('vp-refuse@futty.test');
  v_a uuid := tests.vp_import(tests.vp_venue('V930'));
  v_b uuid := tests.create_venue();
begin
  perform tests.act_as_service_role();
  assert tests.error_of(format('select public.import_venue(%L)', tests.vp_venue('X1'))) = 'invalid_import_key', 'key';
  assert tests.error_of(format('select public.import_venue(%L)', tests.vp_venue('V931', '{"name": " "}')))
         = 'venue_name_required', 'name';
  assert tests.error_of(format('select public.import_venue(%L)',
           tests.vp_venue('V932', jsonb_build_object('existing_venue_id', gen_random_uuid())))) = 'mapped_venue_not_found',
    'mapping to nothing';
  assert tests.error_of(format('select public.import_venue(%L)',
           tests.vp_venue('V933', jsonb_build_object('existing_venue_id', v_a)))) = 'mapped_venue_has_other_key',
    'mapping onto a venue imported under another key';
  assert tests.error_of(format('select public.import_venue(%L)',
           tests.vp_venue('V930', jsonb_build_object('existing_venue_id', v_b)))) = 'import_key_already_used',
    'a key already used by another venue';
  perform tests.act_as_postgres();

  assert not has_function_privilege('authenticated', 'public.import_venue(jsonb)', 'execute'), 'not players';
  assert not has_function_privilege('anon', 'public.import_venue(jsonb)', 'execute'), 'not anon';
  assert has_function_privilege('service_role', 'public.import_venue(jsonb)', 'execute'), 'the import';
  assert not has_table_privilege('authenticated', 'public.venue_import_details', 'select'), 'players never read the sheet notes';
end $$;

-- 7. A venue that isn't live is hidden from players completely; its owner
--    still sees it.
do $$
declare
  v_owner uuid := tests.create_user('vp-owner@futty.test');
  v_player uuid := tests.create_user('vp-player@futty.test');
  v_id uuid := tests.vp_import(tests.vp_venue('V940'));
  v_live uuid := tests.vp_import(tests.vp_venue('V941'));
begin
  update public.venues set owner_profile_id = v_owner where id = v_id;
  update public.venues set is_live = true where id = v_live;
  perform tests.create_pitch(v_id, 'Pitch 1');
  perform tests.set_price(v_id, '5-a-side', 6000);

  perform tests.act_as(v_player);
  assert not exists (select 1 from public.venues where id = v_id), 'player: no venue row';
  assert not exists (select 1 from public.pitches where venue_id = v_id), 'player: no pitches';
  assert not exists (select 1 from public.price_rules where venue_id = v_id), 'player: no prices';
  assert not exists (select 1 from public.opening_hours where venue_id = v_id), 'player: no hours';
  assert not exists (select 1 from public.venue_photos where venue_id = v_id), 'player: no photos';
  assert not exists (select 1 from public.venue_amenities where venue_id = v_id), 'player: no amenities';
  assert not exists (select 1 from public.venue_menu_items where venue_id = v_id), 'player: no items';
  assert tests.error_of(format('select public.venue_page(%L)', v_id)) = 'venue_not_found', 'player: no page';
  assert exists (select 1 from public.venues where id = v_live), 'player: a live venue is listed';
  assert (public.venue_page(v_live) -> 'venue' ->> 'name') = 'Import arena V941', 'player: its page';

  perform tests.act_as(v_owner);
  assert exists (select 1 from public.venues where id = v_id), 'owner: sees their venue';
  assert (select count(*) from public.venue_menu_items where venue_id = v_id) = 2, 'owner: all their items';
  assert (public.venue_page(v_id) -> 'venue' ->> 'name') = 'Import arena V940', 'owner: the page';

  perform tests.act_as_postgres();
  assert not has_table_privilege('anon', 'public.venue_menu_items', 'select')
         and not has_table_privilege('anon', 'public.venue_photos', 'select')
         and not has_function_privilege('anon', 'public.venue_page(uuid)', 'execute'), 'anon reads nothing';
end $$;

-- 8. The page shows only active items (and only offers), and only the
--    venue's own; a player reads only active items from the table too.
do $$
declare
  v_player uuid := tests.create_user('vp-items@futty.test');
  v_id uuid := tests.vp_import(tests.vp_venue('V950', jsonb_build_object('items', tests.vp_venue('V950') -> 'items'
    || jsonb_build_array(jsonb_build_object('name', 'Water', 'price_cents', 100, 'is_post_match_offer', false,
                                            'active', true)))));
  v_other uuid := tests.vp_import(tests.vp_venue('V951'));
  v_page jsonb;
begin
  update public.venues set is_live = true where id in (v_id, v_other);
  perform tests.act_as(v_player);
  v_page := public.venue_page(v_id);
  assert (select array_agg(o ->> 'name') from jsonb_array_elements(v_page -> 'offers') o) = array['Lemonade'],
    format('only the active offer, got %s', v_page -> 'offers');
  assert (v_page -> 'offers' -> 0 ->> 'offer_price_cents')::integer = 250, 'with its price from the server';
  assert (select array_agg(name order by name) from public.venue_menu_items where venue_id = v_id) = array['Lemonade', 'Water'],
    'the table: active items only';
  assert not (v_page ? 'pitches_summary') and not ((v_page -> 'venue') ? 'pitches_summary'), 'the pitch text isn''t shown';
  assert jsonb_array_length(v_page -> 'pitches') = 0, 'no pitches until real ones are entered';
  assert (v_page ->> 'bookable')::boolean = false, 'live but no price: not bookable';
  perform tests.act_as_postgres();
end $$;

-- 9. A live venue with no price can't be booked; with a price and a pitch it can.
do $$
declare
  v_player uuid := tests.create_user('vp-book@futty.test');
  v_id uuid := tests.vp_import(tests.vp_venue('V960', jsonb_build_object('hours',
    (select jsonb_agg(jsonb_build_object('weekday', d, 'opens', '08:00', 'closes', '23:00')) from generate_series(1, 7) d))));
  v_day date := tests.cyprus_today() + 3;
begin
  update public.venues set is_live = true where id = v_id;
  perform tests.create_pitch(v_id, 'Pitch 1');
  perform tests.act_as(v_player);
  assert tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5, ''each_pays_own_spot'')',
    v_id, v_day)) = 'price_not_set', 'no price: refused';
  perform tests.act_as_postgres();

  perform tests.set_price(v_id, '5-a-side', 6000);
  perform tests.act_as(v_player);
  assert (public.venue_page(v_id) ->> 'bookable')::boolean, 'priced: bookable';
  assert (public.venue_page(v_id) -> 'prices' -> 0 ->> 'hour_cents')::integer = 6000, 'the hourly price from price_rules';
  assert tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5, ''each_pays_own_spot'')',
    v_id, v_day)) is null, 'priced: booked';
  perform tests.act_as_postgres();
end $$;

-- 10. Photo files: private bucket, readable only where the venue is visible.
do $$
declare
  v_player uuid := tests.create_user('vp-files@futty.test');
  v_hidden uuid := tests.vp_import(tests.vp_venue('V970'));
  v_live uuid := tests.vp_import(tests.vp_venue('V971'));
begin
  update public.venues set is_live = true where id = v_live;
  assert not (select public from storage.buckets where id = 'venue-photos'), 'private bucket';
  insert into storage.objects (bucket_id, name) values
    ('venue-photos', 'V970/a.jpg'), ('venue-photos', 'V971/b.jpg'), ('venue-photos', 'V971/items/lemonade.jpg'),
    ('venue-photos', v_hidden || '/c.jpg'), ('venue-photos', v_live || '/d.jpg'), ('venue-photos', 'V999/e.jpg');
  perform tests.act_as(v_player);
  assert (select array_agg(name order by name) from storage.objects where bucket_id = 'venue-photos')
         = (select array_agg(x order by x) from unnest(array['V971/b.jpg', 'V971/items/lemonade.jpg', v_live || '/d.jpg']) x),
    format('only the live venue''s files, got %s',
           (select array_agg(name order by name) from storage.objects where bucket_id = 'venue-photos'));
  perform tests.act_as_postgres();
end $$;

select 'pay venue pages 1 passed' as result;

rollback;
