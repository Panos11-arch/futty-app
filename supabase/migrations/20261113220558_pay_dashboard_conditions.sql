-- P6a: venue condition warning (docs/specs/13-payments-bookings.md "Venue
-- condition warning"; 05 section 12, launch item 6; wording decided 13
-- November).
--
-- Staff flag "conditions may be unsuitable" for a day, or a time range on a
-- day, for one pitch or the whole venue. Every player booked in a game it
-- covers that hasn't ended is notified, once per game however many flags
-- overlap it (venue_condition_warnings), so they hear in time to cancel before the 6-hour
-- cutoff. Normal cancellation rules apply: nothing is cancelled, no money
-- moves. Clearing a flag tells nobody.
--
-- Sent as venue_condition_warning, the type contract 4 already reserves for
-- this (docs/specs/match-record.md; always sent), with send_notification.

create table public.venue_condition_flags (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  -- null = every pitch.
  pitch_id uuid references public.pitches (id) on delete cascade,
  flag_day date not null,
  -- Both null = the whole day.
  starts_at time,
  ends_at time,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  check ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and ends_at > starts_at))
);
create index venue_condition_flags_venue_day_idx on public.venue_condition_flags (venue_id, flag_day);

alter table public.venue_condition_flags enable row level security;
create policy "Venue staff read their condition flags" on public.venue_condition_flags
  for select to authenticated using (public.is_venue_staff(venue_id));
revoke all on public.venue_condition_flags from public, anon, authenticated;
grant select on public.venue_condition_flags to authenticated;
grant select, insert, update, delete on public.venue_condition_flags to service_role;

-- Who has been warned about which game: each player once per game, however
-- many flags overlap it (decided 13 November).
create table public.venue_condition_warnings (
  booking_id uuid not null references public.venue_bookings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  flag_id uuid references public.venue_condition_flags (id) on delete set null,
  warned_at timestamptz not null default now(),
  primary key (booking_id, profile_id)
);
create index venue_condition_warnings_venue_idx on public.venue_condition_warnings (venue_id, warned_at);

alter table public.venue_condition_warnings enable row level security;
create policy "Venue staff read their condition warnings" on public.venue_condition_warnings
  for select to authenticated using (public.is_venue_staff(venue_id));
revoke all on public.venue_condition_warnings from public, anon, authenticated;
grant select on public.venue_condition_warnings to authenticated;
grant select, insert, update, delete on public.venue_condition_warnings to service_role;

-- Flags a day or slot and tells everyone booked then. Returns the flag id.
create or replace function public.flag_conditions(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitch_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.venue_condition_flags;
  v_venue_name text;
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_day is null or p_day < (now() at time zone 'Asia/Nicosia')::date then
    raise exception 'day_in_past';
  end if;
  if (p_start is null) <> (p_end is null) or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;
  if p_pitch_id is not null
     and not exists (select 1 from public.pitches where id = p_pitch_id and venue_id = p_venue_id) then
    raise exception 'invalid_pitch';
  end if;

  insert into public.venue_condition_flags (venue_id, pitch_id, flag_day, starts_at, ends_at, note, created_by)
  values (p_venue_id, p_pitch_id, p_day, p_start, p_end, nullif(btrim(p_note), ''), auth.uid())
  returning * into v_flag;

  select name into v_venue_name from public.venues where id = p_venue_id;
  v_venue_name := coalesce(v_venue_name, 'The venue');

  -- The booker and every player still in each game the flag covers that
  -- hasn't ended (Cyprus time), each once per game: a game already warned
  -- about by an earlier flag isn't warned again.
  for v_row in
    select distinct b.id as booking_id, b.booking_day, b.start_time, player.profile_id
    from public.venue_bookings b
    cross join lateral (
      select b.created_by as profile_id
      union
      select s.profile_id from public.booking_payment_shares s
      where s.booking_id = b.id and s.status not in ('cancelled', 'refunded')
    ) as player
    where b.venue_id = p_venue_id
      and b.booking_day = p_day
      and b.booking_type = 'user_booking'
      and b.status <> 'cancelled'
      and b.booking_day + b.end_time > (now() at time zone 'Asia/Nicosia')
      and (p_start is null or (b.start_time < p_end and b.end_time > p_start))
      and (p_pitch_id is null
           or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = p_pitch_id))
      and player.profile_id is not null
  loop
    insert into public.venue_condition_warnings (booking_id, profile_id, venue_id, flag_id)
    values (v_row.booking_id, v_row.profile_id, p_venue_id, v_flag.id)
    on conflict (booking_id, profile_id) do nothing;
    if not found then
      continue;
    end if;
    perform public.send_notification(
      v_row.profile_id,
      'venue_condition_warning',
      jsonb_build_object(
        'title', 'Conditions may be unsuitable',
        'body', v_venue_name || ' says conditions may be unsuitable on '
                || to_char(v_row.booking_day, 'FMDay FMDD FMMonth') || ' at ' || to_char(v_row.start_time, 'HH24:MI')
                || '. Normal cancellation rules apply: cancel at least 6 hours before kickoff to keep your money as '
                || 'credit at ' || v_venue_name || '.',
        'bookingId', v_row.booking_id,
        'venueId', p_venue_id,
        'flagId', v_flag.id
      )
    );
  end loop;

  return v_flag.id;
end;
$$;

-- Clears a flag (conditions are fine again). Nobody is notified.
create or replace function public.clear_conditions(p_flag_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.venue_condition_flags;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_flag from public.venue_condition_flags where id = p_flag_id for update;
  if v_flag.id is null then
    raise exception 'flag_not_found';
  end if;
  if not public.is_venue_staff(v_flag.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  update public.venue_condition_flags set cleared_at = coalesce(cleared_at, now()) where id = p_flag_id;
end;
$$;

revoke all on function public.flag_conditions(uuid, date, time, time, uuid, text) from public, anon;
grant execute on function public.flag_conditions(uuid, date, time, time, uuid, text) to authenticated, service_role;
revoke all on function public.clear_conditions(uuid) from public, anon;
grant execute on function public.clear_conditions(uuid) to authenticated, service_role;
