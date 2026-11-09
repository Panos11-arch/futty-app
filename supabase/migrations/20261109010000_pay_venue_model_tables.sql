-- P3 venue model: real pitches, opening hours per weekday, closures, price
-- rules per format, venue blocks, and which pitch(es) each booking holds.
-- Replaces the pooled venues.base_pitches / open_time / close_time /
-- price_per_pitch_hour model. Those columns stay for app builds released
-- before P3, but the server no longer reads them.

create extension if not exists btree_gist with schema extensions;

-- Peak pricing window on weekdays (Saturday and Sunday use the weekend price
-- all day). peak_ends null = until closing.
alter table public.venues add column if not exists peak_starts time not null default '17:00';
alter table public.venues add column if not exists peak_ends time;

-- 6-a-side is now a real format: a real 6-a-side pitch (English School
-- Central Park) with its own price. allows_6v6_on_5s still only applies to
-- 5-a-side pitches.
create or replace function public.format_player_count(p_format text)
returns integer
language sql
immutable
as $$
  select case p_format
    when '5-a-side' then 5
    when '6-a-side' then 6
    when '7-a-side' then 7
    when '9-a-side' then 9
    when '11-a-side' then 11
    else 10 -- shouldn't happen; book_slot refuses any other format
  end;
$$;

create table if not exists public.pitches (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null,
  size text not null check (size in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  -- Formats this pitch hosts on its own (bigger formats on combined pitches
  -- are in pitch_combinations).
  formats text[] not null,
  surface text,
  indoor boolean not null default false,
  -- Closed for maintenance: nothing new can be booked on it.
  is_open boolean not null default true,
  sort_order integer not null default 0,
  unique (venue_id, name),
  check (formats <@ array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] and cardinality(formats) > 0)
);
create index if not exists pitches_venue_idx on public.pitches (venue_id, sort_order);

-- "Pitch 1 + Pitch 2 = 7-a-side": exactly which pitches combine, and into what.
create table if not exists public.pitch_combinations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  format text not null check (format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  pitch_ids uuid[] not null check (cardinality(pitch_ids) >= 2)
);
create index if not exists pitch_combinations_venue_idx on public.pitch_combinations (venue_id, format);

-- ISO weekday: 1 = Monday ... 7 = Sunday. No row = closed that day.
-- closes may be 24:00 (midnight).
create table if not exists public.opening_hours (
  venue_id uuid not null references public.venues (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  primary key (venue_id, weekday),
  check (closes > opens)
);

-- Whole-venue closures (holidays), inclusive dates.
create table if not exists public.venue_closures (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text,
  check (ends_on >= starts_on)
);
create index if not exists venue_closures_venue_idx on public.venue_closures (venue_id, starts_on);

-- Price per hour for one booking of the format (all the pitches it uses),
-- in cents. Peak = weekdays inside the venue's peak window; weekend =
-- Saturday and Sunday all day; otherwise off-peak.
create table if not exists public.price_rules (
  venue_id uuid not null references public.venues (id) on delete cascade,
  format text not null check (format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  peak_cents integer not null check (peak_cents >= 0),
  offpeak_cents integer not null check (offpeak_cents >= 0),
  weekend_cents integer not null check (weekend_cents >= 0),
  primary key (venue_id, format)
);

-- Staff close a pitch (pitch_id) or every pitch (null) for a whole day
-- (no times) or a time range on a day. Stops NEW bookings only.
create table if not exists public.venue_blocks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  pitch_id uuid references public.pitches (id) on delete cascade,
  block_day date not null,
  starts_at time,
  ends_at time,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and ends_at > starts_at))
);
create index if not exists venue_blocks_venue_day_idx on public.venue_blocks (venue_id, block_day);

-- Which pitch(es) a booking holds. The exclusion constraint makes it
-- impossible for two active bookings to hold the same pitch at overlapping
-- times, even under concurrent requests. Rows are removed when a booking is
-- cancelled.
create table if not exists public.booking_pitches (
  booking_id uuid not null references public.venue_bookings (id) on delete cascade,
  pitch_id uuid not null references public.pitches (id) on delete restrict,
  slot tsrange not null,
  primary key (booking_id, pitch_id),
  constraint booking_pitches_no_overlap exclude using gist (pitch_id with =, slot with &&)
);

-- Venue data is public to signed-in users; writes go through Futty (service
-- role) or the venue functions. Who holds which pitch follows booking
-- visibility.
alter table public.pitches enable row level security;
alter table public.pitch_combinations enable row level security;
alter table public.opening_hours enable row level security;
alter table public.venue_closures enable row level security;
alter table public.price_rules enable row level security;
alter table public.venue_blocks enable row level security;
alter table public.booking_pitches enable row level security;

create policy "Signed-in users read pitches" on public.pitches for select to authenticated using (true);
create policy "Signed-in users read pitch combinations" on public.pitch_combinations for select to authenticated using (true);
create policy "Signed-in users read opening hours" on public.opening_hours for select to authenticated using (true);
create policy "Signed-in users read closures" on public.venue_closures for select to authenticated using (true);
create policy "Signed-in users read prices" on public.price_rules for select to authenticated using (true);
create policy "Signed-in users read venue blocks" on public.venue_blocks for select to authenticated using (true);
create policy "People in a booking read its pitches" on public.booking_pitches
  for select to authenticated using (public.can_view_booking(booking_id));

grant select on public.pitches, public.pitch_combinations, public.opening_hours, public.venue_closures,
  public.price_rules, public.venue_blocks, public.booking_pitches to authenticated;
grant all on public.pitches, public.pitch_combinations, public.opening_hours, public.venue_closures,
  public.price_rules, public.venue_blocks, public.booking_pitches to service_role;

-- Contract 4 (docs/specs/06-coding.md): send_notification(profile_id, type,
-- data) is Anghelo's, built in A2 with push and per-type opt-outs. Until
-- then this stub with the agreed signature only writes the in-app row; A2
-- replaces it with create or replace. data.title and data.body are the
-- text shown.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due',
  'team_invite', 'booking_invite', 'venue_closed_new_bookings'
]));

create or replace function public.send_notification(p_profile_id uuid, p_type text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (profile_id, type, title, body, data)
  values (
    p_profile_id, p_type,
    coalesce(p_data ->> 'title', initcap(replace(p_type, '_', ' '))),
    coalesce(p_data ->> 'body', ''),
    coalesce(p_data, '{}'::jsonb) - 'title' - 'body'
  );
end;
$$;

revoke all on function public.send_notification(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_notification(uuid, text, jsonb) to service_role;

-- Builds the new model for a venue from its legacy columns: N 5-a-side
-- pitches, neighbouring pitches combining for 7s, 9s and 11s (the same rule
-- as the old "a 7-a-side uses 2 pitches"), today's hours every day, and
-- today's price x pitches used for every band. So nothing changes for
-- players until P9 imports the real venue data. Does nothing for a venue
-- that already has pitches.
create or replace function public.init_venue_model_from_legacy(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_size record;
  v_closes time;
  i integer;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null or exists (select 1 from public.pitches where venue_id = p_venue_id) then
    return;
  end if;

  for i in 1 .. coalesce(v_venue.base_pitches, 0) loop
    insert into public.pitches (venue_id, name, size, formats, surface, sort_order)
    values (p_venue_id, 'Pitch ' || i, '5-a-side', array['5-a-side'], v_venue.surface, i);
  end loop;

  for v_size in select * from (values (1, '5-a-side'), (2, '7-a-side'), (3, '9-a-side'), (4, '11-a-side')) as s (pitches, format)
  loop
    continue when v_size.pitches > coalesce(v_venue.base_pitches, 0);

    if v_size.pitches > 1 then
      for i in 1 .. v_venue.base_pitches - v_size.pitches + 1 loop
        insert into public.pitch_combinations (venue_id, format, pitch_ids)
        select p_venue_id, v_size.format, array_agg(p.id order by p.sort_order)
        from public.pitches p
        where p.venue_id = p_venue_id and p.sort_order between i and i + v_size.pitches - 1;
      end loop;
    end if;

    insert into public.price_rules (venue_id, format, peak_cents, offpeak_cents, weekend_cents)
    select p_venue_id, v_size.format, c, c, c
    from (select round(coalesce(v_venue.price_per_pitch_hour, 0) * v_size.pitches * 100)::integer as c) as price;
  end loop;

  -- A close at or before opening, or 23:59, means midnight.
  v_closes := case
    when v_venue.close_time is null or v_venue.close_time <= v_venue.open_time or v_venue.close_time >= time '23:59'
      then time '24:00'
    else v_venue.close_time
  end;
  if v_venue.open_time is not null then
    insert into public.opening_hours (venue_id, weekday, opens, closes)
    select p_venue_id, d, v_venue.open_time, v_closes from generate_series(1, 7) as d;
  end if;
end;
$$;

revoke all on function public.init_venue_model_from_legacy(uuid) from public, anon, authenticated;
grant execute on function public.init_venue_model_from_legacy(uuid) to service_role;

select public.init_venue_model_from_legacy(id) from public.venues;
