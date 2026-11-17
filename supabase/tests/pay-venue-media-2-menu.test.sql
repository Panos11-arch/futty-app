-- P6e amenities and the food and drink menu (spec 13, "Venue photos,
-- amenities and menu", decided 17 November, Dimitris; for Panos to
-- confirm). Amenities come from the fixed list; menu items have a price
-- above €0 in integer cents, and an offer price below it. Players see the
-- active items on the venue page, grouped by category.
begin;

create function tests.vm_item(p_name text, p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object('name', p_name, 'category', 'Drinks', 'price_cents', 350, 'active', true) || p_extra;
$$;

-- 1. Amenities: replaced as a whole, from the fixed list.
do $$
declare
  v_owner uuid := tests.create_user('vm-am-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_bad jsonb;
begin
  perform tests.act_as(v_owner);
  perform public.set_venue_amenities(v_venue, '[{"kind": "parking", "note": " free "}, {"kind": "showers"},
                                                {"kind": "other", "note": "Table tennis"}]');
  assert public.venue_media(v_venue) -> 'amenities' = '[{"kind": "other", "note": "Table tennis"},
                                                       {"kind": "parking", "note": "free"},
                                                       {"kind": "showers", "note": null}]'::jsonb,
    format('saved, trimmed: %s', public.venue_media(v_venue) -> 'amenities');
  perform public.set_venue_amenities(v_venue, '[{"kind": "wifi", "note": "  "}]');
  assert public.venue_media(v_venue) -> 'amenities' = '[{"kind": "wifi", "note": null}]'::jsonb, 'replaced; blank note is none';

  foreach v_bad in array array[
    '[{"kind": "pool"}]', '[{"kind": "wifi"}, {"kind": "wifi"}]', '[{"kind": "other"}]',
    '[{"kind": "other", "note": " "}]', jsonb_build_array(jsonb_build_object('kind', 'bibs', 'note', repeat('x', 61))),
    '{"kind": "wifi"}'
  ]::jsonb[] loop
    assert tests.error_of(format('select public.set_venue_amenities(%L, %L)', v_venue, v_bad)) = 'invalid_amenities',
      format('%s gave %s', v_bad, tests.error_of(format('select public.set_venue_amenities(%L, %L)', v_venue, v_bad)));
  end loop;
  assert public.venue_media(v_venue) -> 'amenities' = '[{"kind": "wifi", "note": null}]'::jsonb, 'unchanged after refusals';
  perform tests.act_as_postgres();
  assert (select amenities_edited_at from public.venue_media_edits where venue_id = v_venue) is not null, 'marked edited';
end $$;

-- 2. Menu items: prices in integer cents above €0, an offer below the price.
do $$
declare
  v_owner uuid := tests.create_user('vm-menu-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_id uuid;
  v_item jsonb;
  v_bad jsonb;
  v_error text;
begin
  perform tests.act_as(v_owner);
  v_id := public.save_menu_item(v_venue, null, tests.vm_item('Lemonade', '{"description": "500 ml", "is_post_match_offer": true,
            "offer_price_cents": 250, "offer_text": "After your match", "available_from": "15:00", "available_to": "22:30",
            "available_weekdays": [5, 1], "dietary_tags": ["vegan"]}'));
  v_item := public.venue_media(v_venue) -> 'items' -> 0;
  assert (v_item ->> 'id')::uuid = v_id, 'saved';
  assert (v_item ->> 'price_cents')::integer = 350 and (v_item ->> 'offer_price_cents')::integer = 250, format('cents exact: %s', v_item);
  assert v_item ->> 'available_from' = '15:00' and v_item ->> 'available_to' = '22:30', 'window';
  assert v_item -> 'available_weekdays' = '[1, 5]'::jsonb, 'days sorted';
  assert v_item -> 'dietary_tags' = '["vegan"]'::jsonb and v_item ->> 'offer_text' = 'After your match', 'tags and offer';

  -- Editing keeps the id; an item that's not an offer keeps no offer price or text.
  perform public.save_menu_item(v_venue, v_id, tests.vm_item('Lemonade', '{"price_cents": 400, "offer_price_cents": 300,
            "offer_text": "x", "is_post_match_offer": false}'));
  v_item := public.venue_media(v_venue) -> 'items' -> 0;
  assert (v_item ->> 'price_cents')::integer = 400, 'edited';
  assert v_item -> 'offer_price_cents' = 'null'::jsonb and v_item -> 'offer_text' = 'null'::jsonb, 'no offer fields off an offer';
  assert v_item -> 'available_from' = 'null'::jsonb and v_item -> 'available_weekdays' = 'null'::jsonb, 'all day, every day';

  foreach v_bad in array array[
    '{"name": " "}', jsonb_build_object('name', repeat('x', 61)),
    '{"price_cents": 0}', '{"price_cents": null}', '{"price_cents": -100}', '{"price_cents": 3.5}', '{"price_cents": "350"}',
    '{"is_post_match_offer": true, "offer_price_cents": 350}', '{"is_post_match_offer": true, "offer_price_cents": 400}',
    '{"is_post_match_offer": true, "offer_price_cents": 0}',
    '{"available_from": "22:00", "available_to": "15:00"}', '{"available_from": "15:00"}', '{"available_from": "25:00", "available_to": "26:00"}',
    '{"available_weekdays": [0]}', '{"available_weekdays": [8]}',
    jsonb_build_object('category', repeat('x', 41)), jsonb_build_object('description', repeat('x', 201)),
    jsonb_build_object('is_post_match_offer', true, 'offer_text', repeat('x', 121))
  ]::jsonb[] loop
    v_error := tests.error_of(format('select public.save_menu_item(%L, null, %L)', v_venue, tests.vm_item('New', v_bad)));
    assert v_error like 'invalid_%', format('%s gave %s', v_bad, v_error);
  end loop;
  -- The price is required even without the key.
  v_error := tests.error_of(format('select public.save_menu_item(%L, null, %L)', v_venue, tests.vm_item('New') - 'price_cents'));
  assert v_error = 'invalid_price', format('missing price gave %s', v_error);

  perform public.save_menu_item(v_venue, null, tests.vm_item('Water', '{"price_cents": 100}'));
  assert tests.error_of(format('select public.save_menu_item(%L, null, %L)', v_venue, tests.vm_item(' water '))) = 'item_name_taken',
    'names are unique per venue, whatever the case';
  assert tests.error_of(format('select public.save_menu_item(%L, %L, %L)', v_venue, v_id, tests.vm_item('Water'))) = 'item_name_taken',
    'renaming onto another item';
  assert (select count(*) from public.venue_menu_items where venue_id = v_venue) = 2, 'only the two good items';
  perform tests.act_as_postgres();
  assert (select menu_edited_at from public.venue_menu_items i join public.venue_media_edits e on e.venue_id = i.venue_id
          where i.id = v_id) is not null, 'marked edited';
end $$;

-- 3. Switching off, reordering, deleting, and what players see.
do $$
declare
  v_owner uuid := tests.create_user('vm-list-owner@futty.test');
  v_player uuid := tests.create_user('vm-list-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_d uuid;
  v_menu jsonb;
begin
  update public.venues set is_live = true where id = v_venue;
  perform tests.act_as(v_owner);
  v_a := public.save_menu_item(v_venue, null, tests.vm_item('Cola'));
  v_b := public.save_menu_item(v_venue, null, tests.vm_item('Beer', '{"price_cents": 450, "is_post_match_offer": true,
                                                                       "offer_price_cents": 400}'));
  v_c := public.save_menu_item(v_venue, null, tests.vm_item('Halloumi pitta', '{"category": "Food", "price_cents": 600}'));
  v_d := public.save_menu_item(v_venue, null, tests.vm_item('Coffee', '{"category": null}'));
  perform public.set_menu_item_active(v_a, false);

  assert tests.error_of(format('select public.reorder_menu_items(%L, %L::uuid[])', v_venue, array[v_a, v_b])) = 'item_list_mismatch',
    'all items, each once';
  perform public.reorder_menu_items(v_venue, array[v_d, v_c, v_b, v_a]);
  assert jsonb_array_length(public.venue_media(v_venue) -> 'items') = 4, 'staff see the switched-off item too';
  perform tests.act_as(v_player);
  v_menu := public.venue_page(v_venue) -> 'menu';
  assert (select array_agg(m ->> 'name' order by o) from jsonb_array_elements(v_menu) with ordinality t(m, o))
         = array['Beer', 'Halloumi pitta', 'Coffee'],
    format('players: active only, by category (Drinks, Food, then none), then the staff order: %s', v_menu);
  assert (v_menu -> 0 ->> 'price_cents')::integer = 450 and (v_menu -> 0 ->> 'offer_price_cents')::integer = 400, 'prices from the server';
  assert public.venue_page(v_venue) -> 'offers' -> 0 ->> 'name' = 'Beer', 'offers as before';
  perform tests.act_as(v_owner);
  perform public.set_menu_item_active(v_a, true);
  assert public.delete_menu_item(v_d) is null, 'no photo to delete';
  assert not exists (select 1 from public.venue_menu_items where id = v_d), 'deleted';
  perform tests.act_as_postgres();
end $$;

-- 4. Item photos: the venue's items folder, after permission; the old path
--    comes back to delete. Deleting an item keeps its post-match codes.
do $$
declare
  v_owner uuid := tests.create_user('vm-ph-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_one text := v_venue || '/items/' || gen_random_uuid() || '.jpg';
  v_two text := v_venue || '/items/' || gen_random_uuid() || '.jpg';
  v_item uuid;
  v_other uuid;
  v_match uuid;
begin
  insert into storage.objects (bucket_id, name) values ('venue-photos', v_one), ('venue-photos', v_two);
  perform tests.act_as(v_owner);
  v_item := public.save_menu_item(v_venue, null, tests.vm_item('Juice'));
  v_other := public.save_menu_item(v_venue, null, tests.vm_item('Tea'));
  assert tests.error_of(format('select public.set_menu_item_photo(%L, %L)', v_item, v_one)) = 'photo_permission_required', 'permission';
  perform public.confirm_photo_permission(v_venue);
  assert tests.error_of(format('select public.set_menu_item_photo(%L, %L)', v_item, v_venue || '/photos/' || gen_random_uuid() || '.jpg'))
         = 'invalid_photo_path', 'items folder only';
  assert tests.error_of(format('select public.set_menu_item_photo(%L, %L)', v_item, v_venue || '/items/' || gen_random_uuid() || '.jpg'))
         = 'photo_file_missing', 'uploaded first';
  assert public.set_menu_item_photo(v_item, v_one) is null, 'no old photo';
  assert tests.error_of(format('select public.set_menu_item_photo(%L, %L)', v_other, v_one)) = 'photo_path_in_use', 'one item per file';
  assert public.set_menu_item_photo(v_item, v_two) = v_one, 'the old path to delete';
  assert public.set_menu_item_photo(v_item, null) = v_two, 'photo removed';
  perform public.set_menu_item_photo(v_item, v_one);
  perform tests.act_as_postgres();

  -- A post-match code for the item, then the item is deleted.
  insert into public.matches (venue_id, kind, format, players_per_side, kickoff_at, ends_at, result_deadline_at)
  values (v_venue, 'pickup', '5-a-side', 5, now() - interval '2 hours', now() - interval '1 hour', now() + interval '1 day')
  returning id into v_match;
  insert into public.post_match_offer_codes (code, match_id, item_id, venue_id, profile_id, expires_at, redeemed_at, redeemed_by)
  values ('ABCDEF', v_match, v_item, v_venue, v_owner, now() + interval '1 hour', now(), v_owner);
  perform tests.act_as(v_owner);
  assert public.delete_menu_item(v_item) = v_one, 'delete returns the photo to remove';
  perform tests.act_as_postgres();
  assert (select item_id is null and redeemed_at is not null from public.post_match_offer_codes where code = 'ABCDEF'),
    'the code and its redemption stay';
end $$;

-- 5. Only that venue's staff.
do $$
declare
  v_owner_a uuid := tests.create_user('vm-msec-a@futty.test');
  v_owner_b uuid := tests.create_user('vm-msec-b@futty.test');
  v_player uuid := tests.create_user('vm-msec-player@futty.test');
  v_venue_a uuid := tests.create_venue(p_owner => v_owner_a);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b);
  v_item uuid;
  v_call text;
  v_pair text[];
  v_error text;
begin
  perform tests.act_as(v_owner_a);
  v_item := public.save_menu_item(v_venue_a, null, tests.vm_item('Cola'));
  perform tests.act_as_postgres();

  foreach v_call in array array[
    format('select public.set_venue_amenities(%L, ''[]'')', v_venue_a),
    format('select public.save_menu_item(%L, null, %L)', v_venue_a, tests.vm_item('Sneaky')),
    format('select public.save_menu_item(%L, %L, %L)', v_venue_a, v_item, tests.vm_item('Sneaky')),
    format('select public.reorder_menu_items(%L, array[%L]::uuid[])', v_venue_a, v_item)
  ] loop
    assert tests.error_as(v_owner_b, v_call) = 'not_venue_staff', format('B: %s', v_call);
    assert tests.error_as(v_player, v_call) = 'not_venue_staff', format('player: %s', v_call);
    perform tests.act_as_anon();
    v_error := tests.error_of(v_call);
    perform tests.act_as_postgres();
    assert v_error like 'permission denied%', format('signed out: %s gave %s', v_call, v_error);
  end loop;

  foreach v_pair slice 1 in array array[
    array[format('select public.set_menu_item_active(%L, false)', v_item), format('select public.set_menu_item_active(%L, false)', gen_random_uuid())],
    array[format('select public.set_menu_item_photo(%L, null)', v_item), format('select public.set_menu_item_photo(%L, null)', gen_random_uuid())],
    array[format('select public.delete_menu_item(%L)', v_item), format('select public.delete_menu_item(%L)', gen_random_uuid())]
  ] loop
    assert tests.error_as(v_player, v_pair[1]) = 'not_venue_staff', format('player: %s', v_pair[1]);
    v_error := tests.error_as(v_owner_b, v_pair[1]);
    assert v_error = 'item_not_found' and v_error = tests.error_as(v_owner_b, v_pair[2]), format('B: %s gave %s', v_pair[1], v_error);
  end loop;
  assert (select active from public.venue_menu_items where id = v_item), 'untouched';
  assert tests.error_as(v_owner_a, format('update public.venue_menu_items set price_cents = 1 where id = %L', v_item))
         like 'permission denied%', 'no direct write';
end $$;

rollback;
