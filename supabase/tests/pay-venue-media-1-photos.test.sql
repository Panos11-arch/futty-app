-- P6e venue photos (spec 13, "Venue photos, amenities and menu", decided
-- 17 November, Dimitris; for Panos to confirm). Staff confirm once that the
-- photos are theirs, then add up to 10 venue photos through the server; the
-- first is the cover everywhere. Files live at <venue id>/photos/<uuid>.jpg.
begin;

-- A file in the venue-photos bucket, as the Storage API would leave it.
create function tests.vm_file(p_path text)
returns text
language sql
as $$
  insert into storage.objects (bucket_id, name) values ('venue-photos', p_path) returning name;
$$;

create function tests.vm_photo_path(p_venue uuid)
returns text
language sql
as $$ select p_venue || '/photos/' || gen_random_uuid() || '.jpg' $$;

-- 1. Permission first: no photo before a staff member confirms; confirming
--    again keeps the first confirmation.
do $$
declare
  v_owner uuid := tests.create_user('vm-perm-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_path text := tests.vm_file(tests.vm_photo_path(v_venue));
  v_media jsonb;
  v_first timestamptz;
begin
  perform tests.act_as(v_owner);
  v_media := public.venue_media(v_venue);
  assert v_media -> 'photo_permission' = 'null'::jsonb, format('no permission yet: %s', v_media -> 'photo_permission');
  assert (v_media ->> 'max_photos')::integer = 10, 'ten photos at most';
  assert tests.error_of(format('select public.add_venue_photo(%L, %L)', v_venue, v_path)) = 'photo_permission_required',
    'no photo before permission';

  perform public.confirm_photo_permission(v_venue);
  v_media := public.venue_media(v_venue);
  assert (v_media -> 'photo_permission' ->> 'by')::uuid = v_owner, 'who confirmed';
  v_first := (v_media -> 'photo_permission' ->> 'at')::timestamptz;
  assert v_first is not null, 'when';
  perform public.confirm_photo_permission(v_venue);
  assert (public.venue_media(v_venue) -> 'photo_permission' ->> 'at')::timestamptz = v_first, 'first confirmation kept';
  perform tests.act_as_postgres();
end $$;

-- 2. Adding, the limit, the cover and reordering.
do $$
declare
  v_owner uuid := tests.create_user('vm-add-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_other uuid := tests.create_venue();
  v_paths text[] := '{}';
  v_ids uuid[] := '{}';
  v_id uuid;
  v_media jsonb;
  v_error text;
  i integer;
begin
  for i in 1..11 loop
    v_paths := v_paths || tests.vm_file(tests.vm_photo_path(v_venue));
  end loop;
  perform tests.act_as(v_owner);
  perform public.confirm_photo_permission(v_venue);

  -- Paths: only this venue's photos folder, a .jpg named by a uuid, a file
  -- that's in storage, and never one already used.
  foreach v_error in array array[
    format('select public.add_venue_photo(%L, %L)', v_venue, v_other || '/photos/' || gen_random_uuid() || '.jpg'),
    format('select public.add_venue_photo(%L, %L)', v_venue, v_venue || '/items/' || gen_random_uuid() || '.jpg'),
    format('select public.add_venue_photo(%L, %L)', v_venue, v_venue || '/photos/cover.jpg'),
    format('select public.add_venue_photo(%L, %L)', v_venue, v_venue || '/photos/' || gen_random_uuid() || '.png'),
    format('select public.add_venue_photo(%L, %L)', v_venue, 'V001/photo-1.jpg')
  ] loop
    assert tests.error_of(v_error) = 'invalid_photo_path', format('%s gave %s', v_error, tests.error_of(v_error));
  end loop;
  assert tests.error_of(format('select public.add_venue_photo(%L, %L)', v_venue, tests.vm_photo_path(v_venue))) = 'photo_file_missing',
    'the file must be uploaded first';

  for i in 1..10 loop
    v_ids := v_ids || public.add_venue_photo(v_venue, v_paths[i]);
  end loop;
  assert tests.error_of(format('select public.add_venue_photo(%L, %L)', v_venue, v_paths[1])) in ('photo_path_in_use', 'too_many_photos'),
    'a used path is refused';
  assert tests.error_of(format('select public.add_venue_photo(%L, %L)', v_venue, v_paths[11])) = 'too_many_photos', 'the 11th';

  v_media := public.venue_media(v_venue);
  assert jsonb_array_length(v_media -> 'photos') = 10, 'ten photos';
  assert (v_media -> 'photos' -> 0 ->> 'id')::uuid = v_ids[1], 'added in order';
  assert (v_media -> 'photos' -> 0 ->> 'is_cover')::boolean and not (v_media -> 'photos' -> 1 ->> 'is_cover')::boolean,
    'the first is the cover';

  -- Reorder: exactly the venue's photos, each once.
  assert tests.error_of(format('select public.reorder_venue_photos(%L, %L::uuid[])', v_venue, v_ids[1:9])) = 'photo_list_mismatch', 'one missing';
  assert tests.error_of(format('select public.reorder_venue_photos(%L, %L::uuid[])', v_venue, v_ids || v_ids[1])) = 'photo_list_mismatch', 'one twice';
  assert tests.error_of(format('select public.reorder_venue_photos(%L, %L::uuid[])', v_venue, v_ids[1:9] || gen_random_uuid())) = 'photo_list_mismatch',
    'a stranger';
  perform public.reorder_venue_photos(v_venue, array[v_ids[10]] || v_ids[1:9]);
  v_media := public.venue_media(v_venue);
  assert (v_media -> 'photos' -> 0 ->> 'id')::uuid = v_ids[10], 'new cover';
  assert (v_media -> 'photos' -> 1 ->> 'id')::uuid = v_ids[1], 'the rest follow';
  perform tests.act_as_postgres();

  -- The cover is what the Book list and the venue page show first.
  update public.venues set is_live = true where id = v_venue;
  perform tests.act_as(v_owner);
  assert (select f.photo_path from public.venues_free_at(tests.cyprus_today() + 2, '12:00', 60, '5-a-side', 5) f
          where f.venue_id = v_venue) = v_paths[10], 'Book card cover';
  assert public.venue_page(v_venue) -> 'photos' -> 0 ->> 'storage_path' = v_paths[10], 'venue page first photo';
  perform tests.act_as_postgres();

  assert (select photos_edited_at from public.venue_media_edits where venue_id = v_venue) is not null, 'marked as edited by staff';
end $$;

-- 3. Removing: the path comes back for the app to delete; the file can't be
--    read by players any more, and only then can staff delete it.
do $$
declare
  v_owner uuid := tests.create_user('vm-rm-owner@futty.test');
  v_player uuid := tests.create_user('vm-rm-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_keep text := tests.vm_file(tests.vm_photo_path(v_venue));
  v_drop text := tests.vm_file(tests.vm_photo_path(v_venue));
  v_drop_id uuid;
  v_count integer;
begin
  update public.venues set is_live = true where id = v_venue;
  perform tests.act_as(v_owner);
  perform public.confirm_photo_permission(v_venue);
  perform public.add_venue_photo(v_venue, v_keep);
  v_drop_id := public.add_venue_photo(v_venue, v_drop);
  perform tests.act_as(v_player);
  assert (select count(*) from storage.objects where bucket_id = 'venue-photos' and name in (v_keep, v_drop)) = 2, 'both readable';

  perform tests.act_as(v_owner);
  assert public.remove_venue_photo(v_drop_id) = v_drop, 'the path to delete';
  assert jsonb_array_length(public.venue_media(v_venue) -> 'photos') = 1, 'one left';
  perform tests.act_as(v_player);
  assert (select array_agg(name) from storage.objects where bucket_id = 'venue-photos' and name in (v_keep, v_drop)) = array[v_keep],
    'the removed file is unreadable';

  -- Staff delete through the Storage API: the orphan goes, a photo in use stays.
  perform set_config('storage.allow_delete_query', 'true', true);
  perform tests.act_as(v_owner);
  delete from storage.objects where bucket_id = 'venue-photos' and name = v_keep;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'a file a photo points to is never deleted';
  delete from storage.objects where bucket_id = 'venue-photos' and name = v_drop;
  get diagnostics v_count = row_count;
  assert v_count = 1, 'the orphan is deleted';
  perform tests.act_as(v_player);
  delete from storage.objects where bucket_id = 'venue-photos' and name = v_keep;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'a player deletes nothing';
  perform tests.act_as_postgres();
  perform set_config('storage.allow_delete_query', 'false', true);
end $$;

-- 4. Uploading straight to storage: only into the caller's own venue's
--    photos or items folder, as a .jpg, after permission. Never another
--    venue's, never as a player or signed out.
do $$
declare
  v_owner_a uuid := tests.create_user('vm-up-owner-a@futty.test');
  v_owner_b uuid := tests.create_user('vm-up-owner-b@futty.test');
  v_player uuid := tests.create_user('vm-up-player@futty.test');
  v_venue_a uuid := tests.create_venue(p_owner => v_owner_a);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b);
  v_sql text := 'insert into storage.objects (bucket_id, name) values (''venue-photos'', %L)';
  v_error text;
  v_count integer;
begin
  v_error := tests.error_as(v_owner_a, format(v_sql, tests.vm_photo_path(v_venue_a)));
  assert v_error like '%row-level security%', format('before permission: %s', v_error);

  perform tests.act_as(v_owner_a);
  perform public.confirm_photo_permission(v_venue_a);
  perform tests.act_as(v_owner_b);
  perform public.confirm_photo_permission(v_venue_b);
  perform tests.act_as_postgres();

  assert tests.error_as(v_owner_a, format(v_sql, tests.vm_photo_path(v_venue_a))) is null, 'own photos folder';
  assert tests.error_as(v_owner_a, format(v_sql, v_venue_a || '/items/' || gen_random_uuid() || '.jpg')) is null, 'own items folder';
  foreach v_error in array array[
    format(v_sql, tests.vm_photo_path(v_venue_b)),
    format(v_sql, v_venue_a || '/other/' || gen_random_uuid() || '.jpg'),
    format(v_sql, v_venue_a || '/photos/' || gen_random_uuid() || '.png'),
    format(v_sql, v_venue_a || '/photos/x.jpg'),
    format(v_sql, 'V001/photo-9.jpg')
  ] loop
    assert tests.error_as(v_owner_a, v_error) like '%row-level security%', format('refused: %s', v_error);
  end loop;
  assert tests.error_as(v_player, format(v_sql, tests.vm_photo_path(v_venue_a))) like '%row-level security%', 'a player';
  perform tests.act_as_anon();
  v_error := tests.error_of(format(v_sql, tests.vm_photo_path(v_venue_a)));
  perform tests.act_as_postgres();
  assert v_error like '%row-level security%' or v_error like 'permission denied%', format('signed out: %s', v_error);
  -- No replacing a file in place.
  perform tests.act_as(v_owner_a);
  update storage.objects set name = name where bucket_id = 'venue-photos';
  get diagnostics v_count = row_count;
  perform tests.act_as_postgres();
  assert v_count = 0, 'nothing updated';
end $$;

-- 5. Only that venue's staff: staff of B and players get not_venue_staff,
--    signed out is refused, and B's staff learn nothing from A's photo ids.
do $$
declare
  v_owner_a uuid := tests.create_user('vm-sec-owner-a@futty.test');
  v_owner_b uuid := tests.create_user('vm-sec-owner-b@futty.test');
  v_player uuid := tests.create_user('vm-sec-player@futty.test');
  v_venue_a uuid := tests.create_venue(p_owner => v_owner_a);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b);
  v_path text := tests.vm_file(tests.vm_photo_path(v_venue_a));
  v_photo uuid;
  v_call text;
  v_error text;
begin
  perform tests.act_as(v_owner_a);
  perform public.confirm_photo_permission(v_venue_a);
  v_photo := public.add_venue_photo(v_venue_a, v_path);
  perform tests.act_as_postgres();

  foreach v_call in array array[
    format('select public.venue_media(%L)', v_venue_a),
    format('select public.confirm_photo_permission(%L)', v_venue_a),
    format('select public.add_venue_photo(%L, %L)', v_venue_a, tests.vm_photo_path(v_venue_a)),
    format('select public.reorder_venue_photos(%L, array[%L]::uuid[])', v_venue_a, v_photo)
  ] loop
    assert tests.error_as(v_owner_b, v_call) = 'not_venue_staff', format('B: %s', v_call);
    assert tests.error_as(v_player, v_call) = 'not_venue_staff', format('player: %s', v_call);
    perform tests.act_as_anon();
    v_error := tests.error_of(v_call);
    perform tests.act_as_postgres();
    assert v_error like 'permission denied%', format('signed out: %s gave %s', v_call, v_error);
  end loop;

  assert tests.error_as(v_player, format('select public.remove_venue_photo(%L)', v_photo)) = 'not_venue_staff', 'player';
  assert tests.error_as(v_owner_b, format('select public.remove_venue_photo(%L)', v_photo)) = 'photo_not_found', 'B on A''s photo';
  assert tests.error_as(v_owner_b, format('select public.remove_venue_photo(%L)', gen_random_uuid())) = 'photo_not_found', 'unknown id';
  assert exists (select 1 from public.venue_photos where id = v_photo), 'still there';

  -- The tables stay read-only to the app.
  assert tests.error_as(v_owner_a, format('insert into public.venue_photos (venue_id, storage_path) values (%L, %L)',
                                          v_venue_a, tests.vm_photo_path(v_venue_a))) like 'permission denied%', 'no direct insert';
  assert tests.error_as(v_owner_a, 'select 1 from public.venue_media_edits') like 'permission denied%', 'edits table is internal';
end $$;

-- 6. Two uploads can't both be the 10th: add_venue_photo and
--    reorder_venue_photos lock the venue row before counting. At 9 photos,
--    two adds: exactly one succeeds. A second session would wait on the
--    venue row's lock, which this transaction now holds (its xmax).
do $$
declare
  v_owner uuid := tests.create_user('vm-race-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_paths text[] := '{}';
  v_ids uuid[] := '{}';
  v_ok integer := 0;
  v_full integer := 0;
  v_error text;
  i integer;
begin
  for i in 1..11 loop
    v_paths := v_paths || tests.vm_file(tests.vm_photo_path(v_venue));
  end loop;
  perform tests.act_as(v_owner);
  perform public.confirm_photo_permission(v_venue);
  for i in 1..9 loop
    v_ids := v_ids || public.add_venue_photo(v_venue, v_paths[i]);
  end loop;
  perform tests.act_as_postgres();

  foreach v_error in array array[v_paths[10], v_paths[11]] loop
    v_error := tests.error_as(v_owner, format('select public.add_venue_photo(%L, %L)', v_venue, v_error));
    if v_error is null then v_ok := v_ok + 1; elsif v_error = 'too_many_photos' then v_full := v_full + 1; end if;
  end loop;
  assert v_ok = 1 and v_full = 1, format('one add succeeds (%s), one is refused (%s)', v_ok, v_full);
  assert (select count(*) from public.venue_photos where venue_id = v_venue) = 10, 'ten photos';
end $$;

-- The lock itself: after each call this transaction holds FOR UPDATE on the
-- venue row (pgrowlocks reads it), not just the key-share lock any foreign
-- key to venues takes, so a second add or reorder waits for it to commit.
create extension if not exists pgrowlocks schema extensions;

create function tests.vm_venue_lock(p_venue uuid)
returns text[]
language sql
as $$
  select l.modes from extensions.pgrowlocks('public.venues') l
  join public.venues v on v.ctid = l.locked_row
  where v.id = p_venue;
$$;

do $$
declare
  v_owner uuid := tests.create_user('vm-lock-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_venue2 uuid := tests.create_venue(p_owner => v_owner);
  v_path text := tests.vm_file(tests.vm_photo_path(v_venue));
begin
  perform tests.act_as(v_owner);
  perform public.confirm_photo_permission(v_venue);
  perform public.confirm_photo_permission(v_venue2);
  perform tests.act_as_postgres();
  assert coalesce(tests.vm_venue_lock(v_venue), '{}') @> array['For Update'] = false, 'not locked for update yet';
  assert coalesce(tests.vm_venue_lock(v_venue2), '{}') @> array['For Update'] = false, 'second venue not locked yet';

  perform tests.act_as(v_owner);
  perform public.add_venue_photo(v_venue, v_path);
  perform tests.act_as_postgres();
  assert tests.vm_venue_lock(v_venue) @> array['For Update'], format('add_venue_photo locks the venue row: %s', tests.vm_venue_lock(v_venue));

  perform tests.act_as(v_owner);
  perform public.reorder_venue_photos(v_venue2, '{}');
  perform tests.act_as_postgres();
  assert tests.vm_venue_lock(v_venue2) @> array['For Update'], format('reorder_venue_photos locks the venue row: %s', tests.vm_venue_lock(v_venue2));
end $$;

-- 7. The helpers are Futty's own.
do $$
declare
  v_owner uuid := tests.create_user('vm-helpers@futty.test');
  v_fn text;
begin
  foreach v_fn in array array['venue_media_touch(uuid, text)', 'venue_max_photos()'] loop
    assert not has_function_privilege('authenticated', 'public.' || v_fn, 'execute'), format('%s internal', v_fn);
    assert not has_function_privilege('anon', 'public.' || v_fn, 'execute'), format('%s internal (anon)', v_fn);
  end loop;
end $$;

rollback;
