-- B1b, Booking v2 (spec 13 "Two kinds of booking" and "How each side pays",
-- decided 20 and 23 November): whole and half pitch, side A with its
-- captain, and each side's way to pay.
--
--   * booking_v2_settings.half_pitch_enabled (off): half pitches can't be
--     booked until the rest of Booking v2 (B1c-B1e and the app, B2-B5) is
--     ready. Only Futty switches it on (service role).
--   * booking_sides: on a half pitch, side A (and side B from B1c): its
--     captain, its way to pay, its half of the pitch (rounded down: Futty
--     absorbs an odd cent, decided 23 November) and its players.
--   * booking_payment_shares.side: which side a share is on.
--   * book_slot: a half pitch makes side A, the booker as captain, with the
--     booker's share from side A's half; with "pay for myself" his
--     guarantee is his side's half (decided 23 November). Losers pay on a
--     half pitch comes in B1d.
--   * add_booking_share_internal: a player joins side A of a half pitch, up
--     to its players (add_booking_side_share_internal).
--   * share_payment_plan: a share on a half pitch is priced from its side;
--     cash is whole pitch only (cash_whole_pitch_only).
--   * collection_amounts: a half pitch is counted side by side
--     (collection_amounts_side).
--   * switch_refusal: a half pitch never switches to 6 v 6.
--   * booking_quote_v2: the checkout's amounts for both kinds.
--
-- Re-created from their latest definitions, with only the B1b changes:
-- book_slot (20261123013206_pay_b1a_choose_pitch.sql),
-- add_booking_share_internal (20261117153008_pay_venue_player.sql),
-- share_payment_plan (20261113115749_pay_gipedo_mode.sql),
-- collection_amounts (20261116134544_pay_cash_top_ups.sql),
-- switch_refusal (20261118001124_p6e_audit_fixes.sql).
-- collection_amounts_side is collection_amounts' own logic, run on one
-- side's half, players and captain.

create table public.booking_v2_settings (
  id boolean primary key default true check (id),
  half_pitch_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.booking_v2_settings default values;
alter table public.booking_v2_settings enable row level security;
revoke all on public.booking_v2_settings from public, anon, authenticated;
grant select, update on public.booking_v2_settings to service_role;

create or replace function public.half_pitch_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.half_pitch_enabled from public.booking_v2_settings s where s.id), false);
$$;

create table public.booking_sides (
  booking_id uuid not null references public.venue_bookings (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  captain_id uuid not null references public.profiles (id),
  payment_mode text not null check (payment_mode in ('pay_all', 'each_pays_responsible', 'gipedo_pano')),
  pitch_cents integer not null check (pitch_cents >= 0),
  players integer not null check (players > 0),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (booking_id, side)
);
alter table public.booking_sides enable row level security;
revoke all on public.booking_sides from public, anon, authenticated;
grant select on public.booking_sides to authenticated;
grant select, insert, update, delete on public.booking_sides to service_role;
create policy "People in a booking can read its sides" on public.booking_sides
  for select to authenticated using (public.can_view_booking(booking_id));

alter table public.booking_payment_shares
  add column side text check (side in ('a', 'b'));

-- A player joins a side of a half pitch: priced from that side's half, its
-- players and its way to pay; nothing if the side is full. Under the
-- booking's row lock, like add_booking_share_internal.
create or replace function public.add_booking_side_share_internal(p_booking_id uuid, p_profile_id uuid, p_side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_count integer;
  v_share record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.status = 'cancelled' or v_booking.booking_kind is distinct from 'half' then
    return;
  end if;
  select * into v_side from public.booking_sides where booking_id = p_booking_id and side = p_side;
  if v_side.booking_id is null then
    raise exception 'side_not_found';
  end if;

  select count(*) into v_count
  from public.booking_payment_shares
  where booking_id = p_booking_id and side = p_side
    and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due');
  if v_count >= v_side.players then
    return;
  end if;

  select * into v_share from public.money_share(
    v_side.pitch_cents, v_side.players, v_side.payment_mode, false,
    exists (select 1 from public.profiles where id = p_profile_id and is_premium), 'card');
  insert into public.booking_payment_shares
    (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, side)
  values
    (p_booking_id, p_profile_id, v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, false,
     case when v_side.payment_mode = 'pay_all' then 'covered' else 'pending' end, p_side)
  on conflict (booking_id, profile_id) do nothing;
end;
$$;

-- What the checkout shows for each kind and way to pay, from the server
-- (spec 13 "Booking modes", worked examples 1-5 and 11). "Pay for myself"
-- shows the caller's own share, a player's share and the guarantee held
-- for unpaid spots: the pitch price on a whole pitch, the side's half on a
-- half pitch. Cash is whole pitch only. Losers pay comes in B1d.
create or replace function public.booking_quote_v2(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_players_per_side integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_premium boolean;
  v_players integer;
  v_price integer;
  v_half integer;
  v_kickoff timestamptz;
  v_in_debt boolean;
  w_all record; w_mine record; w_each record; w_cash record;
  h_all record; h_mine record; h_each record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.venue_visible(p_venue_id) then
    raise exception 'venue_not_found';
  end if;
  v_premium := coalesce((select is_premium from public.profiles where id = v_uid), false);
  v_players := public.booking_slot_checked(p_venue_id, p_day, p_start, p_end, p_format, p_players_per_side, v_premium);
  v_price := public.slot_price_cents(p_venue_id, p_day, p_start, p_end, p_format);
  if v_price is null then
    raise exception 'price_not_set';
  end if;
  v_half := v_price / 2;

  select * into w_all from public.money_share(v_price, v_players, 'pay_all', true, v_premium, 'card');
  select * into w_mine from public.money_share(v_price, v_players, 'each_pays_responsible', true, v_premium, 'card');
  select * into w_each from public.money_share(v_price, v_players, 'each_pays_responsible', false, false, 'card');
  select * into w_cash from public.money_share(v_price, v_players, 'each_pays_responsible', true, v_premium, 'cash');
  select * into h_all from public.money_share(v_half, v_players / 2, 'pay_all', true, v_premium, 'card');
  select * into h_mine from public.money_share(v_half, v_players / 2, 'each_pays_responsible', true, v_premium, 'card');
  select * into h_each from public.money_share(v_half, v_players / 2, 'each_pays_responsible', false, false, 'card');

  v_in_debt := public.profile_has_debt(v_uid);
  v_kickoff := public.booking_kickoff_at(p_day, p_start);

  return jsonb_build_object(
    'venue_id', p_venue_id, 'day', p_day, 'start_time', p_start, 'end_time', p_end, 'format', p_format,
    'players_per_side', p_players_per_side, 'players', v_players, 'pitch_cents', v_price, 'is_premium', v_premium,
    'kickoff_at', v_kickoff,
    'refunds_stop_at', v_kickoff - public.rule_refund_cutoff(),
    'non_refundable', public.money_is_non_refundable(now(), v_kickoff),
    'whole', jsonb_build_object(
      'pay_all', jsonb_build_object('pitch_cents', w_all.pitch_cents, 'fee_cents', w_all.fee_cents,
                                    'card_cents', w_all.card_cents),
      'pay_for_myself', jsonb_build_object('card_cents', w_mine.card_cents, 'pitch_cents', w_mine.pitch_cents,
                                           'fee_cents', w_mine.fee_cents, 'player_cents', w_each.card_cents,
                                           'guarantee_cents', v_price),
      'cash', jsonb_build_object('card_cents', w_cash.card_cents, 'cash_cents', w_cash.cash_cents,
                                 'guarantee_cents', v_price)),
    'half', jsonb_build_object(
      'available', public.half_pitch_enabled(),
      'side_pitch_cents', v_half,
      'pay_all', jsonb_build_object('pitch_cents', h_all.pitch_cents, 'fee_cents', h_all.fee_cents,
                                    'card_cents', h_all.card_cents),
      'pay_for_myself', jsonb_build_object('card_cents', h_mine.card_cents, 'pitch_cents', h_mine.pitch_cents,
                                           'fee_cents', h_mine.fee_cents, 'player_cents', h_each.card_cents,
                                           'guarantee_cents', v_half)),
    'in_debt', v_in_debt,
    'cash_allowed', not v_in_debt,
    'cancellation', public.cancellation_terms()
  );
end;
$$;

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
      -- B1b: half pitches stay off until Booking v2 is ready to go live.
      if not public.half_pitch_enabled() then
        raise exception 'half_pitch_not_available';
      end if;
      if p_mode = 'gipedo_pano' then
        raise exception 'losers_pay_not_available';  -- B1d
      end if;
    end if;
    if p_mode = 'each_pays_own_spot' then
      raise exception 'just_my_spot_removed';
    end if;
    if p_mode = 'gipedo_pano' and p_kind = 'whole' then
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

  -- B1b: a half pitch's side A, its captain the booker: half the pitch,
  -- rounded down, for half the players (Futty absorbs an odd cent).
  if p_kind = 'half' then
    insert into public.booking_sides (booking_id, side, captain_id, payment_mode, pitch_cents, players, accepted_at)
    values (v_booking.id, 'a', auth.uid(), p_mode, v_amount_cents / 2, v_capacity / 2, now());
  end if;

  if v_amount_cents > 0 then
    if p_kind = 'half' then
      select * into v_share from public.money_share(v_amount_cents / 2, v_capacity / 2, p_mode, true, v_premium, 'card');
    else
      select * into v_share from public.money_share(v_amount_cents, v_capacity, p_mode, true, v_premium, 'card');
    end if;
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, gipedo_side, side)
    values
      (v_booking.id, auth.uid(), v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, true,
       'pending', case when v_gipedo then 'a' end, case when p_kind = 'half' then 'a' end);

    if p_mode = 'each_pays_responsible' then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (v_booking.id, auth.uid(), case when p_kind = 'half' then v_amount_cents / 2 else v_amount_cents end,
              public.money_guarantee_hold_due_at(v_booking.created_at, public.booking_kickoff_at(p_day, p_start)));
    end if;
  end if;

  return v_booking;
end;
$$;


create or replace function public.add_booking_share_internal(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
  v_current_count integer;
  v_share record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;  -- P12: one at a time with a switch
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  -- B1b: on a half pitch a player joins side A here; side B's players join
  -- through their own captain (B1c). Each side has its own half and players.
  if v_booking.booking_kind = 'half' then
    perform public.add_booking_side_share_internal(p_booking_id, p_profile_id, 'a');
    return;
  end if;

  v_total_needed := public.booking_total_shares_needed(p_booking_id);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due');
  -- P6e: an accepted venue player takes a spot, with no share. Counted under
  -- the lock above, as answer_venue_player counts it.
  v_current_count := v_current_count + (select count(*) from public.booking_venue_players vp
                                        where vp.booking_id = p_booking_id and vp.status = 'accepted');

  if v_current_count >= v_total_needed then
    return;
  end if;

  if v_booking.payment_mode is not null then
    select * into v_share from public.money_share(
      v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, false,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status)
    values
      (p_booking_id, p_profile_id, v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, false,
       case when v_booking.payment_mode in ('pay_all', 'gipedo_pano') then 'covered' else 'pending' end)
    on conflict (booking_id, profile_id) do nothing;
    return;
  end if;

  v_share_cents := v_booking.amount_cents / v_total_needed
                   + coalesce(v_booking.service_fee_cents_per_player, 0);

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$$;


create or replace function public.share_payment_plan(
  p_share public.booking_payment_shares,
  p_profile_id uuid,
  p_method text,
  p_accept_non_refundable boolean,
  p_use_credit boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_amounts record;
  v_paid record;
  v_available integer;
  v_credit integer := 0;
  v_fee integer;
  v_card integer;
  v_non_refundable boolean := false;
  v_needs_card boolean := false;
  v_customer text;
  v_hold boolean := p_share.gipedo_side is not null;
  v_side public.booking_sides;  -- B1b
  v_mode text;                  -- B1b: the share's way to pay (its side's, on a half pitch)
begin
  if p_share.id is null then
    raise exception 'share_not_found';
  end if;
  if p_share.profile_id is distinct from p_profile_id then
    raise exception 'not_your_share';
  end if;
  if p_share.status <> 'pending' then
    raise exception 'share_not_pending';
  end if;
  select * into v_booking from public.venue_bookings where id = p_share.booking_id;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  select stripe_customer_id into v_customer from public.profiles where id = p_profile_id;

  if v_booking.payment_mode is null then
    if coalesce(p_use_credit, false) then
      raise exception 'credit_not_allowed_legacy';
    end if;
    return jsonb_build_object(
      'share_id', p_share.id, 'booking_id', p_share.booking_id, 'is_booker', p_share.is_booker,
      'payment_mode', null, 'status', p_share.status, 'payment_method', p_share.payment_method,
      'amount_cents', p_share.amount_cents, 'stripe_payment_intent_id', p_share.stripe_payment_intent_id,
      'stripe_customer_id', v_customer, 'needs_saved_card', false, 'credit_cents', 0);
  end if;

  if public.collection_is_due(v_booking)
     or exists (select 1 from public.booking_collections c where c.booking_id = v_booking.id) then
    raise exception 'collection_started';
  end if;
  if p_method = 'cash' and public.profile_has_debt(p_profile_id) then
    raise exception 'player_in_debt';
  end if;

  if p_share.is_booker and v_booking.status = 'pending_payment'
     and now() > public.booking_payment_window_ends_at(v_booking) then
    raise exception 'payment_window_closed';
  end if;

  if v_hold then
    if coalesce(p_use_credit, false) then
      raise exception 'credit_not_allowed';
    end if;
    if p_share.gipedo_side = 'b' and now() > public.money_payment_window_ends_at(p_share.created_at) then
      raise exception 'payment_window_closed';
    end if;
  end if;

  -- B1b: on a half pitch a share comes from its side: the side's half, its
  -- players, its way to pay and its captain. Cash is whole pitch only.
  v_mode := v_booking.payment_mode;
  if v_booking.booking_kind = 'half' then
    if p_method = 'cash' then
      raise exception 'cash_whole_pitch_only';
    end if;
    select * into v_side from public.booking_sides where booking_id = v_booking.id and side = p_share.side;
    if v_side.booking_id is null then
      raise exception 'side_not_found';
    end if;
    v_mode := v_side.payment_mode;
    select * into v_amounts from public.money_share(
      v_side.pitch_cents, v_side.players, v_side.payment_mode, p_share.profile_id = v_side.captain_id,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), p_method);
  else
    select * into v_amounts from public.money_share(
      v_booking.amount_cents, v_booking.capacity,
      case when v_hold then 'gipedo_pano' else v_booking.payment_mode end,
      p_share.is_booker or v_hold,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), p_method);
  end if;
  v_fee := v_amounts.fee_cents;
  v_card := v_amounts.card_cents;

  if coalesce(p_use_credit, false) then
    if p_method <> 'card' then
      raise exception 'credit_needs_card';
    end if;
    v_available := public.venue_credit_available_cents(p_profile_id, v_booking.venue_id)
      + coalesce((select sum(sp.amount_cents) from public.venue_credit_spends sp
                  join public.venue_credits c on c.id = sp.credit_id
                  where sp.share_id = p_share.id and sp.status = 'reserved' and c.expires_at > now()), 0);
    if v_available <= 0 then
      raise exception 'no_credit_at_venue';
    end if;
    select * into v_paid from public.money_credit_payment(v_amounts.pitch_cents, v_amounts.fee_cents, v_available);
    v_credit := v_paid.credit_cents;
    v_fee := v_paid.fee_cents;
    v_card := v_paid.card_cents;
  end if;

  v_non_refundable := public.money_is_non_refundable(now(), public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time));
  if v_non_refundable and not coalesce(p_accept_non_refundable, false) then
    raise exception 'non_refundable_not_accepted';
  end if;

  if v_card = 0 then
    if not (v_mode in ('each_pays_responsible', 'each_pays_own_spot') or v_credit > 0) then
      raise exception 'saved_card_required';
    end if;
    v_needs_card := true;
  end if;

  return jsonb_build_object(
    'share_id', p_share.id,
    'booking_id', p_share.booking_id,
    'is_booker', p_share.is_booker,
    'payment_mode', v_mode,
    'status', p_share.status,
    'payment_method', p_method,
    'amount_cents', v_card,
    'pitch_cents', v_amounts.pitch_cents,
    'fee_cents', v_fee,
    'cash_cents', v_amounts.cash_cents,
    'credit_cents', v_credit,
    'capture_method', case when v_non_refundable and not v_hold then 'immediate' else 'manual' end,
    'non_refundable', v_non_refundable,
    'stripe_payment_intent_id', p_share.stripe_payment_intent_id,
    'stripe_customer_id', v_customer,
    'needs_saved_card', v_needs_card
  );
end;
$$;


create or replace function public.collection_amounts_side(p_booking_id uuid, p_side text)
returns table (
  share_id uuid,
  profile_id uuid,
  is_booker boolean,
  payment_method text,
  share_status text,
  due_pitch_cents integer,
  normal_pitch_cents integer,
  paid_pitch_cents integer,
  fee_cents integer,
  fee_paid boolean,
  cash_received boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booking public.venue_bookings;
  v_joined integer;
  v_booker_joined boolean;
  v_kept integer;
  v_per integer;
  v_normal integer;
  v_due integer;
  v_leftover_share uuid;
  v_side public.booking_sides;
begin
  select * into v_booking from public.venue_bookings b where b.id = p_booking_id;
  select * into v_side from public.booking_sides sd where sd.booking_id = p_booking_id and sd.side = p_side;
  if v_booking.id is null or v_side.booking_id is null or v_side.payment_mode <> 'each_pays_responsible' then
    return;
  end if;

  select count(*), coalesce(bool_or(s.profile_id = v_side.captain_id), false) into v_joined, v_booker_joined
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.side = p_side and s.status in ('pending', 'authorized', 'paid');
  if v_joined = 0 then
    return;
  end if;

  -- The pitch part a late cancellation kept: an unticked cash player's
  -- pitch part was never paid, so it keeps none; ticked cash the venue
  -- keeps counts like a card payment (decided 10 November, "A late
  -- cancellation's kept money"): what was ticked, less any of it handed
  -- back. P12: less the switch credit the share was given before it was
  -- cancelled.
  select coalesce(sum(coalesce(s.pitch_cents, 0) - s.cash_cents
                      + case when s.payment_method = 'cash' and s.cash_received_at is not null
                             then coalesce((select sum(m.venue_cents) from public.money_ledger m
                                            where m.share_id = s.id and m.kind = 'cash_received'), 0)
                             else 0 end
                      - case when s.switch_credit_issued_at is not null
                                  and (s.payment_method = 'card' or s.cash_received_at is not null)
                             then s.switch_credit_cents else 0 end), 0)::integer into v_kept
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.side = p_side and s.status = 'forfeited';

  v_per := v_side.pitch_cents / v_side.players;
  v_normal := v_joined * v_per + case when v_booker_joined then v_side.pitch_cents % v_side.players else 0 end;
  v_due := greatest(v_side.pitch_cents - v_kept, v_normal);
  if not v_booker_joined then
    select s.id into v_leftover_share from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.side = p_side and s.status in ('pending', 'authorized', 'paid')
    order by s.created_at, s.id limit 1;
  end if;

  return query
  select s.id, s.profile_id, s.is_booker, s.payment_method, s.status,
         (case when v_due = v_normal
               then v_per + case when s.profile_id = v_side.captain_id then v_side.pitch_cents % v_side.players else 0 end
               else v_due / v_joined
                    + case when s.profile_id = v_side.captain_id or s.id = v_leftover_share then v_due % v_joined else 0 end
          end)::integer,
         (v_per + case when s.profile_id = v_side.captain_id then v_side.pitch_cents % v_side.players else 0 end)::integer,
         -- P12: less the credit a switch to more players gives it.
         (case when s.payment_method = 'cash' and s.cash_received_at is not null
               -- Decided 16 November: ticked cash counts as paid, so a
               -- ticked cash player is topped up like everyone else. Staff
               -- ticked the share's cash part; a player who paid it by card
               -- after the match paid what was due then.
               then (case when s.cash_received_by is null and s.cash_intent_id is not null
                          then coalesce((select m.amount_cents from public.money_ledger m
                                         where m.kind = 'capture' and m.stripe_id = s.cash_intent_id
                                           and m.share_id = s.id),
                                        s.cash_cents)
                          else s.cash_cents end)
                    - s.switch_credit_cents
               when s.status in ('authorized', 'paid')
               then coalesce(s.pitch_cents, 0) - s.cash_cents
                    - case when s.payment_method = 'card' then s.switch_credit_cents else 0 end
               else 0 end)::integer,
         coalesce(s.fee_cents, 0),
         s.status in ('authorized', 'paid'),
         s.cash_received_at is not null
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.side = p_side and s.status in ('pending', 'authorized', 'paid')
  order by (s.profile_id = v_side.captain_id) desc, s.created_at, s.id;
end;
$$;


create or replace function public.collection_amounts(p_booking_id uuid)
returns table (
  share_id uuid,
  profile_id uuid,
  is_booker boolean,
  payment_method text,
  share_status text,
  due_pitch_cents integer,
  normal_pitch_cents integer,
  paid_pitch_cents integer,
  fee_cents integer,
  fee_paid boolean,
  cash_received boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booking public.venue_bookings;
  v_joined integer;
  v_booker_joined boolean;
  v_kept integer;
  v_per integer;
  v_normal integer;
  v_due integer;
  v_leftover_share uuid;
begin
  select * into v_booking from public.venue_bookings b where b.id = p_booking_id;
  -- B1b: a half pitch is two sides, each counted on its own half, players
  -- and captain (collection_amounts_side).
  if v_booking.booking_kind = 'half' then
    return query select * from public.collection_amounts_side(p_booking_id, 'a')
                 union all
                 select * from public.collection_amounts_side(p_booking_id, 'b');
    return;
  end if;
  if v_booking.id is null or v_booking.payment_mode is null
     or v_booking.payment_mode not in ('each_pays_responsible', 'each_pays_own_spot') then
    return;
  end if;

  select count(*), coalesce(bool_or(s.is_booker), false) into v_joined, v_booker_joined
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid');
  if v_joined = 0 then
    return;
  end if;

  -- The pitch part a late cancellation kept: an unticked cash player's
  -- pitch part was never paid, so it keeps none; ticked cash the venue
  -- keeps counts like a card payment (decided 10 November, "A late
  -- cancellation's kept money"): what was ticked, less any of it handed
  -- back. P12: less the switch credit the share was given before it was
  -- cancelled.
  select coalesce(sum(coalesce(s.pitch_cents, 0) - s.cash_cents
                      + case when s.payment_method = 'cash' and s.cash_received_at is not null
                             then coalesce((select sum(m.venue_cents) from public.money_ledger m
                                            where m.share_id = s.id and m.kind = 'cash_received'), 0)
                             else 0 end
                      - case when s.switch_credit_issued_at is not null
                                  and (s.payment_method = 'card' or s.cash_received_at is not null)
                             then s.switch_credit_cents else 0 end), 0)::integer into v_kept
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status = 'forfeited';

  v_per := v_booking.amount_cents / v_booking.capacity;
  v_normal := v_joined * v_per + case when v_booker_joined then v_booking.amount_cents % v_booking.capacity else 0 end;
  v_due := greatest(v_booking.amount_cents - v_kept, v_normal);
  if not v_booker_joined then
    select s.id into v_leftover_share from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
    order by s.created_at, s.id limit 1;
  end if;

  return query
  select s.id, s.profile_id, s.is_booker, s.payment_method, s.status,
         (case when v_due = v_normal
               then v_per + case when s.is_booker then v_booking.amount_cents % v_booking.capacity else 0 end
               else v_due / v_joined
                    + case when s.is_booker or s.id = v_leftover_share then v_due % v_joined else 0 end
          end)::integer,
         (v_per + case when s.is_booker then v_booking.amount_cents % v_booking.capacity else 0 end)::integer,
         -- P12: less the credit a switch to more players gives it.
         (case when s.payment_method = 'cash' and s.cash_received_at is not null
               -- Decided 16 November: ticked cash counts as paid, so a
               -- ticked cash player is topped up like everyone else. Staff
               -- ticked the share's cash part; a player who paid it by card
               -- after the match paid what was due then.
               then (case when s.cash_received_by is null and s.cash_intent_id is not null
                          then coalesce((select m.amount_cents from public.money_ledger m
                                         where m.kind = 'capture' and m.stripe_id = s.cash_intent_id
                                           and m.share_id = s.id),
                                        s.cash_cents)
                          else s.cash_cents end)
                    - s.switch_credit_cents
               when s.status in ('authorized', 'paid')
               then coalesce(s.pitch_cents, 0) - s.cash_cents
                    - case when s.payment_method = 'card' then s.switch_credit_cents else 0 end
               else 0 end)::integer,
         coalesce(s.fee_cents, 0),
         s.status in ('authorized', 'paid'),
         s.cash_received_at is not null
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
  order by s.is_booker desc, s.created_at, s.id;
end;
$$;


create or replace function public.switch_refusal(
  p_booking public.venue_bookings,
  p_uid uuid,
  p_players_per_side integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  if p_uid is null then
    return 'not_authenticated';
  end if;
  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    return 'invalid_players_per_side';
  end if;
  if p_booking.id is null then
    return 'booking_not_found';
  end if;
  if p_booking.created_by is distinct from p_uid then
    return 'not_booker';
  end if;
  if p_booking.booking_type = 'counter' or p_booking.payment_mode is null or p_booking.payment_mode = 'gipedo_pano'
     or p_booking.booking_kind = 'half'  -- B1b: a half pitch never switches to 6 v 6
     or p_booking.format <> '5-a-side' then
    return 'not_switchable';
  end if;
  if p_booking.status = 'cancelled' then
    return 'booking_cancelled';
  end if;
  if p_booking.status <> 'confirmed' then
    return 'booking_not_confirmed';
  end if;
  if p_booking.switched_at is not null then
    return 'already_switched';
  end if;
  if p_booking.capacity = p_players_per_side * 2 then
    return 'already_that_format';
  end if;
  if now() > public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) - public.rule_refund_cutoff() then
    return 'switch_closed';
  end if;
  if p_players_per_side * 2 > p_booking.capacity then
    select * into v_venue from public.venues where id = p_booking.venue_id;
    if not v_venue.allows_6v6_on_5s or exists (
         select 1 from public.booking_pitches bp join public.pitches p on p.id = bp.pitch_id
         where bp.booking_id = p_booking.id and p.size <> '5-a-side') then
      return 'six_a_side_not_allowed';
    end if;
  end if;
  -- P6e audit: every spot taken, app players and accepted venue players
  -- (booking_spots_taken), not only shares. For a booking that can switch it
  -- counts the same shares as before ('expired' is Gipedo only, refused above).
  if public.booking_spots_taken(p_booking.id) > p_players_per_side * 2 then
    return 'too_many_players';
  end if;
  return null;
end;
$$;


revoke all on function public.half_pitch_enabled() from public, anon;
grant execute on function public.half_pitch_enabled() to authenticated, service_role;
revoke all on function public.booking_quote_v2(uuid, date, time, time, text, integer) from public, anon;
grant execute on function public.booking_quote_v2(uuid, date, time, time, text, integer) to authenticated, service_role;
revoke all on function public.add_booking_side_share_internal(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_booking_side_share_internal(uuid, uuid, text) to service_role;
revoke all on function public.collection_amounts_side(uuid, text) from public, anon, authenticated;
grant execute on function public.collection_amounts_side(uuid, text) to service_role;
