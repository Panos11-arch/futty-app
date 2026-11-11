-- P9: venue pages and the venue data import (docs/specs/13-payments-bookings.md,
-- "Venue pages and the venue data import", decided 11 November; 05 Product
-- section 12; 15 Design section 5).
--
--   * venues gain an import key (V001...), address and contact details;
--     pitches gain a description;
--   * venue_photos, venue_amenities and venue_menu_items, and a private
--     storage bucket for the photos;
--   * venue_import_details keeps what the sheet says for our own use only
--     (the pitch_size text, the sheet's status and notes); players never
--     read it;
--   * a venue that isn't live is hidden from discovery: its row, pitches,
--     hours, prices, photos, amenities and items are readable only by its
--     owner and by players who already hold a booking, a debt or credit
--     there (so their bookings still show it); it's never in the Book list
--     and can't be booked;
--   * import_venue loads one venue from the sheet (service_role only,
--     idempotent on the import key); venue_page returns everything the
--     venue page shows.
--
-- The legacy pooled columns (P3 stopped reading them) become optional, so
-- an imported venue never gets a made-up value. Existing rows keep theirs.

alter table public.venues
  alter column base_pitches drop not null,
  alter column open_time drop not null,
  alter column close_time drop not null,
  alter column price_per_pitch_hour drop not null;

alter table public.venues
  add column if not exists import_key text unique,
  add column if not exists address text,
  add column if not exists google_maps_link text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists instagram text;

alter table public.pitches add column if not exists description text;

-- What the sheet says that the app doesn't show.
create table public.venue_import_details (
  venue_id uuid primary key references public.venues (id) on delete cascade,
  pitches_summary text,
  sheet_status text,
  notes text,
  photo_permission boolean not null default false,
  imported_at timestamptz not null default now()
);

create table public.venue_photos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  pitch_id uuid references public.pitches (id) on delete cascade,
  storage_path text not null unique,
  sort_order integer not null default 0
);
create index venue_photos_venue_idx on public.venue_photos (venue_id, sort_order);

create table public.venue_amenities (
  venue_id uuid not null references public.venues (id) on delete cascade,
  kind text not null check (kind in ('parking', 'changing_rooms', 'showers', 'lockers', 'cafe_or_bar', 'floodlights',
                                     'bibs', 'ball_hire', 'first_aid', 'wifi', 'other')),
  note text,
  primary key (venue_id, kind)
);

create table public.venue_menu_items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null,
  category text,
  description text,
  price_cents integer check (price_cents >= 0),
  available_from time,
  available_to time,
  available_weekdays smallint[] check (available_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  is_post_match_offer boolean not null default false,
  offer_text text,
  offer_price_cents integer check (offer_price_cents >= 0),
  photo_path text,
  dietary_tags text[],
  active boolean not null default true,
  unique (venue_id, name),
  check (available_to is null or available_from is null or available_to > available_from)
);
create index venue_menu_items_venue_idx on public.venue_menu_items (venue_id) where active;

-- Whether the signed-in caller may see a venue: it's live, it's theirs, or
-- they already hold a booking (as its booker or with a share), a debt or
-- credit there. Not live is hidden from discovery, not from them.
create or replace function public.venue_visible(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venues v
    where v.id = p_venue_id
      and (
        v.is_live
        or v.owner_profile_id = (select auth.uid())
        or exists (select 1 from public.venue_bookings b
                   where b.venue_id = v.id
                     and (b.created_by = (select auth.uid())
                          or exists (select 1 from public.booking_payment_shares s
                                     where s.booking_id = b.id and s.profile_id = (select auth.uid()))))
        or exists (select 1 from public.venue_debts d where d.venue_id = v.id and d.profile_id = (select auth.uid()))
        or exists (select 1 from public.venue_credits c where c.venue_id = v.id and c.profile_id = (select auth.uid()))
      )
  );
$$;
revoke all on function public.venue_visible(uuid) from public, anon;
grant execute on function public.venue_visible(uuid) to authenticated, service_role;

-- A venue that isn't live is hidden from discovery (see venue_visible).
drop policy "Signed-in users can read venues" on public.venues;
create policy "Signed-in users read visible venues" on public.venues
  for select to authenticated using (public.venue_visible(id));

drop policy "Signed-in users read pitches" on public.pitches;
create policy "Signed-in users read pitches of visible venues" on public.pitches
  for select to authenticated using (public.venue_visible(venue_id));
drop policy "Signed-in users read pitch combinations" on public.pitch_combinations;
create policy "Signed-in users read pitch combinations of visible venues" on public.pitch_combinations
  for select to authenticated using (public.venue_visible(venue_id));
drop policy "Signed-in users read opening hours" on public.opening_hours;
create policy "Signed-in users read opening hours of visible venues" on public.opening_hours
  for select to authenticated using (public.venue_visible(venue_id));
drop policy "Signed-in users read closures" on public.venue_closures;
create policy "Signed-in users read closures of visible venues" on public.venue_closures
  for select to authenticated using (public.venue_visible(venue_id));
drop policy "Signed-in users read prices" on public.price_rules;
create policy "Signed-in users read prices of visible venues" on public.price_rules
  for select to authenticated using (public.venue_visible(venue_id));

alter table public.venue_import_details enable row level security;
alter table public.venue_photos enable row level security;
alter table public.venue_amenities enable row level security;
alter table public.venue_menu_items enable row level security;

create policy "Signed-in users read photos of visible venues" on public.venue_photos
  for select to authenticated using (public.venue_visible(venue_id));
create policy "Signed-in users read amenities of visible venues" on public.venue_amenities
  for select to authenticated using (public.venue_visible(venue_id));
-- Players see active items only; the venue's owner sees all of its items.
create policy "Signed-in users read active items, owners all of theirs" on public.venue_menu_items
  for select to authenticated using (
    public.venue_visible(venue_id)
    and (active or exists (select 1 from public.venues v
                           where v.id = venue_menu_items.venue_id and v.owner_profile_id = (select auth.uid())))
  );

revoke all on public.venue_import_details, public.venue_photos, public.venue_amenities, public.venue_menu_items
  from public, anon, authenticated;
grant select on public.venue_photos, public.venue_amenities, public.venue_menu_items to authenticated;
grant all on public.venue_import_details, public.venue_photos, public.venue_amenities, public.venue_menu_items
  to service_role;

-- Photos: a private bucket. The import stores files at <import key>/<file>
-- and <import key>/items/<file> (V001/...), so their paths are known before
-- the venue exists. A file is readable (and so signable) only when a
-- venue_photos row or an item's photo_path points to it and the caller may
-- see that venue (and, for an item, the item). A file nothing points to
-- (permission withdrawn, photo dropped from the sheet) can't be read; the
-- import deletes it through the Storage API. Written only by the import
-- (service_role).
insert into storage.buckets (id, name, public)
values ('venue-photos', 'venue-photos', false)
on conflict (id) do nothing;

create or replace function public.venue_photo_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.venue_photos p where p.storage_path = p_name and public.venue_visible(p.venue_id))
      or exists (select 1 from public.venue_menu_items i
                 join public.venues v on v.id = i.venue_id
                 where i.photo_path = p_name and public.venue_visible(i.venue_id)
                   and (i.active or v.owner_profile_id = (select auth.uid())));
$$;
revoke all on function public.venue_photo_readable(text) from public, anon;
grant execute on function public.venue_photo_readable(text) to authenticated, service_role;

create policy "Signed-in users read photos of visible venues" on storage.objects
  for select to authenticated using (bucket_id = 'venue-photos' and public.venue_photo_readable(name));

-- Loads one venue from the venue sheet. Idempotent: keyed on import_key
-- (V001...), or on an existing venue's id when the import's mapping file
-- names one (never matched by name). The sheet is the source for what it
-- holds: hours, amenities, photos and items are replaced with exactly what
-- it says; an item no longer in it is switched off, not deleted. Blank cells
-- stay empty. The import never sets prices or pitches, and never changes
-- is_live: a venue it creates is not live; going live is a separate step.
-- Photos are kept only when photo_permission is true.
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

  delete from public.venue_amenities where venue_id = v_id;
  insert into public.venue_amenities (venue_id, kind, note)
  select v_id, a ->> 'kind', nullif(btrim(a ->> 'note'), '')
  from jsonb_array_elements(coalesce(p_venue -> 'amenities', '[]'::jsonb)) a;

  -- Venue photos (not a pitch's): exactly the sheet's, and none without
  -- permission. Kept rows keep their ids.
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

  return v_id;
end;
$$;
revoke all on function public.import_venue(jsonb) from public, anon, authenticated;
grant execute on function public.import_venue(jsonb) to service_role;

-- The cancellation numbers players are shown: the €1 kept in the middle
-- window, the free cancellation after paying, and the cutoff before kickoff
-- after which nothing comes back (spec 13, "Cancellations and refunds").
-- The same numbers cancellation_plan, cancellation_window and
-- money_capture_due_at use (pay-venue-pages-1 checks they agree); P10 moves
-- them into app_rules.
create or replace function public.cancellation_terms()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('fee_cents', 100, 'free_minutes', 60, 'refund_cutoff_hours', 6);
$$;
revoke all on function public.cancellation_terms() from public, anon;
grant execute on function public.cancellation_terms() to authenticated, service_role;

-- Everything the venue page shows, for a venue the caller may see. Prices
-- are the venue's hourly price per format, from price_rules; bookable is
-- false when the venue isn't live or has no price.
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
      'instagram', v_venue.instagram, 'is_live', v_venue.is_live),
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
                        where i.venue_id = p_venue_id and i.active and i.is_post_match_offer), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.venue_page(uuid) from public, anon;
grant execute on function public.venue_page(uuid) to authenticated, service_role;
