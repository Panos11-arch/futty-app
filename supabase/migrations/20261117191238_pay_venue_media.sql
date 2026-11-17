-- P6e venue photos, amenities and menu: staff edit them from the dashboard
-- (docs/specs/13-payments-bookings.md, "Venue photos, amenities and menu",
-- decided 17 November, Dimitris; for Panos to confirm; 05 Product section 12).
--
--   * Only the venue's staff, only through the functions below: the tables
--     stay read-only to the app. Every function checks the caller is staff
--     of the venue that owns the row (never a venue id sent alongside a row
--     id).
--   * Photos: staff confirm once that the photos are the venue's and Futty
--     may show them (who and when are kept); then up to 10 venue photos, in
--     the order staff set; the first is the cover everywhere. Files are at
--     <venue id>/photos/<uuid>.jpg and <venue id>/items/<uuid>.jpg; the app
--     uploads the file, then registers it here. A file nothing points to
--     can't be read by players (venue_photo_readable) and only then can
--     staff delete it. add_venue_photo and reorder_venue_photos lock the
--     venue row first, so two uploads can't both be the 10th.
--   * Amenities: the fixed list, each with an optional note ("other" needs
--     one).
--   * Menu: items with a price above €0 in integer cents; an offer price,
--     only on a post-match offer, is above €0 and below the price. Players
--     see the active items on the venue page (venue_page's new "menu").
--   * The import leaves a part alone (photos, amenities or menu) once staff
--     have edited it. Withdrawn permission still removes the sheet's own
--     photos, never the ones staff uploaded with their own confirmation.
--   * The bucket takes jpg, png and webp (what the import uploads) up to
--     5 MB; staff uploads are always jpg.

create table public.venue_media_edits (
  venue_id uuid primary key references public.venues (id) on delete cascade,
  photos_edited_at timestamptz,
  amenities_edited_at timestamptz,
  menu_edited_at timestamptz,
  photo_permission_by uuid references public.profiles (id) on delete set null,
  photo_permission_at timestamptz
);
alter table public.venue_media_edits enable row level security;
revoke all on public.venue_media_edits from public, anon, authenticated;
grant all on public.venue_media_edits to service_role;

-- The staff's own order for menu items, within a category.
alter table public.venue_menu_items add column if not exists sort_order integer not null default 0;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'venue-photos';

-- The most venue photos staff can have (decided 17 November, Dimitris).
create or replace function public.venue_max_photos()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;

-- Marks a part (photos, amenities or menu) as edited by staff, so the
-- import leaves it alone.
create or replace function public.venue_media_touch(p_venue_id uuid, p_part text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.venue_media_edits (venue_id) values (p_venue_id) on conflict (venue_id) do nothing;
  update public.venue_media_edits set
    photos_edited_at = case when p_part = 'photos' then now() else photos_edited_at end,
    amenities_edited_at = case when p_part = 'amenities' then now() else amenities_edited_at end,
    menu_edited_at = case when p_part = 'menu' then now() else menu_edited_at end
  where venue_id = p_venue_id;
end;
$$;

-- The venue a staff file path belongs to: <venue id>/(photos|items)/<uuid>.jpg,
-- or null for any other name.
create or replace function public.venue_media_path_venue(p_name text, p_folder text default null)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(photos|items)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
         and (p_folder is null or split_part(p_name, '/', 2) = p_folder)
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

create or replace function public.venue_photo_permission_given(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.venue_media_edits e where e.venue_id = p_venue_id and e.photo_permission_at is not null);
$$;

-- Whether a path is already a venue photo or an item's photo.
create or replace function public.venue_media_path_used(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.venue_photos p where p.storage_path = p_name)
      or exists (select 1 from public.venue_menu_items i where i.photo_path = p_name);
$$;

create or replace function public.venue_media_file_exists(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'venue-photos' and o.name = p_name);
$$;

-- Storage policies. The caller may upload a file into their own venue's
-- photos or items folder, as a .jpg named by a uuid, once photo permission
-- is confirmed; may read their own venue's files (so the Storage API can
-- return and delete them); and may delete one only when nothing points to
-- it. No update: a file is never replaced in place.
create or replace function public.venue_media_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and public.venue_media_path_venue(p_name) is not null
     and public.is_venue_staff(public.venue_media_path_venue(p_name))
     and public.venue_photo_permission_given(public.venue_media_path_venue(p_name));
$$;

create or replace function public.venue_media_own_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and public.venue_media_path_venue(p_name) is not null
     and public.is_venue_staff(public.venue_media_path_venue(p_name));
$$;

create or replace function public.venue_media_deletable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.venue_media_own_file(p_name) and not public.venue_media_path_used(p_name);
$$;

create policy "Venue staff upload their venue's photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'venue-photos' and public.venue_media_upload_allowed(name));
create policy "Venue staff read their venue's files" on storage.objects
  for select to authenticated using (bucket_id = 'venue-photos' and public.venue_media_own_file(name));
create policy "Venue staff delete their venue's unused files" on storage.objects
  for delete to authenticated using (bucket_id = 'venue-photos' and public.venue_media_deletable(name));

-- Everything the photos, amenities and menu screens edit, for the venue's
-- staff: photos in order (the first is the cover), amenities, every item
-- (switched off ones too) by category, then the staff's order, then name,
-- and who confirmed photo permission. Times are "HH:MM".
create or replace function public.venue_media(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;

  return jsonb_build_object(
    'max_photos', public.venue_max_photos(),
    'photo_permission', (
      select jsonb_build_object('by', e.photo_permission_by, 'at', e.photo_permission_at)
      from public.venue_media_edits e where e.venue_id = p_venue_id and e.photo_permission_at is not null
    ),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'storage_path', p.storage_path, 'is_cover', p.n = 1) order by p.n)
      from (select ph.*, row_number() over (order by ph.sort_order, ph.storage_path) as n
            from public.venue_photos ph where ph.venue_id = p_venue_id and ph.pitch_id is null) p
    ), '[]'::jsonb),
    'amenities', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.kind, 'note', a.note) order by a.kind)
      from public.venue_amenities a where a.venue_id = p_venue_id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'category', i.category, 'description', i.description,
               'price_cents', i.price_cents, 'offer_price_cents', i.offer_price_cents,
               'is_post_match_offer', i.is_post_match_offer, 'offer_text', i.offer_text,
               'available_from', left(i.available_from::text, 5), 'available_to', left(i.available_to::text, 5),
               'available_weekdays', to_jsonb(i.available_weekdays), 'dietary_tags', to_jsonb(i.dietary_tags),
               'photo_path', i.photo_path, 'active', i.active, 'sort_order', i.sort_order)
             order by i.category nulls last, i.sort_order, i.name)
      from public.venue_menu_items i where i.venue_id = p_venue_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Staff confirm once that the venue's photos are its own and Futty may show
-- them. A later confirmation keeps the first.
create or replace function public.confirm_photo_permission(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  insert into public.venue_media_edits (venue_id, photo_permission_by, photo_permission_at)
  values (p_venue_id, auth.uid(), now())
  on conflict (venue_id) do update set
    photo_permission_by = excluded.photo_permission_by,
    photo_permission_at = excluded.photo_permission_at
  where public.venue_media_edits.photo_permission_at is null;
end;
$$;

-- Adds an uploaded file as the venue's last photo. Locks the venue row
-- before counting, so two uploads at 9 photos can't both be added.
create or replace function public.add_venue_photo(p_venue_id uuid, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  perform 1 from public.venues where id = p_venue_id for update;

  if not public.venue_photo_permission_given(p_venue_id) then
    raise exception 'photo_permission_required';
  end if;
  if public.venue_media_path_venue(p_path, 'photos') is distinct from p_venue_id then
    raise exception 'invalid_photo_path';
  end if;
  if public.venue_media_path_used(p_path) then
    raise exception 'photo_path_in_use';
  end if;
  if not public.venue_media_file_exists(p_path) then
    raise exception 'photo_file_missing';
  end if;
  if (select count(*) from public.venue_photos where venue_id = p_venue_id and pitch_id is null) >= public.venue_max_photos() then
    raise exception 'too_many_photos';
  end if;

  insert into public.venue_photos (venue_id, storage_path, sort_order)
  values (p_venue_id, p_path,
          coalesce((select max(sort_order) from public.venue_photos where venue_id = p_venue_id and pitch_id is null), 0) + 1)
  returning id into v_id;
  perform public.venue_media_touch(p_venue_id, 'photos');
  return v_id;
end;
$$;

-- Removes a venue photo and returns its path, for the app to delete the
-- file (players can't read it from now on). The next photo becomes the cover.
create or replace function public.remove_venue_photo(p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.venue_photos;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_of_any_venue() then
    raise exception 'not_venue_staff';
  end if;
  select p.* into v_photo
  from public.venue_photos p
  join public.venues v on v.id = p.venue_id
  where p.id = p_photo_id and p.pitch_id is null and public.is_venue_staff(v.id)
  for update of p;
  if v_photo.id is null then
    raise exception 'photo_not_found';
  end if;

  delete from public.venue_photos where id = p_photo_id;
  perform public.venue_media_touch(v_photo.venue_id, 'photos');
  return v_photo.storage_path;
end;
$$;

-- Sets the photos' order: exactly the venue's photos, each once. The first
-- is the cover. Locks the venue row, as add_venue_photo does.
create or replace function public.reorder_venue_photos(p_venue_id uuid, p_photo_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  perform 1 from public.venues where id = p_venue_id for update;

  p_photo_ids := coalesce(p_photo_ids, '{}');
  if cardinality(p_photo_ids) <> (select count(distinct x) from unnest(p_photo_ids) x)
     or array(select x from unnest(p_photo_ids) x order by x)
        is distinct from array(select id from public.venue_photos where venue_id = p_venue_id and pitch_id is null order by id) then
    raise exception 'photo_list_mismatch';
  end if;

  update public.venue_photos p set sort_order = o.n
  from unnest(p_photo_ids) with ordinality as o(id, n)
  where p.id = o.id;
  perform public.venue_media_touch(p_venue_id, 'photos');
end;
$$;

-- Replaces the venue's amenities: [{"kind": ..., "note": ...}], kinds from
-- the fixed list, each once; a note is up to 60 characters, and "other"
-- needs one.
create or replace function public.set_venue_amenities(p_venue_id uuid, p_amenities jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kinds text[] := array['parking', 'changing_rooms', 'showers', 'lockers', 'cafe_or_bar', 'floodlights',
                          'bibs', 'ball_hire', 'first_aid', 'wifi', 'other'];
  v_row jsonb;
  v_seen text[] := '{}';
  v_kind text;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if jsonb_typeof(p_amenities) is distinct from 'array' then
    raise exception 'invalid_amenities';
  end if;

  for v_row in select * from jsonb_array_elements(p_amenities) loop
    if jsonb_typeof(v_row) <> 'object' or jsonb_typeof(v_row -> 'kind') is distinct from 'string'
       or (v_row ? 'note' and jsonb_typeof(v_row -> 'note') not in ('string', 'null')) then
      raise exception 'invalid_amenities';
    end if;
    v_kind := v_row ->> 'kind';
    v_note := nullif(btrim(v_row ->> 'note'), '');
    if not v_kind = any (v_kinds) or v_kind = any (v_seen) or char_length(v_note) > 60
       or (v_kind = 'other' and v_note is null) then
      raise exception 'invalid_amenities';
    end if;
    v_seen := v_seen || v_kind;
  end loop;

  delete from public.venue_amenities where venue_id = p_venue_id;
  insert into public.venue_amenities (venue_id, kind, note)
  select p_venue_id, a ->> 'kind', nullif(btrim(a ->> 'note'), '')
  from jsonb_array_elements(p_amenities) a;
  perform public.venue_media_touch(p_venue_id, 'amenities');
end;
$$;

-- Whether a jsonb value is a whole number of cents above 0 (never a
-- decimal or a string).
create or replace function public.venue_media_cents(p_value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'number' and p_value::text ~ '^[1-9][0-9]{0,6}$' then p_value::text::integer end;
$$;

-- Adds an item (p_item_id null) or edits one of the venue's items.
-- p_item: name (1-60), category (up to 40), description (up to 200),
-- price_cents (required, above 0), is_post_match_offer, offer_price_cents
-- (above 0, below the price) and offer_text (up to 120) on an offer only,
-- available_from and available_to ("HH:MM", both or neither, to after
-- from), available_weekdays (ISO 1-7), dietary_tags (up to 6, each up to
-- 20), active. A name is unique at the venue, whatever its case.
create or replace function public.save_menu_item(p_venue_id uuid, p_item_id uuid, p_item jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_item ->> 'name');
  v_category text := nullif(btrim(p_item ->> 'category'), '');
  v_description text := nullif(btrim(p_item ->> 'description'), '');
  v_price integer := public.venue_media_cents(p_item -> 'price_cents');
  v_offer boolean := coalesce(p_item -> 'is_post_match_offer' = 'true'::jsonb, false);
  v_offer_price integer;
  v_offer_text text;
  v_from text := nullif(p_item ->> 'available_from', '');
  v_to text := nullif(p_item ->> 'available_to', '');
  v_days smallint[];
  v_tags text[];
  v_active boolean := coalesce(p_item -> 'active' <> 'false'::jsonb, true);
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_item_id is not null then
    select id into v_id from public.venue_menu_items where id = p_item_id and venue_id = p_venue_id for update;
    if v_id is null then
      raise exception 'item_not_found';
    end if;
  end if;

  if v_name is null or v_name = '' or char_length(v_name) > 60 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_category) > 40 then
    raise exception 'invalid_category';
  end if;
  if char_length(v_description) > 200 then
    raise exception 'invalid_description';
  end if;
  if v_price is null then
    raise exception 'invalid_price';
  end if;
  if v_offer then
    if jsonb_typeof(p_item -> 'offer_price_cents') not in ('null') then
      v_offer_price := public.venue_media_cents(p_item -> 'offer_price_cents');
      if v_offer_price is null or v_offer_price >= v_price then
        raise exception 'invalid_offer_price';
      end if;
    end if;
    v_offer_text := nullif(btrim(p_item ->> 'offer_text'), '');
    if char_length(v_offer_text) > 120 then
      raise exception 'invalid_offer_text';
    end if;
  end if;
  if (v_from is null) <> (v_to is null)
     or (v_from is not null and (v_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                                 or v_to <= v_from)) then
    raise exception 'invalid_window';
  end if;
  if jsonb_typeof(p_item -> 'available_weekdays') = 'array' then
    if exists (select 1 from jsonb_array_elements(p_item -> 'available_weekdays') d
               where jsonb_typeof(d) <> 'number' or d::text !~ '^[1-7]$') then
      raise exception 'invalid_weekdays';
    end if;
    select array_agg(distinct d::text::smallint order by d::text::smallint) into v_days
    from jsonb_array_elements(p_item -> 'available_weekdays') d;
  elsif jsonb_typeof(p_item -> 'available_weekdays') is not null and jsonb_typeof(p_item -> 'available_weekdays') <> 'null' then
    raise exception 'invalid_weekdays';
  end if;
  if jsonb_typeof(p_item -> 'dietary_tags') = 'array' then
    select array_agg(btrim(t)) into v_tags from jsonb_array_elements_text(p_item -> 'dietary_tags') t;
    if cardinality(v_tags) > 6 or exists (select 1 from unnest(v_tags) t where t = '' or char_length(t) > 20) then
      raise exception 'invalid_dietary_tags';
    end if;
  elsif jsonb_typeof(p_item -> 'dietary_tags') is not null and jsonb_typeof(p_item -> 'dietary_tags') <> 'null' then
    raise exception 'invalid_dietary_tags';
  end if;

  if exists (select 1 from public.venue_menu_items
             where venue_id = p_venue_id and lower(name) = lower(v_name) and id is distinct from p_item_id) then
    raise exception 'item_name_taken';
  end if;

  if p_item_id is null then
    insert into public.venue_menu_items (venue_id, name, category, description, price_cents, offer_price_cents,
                                         is_post_match_offer, offer_text, available_from, available_to,
                                         available_weekdays, dietary_tags, active, sort_order)
    values (p_venue_id, v_name, v_category, v_description, v_price, v_offer_price, v_offer, v_offer_text,
            v_from::time, v_to::time, v_days, v_tags, v_active,
            coalesce((select max(sort_order) + 1 from public.venue_menu_items where venue_id = p_venue_id), 0))
    returning id into v_id;
  else
    update public.venue_menu_items set
      name = v_name, category = v_category, description = v_description, price_cents = v_price,
      offer_price_cents = v_offer_price, is_post_match_offer = v_offer, offer_text = v_offer_text,
      available_from = v_from::time, available_to = v_to::time, available_weekdays = v_days,
      dietary_tags = v_tags, active = v_active
    where id = p_item_id;
  end if;
  perform public.venue_media_touch(p_venue_id, 'menu');
  return v_id;
end;
$$;

-- One of the caller's venues' items, locked; item_not_found otherwise.
create or replace function public.venue_media_own_item(p_item_id uuid)
returns public.venue_menu_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.venue_menu_items;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_of_any_venue() then
    raise exception 'not_venue_staff';
  end if;
  select i.* into v_item
  from public.venue_menu_items i
  join public.venues v on v.id = i.venue_id
  where i.id = p_item_id and public.is_venue_staff(v.id)
  for update of i;
  if v_item.id is null then
    raise exception 'item_not_found';
  end if;
  return v_item;
end;
$$;

-- Sets (or with null removes) an item's photo, an uploaded file in the
-- venue's items folder. Returns the old path, for the app to delete.
create or replace function public.set_menu_item_photo(p_item_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.venue_menu_items := public.venue_media_own_item(p_item_id);
begin
  if p_path is not null then
    if not public.venue_photo_permission_given(v_item.venue_id) then
      raise exception 'photo_permission_required';
    end if;
    if public.venue_media_path_venue(p_path, 'items') is distinct from v_item.venue_id then
      raise exception 'invalid_photo_path';
    end if;
    if p_path is distinct from v_item.photo_path and public.venue_media_path_used(p_path) then
      raise exception 'photo_path_in_use';
    end if;
    if not public.venue_media_file_exists(p_path) then
      raise exception 'photo_file_missing';
    end if;
  end if;

  update public.venue_menu_items set photo_path = p_path where id = p_item_id;
  perform public.venue_media_touch(v_item.venue_id, 'menu');
  return case when v_item.photo_path is distinct from p_path then v_item.photo_path end;
end;
$$;

create or replace function public.set_menu_item_active(p_item_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.venue_menu_items := public.venue_media_own_item(p_item_id);
begin
  update public.venue_menu_items set active = coalesce(p_active, false) where id = p_item_id;
  perform public.venue_media_touch(v_item.venue_id, 'menu');
end;
$$;

-- Deletes an item and returns its photo path, for the app to delete. Its
-- post-match codes and redemptions stay (their item_id becomes null), so
-- the venue's counts don't drop.
create or replace function public.delete_menu_item(p_item_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.venue_menu_items := public.venue_media_own_item(p_item_id);
begin
  delete from public.venue_menu_items where id = p_item_id;
  perform public.venue_media_touch(v_item.venue_id, 'menu');
  return v_item.photo_path;
end;
$$;

-- Sets the items' order: exactly the venue's items, each once. Players see
-- them by category, then in this order.
create or replace function public.reorder_menu_items(p_venue_id uuid, p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  p_item_ids := coalesce(p_item_ids, '{}');
  if cardinality(p_item_ids) <> (select count(distinct x) from unnest(p_item_ids) x)
     or array(select x from unnest(p_item_ids) x order by x)
        is distinct from array(select id from public.venue_menu_items where venue_id = p_venue_id order by id) then
    raise exception 'item_list_mismatch';
  end if;

  update public.venue_menu_items i set sort_order = o.n
  from unnest(p_item_ids) with ordinality as o(id, n)
  where i.id = o.id;
  perform public.venue_media_touch(p_venue_id, 'menu');
end;
$$;

-- As in 20261111164706_pay_venue_pages, except (P6e) a part staff have
-- edited in the app (photos, amenities or the menu) is left alone. With
-- permission withdrawn, the sheet's own photos (paths under the import key)
-- still go, from photo rows and items; staff uploads stay.
create or replace function public.import_venue(p_venue jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(p_venue ->> 'import_key'), '');
  v_existing uuid := nullif(p_venue ->> 'existing_venue_id', '')::uuid;
  v_name text := nullif(btrim(p_venue ->> 'name'), '');
  v_permission boolean := coalesce((p_venue ->> 'photo_permission')::boolean, false);
  v_id uuid;
  v_other_key text;
  v_item_names text[];
  v_edits public.venue_media_edits;  -- P6e
begin
  if v_key is null or v_key !~ '^V[0-9]{3,}$' then
    raise exception 'invalid_import_key';
  end if;
  if v_name is null then
    raise exception 'venue_name_required';
  end if;

  if v_existing is not null then
    select id, import_key into v_id, v_other_key from public.venues where id = v_existing for update;
    if v_id is null then
      raise exception 'mapped_venue_not_found';
    end if;
    if v_other_key is not null and v_other_key <> v_key then
      raise exception 'mapped_venue_has_other_key';
    end if;
    if exists (select 1 from public.venues where import_key = v_key and id <> v_existing) then
      raise exception 'import_key_already_used';
    end if;
  else
    select id into v_id from public.venues where import_key = v_key for update;
  end if;

  if v_id is null then
    insert into public.venues (name, import_key, is_live)
    values (v_name, v_key, false)
    returning id into v_id;
  end if;

  -- P6e: what staff have edited in the app.
  select * into v_edits from public.venue_media_edits where venue_id = v_id;

  update public.venues set
    import_key = v_key,
    name = v_name,
    city = nullif(btrim(p_venue ->> 'city'), ''),
    address = nullif(btrim(p_venue ->> 'address'), ''),
    google_maps_link = nullif(btrim(p_venue ->> 'google_maps_link'), ''),
    phone = nullif(btrim(p_venue ->> 'phone'), ''),
    website = nullif(btrim(p_venue ->> 'website'), ''),
    instagram = nullif(btrim(p_venue ->> 'instagram'), '')
  where id = v_id;

  insert into public.venue_import_details (venue_id, pitches_summary, sheet_status, notes, photo_permission, imported_at)
  values (v_id, nullif(btrim(p_venue ->> 'pitches_summary'), ''), nullif(btrim(p_venue ->> 'sheet_status'), ''),
          nullif(btrim(p_venue ->> 'notes'), ''), v_permission, now())
  on conflict (venue_id) do update set
    pitches_summary = excluded.pitches_summary,
    sheet_status = excluded.sheet_status,
    notes = excluded.notes,
    photo_permission = excluded.photo_permission,
    imported_at = excluded.imported_at;

  delete from public.opening_hours where venue_id = v_id;
  insert into public.opening_hours (venue_id, weekday, opens, closes)
  select v_id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
  from jsonb_array_elements(coalesce(p_venue -> 'hours', '[]'::jsonb)) h;

  -- P6e: amenities staff edited stay as they are.
  if v_edits.amenities_edited_at is null then
    delete from public.venue_amenities where venue_id = v_id;
    insert into public.venue_amenities (venue_id, kind, note)
    select v_id, a ->> 'kind', nullif(btrim(a ->> 'note'), '')
    from jsonb_array_elements(coalesce(p_venue -> 'amenities', '[]'::jsonb)) a;
  end if;

  -- Venue photos (not a pitch's): exactly the sheet's, and none without
  -- permission. Kept rows keep their ids.
  if v_edits.photos_edited_at is null then
    delete from public.venue_photos
    where venue_id = v_id and pitch_id is null
      and (not v_permission
           or storage_path not in (select p ->> 'storage_path'
                                   from jsonb_array_elements(coalesce(p_venue -> 'photos', '[]'::jsonb)) p));
    if v_permission then
      insert into public.venue_photos (venue_id, storage_path, sort_order)
      select v_id, p ->> 'storage_path', (p ->> 'sort_order')::integer
      from jsonb_array_elements(coalesce(p_venue -> 'photos', '[]'::jsonb)) p
      on conflict (storage_path) do update set sort_order = excluded.sort_order
      where public.venue_photos.venue_id = excluded.venue_id;
    end if;
  elsif not v_permission then
    -- P6e: staff edited the photos; only the sheet's own go.
    delete from public.venue_photos
    where venue_id = v_id and pitch_id is null and storage_path like v_key || '/%';
  end if;

  if v_edits.menu_edited_at is null then
    select coalesce(array_agg(i ->> 'name'), '{}') into v_item_names
    from jsonb_array_elements(coalesce(p_venue -> 'items', '[]'::jsonb)) i;
    update public.venue_menu_items set active = false where venue_id = v_id and name <> all (v_item_names);
    insert into public.venue_menu_items (venue_id, name, category, description, price_cents, available_from, available_to,
                                         available_weekdays, is_post_match_offer, offer_text, offer_price_cents,
                                         photo_path, dietary_tags, active)
    select v_id, i ->> 'name', nullif(btrim(i ->> 'category'), ''), nullif(btrim(i ->> 'description'), ''),
           (i ->> 'price_cents')::integer, (i ->> 'available_from')::time, (i ->> 'available_to')::time,
           (select array_agg(d::smallint order by d::smallint) from jsonb_array_elements_text(i -> 'available_weekdays') d),
           coalesce((i ->> 'is_post_match_offer')::boolean, false), nullif(btrim(i ->> 'offer_text'), ''),
           (i ->> 'offer_price_cents')::integer,
           case when v_permission then nullif(i ->> 'photo_path', '') end,
           (select array_agg(t) from jsonb_array_elements_text(i -> 'dietary_tags') t),
           coalesce((i ->> 'active')::boolean, true)
    from jsonb_array_elements(coalesce(p_venue -> 'items', '[]'::jsonb)) i
    on conflict (venue_id, name) do update set
      category = excluded.category,
      description = excluded.description,
      price_cents = excluded.price_cents,
      available_from = excluded.available_from,
      available_to = excluded.available_to,
      available_weekdays = excluded.available_weekdays,
      is_post_match_offer = excluded.is_post_match_offer,
      offer_text = excluded.offer_text,
      offer_price_cents = excluded.offer_price_cents,
      photo_path = excluded.photo_path,
      dietary_tags = excluded.dietary_tags,
      active = excluded.active;
  elsif not v_permission then
    -- P6e: staff edited the menu; only the sheet's own item photos go.
    update public.venue_menu_items set photo_path = null
    where venue_id = v_id and photo_path like v_key || '/%';
  end if;

  return v_id;
end;
$$;

-- As in 20261112090000_pay_booking_screens, plus (P6e) "menu": the active
-- items, by category (none last), then the staff's order, then name.
create or replace function public.venue_page(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  if not public.venue_visible(p_venue_id) then
    raise exception 'venue_not_found';
  end if;
  select * into v_venue from public.venues where id = p_venue_id;

  return jsonb_build_object(
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address,
      'google_maps_link', v_venue.google_maps_link, 'phone', v_venue.phone, 'website', v_venue.website,
      'instagram', v_venue.instagram, 'is_live', v_venue.is_live, 'allows_6v6_on_5s', v_venue.allows_6v6_on_5s),
    'bookable', v_venue.is_live and exists (select 1 from public.price_rules r where r.venue_id = p_venue_id),
    'cancellation', public.cancellation_terms(),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('storage_path', p.storage_path, 'pitch_id', p.pitch_id)
                                         order by p.pitch_id nulls first, p.sort_order, p.storage_path)
                        from public.venue_photos p where p.venue_id = p_venue_id), '[]'::jsonb),
    'amenities', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'note', a.note) order by a.kind)
                           from public.venue_amenities a where a.venue_id = p_venue_id), '[]'::jsonb),
    'pitches', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', p.id, 'name', p.name, 'size', p.size, 'formats', to_jsonb(p.formats),
                                  'surface', p.surface, 'indoor', p.indoor, 'description', p.description,
                                  'is_open', p.is_open) order by p.sort_order, p.name)
                         from public.pitches p where p.venue_id = p_venue_id), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
                                 'format', r.format, 'hour_cents', r.price_cents, 'peak_hour_cents', r.peak_cents,
                                 'weekend_hour_cents', r.weekend_cents)
                               order by public.format_player_count(r.format))
                        from public.price_rules r where r.venue_id = p_venue_id), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', h.opens, 'closes', h.closes)
                                        order by h.weekday)
                       from public.opening_hours h where h.venue_id = p_venue_id), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', i.id, 'name', i.name, 'description', i.description, 'price_cents', i.price_cents,
                                 'offer_text', i.offer_text, 'offer_price_cents', i.offer_price_cents,
                                 'photo_path', i.photo_path, 'available_from', i.available_from,
                                 'available_to', i.available_to, 'available_weekdays', to_jsonb(i.available_weekdays))
                               order by i.name)
                        from public.venue_menu_items i
                        where i.venue_id = p_venue_id and i.active and i.is_post_match_offer), '[]'::jsonb),
    -- P6e: the whole menu.
    'menu', coalesce((select jsonb_agg(jsonb_build_object(
                               'id', i.id, 'name', i.name, 'category', i.category, 'description', i.description,
                               'price_cents', i.price_cents, 'offer_price_cents', i.offer_price_cents,
                               'is_post_match_offer', i.is_post_match_offer, 'offer_text', i.offer_text,
                               'photo_path', i.photo_path, 'dietary_tags', to_jsonb(i.dietary_tags))
                             order by i.category nulls last, i.sort_order, i.name)
                      from public.venue_menu_items i
                      where i.venue_id = p_venue_id and i.active), '[]'::jsonb)
  );
end;
$$;

-- Internal helpers: Futty's own.
revoke all on function public.venue_max_photos() from public, anon, authenticated;
revoke all on function public.venue_media_touch(uuid, text) from public, anon, authenticated;
revoke all on function public.venue_media_path_venue(text, text) from public, anon, authenticated;
revoke all on function public.venue_photo_permission_given(uuid) from public, anon, authenticated;
revoke all on function public.venue_media_path_used(text) from public, anon, authenticated;
revoke all on function public.venue_media_file_exists(text) from public, anon, authenticated;
revoke all on function public.venue_media_cents(jsonb) from public, anon, authenticated;
revoke all on function public.venue_media_own_item(uuid) from public, anon, authenticated;
grant execute on function public.venue_max_photos() to service_role;
grant execute on function public.venue_media_touch(uuid, text) to service_role;
grant execute on function public.venue_media_path_venue(text, text) to service_role;
grant execute on function public.venue_photo_permission_given(uuid) to service_role;
grant execute on function public.venue_media_path_used(text) to service_role;
grant execute on function public.venue_media_file_exists(text) to service_role;
grant execute on function public.venue_media_cents(jsonb) to service_role;
grant execute on function public.venue_media_own_item(uuid) to service_role;

-- Storage policy checks run as the signed-in caller.
revoke all on function public.venue_media_upload_allowed(text) from public, anon;
revoke all on function public.venue_media_own_file(text) from public, anon;
revoke all on function public.venue_media_deletable(text) from public, anon;
grant execute on function public.venue_media_upload_allowed(text) to authenticated, service_role;
grant execute on function public.venue_media_own_file(text) to authenticated, service_role;
grant execute on function public.venue_media_deletable(text) to authenticated, service_role;

-- The app calls these.
revoke all on function public.venue_media(uuid) from public, anon;
revoke all on function public.confirm_photo_permission(uuid) from public, anon;
revoke all on function public.add_venue_photo(uuid, text) from public, anon;
revoke all on function public.remove_venue_photo(uuid) from public, anon;
revoke all on function public.reorder_venue_photos(uuid, uuid[]) from public, anon;
revoke all on function public.set_venue_amenities(uuid, jsonb) from public, anon;
revoke all on function public.save_menu_item(uuid, uuid, jsonb) from public, anon;
revoke all on function public.set_menu_item_photo(uuid, text) from public, anon;
revoke all on function public.set_menu_item_active(uuid, boolean) from public, anon;
revoke all on function public.delete_menu_item(uuid) from public, anon;
revoke all on function public.reorder_menu_items(uuid, uuid[]) from public, anon;
grant execute on function public.venue_media(uuid) to authenticated, service_role;
grant execute on function public.confirm_photo_permission(uuid) to authenticated, service_role;
grant execute on function public.add_venue_photo(uuid, text) to authenticated, service_role;
grant execute on function public.remove_venue_photo(uuid) to authenticated, service_role;
grant execute on function public.reorder_venue_photos(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.set_venue_amenities(uuid, jsonb) to authenticated, service_role;
grant execute on function public.save_menu_item(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_menu_item_photo(uuid, text) to authenticated, service_role;
grant execute on function public.set_menu_item_active(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_menu_item(uuid) to authenticated, service_role;
grant execute on function public.reorder_menu_items(uuid, uuid[]) to authenticated, service_role;
revoke all on function public.import_venue(jsonb) from public, anon, authenticated;
grant execute on function public.import_venue(jsonb) to service_role;
revoke all on function public.venue_page(uuid) from public, anon;
grant execute on function public.venue_page(uuid) to authenticated, service_role;
