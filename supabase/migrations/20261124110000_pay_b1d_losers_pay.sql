-- B1d (spec 13 "Losers pay (Gipedo Pano in Booking v2)", examples 7a-10b and
-- 11; pulling out and no opponent decided by Panos on 23 November): Losers
-- pay on a half pitch, chosen by the booker, each side keeping its own way to
-- pay, up to 5 days ahead.
--   * venue_bookings.losers_pay marks the booking; each side's way to pay
--     stays in booking_sides.payment_mode (pay_all or each_pays_responsible).
--     book_slot(p_losers_pay) and accept_opposition(_post)(p_losers_pay):
--     side B accepts knowingly (accept_losers_pay otherwise).
--   * money_losers_pay_hold: pay for everyone holds the whole pitch + the fee
--     for all 10 players (€45.50, Premium €44.95); pay for myself holds twice
--     the share with the fee (€9.60, Premium €8.00). Every Losers pay hold is
--     a share with gipedo_side set: never taken after the free hour
--     (shares_due_for_capture skips them), no credit, held until settled.
--   * The captain of a pay-for-myself side has a guarantee, counted 24 hours
--     before kickoff (or at once if later) for the side's spots still without
--     a hold, at the same per-spot amount (losers_pay_count_guarantees; held
--     only once counted: guarantees_due_for_hold).
--   * Settlement reuses Gipedo Pano's: losers_pay_settle_from_results writes
--     one gipedo_settlements row per hold (and the guarantee: the table now
--     takes a guarantee_id), carried out at Stripe by _shared/gipedo.ts with
--     idempotency keys from the settlement id, and recorded in the ledger by
--     gipedo_settlement_done. Lost: in full (players' holds, then the
--     guarantee for spots without one); won: released; a draw, a dispute or
--     no result: half of every hold, rounded down. The venue gets the full
--     pitch: a cent lost to rounding comes off Futty's part.
--   * Pulling out: losers_pay_leave (rule 1: a player's €4.80 share as today
--     - free hour, then €1 kept and the rest venue credit, under 6 hours
--     nothing back - and the rest of his hold released) and
--     losers_pay_pull_out (rule 2: a whole pay-for-myself side more than 6
--     hours before kickoff: €1 from each player's own hold, the rest
--     released). Not decided yet, so refused: a pay-for-everyone side
--     pulling out, any side pulling out less than 6 hours before kickoff,
--     and a lone side pulling out.
--   * No opponent (rule 3): "Cancel free" as a normal half pitch. "Pay the
--     whole pitch and play" is refused for now (how the holds become an
--     ordinary payment isn't decided).

alter table public.venue_bookings add column losers_pay boolean not null default false;

-- A Losers pay guarantee is counted 24 hours before kickoff; until then it isn't held.
alter table public.booking_guarantees add column counted boolean not null default true;

alter table public.gipedo_settlements
  alter column share_id drop not null,
  add column guarantee_id uuid unique references public.booking_guarantees (id),
  add column credit_cents integer not null default 0 check (credit_cents >= 0),
  add constraint gipedo_settlements_one_hold check ((share_id is null) <> (guarantee_id is null));
alter table public.gipedo_settlements drop constraint gipedo_settlements_reason_check;
alter table public.gipedo_settlements add constraint gipedo_settlements_reason_check
  check (reason in ('lost', 'won', 'split', 'pull_out_fee', 'play_normal', 'left'));

-- One Losers pay hold (the whole pitch's price and capacity).
create function public.money_losers_pay_hold(
  p_pitch_cents integer,
  p_capacity integer,
  p_mode text,
  p_is_captain boolean,
  p_is_premium boolean,
  out pitch_cents integer,
  out fee_cents integer,
  out card_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if p_mode = 'pay_all' then
    -- The whole pitch with all its players' fees (Premium: none on his own spot).
    select * into v from public.money_share(p_pitch_cents, p_capacity, 'gipedo_pano', true, p_is_premium, 'card');
    pitch_cents := v.pitch_cents;
    fee_cents := v.fee_cents;
    card_cents := v.card_cents;
  elsif p_mode = 'each_pays_responsible' then
    -- Twice his share of his side's half, with the fee.
    select * into v from public.money_share(p_pitch_cents / 2, p_capacity / 2, 'each_pays_responsible', p_is_captain,
                                            p_is_premium, 'card');
    pitch_cents := 2 * v.pitch_cents;
    fee_cents := 2 * v.fee_cents;
    card_cents := 2 * v.card_cents;
  else
    raise exception 'invalid_payment_mode';
  end if;
end;
$$;

-- A pay-for-myself side's captain: his guarantee, at most every spot but
-- his own, counted 24 hours before kickoff (or at once if that's passed).
create function public.losers_pay_add_guarantee(p_booking_id uuid, p_captain uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_spot record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  select * into v_spot from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity, 'each_pays_responsible',
                                                         false, false);
  if v_spot.card_cents * (v_booking.capacity / 2 - 1) <= 0 then
    return;
  end if;
  insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at, counted)
  values (p_booking_id, p_captain, v_spot.card_cents * (v_booking.capacity / 2 - 1),
          greatest(now(), public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_gipedo_opponent_lead()),
          false)
  on conflict (booking_id, profile_id) do update
    set amount_cents = excluded.amount_cents, hold_due_at = excluded.hold_due_at, counted = false, status = 'awaiting_card',
        stripe_customer_id = null, stripe_payment_method_id = null, stripe_payment_intent_id = null,
        attempts = 0, next_attempt_at = null, last_error = null, failure_notified_at = null, held_at = null;
end;
$$;

-- As in 20261123014011_pay_b1b_half_pitch.sql, plus B1d: p_losers_pay.
drop function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid, uuid[], text);
create function public.book_slot(
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
  p_kind text default null,
  p_losers_pay boolean default false
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
        raise exception 'losers_pay_needs_way_to_pay';  -- B1d: p_losers_pay, with the side's way to pay
      end if;
    end if;
    if p_mode = 'each_pays_own_spot' then
      raise exception 'just_my_spot_removed';
    end if;
    if p_mode = 'gipedo_pano' and p_kind = 'whole' then
      raise exception 'losers_pay_half_pitch_only';
    end if;
  end if;

  -- B1d: Losers pay is a half pitch only, each side with its own way to pay,
  -- up to 5 days ahead (holds expire).
  if coalesce(p_losers_pay, false) then
    if p_kind is distinct from 'half' then
      raise exception 'losers_pay_half_pitch_only';
    end if;
    if p_mode not in ('pay_all', 'each_pays_responsible') then
      raise exception 'invalid_payment_mode';
    end if;
    if public.booking_kickoff_at(p_day, p_start) > now() + public.rule_gipedo_max_ahead() then
      raise exception 'losers_pay_too_far_ahead';
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
       amount_cents, service_fee_cents_per_player, payment_mode, team_id, booking_kind, losers_pay)
    values
      (p_venue_id, p_day, p_start, p_end, cardinality(v_pitch_ids), v_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.money_fee_per_player_cents(p_mode) end, p_mode,
       case when v_gipedo then p_team_id end, p_kind, coalesce(p_losers_pay, false))
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
    if coalesce(p_losers_pay, false) then
      -- B1d: the captain's Losers pay hold.
      select x.pitch_cents, x.fee_cents, x.card_cents, 0 as cash_cents into v_share
      from public.money_losers_pay_hold(v_amount_cents, v_capacity, p_mode, true, v_premium) x;
    elsif p_kind = 'half' then
      select * into v_share from public.money_share(v_amount_cents / 2, v_capacity / 2, p_mode, true, v_premium, 'card');
    else
      select * into v_share from public.money_share(v_amount_cents, v_capacity, p_mode, true, v_premium, 'card');
    end if;
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, gipedo_side, side)
    values
      (v_booking.id, auth.uid(), v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, true,
       'pending', case when v_gipedo or coalesce(p_losers_pay, false) then 'a' end, case when p_kind = 'half' then 'a' end);

    if p_mode = 'each_pays_responsible' and coalesce(p_losers_pay, false) then
      perform public.losers_pay_add_guarantee(v_booking.id, auth.uid());
    elsif p_mode = 'each_pays_responsible' then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (v_booking.id, auth.uid(), case when p_kind = 'half' then v_amount_cents / 2 else v_amount_cents end,
              public.money_guarantee_hold_due_at(v_booking.created_at, public.booking_kickoff_at(p_day, p_start)));
    end if;
  end if;

  return v_booking;
end;
$$;

-- As in 20261123014011_pay_b1b_half_pitch.sql, plus B1d: Losers pay holds.
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
    -- Side B's captain's payment window (a Losers pay side B's other players have none).
    if p_share.gipedo_side = 'b' and now() > public.money_payment_window_ends_at(p_share.created_at)
       and (not v_booking.losers_pay
            or p_share.profile_id = (select s.captain_id from public.booking_sides s
                                     where s.booking_id = v_booking.id and s.side = 'b')) then
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
    if v_booking.losers_pay and v_hold then
      -- B1d: a Losers pay hold.
      select x.pitch_cents, x.fee_cents, x.card_cents, 0 as cash_cents into v_amounts
      from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity, v_side.payment_mode,
        p_share.profile_id = v_side.captain_id, exists (select 1 from public.profiles where id = p_profile_id and is_premium)) x;
    else
      select * into v_amounts from public.money_share(
        v_side.pitch_cents, v_side.players, v_side.payment_mode, p_share.profile_id = v_side.captain_id,
        exists (select 1 from public.profiles where id = p_profile_id and is_premium), p_method);
    end if;
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

-- As in 20261123014011_pay_b1b_half_pitch.sql, plus B1d: Losers pay holds.
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

  if v_booking.losers_pay and v_side.payment_mode = 'each_pays_responsible' then
    -- B1d: his Losers pay hold.
    select x.pitch_cents, x.fee_cents, x.card_cents, 0 as cash_cents into v_share
    from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity, 'each_pays_responsible', false,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium)) x;
  else
    select * into v_share from public.money_share(
      v_side.pitch_cents, v_side.players, v_side.payment_mode, false,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), 'card');
  end if;
  insert into public.booking_payment_shares
    (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, side, gipedo_side)
  values
    (p_booking_id, p_profile_id, v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, false,
     case when v_side.payment_mode = 'pay_all' then 'covered' else 'pending' end, p_side,
     case when v_booking.losers_pay and v_side.payment_mode = 'each_pays_responsible' then p_side end)
  on conflict (booking_id, profile_id) do nothing;
end;
$$;

-- As in 20261123220000_pay_b1e_publish.sql, plus B1d: Losers pay.
drop function public.accept_opposition_internal(uuid, uuid, text);
create function public.accept_opposition_internal(p_booking_id uuid, p_team_id uuid, p_mode text,
                                                   p_losers_pay boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_error text;
  v_premium boolean;
  v_half integer;
  v_players integer;
  v_money record;
  v_share_id uuid;
  v_name text;
begin
  if p_mode = 'cash' then
    raise exception 'cash_whole_pitch_only';
  elsif p_mode = 'each_pays_own_spot' then
    raise exception 'just_my_spot_removed';
  elsif p_mode = 'gipedo_pano' then
    raise exception 'losers_pay_needs_way_to_pay';  -- B1d: side B keeps its own way to pay
  elsif p_mode is null or p_mode not in ('pay_all', 'each_pays_responsible') then
    raise exception 'invalid_payment_mode';
  end if;

  -- The booking's row lock: of two captains accepting at once, the second
  -- waits here and then finds side B taken.
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_error := public.opposition_open_error(v_booking);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  -- B1d: side B sees Losers pay and accepts it; there's no way to accept without it.
  if v_booking.losers_pay and not coalesce(p_losers_pay, false) then
    raise exception 'accept_losers_pay';
  end if;
  if exists (select 1 from public.booking_sides s where s.booking_id = v_booking.id and s.side = 'b') then
    raise exception 'opposition_found';
  end if;
  if exists (select 1 from public.booking_payment_shares s
             where s.booking_id = v_booking.id and s.profile_id = auth.uid()
               and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) then
    raise exception 'already_in_booking';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  v_premium := exists (select 1 from public.profiles where id = auth.uid() and is_premium);
  v_half := v_booking.amount_cents / 2;   -- rounded down: Futty absorbs an odd cent
  v_players := v_booking.capacity / 2;
  insert into public.booking_sides (booking_id, side, captain_id, payment_mode, pitch_cents, players, accepted_at, team_id, paid_at)
  values (v_booking.id, 'b', auth.uid(), p_mode, v_half, v_players, now(), p_team_id,
          case when v_half = 0 then now() end);

  if v_half > 0 then
    if v_booking.losers_pay then
      select x.pitch_cents, x.fee_cents, x.card_cents, 0 as cash_cents into v_money
      from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity, p_mode, true, v_premium) x;
    else
      select * into v_money from public.money_share(v_half, v_players, p_mode, true, v_premium, 'card');
    end if;
    -- A captain whose earlier acceptance lapsed has a cancelled share here:
    -- it starts again, keeping the intent it replaced (as offer_opposition).
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, side, gipedo_side)
    values
      (v_booking.id, auth.uid(), v_money.card_cents, v_money.pitch_cents, v_money.fee_cents, 0, false, 'pending', 'b',
       case when v_booking.losers_pay then 'b' end)
    on conflict (booking_id, profile_id) do update
      set amount_cents = excluded.amount_cents, pitch_cents = excluded.pitch_cents, fee_cents = excluded.fee_cents,
          cash_cents = 0, status = 'pending', side = 'b', gipedo_side = excluded.gipedo_side, created_at = now(),
          replaced_intent_ids = case
            when public.booking_payment_shares.stripe_payment_intent_id is null then public.booking_payment_shares.replaced_intent_ids
            else array_append(public.booking_payment_shares.replaced_intent_ids,
                              public.booking_payment_shares.stripe_payment_intent_id) end,
          stripe_payment_intent_id = null, stripe_setup_intent_id = null, payment_method = 'card',
          credit_cents = 0, held_at = null, capture_due_at = null
    returning id into v_share_id;

    -- Pay for myself: he covers his side's unpaid spots, his side's half
    -- (decided 23 November).
    if p_mode = 'each_pays_responsible' and v_booking.losers_pay then
      perform public.losers_pay_add_guarantee(v_booking.id, auth.uid());
    elsif p_mode = 'each_pays_responsible' then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (v_booking.id, auth.uid(), v_half,
              public.money_guarantee_hold_due_at(now(), public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)))
      on conflict (booking_id, profile_id) do update
        set amount_cents = excluded.amount_cents, hold_due_at = excluded.hold_due_at, status = 'awaiting_card',
            stripe_customer_id = null, stripe_payment_method_id = null, stripe_payment_intent_id = null,
            attempts = 0, next_attempt_at = null, last_error = null, failure_notified_at = null, held_at = null;
    end if;
  end if;

  -- B1e: a public opposition post for this booking is matched.
  update public.squad_posts set status = 'matched'
  where venue_booking_id = v_booking.id and type = 'opposition' and status = 'open';

  select coalesce(username, full_name, 'A captain') into v_name from public.profiles where id = auth.uid();
  perform public.send_notification(v_booking.created_by, 'opposition_found', jsonb_build_object(
    'title', 'Opposition found',
    'body', format('%s accepted your invite for %s.', v_name, public.booking_label(v_booking)),
    'bookingId', v_booking.id));

  return jsonb_build_object(
    'booking_id', v_booking.id, 'side', 'b', 'share_id', v_share_id, 'payment_mode', p_mode,
    'amount_cents', coalesce(v_money.card_cents, 0),
    'pay_by', public.money_payment_window_ends_at(now()));
end;
$$;

drop function public.accept_opposition(uuid, text);
create function public.accept_opposition(p_invite_id uuid, p_mode text, p_losers_pay boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.booking_opposition_invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_invite from public.booking_opposition_invites where id = p_invite_id;
  if v_invite.id is null or v_invite.invited_profile_id is distinct from auth.uid() and v_invite.invited_team_id is null then
    raise exception 'not_invited';
  end if;
  if v_invite.invited_team_id is not null and not public.is_team_captain(v_invite.invited_team_id, auth.uid()) then
    if exists (select 1 from public.team_members tm where tm.team_id = v_invite.invited_team_id and tm.profile_id = auth.uid()) then
      raise exception 'not_captain';
    end if;
    raise exception 'not_invited';
  end if;

  return public.accept_opposition_internal(v_invite.booking_id, v_invite.invited_team_id, p_mode, p_losers_pay);
end;
$$;

drop function public.accept_opposition_post(uuid, text);
create function public.accept_opposition_post(p_post_id uuid, p_mode text, p_losers_pay boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_post from public.squad_posts where id = p_post_id;
  if v_post.id is null or v_post.type <> 'opposition' or v_post.venue_booking_id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.status = 'closed' then
    raise exception 'post_closed';
  end if;
  return public.accept_opposition_internal(v_post.venue_booking_id, null, p_mode, p_losers_pay);
end;
$$;

-- As in 20261109164845_pay_modes_recovery.sql, plus B1d: a guarantee is held only once counted.
create or replace function public.guarantees_due_for_hold(p_guarantee_id uuid default null)
returns table (
  guarantee_id uuid,
  booking_id uuid,
  profile_id uuid,
  amount_cents integer,
  stripe_customer_id text,
  stripe_payment_method_id text,
  attempts integer,
  api_errors integer,
  created_at timestamptz,
  check_only boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.booking_id, g.profile_id, g.amount_cents, g.stripe_customer_id, g.stripe_payment_method_id, g.attempts,
         g.api_errors, g.created_at,
         b.status = 'cancelled' or g.status = 'cancelled' or now() >= k.kickoff
  from public.booking_guarantees g
  join public.venue_bookings b on b.id = g.booking_id
  cross join lateral (select public.booking_kickoff_at(b.booking_day, b.start_time) as kickoff) k
  where g.stripe_payment_method_id is not null
    and g.counted  -- B1d: a Losers pay guarantee is held once counted
    and g.stripe_customer_id is not null
    and (
      (g.status in ('scheduled', 'failed') and b.status <> 'cancelled' and now() < k.kickoff and g.next_attempt_at <= now())
      or (g.api_errors > 0 and g.status <> 'held' and coalesce(g.next_attempt_at, now()) <= now())
    )
    and (p_guarantee_id is null or g.id = p_guarantee_id)
  order by g.next_attempt_at nulls first;
$$;

-- As in 20261123190000_pay_b1c_pay_whole.sql, plus B1d: not for Losers pay yet.
create or replace function public.plan_other_half_payment(p_booking_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_money record;
  v_payment public.booking_other_half_payments;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_side := public.half_pitch_lone_side(p_booking_id);
  if v_booking.id is null or v_side.captain_id is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;
  -- B1d: how Losers pay holds become an ordinary payment isn't decided yet.
  if v_booking.losers_pay then
    raise exception 'losers_pay_play_whole_not_available';
  end if;
  if v_booking.no_opponent_choice is not null then
    raise exception 'already_chosen';
  end if;
  if v_booking.status <> 'confirmed' or v_booking.no_opponent_at is null then
    raise exception 'choice_not_due';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff() then
    raise exception 'choice_closed';
  end if;

  select * into v_money from public.no_opponent_amounts(v_booking, v_side);
  insert into public.booking_other_half_payments (booking_id, profile_id, pitch_cents, fee_cents, amount_cents)
  values (p_booking_id, p_profile_id, v_money.pitch_cents, v_money.fee_cents, v_money.amount_cents)
  on conflict (booking_id) do update
    set pitch_cents = excluded.pitch_cents, fee_cents = excluded.fee_cents, amount_cents = excluded.amount_cents
    where public.booking_other_half_payments.status = 'pending'
  returning * into v_payment;
  if v_payment.id is null then
    raise exception 'already_chosen';
  end if;

  return jsonb_build_object(
    'payment_id', v_payment.id, 'booking_id', p_booking_id,
    'pitch_cents', v_payment.pitch_cents, 'fee_cents', v_payment.fee_cents, 'amount_cents', v_payment.amount_cents,
    'stripe_payment_intent_id', v_payment.stripe_payment_intent_id,
    'stripe_customer_id', (select stripe_customer_id from public.profiles where id = p_profile_id));
end;
$$;

-- As in 20261123014011_pay_b1b_half_pitch.sql, plus B1d: the Losers pay holds.
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
  l_all record; l_mine record; l_spot record;  -- B1d
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

  -- B1d: Losers pay holds (the whole pitch's price and players).
  select * into l_all from public.money_losers_pay_hold(v_price, v_players, 'pay_all', true, v_premium);
  select * into l_mine from public.money_losers_pay_hold(v_price, v_players, 'each_pays_responsible', true, v_premium);
  select * into l_spot from public.money_losers_pay_hold(v_price, v_players, 'each_pays_responsible', false, false);

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
                                           'guarantee_cents', v_half),
      'losers_pay', jsonb_build_object(
        'available', public.half_pitch_enabled() and v_kickoff <= now() + public.rule_gipedo_max_ahead(),
        'pay_all', jsonb_build_object('pitch_cents', l_all.pitch_cents, 'fee_cents', l_all.fee_cents,
                                      'card_cents', l_all.card_cents),
        'pay_for_myself', jsonb_build_object('card_cents', l_mine.card_cents, 'pitch_cents', l_mine.pitch_cents,
                                             'fee_cents', l_mine.fee_cents, 'spot_cents', l_spot.card_cents))),
    'in_debt', v_in_debt,
    'cash_allowed', not v_in_debt,
    'cancellation', public.cancellation_terms()
  );
end;
$$;

-- As in 20261124100000_pay_b4_posts.sql, plus B1d: Losers pay holds.
create or replace function public.booking_post_quotes(p_post_ids uuid[])
returns table (
  post_id uuid,
  kind text,
  side text,
  mine boolean,
  open boolean,
  closes_at timestamptz,
  join_cents integer,
  join_pitch_cents integer,
  join_fee_cents integer,
  pay_all_cents integer,
  each_pays_cents integer,
  guarantee_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_premium boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if cardinality(p_post_ids) > 50 then
    raise exception 'too_many_posts';
  end if;
  v_premium := coalesce((select pr.is_premium from public.profiles pr where pr.id = auth.uid()), false);

  return query
    select
      p.id,
      p.type,
      p.side,
      -- As unpublish_post: the post's author or that side's captain.
      (p.posted_by is not distinct from auth.uid()
       or exists (select 1 from public.booking_sides s
                  where s.booking_id = b.id and s.captain_id = auth.uid() and s.side = coalesce(p.side, 'a'))),
      case
        when p.type = 'players'
          then p.status = 'open' and b.status <> 'cancelled' and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
        else p.status = 'open' and public.opposition_open_error(b) is null
             and not exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b')
      end,
      case
        when p.type = 'players' then public.booking_kickoff_at(b.booking_day, b.start_time)
        else public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_gipedo_opponent_lead()
      end,
      j.card_cents,
      j.pitch_cents,
      j.fee_cents,
      o.pay_all_cents,
      o.each_pays_cents,
      o.guarantee_cents
    from public.squad_posts p
    join public.venue_bookings b on b.id = p.venue_booking_id
    left join public.booking_sides sd
      on b.booking_kind = 'half' and sd.booking_id = b.id and sd.side = coalesce(p.side, 'a')
    -- A players post: the joiner pays as his side pays.
    left join lateral (
      select
        case when m.mode = 'pay_all' then 0 else x.card_cents end as card_cents,
        case when m.mode = 'pay_all' then 0 else x.pitch_cents end as pitch_cents,
        case when m.mode = 'pay_all' then 0 else x.fee_cents end as fee_cents
      from (select coalesce(sd.payment_mode, b.payment_mode) as mode,
                   coalesce(sd.pitch_cents, b.amount_cents) as pitch,
                   coalesce(sd.players, b.capacity) as players) m
      left join lateral (
        -- B1d: on a Losers pay side paying for myself, a joiner's hold.
        select y.pitch_cents, y.fee_cents, y.card_cents
        from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'each_pays_responsible', false, v_premium) y
        where b.losers_pay
        union all
        select z.pitch_cents, z.fee_cents, z.card_cents
        from public.money_share(m.pitch, m.players, m.mode, false, v_premium, 'card') z
        where not b.losers_pay
      ) x on m.mode = 'each_pays_responsible'
      where p.type = 'players' and m.mode in ('pay_all', 'each_pays_responsible')
        and (b.booking_kind = 'whole' or sd.booking_id is not null)
    ) j on true
    -- An opposition post: side B's price, as my_opposition_invites.
    left join lateral (
      select
        case when b.losers_pay
             then (select x.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'pay_all', true, v_premium) x)
             else (select x.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'pay_all', true, v_premium, 'card') x)
        end as pay_all_cents,
        case when b.losers_pay
             then (select x.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'each_pays_responsible', true, v_premium) x)
             else (select x.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'each_pays_responsible', true, v_premium, 'card') x)
        end as each_pays_cents,
        b.amount_cents / 2 as guarantee_cents
      where p.type = 'opposition' and b.booking_kind = 'half'
    ) o on true
    where p.id = any (coalesce(p_post_ids, '{}')) and b.booking_kind is not null;
end;
$$;

-- Job: 24 hours before kickoff (or at once if later), each Losers pay
-- guarantee is counted: the side's spots still without a hold, at the
-- per-spot amount. Nothing to cover: cancelled. Then it's held as any
-- guarantee (guarantees_due_for_hold).
create function public.losers_pay_count_guarantees()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_spot record;
  v_held integer;
  v_missing integer;
  v_count integer := 0;
begin
  for v_row in
    select g.id, g.status, b.id as booking_id, b.amount_cents, b.capacity, s.side, s.players
    from public.booking_guarantees g
    join public.venue_bookings b on b.id = g.booking_id
    join public.booking_sides s on s.booking_id = b.id and s.captain_id = g.profile_id and s.left_at is null
    where b.losers_pay and not g.counted and g.status <> 'cancelled' and b.status <> 'cancelled'
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_gipedo_opponent_lead()
      and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
    for update of g
  loop
    select * into v_spot from public.money_losers_pay_hold(v_row.amount_cents, v_row.capacity, 'each_pays_responsible',
                                                           false, false);
    select count(*) into v_held from public.booking_payment_shares sh
    where sh.booking_id = v_row.booking_id and sh.side = v_row.side and sh.gipedo_side is not null
      and sh.status in ('authorized', 'paid');
    v_missing := greatest(v_row.players - v_held, 0);
    if v_missing = 0 then
      update public.booking_guarantees set counted = true, status = 'cancelled', next_attempt_at = null where id = v_row.id;
    else
      update public.booking_guarantees
      set counted = true, amount_cents = v_missing * v_spot.card_cents, hold_due_at = now(),
          next_attempt_at = case when status in ('scheduled', 'failed') then now() else next_attempt_at end
      where id = v_row.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- One Losers pay booking's result, as one settlement per hold: the losing
-- side's holds in full (players' holds, then the captain's guarantee for
-- the spots without one), the winners' released, or (a draw, a dispute, no
-- result) half of every hold, rounded down. The venue gets the full pitch:
-- a cent lost to rounding comes off Futty's part (decided 23 November).
create function public.losers_pay_settle_booking(p_booking_id uuid, p_outcome text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_spot record;
  v_result text;
  v_held integer;
  v_missing integer;
  v_need integer;
  v_need_pitch integer;
  v_capture integer;
  v_venue integer;
  v_rows integer;
  v_deficit integer;
  v_move integer;
  v_fix record;
  v_count integer := 0;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  select * into v_spot from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity, 'each_pays_responsible',
                                                         false, false);
  for v_side in select * from public.booking_sides where booking_id = p_booking_id order by side loop
    v_result := case
      when p_outcome = 'side_a_won' then case when v_side.side = 'a' then 'won' else 'lost' end
      when p_outcome = 'side_b_won' then case when v_side.side = 'b' then 'won' else 'lost' end
      else 'split'
    end;
    v_held := 0;
    for v_share in
      select * from public.booking_payment_shares s
      where s.booking_id = p_booking_id and s.side = v_side.side and s.gipedo_side is not null
        and s.status in ('authorized', 'expired')
        and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id)
      order by s.created_at
    loop
      v_held := v_held + 1;
      if v_result = 'lost' then
        v_capture := v_share.pitch_cents + v_share.fee_cents;
        v_venue := v_share.pitch_cents;
      elsif v_result = 'won' then
        v_capture := 0;
        v_venue := 0;
      else
        v_capture := (v_share.pitch_cents + v_share.fee_cents) / 2;
        v_venue := least(v_share.pitch_cents / 2, v_capture);
      end if;
      insert into public.gipedo_settlements
        (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
      values (p_booking_id, v_share.id, v_share.profile_id, v_side.side, v_result, v_capture, v_venue, v_capture - v_venue);
      v_count := v_count + 1;
    end loop;

    if v_side.payment_mode = 'each_pays_responsible' then
      select * into v_guarantee from public.booking_guarantees
      where booking_id = p_booking_id and profile_id = v_side.captain_id and counted and status <> 'cancelled';
      if v_guarantee.id is not null
         and not exists (select 1 from public.gipedo_settlements g where g.guarantee_id = v_guarantee.id) then
        v_missing := greatest(v_side.players - v_held, 0);
        v_need := least(v_guarantee.amount_cents, v_missing * v_spot.card_cents);
        v_need_pitch := least(v_need, v_missing * v_spot.pitch_cents);
        if v_result = 'lost' then
          v_capture := v_need;
          v_venue := v_need_pitch;
        elsif v_result = 'won' then
          v_capture := 0;
          v_venue := 0;
        else
          v_capture := v_need / 2;
          v_venue := least(v_need_pitch / 2, v_capture);
        end if;
        insert into public.gipedo_settlements
          (booking_id, guarantee_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
        values (p_booking_id, v_guarantee.id, v_guarantee.profile_id, v_side.side, v_result, v_capture, v_venue,
                v_capture - v_venue);
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  -- A cent each hold lost to rounding goes to the venue, from Futty's part.
  select count(*), v_booking.amount_cents - coalesce(sum(venue_cents), 0) into v_rows, v_deficit
  from public.gipedo_settlements
  where booking_id = p_booking_id and reason in ('lost', 'split') and status = 'due';
  v_deficit := least(greatest(v_deficit, 0), v_rows);
  for v_fix in
    select id, futty_cents from public.gipedo_settlements
    where booking_id = p_booking_id and reason in ('lost', 'split') and status = 'due' and futty_cents > 0
    order by futty_cents desc, id
  loop
    exit when v_deficit <= 0;
    v_move := least(v_deficit, v_fix.futty_cents, 1);
    update public.gipedo_settlements set venue_cents = venue_cents + v_move, futty_cents = futty_cents - v_move
    where id = v_fix.id;
    v_deficit := v_deficit - v_move;
  end loop;
  return v_count;
end;
$$;

-- Job: every Losers pay match with a final result (confirmed, disputed or
-- no result) is settled once.
create function public.losers_pay_settle_from_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select r.booking_id, r.outcome
    from public.match_result_confirmed r
    join public.venue_bookings b on b.id = r.booking_id
    where b.losers_pay and b.status = 'confirmed'
      and exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b')
      and not exists (select 1 from public.gipedo_settlements g
                      where g.booking_id = b.id and g.reason in ('lost', 'won', 'split'))
  loop
    v_count := v_count + public.losers_pay_settle_booking(v_row.booking_id, v_row.outcome);
  end loop;
  return v_count;
end;
$$;

-- As in 20261113130016_pay_gipedo_review_fixes.sql, plus B1d: a settlement
-- of a guarantee (its intent, held or not).
create or replace function public.gipedo_settlements_due()
returns table (settlement_id uuid, booking_id uuid, share_id uuid, stripe_payment_intent_id text,
               capture_cents integer, hold_live boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with claimed as (
    update public.gipedo_settlements g
    set claimed_at = now()
    where g.id in (
      select g2.id from public.gipedo_settlements g2
      where g2.status = 'due' and (g2.next_attempt_at is null or g2.next_attempt_at <= now())
        and (g2.claimed_at is null or g2.claimed_at <= now() - interval '2 minutes')
      order by g2.created_at
      limit 50
      for update skip locked)
    returning g.*
  )
  select c.id, c.booking_id, c.share_id, coalesce(s.stripe_payment_intent_id, gu.stripe_payment_intent_id), c.capture_cents,
         case when c.share_id is not null then s.status = 'authorized' and s.stripe_payment_intent_id is not null
              else gu.status = 'held' and gu.stripe_payment_intent_id is not null end
  from claimed c
  left join public.booking_payment_shares s on s.id = c.share_id
  left join public.booking_guarantees gu on gu.id = c.guarantee_id
  order by c.created_at;
end;
$$;

-- As in 20261113115755_pay_gipedo_settle.sql, plus B1d: a guarantee's
-- settlement (recorded against the guarantee), a player leaving ('left':
-- the €1 kept and his credit, as today), and Losers pay wording.
create or replace function public.gipedo_settlement_done(
  p_settlement_id uuid,
  p_outcome text,
  p_amount_cents integer default null,
  p_stripe_fee_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gipedo_settlements;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_booking public.venue_bookings;
  v_intent text;
  v_debt uuid;
  v_owed_to text;
  v_name text;
begin
  select * into v_row from public.gipedo_settlements where id = p_settlement_id for update;
  if v_row.id is null then
    raise exception 'settlement_not_found';
  end if;
  if v_row.status <> 'due' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if p_outcome not in ('captured', 'released', 'gone') then
    raise exception 'invalid_outcome';
  end if;
  if v_row.share_id is not null then
    select * into v_share from public.booking_payment_shares where id = v_row.share_id for update;
    v_intent := v_share.stripe_payment_intent_id;
  else
    select * into v_guarantee from public.booking_guarantees where id = v_row.guarantee_id for update;
    v_intent := v_guarantee.stripe_payment_intent_id;
  end if;
  select * into v_booking from public.venue_bookings where id = v_row.booking_id;
  v_name := case when v_booking.losers_pay then 'Losers pay' else 'Gipedo Pano' end;

  if p_outcome = 'captured' then
    if v_row.capture_cents = 0 or p_amount_cents is distinct from v_row.capture_cents then
      raise exception 'amount_mismatch';
    end if;
    perform public.record_intent_capture(v_row.booking_id, v_row.share_id, v_row.guarantee_id, v_intent,
      p_amount_cents, v_row.futty_cents, coalesce(p_stripe_fee_cents, 0),
      case when v_booking.losers_pay then 'losers_pay_' else 'gipedo_' end || v_row.reason);
    if v_row.share_id is not null then
      update public.booking_payment_shares
      set status = case when v_row.reason = 'pull_out_fee' then 'forfeited'
                        when v_row.reason = 'left' and v_row.credit_cents > 0 then 'credited'
                        when v_row.reason = 'left' then 'forfeited'
                        else 'paid' end,
          paid_at = now()
      where id = v_row.share_id;
    end if;
    if v_row.reason = 'left' and v_row.credit_cents > 0 then
      -- As today: the €1 is kept (Futty's), the rest of his share is credit at the venue.
      perform public.issue_venue_credit(v_row.profile_id, v_booking.venue_id, v_row.credit_cents, 'player_cancelled',
                                        v_row.booking_id, v_row.share_id);
      if v_row.capture_cents - v_row.credit_cents - v_row.futty_cents > 0 then
        perform public.record_money_transfer(v_row.booking_id, v_row.share_id,
          v_row.capture_cents - v_row.credit_cents - v_row.futty_cents, 'cancel-kept-' || v_row.id, 'losers_pay_left');
      end if;
    end if;
    update public.gipedo_settlements set status = 'done', outcome = 'captured', done_at = now(), last_error = null
    where id = v_row.id;
  elsif p_outcome = 'released' then
    if v_row.capture_cents <> 0 then
      raise exception 'amount_mismatch';
    end if;
    perform public.record_intent_cancelled(v_row.booking_id, v_row.share_id, v_row.guarantee_id, v_intent,
      case when v_booking.losers_pay then 'losers_pay_' else 'gipedo_' end || v_row.reason);
    if v_row.share_id is not null then
      update public.booking_payment_shares set status = 'cancelled' where id = v_row.share_id;
    else
      update public.booking_guarantees set status = 'cancelled' where id = v_row.guarantee_id;
    end if;
    update public.gipedo_settlements set status = 'done', outcome = 'released', done_at = now(), last_error = null
    where id = v_row.id;
  else
    if v_intent is not null then
      perform public.record_intent_cancelled(v_row.booking_id, v_row.share_id, v_row.guarantee_id, v_intent,
                                             'gipedo_hold_expired');
    end if;
    if v_row.share_id is not null then
      update public.booking_payment_shares set status = 'cancelled' where id = v_row.share_id;
    else
      update public.booking_guarantees set status = 'cancelled' where id = v_row.guarantee_id;
    end if;
    if v_row.capture_cents > 0 then
      -- Decisions 3 and 8: the venue is owed what the hold should have
      -- paid, Futty a pull-out fee.
      v_owed_to := case when v_row.reason = 'pull_out_fee' then 'futty' else 'venue' end;
      v_debt := public.create_venue_debt(v_row.profile_id, v_owed_to,
        case when v_owed_to = 'venue' then v_booking.venue_id end, v_row.booking_id,
        v_row.capture_cents, v_row.venue_cents, v_row.futty_cents, 'gipedo_hold_expired', null, null);
    end if;
    update public.gipedo_settlements
    set status = case when v_debt is null then 'done' else 'debt' end, outcome = 'gone', debt_id = v_debt,
        done_at = now(), last_error = null
    where id = v_row.id;
  end if;

  if v_row.reason in ('lost', 'won', 'split') then
    perform public.send_notification(v_row.profile_id, 'gipedo_settled', jsonb_build_object(
      'title', case v_row.reason when 'won' then 'You won: hold released'
                                 when 'lost' then v_name || ': you pay the pitch'
                                 else v_name || ': split 50/50' end,
      'body', case when v_row.reason = 'won' then format('Your hold for %s is released.', public.booking_label(v_booking))
                   when p_outcome = 'gone' then format('Your hold for %s had expired, so you owe %s.',
                                                       public.booking_label(v_booking), public.money_format_euros(v_row.capture_cents))
                   else format('%s was taken from your hold for %s.', public.money_format_euros(v_row.capture_cents),
                               public.booking_label(v_booking)) end,
      'bookingId', v_row.booking_id,
      'amountCents', v_row.capture_cents
    ));
  end if;
  return jsonb_build_object('result', p_outcome, 'debt_id', v_debt);
end;
$$;

-- Rule 1 (decided by Panos, 23 November): a player (not the captain) leaves
-- a Losers pay game before it starts. On a pay-for-myself side his €4.80
-- share goes as today (free in his first hour; then €1 kept and the rest
-- venue credit; less than 6 hours before kickoff nothing back) and the rest
-- of his hold is released. Nothing held (his side paid for everyone, or he
-- never paid): his spot is simply free again.
create function public.losers_pay_leave(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_window_share public.booking_payment_shares;
  v_side public.booking_sides;
  v_kickoff timestamptz;
  v_window text;
  v_pitch integer;
  v_fee integer;
  v_capture integer := 0;
  v_credit integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or not v_booking.losers_pay then
    raise exception 'not_losers_pay';
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if now() >= v_kickoff then
    raise exception 'booking_started';
  end if;
  select * into v_share from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = auth.uid()
    and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')
  for update;
  if v_share.id is null then
    raise exception 'not_in_booking';
  end if;
  select * into v_side from public.booking_sides where booking_id = p_booking_id and side = v_share.side;
  if v_side.captain_id = auth.uid() then
    raise exception 'captain_pulls_out_side';
  end if;

  delete from public.squad_post_joiners j using public.squad_posts p
  where j.post_id = p.id and p.venue_booking_id = p_booking_id and j.profile_id = auth.uid();

  if v_share.status <> 'authorized' or v_share.gipedo_side is null then
    update public.booking_payment_shares set status = 'cancelled' where id = v_share.id;
    return jsonb_build_object('result', 'left', 'capture_cents', 0, 'credit_cents', 0);
  end if;
  if exists (select 1 from public.gipedo_settlements g where g.share_id = v_share.id) then
    raise exception 'already_settled';
  end if;

  -- His normal share is half his hold; its window as today.
  v_pitch := v_share.pitch_cents / 2;
  v_fee := v_share.fee_cents / 2;
  v_window_share := v_share;
  v_window_share.capture_due_at := null;
  v_window := public.cancellation_window(v_window_share, v_kickoff, now());
  if v_window = 'middle' then
    v_capture := v_pitch + v_fee;
    v_credit := v_capture - least(public.rule_cancel_fee_cents(), v_capture);
  elsif v_window = 'late' then
    v_capture := v_pitch + v_fee;
  end if;
  insert into public.gipedo_settlements
    (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents, credit_cents)
  values (p_booking_id, v_share.id, v_share.profile_id, v_share.side, 'left', v_capture,
          case when v_capture > 0 then v_pitch else 0 end, case when v_capture > 0 then v_fee else 0 end, v_credit);
  return jsonb_build_object('result', 'left', 'capture_cents', v_capture, 'credit_cents', v_credit);
end;
$$;

-- Rule 2 (decided by Panos, 23 November): a whole pay-for-myself side
-- pulls out more than 6 hours before kickoff: €1 per player is taken from
-- each player's own hold and the rest released; the captain's guarantee is
-- released. The other side keeps the slot as when a side cancels (the
-- opposition post reopens). Not decided yet, so refused: a pay-for-everyone
-- side, less than 6 hours before kickoff, a side on its own.
create function public.losers_pay_pull_out(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_fee integer;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or not v_booking.losers_pay then
    raise exception 'not_losers_pay';
  end if;
  select * into v_side from public.booking_sides
  where booking_id = p_booking_id and captain_id = auth.uid() and left_at is null;
  if v_side.booking_id is null then
    raise exception 'not_your_booking';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff() then
    raise exception 'losers_pay_pull_out_too_late';
  end if;
  if v_side.payment_mode <> 'each_pays_responsible' then
    raise exception 'losers_pay_pull_out_pay_all';
  end if;
  if not exists (select 1 from public.booking_sides s
                 where s.booking_id = p_booking_id and s.side <> v_side.side and s.left_at is null) then
    raise exception 'losers_pay_pull_out_alone';
  end if;

  for v_share in
    select * from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.side = v_side.side and s.gipedo_side is not null and s.status = 'authorized'
      and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id)
    for update
  loop
    v_fee := least(public.rule_cancel_fee_cents(), v_share.pitch_cents + v_share.fee_cents);
    insert into public.gipedo_settlements
      (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
    values (p_booking_id, v_share.id, v_share.profile_id, v_side.side, 'pull_out_fee', v_fee, 0, v_fee);
    v_count := v_count + 1;
  end loop;
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and side = v_side.side and status in ('pending', 'covered');

  select * into v_guarantee from public.booking_guarantees
  where booking_id = p_booking_id and profile_id = v_side.captain_id and status <> 'cancelled' for update;
  if v_guarantee.id is not null then
    if v_guarantee.status = 'held' then
      insert into public.gipedo_settlements
        (booking_id, guarantee_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
      values (p_booking_id, v_guarantee.id, v_guarantee.profile_id, v_side.side, 'pull_out_fee', 0, 0, 0);
    else
      update public.booking_guarantees set status = 'cancelled', next_attempt_at = null where id = v_guarantee.id;
    end if;
  end if;

  update public.squad_posts set status = 'closed'
  where venue_booking_id = p_booking_id and type = 'players' and side = v_side.side and status = 'open';
  perform public.booking_side_left(p_booking_id, auth.uid());
  return jsonb_build_object('result', 'pulled_out', 'holds', v_count);
end;
$$;

-- As in 20261123180000_pay_b1c_opposition.sql, plus B1d: whether it's Losers
-- pay, and side B's Losers pay holds.
drop function public.my_opposition_invites();
create function public.my_opposition_invites()
returns table (
  invite_id uuid,
  booking_id uuid,
  team_id uuid,
  venue_name text,
  booking_day date,
  start_time time,
  end_time time,
  format text,
  pitch_label text,
  side_pitch_cents integer,
  side_players integer,
  pay_all_cents integer,
  each_pays_cents integer,
  guarantee_cents integer,
  found boolean,
  losers_pay boolean,
  losers_pay_all_cents integer,
  losers_each_pays_cents integer,
  losers_spot_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, b.id, i.invited_team_id, v.name, b.booking_day, b.start_time, b.end_time, b.format,
         public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp where bp.booking_id = b.id)),
         b.amount_cents / 2, b.capacity / 2,
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'pay_all', true, me.is_premium, 'card') m),
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'each_pays_responsible', true, me.is_premium, 'card') m),
         b.amount_cents / 2,
         exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b'),
         b.losers_pay,
         (select m.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'pay_all', true, me.is_premium) m),
         (select m.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'each_pays_responsible', true, me.is_premium) m),
         (select m.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'each_pays_responsible', false, false) m)
  from public.booking_opposition_invites i
  join public.venue_bookings b on b.id = i.booking_id
  join public.venues v on v.id = b.venue_id
  cross join (select coalesce(p.is_premium, false) as is_premium from public.profiles p where p.id = auth.uid()) me
  where (i.invited_profile_id = auth.uid() or public.is_team_captain(i.invited_team_id, auth.uid()))
    and b.status <> 'cancelled'
    and public.booking_kickoff_at(b.booking_day, b.start_time) > now()
  order by b.booking_day, b.start_time;
$$;

-- As in 20261124100000_pay_b4_posts.sql, plus B1d: Losers pay.
drop function public.opposition_post_detail(uuid);
create function public.opposition_post_detail(p_post_id uuid)
returns table (
  post_id uuid,
  booking_id uuid,
  venue_name text,
  booking_day date,
  start_time time,
  end_time time,
  format text,
  pitch_label text,
  side_pitch_cents integer,
  side_players integer,
  pay_all_cents integer,
  each_pays_cents integer,
  guarantee_cents integer,
  found boolean,
  open boolean,
  losers_pay boolean,
  losers_pay_all_cents integer,
  losers_each_pays_cents integer,
  losers_spot_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, b.id, v.name, b.booking_day, b.start_time, b.end_time, b.format,
         public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp where bp.booking_id = b.id)),
         b.amount_cents / 2, b.capacity / 2,
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'pay_all', true, me.is_premium, 'card') m),
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'each_pays_responsible', true, me.is_premium, 'card') m),
         b.amount_cents / 2,
         exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b'),
         p.status = 'open' and public.opposition_open_error(b) is null,
         b.losers_pay,
         (select m.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'pay_all', true, me.is_premium) m),
         (select m.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'each_pays_responsible', true, me.is_premium) m),
         (select m.card_cents from public.money_losers_pay_hold(b.amount_cents, b.capacity, 'each_pays_responsible', false, false) m)
  from public.squad_posts p
  join public.venue_bookings b on b.id = p.venue_booking_id
  join public.venues v on v.id = b.venue_id
  cross join (select coalesce((select pr.is_premium from public.profiles pr where pr.id = auth.uid()), false) as is_premium) me
  where auth.uid() is not null
    and p.id = p_post_id and p.type = 'opposition' and b.booking_kind = 'half'
    and b.status <> 'cancelled'
    and public.booking_kickoff_at(b.booking_day, b.start_time) > now();
$$;

-- B1d: a Losers pay booking never goes through Gipedo Pano's or the usual
-- cancellation paths: its players leave with losers_pay_leave, its sides
-- pull out with losers_pay_pull_out, and its no-opponent choice is Booking
-- v2's. Booking detail shows no Gipedo Pano panel for it.

-- As in 20261124090000_pay_b3_after_pay.sql, plus B1d: no Gipedo Pano panel on Losers pay.
create or replace function public.booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  -- P12: what switching 5 v 5 / 6 v 6 would do, on every booking.
  v_detail jsonb := public.booking_detail_modes(p_booking_id)
                    || jsonb_build_object('switch', public.booking_switch_info(p_booking_id, auth.uid()));
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_mine public.booking_payment_shares;
  v_opponent public.booking_payment_shares;
  v_booker_hold public.booking_payment_shares;
  v_settlement public.gipedo_settlements;
  v_pull jsonb;
  v_roster jsonb;
  v_cash_share public.booking_payment_shares;
  v_cash_plan jsonb;
  v_cash jsonb;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;

  -- Could the caller pay their own share in cash now, and for how much?
  -- Only the planner's refusals (raise exception) mean "no"; any other
  -- error still fails the call.
  select * into v_cash_share from public.booking_payment_shares
  where id = (v_detail -> 'me' ->> 'share_id')::uuid;
  if v_cash_share.id is not null and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') then
    begin
      v_cash_plan := public.share_payment_plan(v_cash_share, v_uid, 'cash', true, false);
      v_cash := jsonb_build_object('cash_cents', (v_cash_plan ->> 'cash_cents')::integer,
                                   'card_cents', (v_cash_plan ->> 'amount_cents')::integer);
    exception when raise_exception then
      v_cash := null;
    end;
  end if;
  v_detail := v_detail || jsonb_build_object('cash_allowed', v_cash is not null);
  if jsonb_typeof(v_detail -> 'me') = 'object' then
    v_detail := jsonb_set(v_detail, '{me,cash}', coalesce(v_cash, 'null'::jsonb));
  end if;
  -- P6e: the players the venue offered, as the caller may see them (the
  -- booker: open and accepted, with what they can do; another player:
  -- accepted names). booking_detail_modes above already refused anyone not
  -- in the booking.
  v_detail := v_detail || jsonb_build_object('venue_players',
                public.booking_venue_players_json(p_booking_id, v_uid, false));
  -- B3: Booking v2's sides, opposition, posts and no-opponent choice.
  v_detail := v_detail || jsonb_build_object('v2', public.booking_v2_detail(p_booking_id, v_uid));

  if not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.gipedo_side is not null)
     or (select b.losers_pay from public.venue_bookings b where b.id = p_booking_id) then  -- B1d
    return v_detail || jsonb_build_object('gipedo', null);
  end if;
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1;
  select * into v_mine from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid and gipedo_side is not null;
  select * into v_opponent from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.gipedo_side = 'b' and s.status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.reason = 'pull_out_fee');
  select * into v_booker_hold from public.booking_payment_shares
  where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
  select * into v_settlement from public.gipedo_settlements where share_id = v_mine.id;
  v_pull := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  -- A captain's card that is only held shows as held, not paid; one whose
  -- hold expired as unpaid.
  select coalesce(jsonb_agg(case when s.gipedo_side is not null and s.status = 'authorized'
                                 then r.e || jsonb_build_object('state', 'held')
                                 when s.gipedo_side is not null and s.status = 'expired'
                                 then r.e || jsonb_build_object('state', 'unpaid')
                                 else r.e end order by r.ord), '[]'::jsonb)
    into v_roster
  from jsonb_array_elements(v_detail -> 'roster') with ordinality as r(e, ord)
  left join public.booking_payment_shares s on s.id = (r.e ->> 'share_id')::uuid;

  return v_detail
    || jsonb_build_object('roster', v_roster)
    || jsonb_build_object('can_cancel', case when v_mine.id is not null and v_booking.payment_mode = 'gipedo_pano'
                                             then jsonb_build_object('my_spot', false, 'whole_team', false)
                                             else v_detail -> 'can_cancel' end)
    || jsonb_build_object('gipedo', jsonb_build_object(
      'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = v_booking.team_id),
      'opponent', jsonb_build_object(
        'state', case when v_opponent.status = 'authorized' then 'held' when v_opponent.id is not null then 'offered' else 'none' end,
        'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t
                 where t.id = v_post.matched_team_id and v_opponent.id is not null)),
      'my_side', v_mine.gipedo_side,
      'pull_out', v_pull - 'share_id' - 'side',
      'choice_due', v_booking.created_by = v_uid and v_booking.payment_mode = 'gipedo_pano'
                    and v_booking.status = 'confirmed' and v_booking.gipedo_no_opponent_at is not null
                    and v_booking.gipedo_choice is null
                    and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff(),
      'choice', v_booking.gipedo_choice,
      'play_normal_cents', case when v_booking.created_by = v_uid then v_booker_hold.amount_cents end,
      'settlement', case when v_settlement.id is null then null else jsonb_build_object(
        'reason', v_settlement.reason, 'capture_cents', v_settlement.capture_cents, 'status', v_settlement.status) end));
end;
$$;

-- As in 20261115190000_pay_app_rules.sql, plus B1d: not for Losers pay.
create or replace function public.gipedo_pull_out(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_quote jsonb;
  v_side text;
  v_match public.matches;
  v_post public.squad_posts;
  v_other uuid;
  v_team text;
  v_opponent_share public.booking_payment_shares;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.losers_pay then
    raise exception 'use_losers_pay_pull_out';  -- B1d
  end if;
  v_quote := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  if v_quote is null then
    raise exception 'cannot_pull_out';
  end if;
  v_side := v_quote ->> 'side';
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1 for update;
  select * into v_opponent_share from public.booking_payment_shares
  where booking_id = p_booking_id and gipedo_side = 'b' and status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = booking_payment_shares.id);

  if v_quote ->> 'kind' = 'free' then
    -- An offer not yet held goes with the booking.
    if v_opponent_share.id is not null then
      update public.booking_payment_shares set status = 'cancelled' where id = v_opponent_share.id;
    end if;
    perform public.gipedo_cancel_booking(p_booking_id, 'The booking team cancelled before anyone took it on; holds are released.');
    return jsonb_build_object('result', 'cancelled', 'cents', 0);
  end if;

  v_other := case when v_side = 'a' then v_opponent_share.profile_id else v_booking.created_by end;
  select name into v_team from public.teams
  where id = case when v_side = 'a' then v_booking.team_id else v_post.matched_team_id end;

  if v_quote ->> 'kind' = 'forfeit' then
    select * into v_match from public.matches where booking_id = p_booking_id;
    if v_match.id is null then
      perform public.create_match_for_booking(p_booking_id);
      select * into v_match from public.matches where booking_id = p_booking_id;
    end if;
    if v_match.id is null then
      raise exception 'match_not_ready';
    end if;
    perform public.record_match_forfeit(v_match.id, v_side, 'pulled_out');
    perform public.send_notification(v_other, 'gipedo_pulled_out', jsonb_build_object(
      'title', 'Your opponent pulled out',
      'body', format('%s pulled out of your Gipedo Pano game at %s less than ' || public.rule_duration_words(public.rule_refund_cutoff()) || ' before kickoff, so they pay the '
                     || 'pitch and your hold is released.', coalesce(v_team, 'The other team'), public.booking_label(v_booking)),
      'bookingId', p_booking_id
    ));
    return jsonb_build_object('result', 'forfeit', 'cents', (v_quote ->> 'cents')::integer);
  end if;

  perform public.gipedo_add_settlement((v_quote ->> 'share_id')::uuid, 'pull_out_fee');
  if v_side = 'a' then
    perform public.gipedo_cancel_booking(p_booking_id,
      'The booking team pulled out, so the slot is freed and the other team''s hold is released.');
  else
    update public.friendly_matches set status = 'cancelled'
    where squad_post_id = v_post.id and coalesce(status, '') <> 'cancelled';
    update public.squad_posts
    set status = case when now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_gipedo_opponent_lead()
                      then 'closed' else 'open' end,
        matched_team_id = null
    where id = v_post.id;
    perform public.booking_match_drop_friendly(p_booking_id);
    perform public.send_notification(v_other, 'gipedo_pulled_out', jsonb_build_object(
      'title', 'Your opponent pulled out',
      'body', format('%s pulled out of your Gipedo Pano game at %s. Your hold stays and your post is open again.',
                     coalesce(v_team, 'The other team'), public.booking_label(v_booking)),
      'bookingId', p_booking_id
    ));
  end if;
  return jsonb_build_object('result', 'pulled_out', 'cents', (v_quote ->> 'cents')::integer);
end;
$$;

-- As in 20261115170000_pay_gipedo_dashboard_merge.sql, plus B1d.
create or replace function public.cancellation_plan(
  p_booking_id uuid,
  p_scope text,
  p_profile_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- B1d: Losers pay has its own ways out (losers_pay_leave, losers_pay_pull_out).
  if p_scope in ('my_spot', 'whole_team') and exists (
       select 1 from public.venue_bookings b where b.id = p_booking_id and b.losers_pay and b.status <> 'cancelled') then
    raise exception 'use_losers_pay_leave';
  end if;
  if p_scope in ('my_spot', 'whole_team') and exists (
       select 1 from public.venue_bookings b
       where b.id = p_booking_id and b.payment_mode = 'gipedo_pano' and b.status <> 'cancelled'
         and (b.created_by = p_profile_id
              or exists (select 1 from public.booking_payment_shares s
                         where s.booking_id = b.id and s.profile_id = p_profile_id and s.gipedo_side is not null
                           and s.status in ('pending', 'authorized'))))
  then
    raise exception 'use_gipedo_pull_out';
  end if;
  return public.cancellation_plan_modes(p_booking_id, p_scope, p_profile_id, p_at);
end;
$$;

-- As in 20261123210000_pay_b1c_collection_odd_cent.sql, plus B1d: a Losers
-- pay booking is never collected (its settlement takes what's owed) and has
-- no separate odd cent (its settlement gives the venue the full pitch).
create or replace function public.collections_due()
returns table (booking_id uuid, collection_id uuid, side text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, null::uuid, null::text
  from public.venue_bookings b
  where b.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
    and b.booking_kind is distinct from 'half'
    and b.status = 'confirmed'
    and b.booking_day <= (now() at time zone 'Asia/Nicosia')::date
    and public.collection_is_due(b)
    and not exists (select 1 from public.booking_collections c where c.booking_id = b.id)
  union all
  -- B1c: a half pitch, side by side.
  select b.id, null::uuid, s.side
  from public.venue_bookings b
  join public.booking_sides s on s.booking_id = b.id and s.left_at is null
  where b.booking_kind = 'half' and b.status = 'confirmed'
    and not b.losers_pay  -- B1d: Losers pay is settled from the result
    and s.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
    and public.collection_side_is_due(b, s.side)
    and not exists (select 1 from public.booking_collections c where c.booking_id = b.id and c.side = s.side)
  union all
  select c.booking_id, c.id, c.side
  from public.booking_collections c
  where c.status <> 'done' and coalesce(c.next_attempt_at, c.started_at) <= now();
$$;

create or replace function public.booking_odd_cent_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_count integer := 0;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.booking_kind = 'half' and b.status = 'confirmed' and b.amount_cents % 2 = 1
      and not b.losers_pay  -- B1d: the settlement gives the venue the full pitch
      and now() >= public.booking_ends_at(b.booking_day, b.end_time)
      and not exists (select 1 from public.money_ledger l
                      where l.booking_id = b.id and l.kind = 'transfer' and l.reason = 'odd_cent_absorbed')
    for update of b
  loop
    if public.record_money_transfer(v_booking.id, null, -1, 'odd-cent-' || v_booking.id, 'odd_cent_absorbed') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.money_losers_pay_hold(integer, integer, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.money_losers_pay_hold(integer, integer, text, boolean, boolean) to service_role;
revoke all on function public.losers_pay_add_guarantee(uuid, uuid) from public, anon, authenticated;
grant execute on function public.losers_pay_add_guarantee(uuid, uuid) to service_role;
revoke all on function public.losers_pay_count_guarantees() from public, anon, authenticated;
grant execute on function public.losers_pay_count_guarantees() to service_role;
revoke all on function public.losers_pay_settle_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.losers_pay_settle_booking(uuid, text) to service_role;
revoke all on function public.losers_pay_settle_from_results() from public, anon, authenticated;
grant execute on function public.losers_pay_settle_from_results() to service_role;
revoke all on function public.gipedo_settlements_due() from public, anon, authenticated;
grant execute on function public.gipedo_settlements_due() to service_role;
revoke all on function public.gipedo_settlement_done(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.gipedo_settlement_done(uuid, text, integer, integer) to service_role;
revoke all on function public.losers_pay_leave(uuid) from public, anon;
grant execute on function public.losers_pay_leave(uuid) to authenticated, service_role;
revoke all on function public.losers_pay_pull_out(uuid) from public, anon;
grant execute on function public.losers_pay_pull_out(uuid) to authenticated, service_role;
revoke all on function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid, uuid[], text, boolean) from public, anon;
grant execute on function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid, uuid[], text, boolean) to authenticated, service_role;
revoke all on function public.share_payment_plan(public.booking_payment_shares, uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.share_payment_plan(public.booking_payment_shares, uuid, text, boolean, boolean) to service_role;
revoke all on function public.add_booking_side_share_internal(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_booking_side_share_internal(uuid, uuid, text) to service_role;
revoke all on function public.accept_opposition_internal(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.accept_opposition_internal(uuid, uuid, text, boolean) to service_role;
revoke all on function public.accept_opposition(uuid, text, boolean) from public, anon;
grant execute on function public.accept_opposition(uuid, text, boolean) to authenticated, service_role;
revoke all on function public.accept_opposition_post(uuid, text, boolean) from public, anon;
grant execute on function public.accept_opposition_post(uuid, text, boolean) to authenticated, service_role;
revoke all on function public.guarantees_due_for_hold(uuid) from public, anon, authenticated;
grant execute on function public.guarantees_due_for_hold(uuid) to service_role;
revoke all on function public.plan_other_half_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.plan_other_half_payment(uuid, uuid) to service_role;
revoke all on function public.my_opposition_invites() from public, anon;
grant execute on function public.my_opposition_invites() to authenticated, service_role;
revoke all on function public.opposition_post_detail(uuid) from public, anon;
grant execute on function public.opposition_post_detail(uuid) to authenticated, service_role;
revoke all on function public.booking_quote_v2(uuid, date, time, time, text, integer) from public, anon;
grant execute on function public.booking_quote_v2(uuid, date, time, time, text, integer) to authenticated, service_role;
revoke all on function public.booking_post_quotes(uuid[]) from public, anon;
grant execute on function public.booking_post_quotes(uuid[]) to authenticated, service_role;
revoke all on function public.booking_detail(uuid) from public, anon;
grant execute on function public.booking_detail(uuid) to authenticated, service_role;
revoke all on function public.gipedo_pull_out(uuid) from public, anon;
grant execute on function public.gipedo_pull_out(uuid) to authenticated, service_role;
revoke all on function public.cancellation_plan(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cancellation_plan(uuid, text, uuid, timestamptz) to service_role;
revoke all on function public.collections_due() from public, anon, authenticated;
grant execute on function public.collections_due() to service_role;
revoke all on function public.booking_odd_cent_due() from public, anon, authenticated;
grant execute on function public.booking_odd_cent_due() to service_role;
