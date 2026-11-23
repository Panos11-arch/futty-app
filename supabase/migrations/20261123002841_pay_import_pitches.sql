-- F8 (decided 22 November): the venue sheet's Pitches, Combinations and
-- Prices tabs, and the Venues tab's latitude and longitude, reach the
-- database through import_venue (spec 13, "Venue pages and the venue data
-- import"). The script sends only rows the venue confirmed
-- (confirmed_by_venue = yes); this checks them again.
--
-- import_venue is re-created from its latest definition
-- (20261117191238_pay_venue_media.sql). Only the F8 blocks are new: the
-- declarations under "F8" and the four blocks before "return v_id". A
-- payload without these keys imports exactly as before.

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
  -- F8: pitches, combinations, prices and coordinates from the sheet.
  v_sizes constant text[] := array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'];
  v_lat double precision;
  v_lng double precision;
  v_p jsonb;
  v_order bigint;
  v_pname text;
  v_psize text;
  v_pformats text[];
  v_pitch public.pitches;
  v_sheet_names text[];
  v_c jsonb;
  v_cformat text;
  v_n integer;
  v_found integer;
  v_ids uuid[];
  v_fits boolean;
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

  -- F8: coordinates, only a valid pair inside Cyprus (the script checks
  -- this too and leaves anything else out). Never from an address lookup.
  -- Without a pair, the venue keeps what it has.
  if p_venue ? 'latitude' or p_venue ? 'longitude' then
    v_lat := (p_venue ->> 'latitude')::double precision;
    v_lng := (p_venue ->> 'longitude')::double precision;
    if v_lat is null or v_lng is null
       or v_lat not between 34.4 and 35.8 or v_lng not between 32.2 and 34.7 then
      raise exception 'invalid_coordinates';
    end if;
    update public.venues set latitude = v_lat, longitude = v_lng where id = v_id;
  end if;

  -- F8: pitches the venue confirmed on the Pitches tab, matched on their
  -- exact name. A new one is added; an existing one takes the sheet's
  -- surface and indoor, and its size and formats unless it holds a game
  -- that hasn't ended (then they stay, as in save_pitch, with a NOTICE).
  -- Nothing is ever deleted: a pitch missing from the tab is kept and
  -- reported with a NOTICE.
  if p_venue ? 'pitches' then
    for v_p, v_order in
      select x.value, x.ordinality from jsonb_array_elements(p_venue -> 'pitches') with ordinality x
    loop
      v_pname := nullif(btrim(v_p ->> 'name'), '');
      v_psize := v_p ->> 'size';
      select coalesce(array_agg(distinct f order by f), '{}') into v_pformats
      from jsonb_array_elements_text(coalesce(v_p -> 'formats', '[]'::jsonb)) f;
      if v_pname is null or v_psize is null or not (v_psize = any (v_sizes))
         or cardinality(v_pformats) = 0 or not (v_pformats <@ v_sizes) then
        raise exception 'invalid_pitch';
      end if;

      select * into v_pitch from public.pitches where venue_id = v_id and name = v_pname for update;
      if v_pitch.id is null then
        insert into public.pitches (venue_id, name, size, formats, surface, indoor, sort_order)
        values (v_id, v_pname, v_psize, v_pformats, nullif(btrim(v_p ->> 'surface'), ''),
                coalesce((v_p ->> 'indoor')::boolean, false), v_order::integer);
      elsif (v_pitch.size <> v_psize
             or (select array_agg(distinct f order by f) from unnest(v_pitch.formats) f) <> v_pformats)
            and public.pitch_has_bookings(v_pitch.id, true) then
        raise notice 'import_venue: % "%" keeps its size and formats: it holds a game that hasn''t ended',
          v_key, v_pname;
        update public.pitches
        set surface = nullif(btrim(v_p ->> 'surface'), ''),
            indoor = coalesce((v_p ->> 'indoor')::boolean, false)
        where id = v_pitch.id;
      else
        update public.pitches
        set size = v_psize,
            formats = v_pformats,
            surface = nullif(btrim(v_p ->> 'surface'), ''),
            indoor = coalesce((v_p ->> 'indoor')::boolean, false)
        where id = v_pitch.id;
      end if;
    end loop;

    select coalesce(array_agg(btrim(x ->> 'name')), '{}') into v_sheet_names
    from jsonb_array_elements(p_venue -> 'pitches') x;
    for v_pname in
      select p.name from public.pitches p
      where p.venue_id = v_id and not (p.name = any (v_sheet_names))
      order by p.sort_order, p.name
    loop
      raise notice 'import_venue: % "%" isn''t on the Pitches tab: kept, not removed', v_key, v_pname;
    end loop;
  end if;

  -- F8: combinations the venue confirmed, by the pitches' exact names. One
  -- naming a pitch the venue doesn't have, or whose pitches can't host the
  -- format (it must be bigger than every pitch in it), is skipped with a
  -- NOTICE. An identical one already there is left as it is; nothing is
  -- removed.
  if p_venue ? 'combinations' then
    for v_c in select x.value from jsonb_array_elements(p_venue -> 'combinations') x loop
      v_cformat := v_c ->> 'format';
      if v_cformat is null or not (v_cformat = any (v_sizes)) then
        raise exception 'invalid_format';
      end if;

      select count(*), count(p.id),
             array_agg(p.id order by p.id) filter (where p.id is not null),
             coalesce(bool_and(array_position(v_sizes, p.size) < array_position(v_sizes, v_cformat)), false)
        into v_n, v_found, v_ids, v_fits
      from jsonb_array_elements_text(coalesce(v_c -> 'pitch_names', '[]'::jsonb)) n(name)
      left join public.pitches p on p.venue_id = v_id and p.name = btrim(n.name);

      if v_n < 2 or v_found <> v_n or (select count(distinct x) from unnest(v_ids) x) <> v_n then
        raise notice 'import_venue: % % % names a pitch the venue doesn''t have: skipped',
          v_key, v_cformat, v_c -> 'pitch_names';
        continue;
      end if;
      if not v_fits then
        raise notice 'import_venue: % % % can''t host that format: skipped', v_key, v_cformat, v_c -> 'pitch_names';
        continue;
      end if;
      if not exists (select 1 from public.pitch_combinations c
                     where c.venue_id = v_id and c.format = v_cformat
                       and (select array_agg(x order by x) from unnest(c.pitch_ids) x) = v_ids) then
        insert into public.pitch_combinations (venue_id, format, pitch_ids) values (v_id, v_cformat, v_ids);
      end if;
    end loop;
  end if;

  -- F8: one price per format (decided 19 November), confirmed by the venue,
  -- above €0, in integer cents.
  if p_venue ? 'prices' then
    if exists (select 1 from jsonb_array_elements(p_venue -> 'prices') x
               where (x ->> 'format') is null or not ((x ->> 'format') = any (v_sizes))
                  or (x ->> 'price_cents') is null or (x ->> 'price_cents')::integer <= 0) then
      raise exception 'invalid_price';
    end if;
    insert into public.price_rules (venue_id, format, price_cents)
    select v_id, x ->> 'format', (x ->> 'price_cents')::integer
    from jsonb_array_elements(p_venue -> 'prices') x
    on conflict (venue_id, format) do update set price_cents = excluded.price_cents;
  end if;

  return v_id;
end;
$$;

revoke all on function public.import_venue(jsonb) from public, anon, authenticated;
grant execute on function public.import_venue(jsonb) to service_role;
