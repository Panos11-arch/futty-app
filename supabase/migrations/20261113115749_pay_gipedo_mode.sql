-- P8: Gipedo Pano as a fourth booking mode, chosen at checkout
-- (docs/specs/13-payments-bookings.md, "Gipedo Pano"). Bookings made with a
-- squad post's payment_mode = 'gipedo_pano' before this keep the old logic;
-- this mode is venue_bookings.payment_mode = 'gipedo_pano'.
--
--   - Only a team's captain books it, for that team (team_required,
--     not_captain), and only for a kickoff between 24 and 144 hours away
--     (decided 13 November: gipedo_too_soon, gipedo_too_far_ahead).
--   - Each captain's card is held for the pitch price plus 55 cents per
--     player in the booking (6550 on a €60 5 v 5; a Premium captain's own
--     spot is fee-free, 6495). The booking captain's hold is the booker's
--     share (gipedo_side 'a'); the opponent captain's is added when they
--     offer (gipedo_side 'b', pay_gipedo_opposition).
--   - A hold is never taken at +60 minutes and the booking is left out of
--     the 2-hour collection: pay_gipedo_settle decides what each hold pays.
--   - Card only: no cash, no venue credit (decided 13 November).
--   - Everyone else who joins plays covered, as when the booker pays for
--     everyone.

-- 1. The mode and the hold shares.
alter table public.venue_bookings drop constraint venue_bookings_payment_mode_check;
alter table public.venue_bookings add constraint venue_bookings_payment_mode_check
  check (payment_mode in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot', 'gipedo_pano'));

alter table public.booking_payment_shares
  add column gipedo_side text check (gipedo_side in ('a', 'b'));
comment on column public.booking_payment_shares.gipedo_side is
  'Gipedo Pano: this share is a captain''s hold, for the booking team (a) or the opponent (b). Null otherwise.';

-- A Gipedo Pano hold is never taken by the +60-minute job: whatever path
-- marks it held, it has no capture time.
create or replace function public.gipedo_hold_no_capture_due()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.gipedo_side is not null then
    new.capture_due_at := null;
  end if;
  return new;
end;
$$;
create trigger gipedo_hold_no_capture_due
  before insert or update of capture_due_at, gipedo_side on public.booking_payment_shares
  for each row execute function public.gipedo_hold_no_capture_due();

-- 2. Money: a captain's hold is priced as the booker paying for everyone.
create or replace function public.money_share(
  p_pitch_cents integer,
  p_players integer,
  p_mode text,
  p_is_booker boolean,
  p_is_premium boolean,
  p_method text default 'card',
  out pitch_cents integer,
  out fee_cents integer,
  out card_cents integer,
  out cash_cents integer
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_pitch_cents is null or p_pitch_cents < 0 or p_players is null or p_players < 1
     or p_is_booker is null or p_is_premium is null then
    raise exception 'invalid_money_input';
  end if;
  if p_mode is null or p_mode not in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;
  if p_method is null or p_method not in ('card', 'cash') then
    raise exception 'invalid_payment_method';
  end if;
  if p_mode in ('pay_all', 'gipedo_pano') and p_method = 'cash' then
    raise exception 'cash_not_allowed';
  end if;

  -- Gipedo Pano: p_is_booker means "a captain's hold" (either team's).
  if p_mode in ('pay_all', 'gipedo_pano') then
    if p_is_booker then
      pitch_cents := p_pitch_cents;
      fee_cents := 55 * (p_players - case when p_is_premium then 1 else 0 end);
    else
      pitch_cents := 0;
      fee_cents := 0;
    end if;
  else
    pitch_cents := p_pitch_cents / p_players + case when p_is_booker then p_pitch_cents % p_players else 0 end;
    fee_cents := case when p_is_premium then 0 else 80 end;
  end if;

  if p_method = 'cash' then
    card_cents := fee_cents;
    cash_cents := pitch_cents;
  else
    card_cents := pitch_cents + fee_cents;
    cash_cents := 0;
  end if;
end;
$$;

create or replace function public.money_fee_per_player_cents(p_mode text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_mode when 'pay_all' then 55 when 'gipedo_pano' then 55
                     when 'each_pays_responsible' then 80 when 'each_pays_own_spot' then 80 end;
$$;

-- Half of a hold for a draw, a dispute or no result (decided 12 November):
-- half its pitch part and half its fee, the odd cent on the booking team.
create or replace function public.money_gipedo_half(
  p_pitch_cents integer,
  p_fee_cents integer,
  p_booking_team boolean,
  out pitch_cents integer,
  out fee_cents integer
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_pitch_cents is null or p_pitch_cents < 0 or p_fee_cents is null or p_fee_cents < 0 or p_booking_team is null then
    raise exception 'invalid_money_input';
  end if;
  pitch_cents := p_pitch_cents / 2 + case when p_booking_team then p_pitch_cents % 2 else 0 end;
  fee_cents := p_fee_cents / 2 + case when p_booking_team then p_fee_cents % 2 else 0 end;
end;
$$;

-- Whether a Gipedo Pano game kicking off at p_kickoff can be booked (or
-- offered for) at p_at: null if so, otherwise the error. At most 144 hours
-- ahead (6 days, decided 13 November, so the holds last until settlement)
-- and at least 24 hours ahead (the opposition post closes then).
create or replace function public.gipedo_window_error(p_kickoff timestamptz, p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kickoff > p_at + interval '144 hours' then 'gipedo_too_far_ahead'
    when p_kickoff < p_at + interval '24 hours' then 'gipedo_too_soon'
  end;
$$;

-- Is p_profile a captain of p_team?
create or replace function public.is_team_captain(p_team_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_team_id is not null and p_profile_id is not null and exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = p_profile_id and tm.role = 'captain');
$$;

-- 3. book_slot takes the team a Gipedo Pano game is for. As in
-- 20261109131700_pay_modes_booking, plus the Gipedo Pano checks; the other
-- modes are unchanged (p_team_id is ignored for them).
drop function public.book_slot(uuid, date, time, time, integer, text, integer, text);

create function public.book_slot(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitches integer,
  p_format text,
  p_players_per_side integer default 5,
  p_mode text default null,
  p_team_id uuid default null
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
  v_window_days := case when v_premium then 14 else 7 end;
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

  v_pitch_ids := public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five);
  if v_pitch_ids is null then
    if public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five, p_ignore_blocks => true) is not null then
      raise exception 'slot_blocked';
    end if;
    raise exception 'slot_full';
  end if;

  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player, payment_mode, team_id)
    values
      (p_venue_id, p_day, p_start, p_end, cardinality(v_pitch_ids), v_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.money_fee_per_player_cents(p_mode) end, p_mode,
       case when v_gipedo then p_team_id end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select v_booking.id, unnest(v_pitch_ids), public.booking_slot_range(p_day, p_start, p_end);
  exception when exclusion_violation then
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

revoke all on function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid) from public, anon;
grant execute on function public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid) to authenticated, service_role;

-- 4. The booking captain's hold confirms the booking, as the booker paying
-- for everyone does, and opens its "Need opposition" post. As in
-- 20261109131704_pay_modes_timing otherwise.
create or replace function public.booker_share_settled(p_share public.booking_payment_shares, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  if not p_share.is_booker then
    return jsonb_build_object('guarantee_id', null, 'guarantee_due', false);
  end if;
  select * into v_booking from public.venue_bookings where id = p_share.booking_id;
  if v_booking.payment_mode in ('pay_all', 'gipedo_pano') or p_payment_method_id is not null then
    update public.venue_bookings set status = 'confirmed' where id = p_share.booking_id and status = 'pending_payment';
  end if;
  if v_booking.payment_mode = 'gipedo_pano' then
    perform public.gipedo_open_post(p_share.booking_id);
  end if;
  return public.guarantee_card_saved(p_share.booking_id, p_share.profile_id, p_payment_method_id);
end;
$$;

-- A confirmed Gipedo Pano booking's opposition post (once).
create or replace function public.gipedo_open_post(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.payment_mode is distinct from 'gipedo_pano' or v_booking.status <> 'confirmed'
     or exists (select 1 from public.squad_posts sp where sp.venue_booking_id = p_booking_id and sp.type = 'opposition') then
    return;
  end if;
  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, team_id, posted_by, status, venue_booking_id, payment_mode)
  values
    (v_booking.venue_id, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time), v_booking.format,
     'opposition', v_booking.team_id, v_booking.created_by, 'open', p_booking_id, 'gipedo_pano');
end;
$$;

-- 5. Paying a share. As in 20261110190002_pay_collection_debt, plus for a
-- Gipedo Pano hold: priced as a captain's hold, card only (no cash, no
-- credit), always held (manual capture), and the opponent captain has 15
-- minutes from offering to place it (decided 13 November).
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

  select * into v_amounts from public.money_share(
    v_booking.amount_cents, v_booking.capacity,
    case when v_hold then 'gipedo_pano' else v_booking.payment_mode end,
    p_share.is_booker or v_hold,
    exists (select 1 from public.profiles where id = p_profile_id and is_premium), p_method);
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
    if not (v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') or v_credit > 0) then
      raise exception 'saved_card_required';
    end if;
    v_needs_card := true;
  end if;

  return jsonb_build_object(
    'share_id', p_share.id,
    'booking_id', p_share.booking_id,
    'is_booker', p_share.is_booker,
    'payment_mode', v_booking.payment_mode,
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

-- 6. The +60-minute job never takes a Gipedo Pano hold. As in
-- 20261109164845_pay_modes_recovery otherwise.
create or replace function public.shares_due_for_capture()
returns table (share_id uuid, booking_id uuid, stripe_payment_intent_id text, amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.booking_id, s.stripe_payment_intent_id, s.amount_cents
  from public.booking_payment_shares s
  join public.venue_bookings b on b.id = s.booking_id
  where s.status = 'authorized'
    and s.capture_method = 'manual'
    and s.capture_due_at <= now()
    and (s.capture_next_attempt_at is null or s.capture_next_attempt_at <= now())
    and s.stripe_payment_intent_id is not null
    and s.gipedo_side is null
    and b.payment_mode is not null
    and b.status <> 'cancelled'
  order by s.capture_due_at;
$$;

-- 7. Everyone who joins a Gipedo Pano booking plays covered. As in
-- 20261109180838_pay_cancellations_apply otherwise.
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
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  v_total_needed := public.booking_total_shares_needed(p_booking_id);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due');

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

-- 8. Cancelling: a captain leaves a Gipedo Pano game by pulling out
-- (gipedo_pull_out, pay_gipedo_settle), never with "my spot" or "whole
-- team"; the venue cancels it as any booking (both holds released). After
-- "play as normal" the booking is pay_all and cancels by its rules
-- (decided 13 November). The plan itself is unchanged.
alter function public.cancellation_plan(uuid, text, uuid, timestamptz) rename to cancellation_plan_modes;

create function public.cancellation_plan(
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

revoke all on function public.cancellation_plan_modes(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cancellation_plan_modes(uuid, text, uuid, timestamptz) to service_role;
revoke all on function public.cancellation_plan(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cancellation_plan(uuid, text, uuid, timestamptz) to service_role;

-- 9. Checkout: Gipedo Pano priced and offered by the server.
--   gipedo_pano.hold_cents   what the caller's card is held for
--   gipedo_pano.available    whether the caller can book it for this slot
--   gipedo_pano.unavailable_reason  not_captain, gipedo_too_far_ahead or
--                            gipedo_too_soon (null when available)
--   captain_teams            the teams the caller captains ({id, name})
alter function public.booking_quote(uuid, date, time, time, text, integer) rename to booking_quote_modes;

create function public.booking_quote(
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
  v_quote jsonb := public.booking_quote_modes(p_venue_id, p_day, p_start, p_end, p_format, p_players_per_side);
  v_uid uuid := auth.uid();
  v_hold record;
  v_teams jsonb;
  v_reason text;
begin
  select * into v_hold from public.money_share((v_quote ->> 'pitch_cents')::integer, (v_quote ->> 'players')::integer,
                                               'gipedo_pano', true, (v_quote ->> 'is_premium')::boolean, 'card');
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name, t.id), '[]'::jsonb)
    into v_teams
  from public.teams t
  where exists (select 1 from public.team_members tm
                where tm.team_id = t.id and tm.profile_id = v_uid and tm.role = 'captain');
  v_reason := case when jsonb_array_length(v_teams) = 0 then 'not_captain'
                   else public.gipedo_window_error(public.booking_kickoff_at(p_day, p_start), now()) end;
  return v_quote || jsonb_build_object(
    'gipedo_pano', jsonb_build_object(
      'pitch_cents', v_hold.pitch_cents, 'fee_cents', v_hold.fee_cents, 'hold_cents', v_hold.card_cents,
      'available', v_reason is null, 'unavailable_reason', v_reason),
    'captain_teams', v_teams);
end;
$$;

revoke all on function public.booking_quote_modes(uuid, date, time, time, text, integer) from public, anon, authenticated;
grant execute on function public.booking_quote_modes(uuid, date, time, time, text, integer) to service_role;
revoke all on function public.booking_quote(uuid, date, time, time, text, integer) from public, anon;
grant execute on function public.booking_quote(uuid, date, time, time, text, integer) to authenticated, service_role;

-- 10. The old Gipedo Pano (a squad post's payment_mode on a booking from
-- before P4a) never touches a booking with a payment mode: those settle in
-- pay_gipedo_settle. Otherwise exactly as in the baseline.
create or replace function public.record_gipedo_pano_settlement(p_match_id uuid, p_settlement text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_booking public.venue_bookings;
begin
  select * into v_match from public.friendly_matches where id = p_match_id;
  if v_match.id is null or v_match.squad_post_id is null then
    return;
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.id is null or v_post.payment_mode <> 'gipedo_pano' or v_post.venue_booking_id is null then
    return;
  end if;

  select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.payment_mode is not null then
    return;
  end if;

  update public.friendly_matches
  set payment_settlement = p_settlement
  where id = p_match_id;
end;
$$;

create or replace function public.gipedo_pano_pending_settlement_shares()
returns table (match_id uuid, share_id uuid, stripe_payment_intent_id text, action text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    fm.id as match_id,
    s.id as share_id,
    s.stripe_payment_intent_id,
    case
      when fm.payment_settlement = 'void' then 'void'
      when fm.payment_settlement = 'draw' then 'capture'
      when fm.payment_settlement = 'home_wins' and tm.team_id = fm.home_team_id then 'void'
      when fm.payment_settlement = 'home_wins' and tm.team_id = fm.away_team_id then 'capture'
      when fm.payment_settlement = 'away_wins' and tm.team_id = fm.away_team_id then 'void'
      when fm.payment_settlement = 'away_wins' and tm.team_id = fm.home_team_id then 'capture'
    end as action
  from public.friendly_matches fm
  join public.squad_posts sp on sp.id = fm.squad_post_id
  join public.booking_payment_shares s on s.booking_id = sp.venue_booking_id
  join public.venue_bookings b on b.id = s.booking_id
  join public.team_members tm
    on tm.profile_id = s.profile_id and tm.team_id in (fm.home_team_id, fm.away_team_id)
  where fm.payment_settlement is not null
    and fm.payment_settled_at is null
    and s.status = 'authorized'
    and b.payment_mode is null;
$$;

revoke all on function public.gipedo_hold_no_capture_due() from public, anon, authenticated;
revoke all on function public.money_gipedo_half(integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.money_gipedo_half(integer, integer, boolean) to service_role;
revoke all on function public.gipedo_window_error(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.gipedo_window_error(timestamptz, timestamptz) to service_role;
revoke all on function public.is_team_captain(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_team_captain(uuid, uuid) to service_role;
revoke all on function public.gipedo_open_post(uuid) from public, anon, authenticated;
grant execute on function public.gipedo_open_post(uuid) to service_role;
revoke all on function public.record_gipedo_pano_settlement(uuid, text) from public, anon, authenticated;
grant execute on function public.record_gipedo_pano_settlement(uuid, text) to service_role;
revoke all on function public.gipedo_pano_pending_settlement_shares() from public, anon, authenticated;
grant execute on function public.gipedo_pano_pending_settlement_shares() to service_role;
