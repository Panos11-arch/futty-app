-- P4a: book_slot takes the booking mode; every share is priced by
-- money_share (pay_modes_money). docs/specs/13-payments-bookings.md,
-- "Prices and fees" and "Booking modes".
--
-- The mode is required: there is no default (decided 9 November). App
-- builds without the mode picker (P5) get mode_required, so these
-- migrations go to production together with P5.

drop function public.book_slot(uuid, date, time, time, integer, text, integer);

create function public.book_slot(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitches integer,
  p_format text,
  p_players_per_side integer default 5,
  p_mode text default null
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
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Locking the venue serialises bookings there; booking_pitches' exclusion
  -- constraint is the backstop.
  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not v_venue.is_live then
    raise exception 'venue_not_live';
  end if;

  -- Cyprus time, not the server's UTC.
  if p_day < v_now::date or (p_day = v_now::date and p_start <= v_now::time) then
    raise exception 'slot_in_past';
  end if;

  -- Day 0 is today in Cyprus. Premium comes only from profiles.is_premium.
  v_premium := exists (select 1 from public.profiles where id = auth.uid() and is_premium);
  v_window_days := case when v_premium then 14 else 7 end;
  if p_day - v_now::date > v_window_days then
    raise exception 'beyond_booking_window';
  end if;

  -- The app still sends how many pitches it thinks the format needs. The
  -- server picks the actual pitches below; this only refuses nonsense.
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

  -- A format the venue offers: a pitch that hosts it, or a combination.
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
     or not (
       exists (select 1 from public.pitches where venue_id = p_venue_id and p_format = any (formats))
       or exists (select 1 from public.pitch_combinations where venue_id = p_venue_id and format = p_format)
     ) then
    raise exception 'invalid_format';
  end if;

  -- 6 v 6 on a 5-a-side pitch needs the venue's flag. A real 6-a-side pitch
  -- is its own format (12 players either way) and doesn't.
  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    raise exception 'invalid_players_per_side';
  end if;
  v_six_on_five := p_players_per_side = 6 and p_format = '5-a-side';
  if p_players_per_side = 6 and p_format <> '6-a-side' and (p_format <> '5-a-side' or not v_venue.allows_6v6_on_5s) then
    raise exception 'six_a_side_not_allowed';
  end if;
  v_capacity := case when v_six_on_five then 12 else public.format_player_count(p_format) * 2 end;

  -- Who pays: chosen by the booker, never defaulted.
  if p_mode is null then
    raise exception 'mode_required';
  end if;
  if p_mode not in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot') then
    raise exception 'invalid_payment_mode';
  end if;

  -- Prices come from the venue's data on the server, never from the app.
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
       amount_cents, service_fee_cents_per_player, payment_mode)
    values
      (p_venue_id, p_day, p_start, p_end, cardinality(v_pitch_ids), v_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.money_fee_per_player_cents(p_mode) end, p_mode)
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
    -- The booker's share, by card until they choose otherwise when paying.
    select * into v_share from public.money_share(v_amount_cents, v_capacity, p_mode, true, v_premium, 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status)
    values
      (v_booking.id, auth.uid(), v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, true, 'pending');

    -- Booker responsible: the full pitch price, held 72 hours before kickoff
    -- or now when kickoff is closer, once their card is saved.
    if p_mode = 'each_pays_responsible' then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (v_booking.id, auth.uid(), v_amount_cents,
              public.money_guarantee_hold_due_at(v_booking.created_at, public.booking_kickoff_at(p_day, p_start)));
    end if;
  end if;

  return v_booking;
end;
$$;

revoke all on function public.book_slot(uuid, date, time, time, integer, text, integer, text) from public, anon;
grant execute on function public.book_slot(uuid, date, time, time, integer, text, integer, text) to authenticated, service_role;

-- A player joining a booking (invite accepted, squad post joined, added by
-- the booker). New bookings price the share with money_share; in a booking
-- the booker paid for in full, the spot is 'covered'. Bookings before P4a
-- keep the old maths.
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
  where booking_id = p_booking_id;

  if v_current_count >= v_total_needed then
    return; -- booking already has a share for every slot
  end if;

  if v_booking.payment_mode is not null then
    select * into v_share from public.money_share(
      v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, false,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status)
    values
      (p_booking_id, p_profile_id, v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, false,
       case when v_booking.payment_mode = 'pay_all' then 'covered' else 'pending' end)
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

-- What joining a squad post costs the caller (share_cents, of which
-- fee_cents is the service fee), from the same maths as their share would
-- be. No row when the post has no paid booking.
create or replace function public.squad_post_price(p_post_id uuid)
returns table (share_cents integer, fee_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when b.payment_mode is not null then m.card_cents
      when b.service_fee_cents_per_player is not null
        then b.amount_cents / public.booking_total_shares_needed(b.id) + b.service_fee_cents_per_player
      -- Older bookings had the fee folded into amount_cents.
      else round(b.amount_cents::numeric / public.format_player_count(b.format))::integer
    end,
    case when b.payment_mode is not null then m.fee_cents else b.service_fee_cents_per_player end
  from public.squad_posts p
  join public.venue_bookings b on b.id = p.venue_booking_id
  left join lateral public.money_share(
    b.amount_cents, b.capacity, coalesce(b.payment_mode, 'each_pays_own_spot'), false,
    exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_premium), 'card'
  ) m on b.payment_mode is not null
  where p.id = p_post_id and b.status <> 'cancelled' and b.amount_cents > 0;
$$;

-- Called by create-share-payment, as the verified caller, before any Stripe
-- call. Checks the share is theirs and unpaid, recomputes it from the venue
-- price (Premium as of now) for the chosen method, and decides the timing:
-- held and taken 60 minutes later, or, less than 6 hours before kickoff,
-- taken at once after the player accepts "This booking is non-refundable"
-- (the acceptance time is stored). Nothing to pay by card settles the share
-- now, except a responsible booker whose card the guarantee still needs
-- (needs_saved_card: the function saves it with a SetupIntent).
-- Bookings before P4a are checked and returned unchanged (payment_mode null).
create or replace function public.prepare_share_payment(
  p_share_id uuid,
  p_profile_id uuid,
  p_method text,
  p_accept_non_refundable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_amounts record;
  v_non_refundable boolean;
  v_needs_card boolean := false;
  v_customer text;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    raise exception 'share_not_found';
  end if;
  if v_share.profile_id is distinct from p_profile_id then
    raise exception 'not_your_share';
  end if;
  if v_share.status <> 'pending' then
    raise exception 'share_not_pending';
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  select stripe_customer_id into v_customer from public.profiles where id = p_profile_id;

  if v_booking.payment_mode is not null then
    select * into v_amounts from public.money_share(
      v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, v_share.is_booker,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), p_method);

    v_non_refundable := public.money_is_non_refundable(now(), public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time));
    if v_non_refundable and not coalesce(p_accept_non_refundable, false) then
      raise exception 'non_refundable_not_accepted';
    end if;

    v_needs_card := v_amounts.card_cents = 0 and exists (
      select 1 from public.booking_guarantees g
      where g.booking_id = v_booking.id and g.profile_id = p_profile_id and g.status = 'awaiting_card'
    );

    update public.booking_payment_shares
    set payment_method = p_method,
        pitch_cents = v_amounts.pitch_cents,
        fee_cents = v_amounts.fee_cents,
        cash_cents = v_amounts.cash_cents,
        amount_cents = v_amounts.card_cents,
        capture_method = case when v_non_refundable then 'immediate' else 'manual' end,
        non_refundable_accepted_at = case when v_non_refundable then now() end,
        status = case when v_amounts.card_cents = 0 and not v_needs_card then 'paid' else status end,
        paid_at = case when v_amounts.card_cents = 0 and not v_needs_card then now() else paid_at end
    where id = p_share_id
    returning * into v_share;

    -- A booker with nothing to pay by card holds the pitch straight away.
    if v_share.status = 'paid' and v_share.is_booker then
      update public.venue_bookings set status = 'confirmed' where id = v_booking.id and status = 'pending_payment';
    end if;
  end if;

  return jsonb_build_object(
    'share_id', v_share.id,
    'booking_id', v_share.booking_id,
    'is_booker', v_share.is_booker,
    'payment_mode', v_booking.payment_mode,
    'status', v_share.status,
    'payment_method', v_share.payment_method,
    'amount_cents', v_share.amount_cents,
    'pitch_cents', v_share.pitch_cents,
    'fee_cents', v_share.fee_cents,
    'cash_cents', v_share.cash_cents,
    'capture_method', v_share.capture_method,
    'non_refundable', coalesce(v_share.capture_method = 'immediate', false),
    'stripe_payment_intent_id', v_share.stripe_payment_intent_id,
    'stripe_customer_id', v_customer,
    'needs_saved_card', v_needs_card
  );
end;
$$;

create or replace function public.set_share_payment_intent(p_share_id uuid, p_intent_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.booking_payment_shares set stripe_payment_intent_id = p_intent_id where id = p_share_id;
$$;

-- Saves a player's Stripe customer the first time they pay. Never replaces
-- one already saved.
create or replace function public.set_stripe_customer(p_profile_id uuid, p_customer_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set stripe_customer_id = p_customer_id where id = p_profile_id and stripe_customer_id is null;
$$;

revoke all on function public.prepare_share_payment(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.prepare_share_payment(uuid, uuid, text, boolean) to service_role;
revoke all on function public.set_share_payment_intent(uuid, text) from public, anon, authenticated;
grant execute on function public.set_share_payment_intent(uuid, text) to service_role;
revoke all on function public.set_stripe_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.set_stripe_customer(uuid, text) to service_role;
