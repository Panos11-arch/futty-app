-- B1a, Booking v2 rule 8 (spec 13 "Choosing a pitch", decided 20 November):
-- players choose their pitch.
--
--   * venue_bookings.booking_kind: 'whole' or 'half' for a Booking v2
--     booking; null for one booked by an older app build (rule 7).
--   * venue_free_pitches: the free pitches and the venue's own combinations
--     for a time and format, with their names ("Pitch 2", "Pitch 1 + 2"),
--     surface, indoor or outdoor and the server's price, first the one
--     book_slot would pick by itself. A format bigger than a single pitch
--     comes only from pitch_combinations; never from pitch sizes.
--   * book_slot takes the chosen pitch or combination (p_pitch_ids) and the
--     Booking v2 kind (p_kind). It checks the choice belongs to the venue,
--     fits the format, is open, isn't blocked and is free; if it was just
--     taken: pitch_not_free, with the pitch's name as the detail ("Pitch 2
--     is no longer free. Pick another."). booking_pitches' exclusion
--     constraint stays the final guard. A Booking v2 call refuses "Just my
--     spot" and a whole-pitch Losers pay. Without p_kind and p_pitch_ids it
--     books exactly as before, so older app builds keep working.
--   * booking_pitch_label: a booking's pitch name, for whoever can see it.
--
-- book_slot is re-created from its latest definition
-- (20261115190000_pay_app_rules.sql). Its only changes: the two new
-- parameters, the Booking v2 checks after the mode checks, the chosen-pitch
-- branch, booking_kind in the insert and pitch_not_free on an exclusion
-- violation of a chosen pitch.

alter table public.venue_bookings
  add column booking_kind text check (booking_kind in ('whole', 'half'));

-- "Pitch 2", or "Pitch 1 + 2" when the names share a prefix and end in a
-- number, otherwise "North + South".
create or replace function public.pitch_choice_label(p_pitch_ids uuid[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select p.name, p.sort_order, regexp_match(p.name, '^(.*?)([0-9]+)$') as parts
    from public.pitches p
    where p.id = any (p_pitch_ids)
  )
  select case
           when count(*) = 0 then null
           when count(*) = 1 then min(m.name)
           when count(m.parts) = count(*) and count(distinct m.parts[1]) = 1 then
             (array_agg(m.name order by m.sort_order, m.name))[1] || ' + '
             || array_to_string((array_agg(m.parts[2] order by m.sort_order, m.name))[2:], ' + ')
           else string_agg(m.name, ' + ' order by m.sort_order, m.name)
         end
  from m;
$$;

-- The chosen pitch or combination, checked: one open pitch of the venue that
-- hosts the format, or exactly one of the venue's own combinations for the
-- format, all of its pitches open. 6 v 6 on 5s uses one 5-a-side pitch.
create or replace function public.validated_pitch_choice(
  p_venue_id uuid,
  p_pitch_ids uuid[],
  p_format text,
  p_six_on_five boolean
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sorted uuid[];
begin
  if p_pitch_ids is null or cardinality(p_pitch_ids) = 0 or array_position(p_pitch_ids, null) is not null
     or (select count(distinct x) from unnest(p_pitch_ids) x) <> cardinality(p_pitch_ids) then
    raise exception 'invalid_pitch_choice';
  end if;
  select array_agg(x order by x) into v_sorted from unnest(p_pitch_ids) x;

  if cardinality(p_pitch_ids) = 1 then
    if not exists (select 1 from public.pitches p
                   where p.id = p_pitch_ids[1] and p.venue_id = p_venue_id and p.is_open
                     and p_format = any (p.formats)
                     and (not p_six_on_five or p.size = '5-a-side')) then
      raise exception 'invalid_pitch_choice';
    end if;
  elsif p_six_on_five
        or not exists (select 1 from public.pitch_combinations c
                       where c.venue_id = p_venue_id and c.format = p_format
                         and (select array_agg(x order by x) from unnest(c.pitch_ids) x) = v_sorted)
        or (select count(*) from public.pitches p
            where p.id = any (p_pitch_ids) and p.venue_id = p_venue_id and p.is_open) <> cardinality(p_pitch_ids) then
    raise exception 'invalid_pitch_choice';
  end if;

  return array(select p.id from public.pitches p where p.id = any (p_pitch_ids) order by p.sort_order, p.name, p.id);
end;
$$;

create or replace function public.venue_free_pitches(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_players_per_side integer default 5
)
returns table (
  pitch_ids uuid[],
  label text,
  kind text,
  surface text,
  indoor boolean,
  price_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_premium boolean;
  v_six_on_five boolean := p_players_per_side = 6 and p_format = '5-a-side';
  v_price integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_premium := coalesce((select pr.is_premium from public.profiles pr where pr.id = auth.uid()), false);
  begin
    perform public.booking_slot_checked(p_venue_id, p_day, p_start, p_end, p_format, p_players_per_side, v_premium);
  exception when others then
    -- A format the venue doesn't offer (no pitch, no combination) lists nothing.
    if sqlerrm = 'invalid_format' then
      return;
    end if;
    raise;
  end;
  v_price := public.slot_price_cents(p_venue_id, p_day, p_start, p_end, p_format);
  if v_price is null then
    return;
  end if;

  -- The same candidates, in the same order, as pick_pitches.
  return query
  with candidates as (
    select array[p.id] as ids, 0 as k, public.format_player_count(p.size) as size_rank, p.sort_order as ord
    from public.pitches p
    where p.venue_id = p_venue_id and p.is_open and p_format = any (p.formats)
      and (not v_six_on_five or p.size = '5-a-side')
    union all
    select array(select p.id from public.pitches p where p.id = any (c.pitch_ids) order by p.sort_order, p.name, p.id),
           1, 0, (select min(p.sort_order) from public.pitches p where p.id = any (c.pitch_ids))
    from public.pitch_combinations c
    where c.venue_id = p_venue_id and c.format = p_format and not v_six_on_five
      and (select count(*) from public.pitches p
           where p.id = any (c.pitch_ids) and p.venue_id = p_venue_id and p.is_open) = cardinality(c.pitch_ids)
  )
  select c.ids,
         public.pitch_choice_label(c.ids),
         case c.k when 0 then 'pitch' else 'combination' end,
         (select case when count(distinct p.surface) = 1 and count(p.surface) = count(*) then min(p.surface) end
          from public.pitches p where p.id = any (c.ids)),
         (select case when bool_and(p.indoor) then true when not bool_or(p.indoor) then false end
          from public.pitches p where p.id = any (c.ids)),
         v_price
  from candidates c
  where not exists (select 1 from public.booking_pitches bp
                    where bp.pitch_id = any (c.ids)
                      and bp.slot && public.booking_slot_range(p_day, p_start, p_end))
    and not public.slot_is_blocked(p_venue_id, c.ids, p_day, p_start, p_end)
  order by c.k, c.size_rank, c.ord;
end;
$$;

create or replace function public.booking_pitch_label(p_booking_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.can_view_booking(p_booking_id) then
           public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp
                                           where bp.booking_id = p_booking_id))
         end;
$$;

drop function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid);

create or replace function public.book_slot(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitches integer,
  p_format text,
  p_players_per_side integer default 5,
  p_mode text default null,
  p_team_id uuid default null,
  p_pitch_ids uuid[] default null,
  p_kind text default null
)
returns public.venue_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_window_days integer;
  v_hours record;
  v_six_on_five boolean;
  v_capacity integer;
  v_pitch_ids uuid[];
  v_amount_cents integer;
  v_status text;
  v_booking public.venue_bookings;
  v_share record;
  v_premium boolean;
  v_gipedo boolean := p_mode = 'gipedo_pano';
  v_error text;
  v_label text;  -- B1a: the chosen pitch's name, for "pitch_not_free"
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not v_venue.is_live then
    raise exception 'venue_not_live';
  end if;

  if p_day < v_now::date or (p_day = v_now::date and p_start <= v_now::time) then
    raise exception 'slot_in_past';
  end if;

  v_premium := exists (select 1 from public.profiles where id = auth.uid() and is_premium);
  v_window_days := public.rule_window_days(v_premium);
  if p_day - v_now::date > v_window_days then
    raise exception 'beyond_booking_window';
  end if;

  if p_pitches is null or p_pitches < 1
     or p_pitches > (select count(*) from public.pitches where venue_id = p_venue_id) then
    raise exception 'invalid_pitches';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;

  if extract(minute from p_start) not in (0, 30) or extract(second from p_start) <> 0
     or extract(minute from p_end) not in (0, 30) or extract(second from p_end) <> 0 then
    raise exception 'slot_not_on_grid';
  end if;

  select * into v_hours from public.venue_hours_on(p_venue_id, p_day);
  if v_hours.closed then
    raise exception 'venue_closed';
  end if;
  if v_hours.opens is null or p_start < v_hours.opens or p_end > v_hours.closes then
    raise exception 'outside_opening_hours';
  end if;

  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
     or not (
       exists (select 1 from public.pitches where venue_id = p_venue_id and p_format = any (formats))
       or exists (select 1 from public.pitch_combinations where venue_id = p_venue_id and format = p_format)
     ) then
    raise exception 'invalid_format';
  end if;

  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    raise exception 'invalid_players_per_side';
  end if;
  v_six_on_five := p_players_per_side = 6 and p_format = '5-a-side';
  if p_players_per_side = 6 and p_format <> '6-a-side' and (p_format <> '5-a-side' or not v_venue.allows_6v6_on_5s) then
    raise exception 'six_a_side_not_allowed';
  end if;
  v_capacity := case when v_six_on_five then 12 else public.format_player_count(p_format) * 2 end;

  if p_mode is null then
    raise exception 'mode_required';
  end if;
  if p_mode not in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;

  -- B1a, Booking v2 (spec 13 "Booking modes"): a call that names its kind
  -- is a Booking v2 booking. "Just my spot" is removed for those, and Losers
  -- pay is half pitch only. Half pitches arrive in B1b. A call without
  -- p_kind is an older app build and books exactly as before.
  if p_kind is not null then
    if p_kind not in ('whole', 'half') then
      raise exception 'invalid_booking_kind';
    end if;
    if p_kind = 'half' then
      raise exception 'half_pitch_not_available';
    end if;
    if p_mode = 'each_pays_own_spot' then
      raise exception 'just_my_spot_removed';
    end if;
    if p_mode = 'gipedo_pano' then
      raise exception 'losers_pay_half_pitch_only';
    end if;
  end if;

  -- Gipedo Pano: a captain, for their team, 24 to 144 hours ahead.
  if v_gipedo then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not public.is_team_captain(p_team_id, auth.uid()) then
      raise exception 'not_captain';
    end if;
    v_error := public.gipedo_window_error(public.booking_kickoff_at(p_day, p_start), now());
    if v_error is not null then
      raise exception '%', v_error;
    end if;
  end if;

  v_amount_cents := public.slot_price_cents(p_venue_id, p_day, p_start, p_end, p_format);
  if v_amount_cents is null then
    raise exception 'price_not_set';
  end if;

  if p_pitch_ids is not null then
    -- B1a: the player's chosen pitch or combination: the venue's own, fit
    -- for the format, open, not blocked and free. booking_pitches'
    -- exclusion constraint below stays the final guard.
    v_pitch_ids := public.validated_pitch_choice(p_venue_id, p_pitch_ids, p_format, v_six_on_five);
    v_label := public.pitch_choice_label(v_pitch_ids);
    if public.slot_is_blocked(p_venue_id, v_pitch_ids, p_day, p_start, p_end) then
      raise exception 'slot_blocked';
    end if;
    if exists (select 1 from public.booking_pitches bp
               where bp.pitch_id = any (v_pitch_ids)
                 and bp.slot && public.booking_slot_range(p_day, p_start, p_end)) then
      raise exception 'pitch_not_free' using detail = v_label;
    end if;
  else
    v_pitch_ids := public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five);
    if v_pitch_ids is null then
      if public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five, p_ignore_blocks => true) is not null then
        raise exception 'slot_blocked';
      end if;
      raise exception 'slot_full';
    end if;
  end if;

  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player, payment_mode, team_id, booking_kind)
    values
      (p_venue_id, p_day, p_start, p_end, cardinality(v_pitch_ids), v_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.money_fee_per_player_cents(p_mode) end, p_mode,
       case when v_gipedo then p_team_id end, p_kind)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select v_booking.id, unnest(v_pitch_ids), public.booking_slot_range(p_day, p_start, p_end);
  exception when exclusion_violation then
    if p_pitch_ids is not null then
      raise exception 'pitch_not_free' using detail = v_label;
    end if;
    raise exception 'slot_full';
  end;

  if v_amount_cents > 0 then
    select * into v_share from public.money_share(v_amount_cents, v_capacity, p_mode, true, v_premium, 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, gipedo_side)
    values
      (v_booking.id, auth.uid(), v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, true,
       'pending', case when v_gipedo then 'a' end);

    if p_mode = 'each_pays_responsible' then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (v_booking.id, auth.uid(), v_amount_cents,
              public.money_guarantee_hold_due_at(v_booking.created_at, public.booking_kickoff_at(p_day, p_start)));
    end if;
  end if;

  return v_booking;
end;
$$;


revoke all on function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid, uuid[], text) from public, anon;
grant execute on function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid, uuid[], text)
  to authenticated, service_role;

revoke all on function public.venue_free_pitches(uuid, date, time, time, text, integer) from public, anon;
grant execute on function public.venue_free_pitches(uuid, date, time, time, text, integer) to authenticated, service_role;
revoke all on function public.booking_pitch_label(uuid) from public, anon;
grant execute on function public.booking_pitch_label(uuid) to authenticated, service_role;

revoke all on function public.pitch_choice_label(uuid[]) from public, anon, authenticated;
grant execute on function public.pitch_choice_label(uuid[]) to service_role;
revoke all on function public.validated_pitch_choice(uuid, uuid[], text, boolean) from public, anon, authenticated;
grant execute on function public.validated_pitch_choice(uuid, uuid[], text, boolean) to service_role;
