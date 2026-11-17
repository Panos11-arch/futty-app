-- P6e and the venue import (spec 13, "Venue photos, amenities and menu",
-- decided 17 November, Dimitris; for Panos to confirm). Once staff edit a
-- venue's photos, amenities or menu in the app, a re-import leaves that part
-- alone and still loads the rest. Withdrawn permission still removes the
-- sheet's own photos, never the ones staff uploaded. The bucket takes the
-- import's jpg, png and webp up to 5 MB.
begin;

create function tests.vm_sheet(p_key text, p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'import_key', p_key,
    'name', 'Sheet arena ' || p_key,
    'address', 'Old street 1',
    'photo_permission', true,
    'hours', '[]'::jsonb,
    'amenities', '[{"kind": "parking", "note": null}]'::jsonb,
    'photos', jsonb_build_array(jsonb_build_object('storage_path', p_key || '/photo-1.jpg', 'sort_order', 1)),
    'items', jsonb_build_array(jsonb_build_object('name', 'Sheet lemonade', 'price_cents', 300, 'active', true,
                                                  'photo_path', p_key || '/items/lemonade.jpg'))
  ) || p_extra;
$$;

create function tests.vm_import(p_venue jsonb)
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

-- 1. The bucket: private, jpg, png and webp, 5 MB.
do $$
begin
  assert (select not public and file_size_limit = 5242880
                 and allowed_mime_types::text[] @> array['image/jpeg', 'image/png', 'image/webp']
                 and cardinality(allowed_mime_types) = 3
          from storage.buckets where id = 'venue-photos'),
    format('bucket: %s', (select row_to_json(b) from storage.buckets b where id = 'venue-photos'));
end $$;

-- 2. Nothing edited by staff: the import does exactly what it did.
do $$
declare
  v_venue uuid := tests.vm_import(tests.vm_sheet('V980'));
begin
  perform tests.vm_import(tests.vm_sheet('V980', jsonb_build_object(
    'amenities', '[{"kind": "wifi", "note": null}]'::jsonb,
    'photos', '[{"storage_path": "V980/photo-2.jpg", "sort_order": 1}]'::jsonb,
    'items', '[]'::jsonb)));
  assert (select array_agg(kind) from public.venue_amenities where venue_id = v_venue) = array['wifi'], 'amenities replaced';
  assert (select array_agg(storage_path) from public.venue_photos where venue_id = v_venue) = array['V980/photo-2.jpg'], 'photos replaced';
  assert not (select active from public.venue_menu_items where venue_id = v_venue and name = 'Sheet lemonade'), 'item switched off';
end $$;

-- 3. Staff edited each part: the import leaves it alone, the rest still loads.
do $$
declare
  v_owner uuid := tests.create_user('vm-imp-owner@futty.test');
  v_venue uuid := tests.vm_import(tests.vm_sheet('V981'));
  v_staff_photo text;
  v_item uuid;
begin
  update public.venues set owner_profile_id = v_owner where id = v_venue;
  v_staff_photo := v_venue || '/photos/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name) values ('venue-photos', v_staff_photo);
  perform tests.act_as(v_owner);
  perform public.confirm_photo_permission(v_venue);
  perform public.add_venue_photo(v_venue, v_staff_photo);
  perform public.set_venue_amenities(v_venue, '[{"kind": "showers"}]');
  v_item := public.save_menu_item(v_venue, null, '{"name": "Staff cola", "price_cents": 250}');
  perform tests.act_as_postgres();

  perform tests.vm_import(tests.vm_sheet('V981', jsonb_build_object(
    'address', 'New street 2',
    'amenities', '[{"kind": "wifi", "note": null}]'::jsonb,
    'photos', '[{"storage_path": "V981/photo-9.jpg", "sort_order": 1}]'::jsonb,
    'items', '[{"name": "Sheet beer", "price_cents": 400, "active": true}]'::jsonb)));

  assert (select address from public.venues where id = v_venue) = 'New street 2', 'the rest still imports';
  assert (select array_agg(storage_path order by sort_order) from public.venue_photos where venue_id = v_venue)
         = array['V981/photo-1.jpg', v_staff_photo], 'photos untouched';
  assert (select array_agg(kind) from public.venue_amenities where venue_id = v_venue) = array['showers'], 'amenities untouched';
  assert (select array_agg(name order by name) from public.venue_menu_items where venue_id = v_venue and active)
         = array['Sheet lemonade', 'Staff cola'], 'menu untouched: nothing added or switched off';
end $$;

-- 4. Permission withdrawn in the sheet after staff edits: the sheet's own
--    photos (and item photos) go, staff uploads stay.
do $$
declare
  v_owner uuid := tests.create_user('vm-imp-perm@futty.test');
  v_venue uuid := tests.vm_import(tests.vm_sheet('V982'));
  v_staff_photo text;
begin
  update public.venues set owner_profile_id = v_owner where id = v_venue;
  v_staff_photo := v_venue || '/photos/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name) values ('venue-photos', v_staff_photo);
  perform tests.act_as(v_owner);
  perform public.confirm_photo_permission(v_venue);
  perform public.add_venue_photo(v_venue, v_staff_photo);
  perform public.save_menu_item(v_venue, null, '{"name": "Staff cola", "price_cents": 250}');
  perform tests.act_as_postgres();

  perform tests.vm_import(tests.vm_sheet('V982', '{"photo_permission": false}'));
  assert (select array_agg(storage_path) from public.venue_photos where venue_id = v_venue) = array[v_staff_photo],
    'only the staff photo is left';
  assert (select photo_path from public.venue_menu_items where venue_id = v_venue and name = 'Sheet lemonade') is null,
    'the sheet''s item photo is gone';
end $$;

rollback;
