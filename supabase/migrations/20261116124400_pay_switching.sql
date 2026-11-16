-- P12: switching 5 v 5 / 6 v 6 after booking (docs/specs/13-payments-bookings.md,
-- "Switching after booking", and its decisions of 16 November).
--
-- Only the booker switches, once per booking, until the refund cutoff
-- before kickoff (exactly at the cutoff is still allowed), and every player
-- is told. The booking's capacity is what changes; every amount follows
-- from it with the existing money functions:
--   5 v 5 -> 6 v 6  each share already paid at the 5 v 5 price gets the
--                   difference in its pitch part as venue credit (on a €60
--                   pitch 600 - 500 = 100). A share that's only held gets it
--                   when it is taken (also a payment started at the old
--                   price that lands after the switch). Credit that paid for
--                   the share goes back first, latest-expiring first; only
--                   the rest is new 12-month credit. An unticked cash
--                   player gets no credit: the cash they owe goes down.
--   6 v 6 -> 5 v 5  only while no more than 10 players have joined. Nothing
--                   moves now: collection_amounts prices each share on the
--                   new capacity, so each paid player owes the difference
--                   (100 on €60) with the after-match top-ups.
--   pay-all         no money moves; the €1-per-player kept if the booker
--                   cancels stays counted on the capacity they paid for.
--
-- Re-created from their latest definitions, with only the switch added:
--   collection_amounts         (20261110190001) a paid share's pitch part
--                              less the switch credit it was given
--   cancellation_plan_modes    (20261115190000) cancellations work from
--                              what's left after the switch credit; pay-all
--                              keeps €1 x the capacity paid for
--   add_booking_share_internal (20261115170000) locks the booking, so a
--                              join can't race a switch to 5 v 5
--   booking_detail             (20261115190000) adds 'switch'

-- ---- Columns -----------------------------------------------------------------

alter table public.venue_bookings
  add column switched_at timestamptz,
  add column switched_by uuid,
  add column booked_capacity integer check (booked_capacity > 0);
comment on column public.venue_bookings.switched_at is
  'When the booker switched 5 v 5 / 6 v 6 (once per booking). Null if never switched.';
comment on column public.venue_bookings.booked_capacity is
  'The capacity at booking, kept when the booking is switched (null if never switched). A pay-all booker paid for this many players.';

alter table public.booking_payment_shares
  add column switch_credit_cents integer not null default 0 check (switch_credit_cents >= 0),
  add column switch_credit_back_cents integer not null default 0 check (switch_credit_back_cents >= 0),
  add column switch_credit_issued_at timestamptz,
  add constraint booking_payment_shares_switch_back_check check (switch_credit_back_cents <= switch_credit_cents);
comment on column public.booking_payment_shares.switch_credit_cents is
  'Venue credit a 5 v 5 -> 6 v 6 switch gives this share: its pitch part paid less its new pitch part. Given when the share is taken (switch_credit_issued_at).';
comment on column public.booking_payment_shares.switch_credit_back_cents is
  'The part of switch_credit_cents that went back to the credit that paid for the share; the rest is new credit.';

alter table public.venue_credits drop constraint venue_credits_source_check;
alter table public.venue_credits add constraint venue_credits_source_check
  check (source in ('player_cancelled', 'booking_cancelled', 'venue_cancelled', 'format_switch'));

insert into public.notification_types (type, always_sent) values ('booking_switched', true)
on conflict (type) do nothing;

-- ---- Amounts -----------------------------------------------------------------

-- The pitch part a share carries when the booking is for p_capacity players:
-- money_share's split, the leftover cents on the booker's share or, when the
-- booker gave up their spot, on the first player who joined (as in
-- collection_amounts).
create or replace function public.switch_pitch_part(
  p_booking public.venue_bookings,
  p_share public.booking_payment_shares,
  p_capacity integer
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (public.money_share(
    p_booking.amount_cents, p_capacity, p_booking.payment_mode,
    p_share.is_booker or (
      not exists (select 1 from public.booking_payment_shares s
                  where s.booking_id = p_booking.id and s.is_booker and s.status in ('pending', 'authorized', 'paid'))
      and p_share.id = (select s.id from public.booking_payment_shares s
                        where s.booking_id = p_booking.id and s.status in ('pending', 'authorized', 'paid')
                        order by s.created_at, s.id limit 1)),
    false, 'card')).pitch_cents;
$$;

-- The credit a switched booking gives a share that has paid its pitch part
-- (by card, credit, or cash ticked as received): what it paid less its pitch
-- part now. Zero unless the booking was switched to more players.
create or replace function public.switch_credit_due(p_share public.booking_payment_shares)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  select * into v_booking from public.venue_bookings where id = p_share.booking_id;
  if v_booking.switched_at is null or v_booking.capacity <= v_booking.booked_capacity
     or v_booking.payment_mode not in ('each_pays_responsible', 'each_pays_own_spot') then
    return 0;
  end if;
  if p_share.payment_method = 'cash' and p_share.cash_received_at is null then
    return 0;
  end if;
  return greatest(coalesce(p_share.pitch_cents, 0) - public.switch_pitch_part(v_booking, p_share, v_booking.capacity), 0);
end;
$$;

-- Gives a share its switch credit, once: back to the credit that paid for the
-- share first (latest-expiring first, keeping its expiry), the rest as new
-- credit at the venue. Returns the credit given now.
create or replace function public.issue_switch_credit(p_share_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_used integer;
  v_back integer;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null or v_share.switch_credit_issued_at is not null or v_share.switch_credit_cents = 0 then
    return 0;
  end if;
  select coalesce(sum(amount_cents), 0)::integer into v_used from public.venue_credit_spends
  where share_id = v_share.id and status in ('reserved', 'spent');
  v_back := public.return_share_credit_part(v_share.id, least(v_share.switch_credit_cents, v_used), 'format_switch');
  if v_share.switch_credit_cents - v_back > 0 then
    perform public.issue_venue_credit(v_share.profile_id,
      (select venue_id from public.venue_bookings where id = v_share.booking_id),
      v_share.switch_credit_cents - v_back, 'format_switch', v_share.booking_id, v_share.id);
  end if;
  update public.booking_payment_shares
  set switch_credit_back_cents = v_back, switch_credit_issued_at = now()
  where id = v_share.id;
  return v_share.switch_credit_cents;
end;
$$;

-- A payment that lands after the switch, at the price it started at: the
-- share is owed the difference when held, and given it when taken.
create or replace function public.share_switch_credit_owed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.switch_credit_issued_at is null and new.switch_credit_cents = 0 then
    new.switch_credit_cents := public.switch_credit_due(new);
  end if;
  return new;
end;
$$;

create trigger booking_payment_shares_switch_owed
  before update of status on public.booking_payment_shares
  for each row when (old.status = 'pending' and new.status in ('authorized', 'paid'))
  execute function public.share_switch_credit_owed();

-- After booking_payment_shares_credit (triggers fire in name order), so
-- credit that paid for the share is already spent when part of it goes back.
create or replace function public.share_switch_credit_taken()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.issue_switch_credit(new.id);
  return new;
end;
$$;

create trigger booking_payment_shares_switch_taken
  after update of status on public.booking_payment_shares
  for each row when (new.status = 'paid' and old.status is distinct from 'paid'
                     and new.switch_credit_cents > 0 and new.switch_credit_issued_at is null)
  execute function public.share_switch_credit_taken();

-- ---- The switch --------------------------------------------------------------

-- Why p_uid can't switch the booking to p_players_per_side a side now, or
-- null if they can. Shared by the switch and the booking screen.
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
  if (select count(*) from public.booking_payment_shares s
      where s.booking_id = p_booking.id and s.status in ('pending', 'authorized', 'paid', 'covered'))
     > p_players_per_side * 2 then
    return 'too_many_players';
  end if;
  return null;
end;
$$;

-- What a player is told: the new format and what it means for their money.
create or replace function public.switch_notice_body(
  p_booking public.venue_bookings,
  p_share public.booking_payment_shares,
  p_old_capacity integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_side integer := p_booking.capacity / 2;
  v_head text;
  v_extra integer;
begin
  v_head := format('%s switched your game on %s at %s to %s v %s.',
    public.profile_display_name(p_booking.created_by),
    to_char(p_booking.booking_day, 'Dy DD Mon'), to_char(p_booking.start_time, 'HH24:MI'), v_side, v_side);
  if p_booking.payment_mode = 'pay_all' then
    return v_head || ' The booking is paid in full, so no money changes.';
  end if;
  if p_share.switch_credit_cents > 0 then
    return v_head || format(' You get %s credit at %s%s.', public.money_format_euros(p_share.switch_credit_cents),
      (select name from public.venues where id = p_booking.venue_id),
      case when p_share.switch_credit_issued_at is null then ' when your payment is taken' else '' end);
  end if;
  if p_booking.capacity < p_old_capacity
     and (p_share.status in ('authorized', 'paid') and p_share.payment_method = 'card'
          or p_share.payment_method = 'cash' and p_share.cash_received_at is not null) then
    v_extra := public.switch_pitch_part(p_booking, p_share, p_booking.capacity) - coalesce(p_share.pitch_cents, 0);
    if v_extra > 0 then
      return v_head || format(' You''ll pay %s more after the match.', public.money_format_euros(v_extra));
    end if;
  end if;
  if p_share.payment_method = 'cash' and p_share.cash_received_at is null then
    return v_head || format(' You now pay %s in cash at the venue.', public.money_format_euros(p_share.cash_cents));
  end if;
  return v_head;
end;
$$;

-- The booker switches their 5-a-side booking to p_players_per_side a side.
create or replace function public.switch_players_per_side(p_booking_id uuid, p_players_per_side integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_old_capacity integer;
  v_refusal text;
  v_share public.booking_payment_shares;
  v_part integer;
  v_price record;
  v_credit integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  -- Every share too, so no payment lands half-way through.
  perform 1 from public.booking_payment_shares where booking_id = p_booking_id for update;
  v_refusal := public.switch_refusal(v_booking, v_uid, p_players_per_side);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  v_old_capacity := v_booking.capacity;
  update public.venue_bookings
  set capacity = p_players_per_side * 2, booked_capacity = coalesce(booked_capacity, capacity),
      switched_at = now(), switched_by = v_uid
  where id = p_booking_id
  returning * into v_booking;

  if v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') then
    for v_share in
      select * from public.booking_payment_shares
      where booking_id = p_booking_id and status in ('pending', 'authorized', 'paid')
      order by is_booker desc, created_at, id
    loop
      if v_share.payment_method = 'cash' and v_share.cash_received_at is null then
        -- Cash not yet paid: they owe the new pitch part at the venue.
        v_part := public.switch_pitch_part(v_booking, v_share, v_booking.capacity);
        update public.booking_payment_shares set pitch_cents = v_part, cash_cents = v_part where id = v_share.id;
      elsif v_share.status = 'pending' and v_share.payment_method = 'card'
            and v_share.stripe_payment_intent_id is null and v_share.stripe_setup_intent_id is null then
        -- Not paying yet: shown at the new price (paying prices it again).
        select * into v_price from public.money_share(v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode,
          v_share.is_booker, exists (select 1 from public.profiles where id = v_share.profile_id and is_premium), 'card');
        update public.booking_payment_shares
        set amount_cents = v_price.card_cents, pitch_cents = v_price.pitch_cents, fee_cents = v_price.fee_cents,
            cash_cents = v_price.cash_cents
        where id = v_share.id;
      elsif v_share.status in ('authorized', 'paid') or v_share.payment_method = 'cash' then
        -- Paid (or held, or cash received): credit if the pitch part went down.
        update public.booking_payment_shares set switch_credit_cents = public.switch_credit_due(v_share)
        where id = v_share.id
        returning * into v_share;
        if v_share.status = 'paid' or v_share.payment_method = 'cash' then
          v_credit := v_credit + public.issue_switch_credit(v_share.id);
        end if;
      end if;
    end loop;
  end if;

  -- Every player is told, with what it means for them.
  for v_share in
    select * from public.booking_payment_shares
    where booking_id = p_booking_id and status in ('pending', 'authorized', 'paid', 'covered')
    order by is_booker desc, created_at, id
  loop
    perform public.send_notification(v_share.profile_id, 'booking_switched', jsonb_build_object(
      'title', format('Now %s v %s', v_booking.capacity / 2, v_booking.capacity / 2),
      'body', public.switch_notice_body(v_booking, v_share, v_old_capacity),
      'bookingId', v_booking.id,
      'playersPerSide', v_booking.capacity / 2,
      'creditCents', v_share.switch_credit_cents));
  end loop;

  -- The match follows the booking's players per side.
  if exists (select 1 from public.matches where booking_id = p_booking_id) then
    perform public.create_match_for_booking(p_booking_id);
  end if;

  return jsonb_build_object('booking_id', v_booking.id, 'players_per_side', v_booking.capacity / 2,
                            'capacity', v_booking.capacity, 'credit_cents', v_credit);
end;
$$;

-- What the booking screen shows about switching (null for a booking that
-- can't ever switch). The amounts are each player's pitch-part change.
create or replace function public.booking_switch_info(p_booking_id uuid, p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_to integer;
  v_now integer;
  v_then integer;
  v_booker_now integer;
  v_booker_then integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.format <> '5-a-side' or v_booking.booking_type = 'counter'
     or v_booking.payment_mode is null or v_booking.payment_mode = 'gipedo_pano' then
    return null;
  end if;
  if v_booking.switched_at is not null then
    return jsonb_build_object('switched', true, 'switched_at', v_booking.switched_at, 'can_switch', false,
                              'refusal', 'already_switched', 'to_players_per_side', null);
  end if;
  v_to := case when v_booking.capacity / 2 = 5 then 6 else 5 end;
  if v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') and v_booking.amount_cents > 0 then
    v_now := (public.money_share(v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, false, false, 'card')).pitch_cents;
    v_then := (public.money_share(v_booking.amount_cents, v_to * 2, v_booking.payment_mode, false, false, 'card')).pitch_cents;
    v_booker_now := (public.money_share(v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, true, false, 'card')).pitch_cents;
    v_booker_then := (public.money_share(v_booking.amount_cents, v_to * 2, v_booking.payment_mode, true, false, 'card')).pitch_cents;
  end if;
  return jsonb_build_object(
    'switched', false,
    'switched_at', null,
    'to_players_per_side', v_to,
    'refusal', public.switch_refusal(v_booking, p_uid, v_to),
    'can_switch', public.switch_refusal(v_booking, p_uid, v_to) is null,
    'closes_at', public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff(),
    -- 'credit' (each paid player gets credit), 'extra' (each paid player pays
    -- more after the match) or 'none' (pay-all, free).
    'money', case when v_now is null then 'none' when v_then < v_now then 'credit' else 'extra' end,
    'each_cents', abs(v_now - v_then),
    'booker_cents', abs(v_booker_now - v_booker_then));
end;
$$;

revoke all on function public.switch_pitch_part(public.venue_bookings, public.booking_payment_shares, integer) from public, anon, authenticated;
revoke all on function public.switch_credit_due(public.booking_payment_shares) from public, anon, authenticated;
revoke all on function public.issue_switch_credit(uuid) from public, anon, authenticated;
revoke all on function public.share_switch_credit_owed() from public, anon, authenticated;
revoke all on function public.share_switch_credit_taken() from public, anon, authenticated;
revoke all on function public.switch_refusal(public.venue_bookings, uuid, integer) from public, anon, authenticated;
revoke all on function public.switch_notice_body(public.venue_bookings, public.booking_payment_shares, integer) from public, anon, authenticated;
revoke all on function public.booking_switch_info(uuid, uuid) from public, anon, authenticated;
revoke all on function public.switch_players_per_side(uuid, integer) from public, anon;
grant execute on function public.switch_pitch_part(public.venue_bookings, public.booking_payment_shares, integer) to service_role;
grant execute on function public.switch_credit_due(public.booking_payment_shares) to service_role;
grant execute on function public.issue_switch_credit(uuid) to service_role;
grant execute on function public.switch_refusal(public.venue_bookings, uuid, integer) to service_role;
grant execute on function public.switch_notice_body(public.venue_bookings, public.booking_payment_shares, integer) to service_role;
grant execute on function public.booking_switch_info(uuid, uuid) to service_role;
grant execute on function public.switch_players_per_side(uuid, integer) to authenticated, service_role;

-- ---- Functions that read what a share paid -----------------------------------

-- collection_amounts, from 20261110190001_pay_collection_collect.sql
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

  -- The pitch part a late cancellation kept: a cash player's pitch part
  -- was never paid, so it keeps none. P12: less the switch credit the
  -- share was given before it was cancelled.
  select coalesce(sum(coalesce(s.pitch_cents, 0) - s.cash_cents
                      - case when s.payment_method = 'card' and s.switch_credit_issued_at is not null
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
         (case when s.status in ('authorized', 'paid')
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

-- cancellation_plan_modes, from 20261115190000_pay_app_rules.sql
CREATE OR REPLACE FUNCTION public.cancellation_plan_modes(p_booking_id uuid, p_scope text, p_profile_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_kickoff timestamptz;
  v_own public.booking_payment_shares;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_late_team boolean;
  v_lines jsonb := '[]'::jsonb;
  v_has_money boolean;
  v_value integer;
  v_paid integer;
  v_card_taken boolean;
  v_window text;
  v_action text;
  v_kept integer;
  v_credit integer;
  v_refund integer;
  v_capture boolean;
  v_keep_unit integer;
  v_taken integer;
  v_fee jsonb := null;
  v_cash integer;
  v_cash_back integer;
  v_cash_credit integer;
  v_cash_share public.booking_payment_shares;
  v_cash_window text;
  v_switch_back integer;
  v_switch_new integer;
  v_card_left integer;
  v_credit_left integer;
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_scope is null or p_scope not in ('my_spot', 'whole_team', 'venue') then
    raise exception 'invalid_scope';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.payment_mode is null then
    raise exception 'legacy_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if p_at >= v_kickoff then
    raise exception 'booking_started';
  end if;

  if p_scope = 'whole_team' and v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;
  if p_scope = 'venue' and not exists (
    select 1 from public.venues where id = v_booking.venue_id and owner_profile_id = p_profile_id
  ) then
    raise exception 'not_your_venue';
  end if;
  if p_scope = 'my_spot' then
    select * into v_own from public.booking_payment_shares
    where booking_id = p_booking_id and profile_id = p_profile_id
      and status in ('pending', 'authorized', 'paid', 'covered');
    if v_own.id is null then
      raise exception 'not_in_booking';
    end if;
    if v_own.is_booker and v_booking.payment_mode = 'pay_all' then
      raise exception 'use_whole_team';
    end if;
  end if;

  v_late_team := p_at > v_kickoff - public.rule_refund_cutoff();
  v_keep_unit := public.rule_cancel_fee_cents();

  for v_share in
    select s.* from public.booking_payment_shares s
    where s.booking_id = p_booking_id
      and (s.status in ('pending', 'authorized', 'paid', 'covered')
           -- Q1: forfeited by a late cancellation of the player's own spot
           -- (not the €1 of a middle-window one).
           or (p_scope = 'venue' and s.status = 'forfeited'
               and exists (select 1 from public.booking_cancellation_lines l
                           where l.share_id = s.id and l."window" = 'late')))
      and (p_scope <> 'my_spot' or s.id = v_own.id)
    order by s.is_booker desc, s.created_at, s.id
  loop
    v_kept := 0;
    v_credit := 0;
    v_refund := 0;
    v_capture := false;
    v_window := null;
    -- P12: what a switch to more players already gave back is not the
    -- player's any more. Its credit came back to the credit that paid for
    -- the share first; the rest came out of the card part (or the cash).
    v_switch_back := case when v_share.switch_credit_issued_at is not null then v_share.switch_credit_back_cents else 0 end;
    v_switch_new := case when v_share.switch_credit_issued_at is not null
                         then v_share.switch_credit_cents - v_share.switch_credit_back_cents else 0 end;
    v_card_left := v_share.amount_cents - case when v_share.payment_method = 'card' then v_switch_new else 0 end;
    v_credit_left := v_share.credit_cents - v_switch_back;

    if v_share.status = 'forfeited' then
      v_card_taken := v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null
        and exists (select 1 from public.money_ledger m
                    where m.kind = 'capture' and m.stripe_id = v_share.stripe_payment_intent_id);
      v_window := 'venue';
      if v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null and not v_card_taken then
        -- The card part was never taken: whatever hold is left is released.
        v_paid := v_share.amount_cents;
        v_value := v_paid + v_credit_left;
        v_action := 'release';
      else
        v_paid := case when v_card_taken then v_card_left else 0 end;
        v_value := v_paid + v_credit_left;
        v_action := case when v_value > 0 then 'refund_choice' else 'none' end;
        if v_value = 0 then
          v_window := null;
        end if;
      end if;
      v_refund := v_value;
      v_has_money := v_value > 0;
    else
      v_has_money := v_share.status in ('authorized', 'paid') and v_share.amount_cents + v_share.credit_cents > 0;
      v_value := case when v_has_money then v_card_left + v_credit_left else 0 end;
      v_paid := case when v_has_money then v_card_left else 0 end;

      if not v_has_money then
        v_action := case when v_share.stripe_payment_intent_id is not null and v_share.status = 'pending'
                         then 'release' else 'none' end;
      elsif p_scope = 'venue' then
        v_window := 'venue';
        v_action := case when v_share.status = 'authorized' then 'release' else 'refund_choice' end;
        v_refund := v_value;
      elsif p_scope = 'my_spot' or v_share.is_booker then
        v_window := public.cancellation_window(v_share, v_kickoff, p_at);
        if v_window = 'free' then
          v_action := 'release';
          v_refund := v_value;
        elsif v_window = 'middle' then
          v_kept := least(v_value, v_keep_unit * case when v_booking.payment_mode = 'pay_all' then coalesce(v_booking.booked_capacity, v_booking.capacity) else 1 end);
          v_credit := v_value - v_kept;
          v_action := case when v_credit > 0 then 'keep_and_credit' else 'keep' end;
          v_capture := v_share.status = 'authorized';
        else
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        end if;
      else
        v_window := 'other';
        if v_late_team then
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        elsif v_share.status = 'authorized' then
          v_action := 'release';
          v_refund := v_value;
        else
          v_action := 'refund_choice';
          v_refund := v_value;
        end if;
      end if;
    end if;

    -- Ticked cash (decided 13 November, Dimitris; for Panos to confirm)
    -- follows the cancellation rules as if it had been paid by card, beside
    -- the card amounts above, which alone reach Stripe: it goes back where a
    -- card player gets money back (the venue cancelling, a cancel in the
    -- free hour, a whole-team cancel more than 6 hours before kickoff); in
    -- the middle window the €1 is kept over card and cash together and the
    -- rest of the cash becomes credit at the venue; a late cancel keeps it.
    v_cash := coalesce((select sum(m.venue_cents) from public.money_ledger m
                        where m.share_id = v_share.id and m.kind = 'cash_received'), 0)
              - case when v_share.payment_method = 'cash' then v_switch_new else 0 end;
    v_cash_back := 0;
    v_cash_credit := 0;
    if v_cash > 0 then
      if p_scope = 'venue' then
        v_cash_back := v_cash;
      elsif p_scope = 'my_spot' or v_share.is_booker then
        -- The window a card player who paid then would be in; with nothing
        -- paid in the app, the cash is the payment.
        v_cash_share := v_share;
        if v_cash_share.held_at is null and v_cash_share.paid_at is null then
          v_cash_share.held_at := v_cash_share.cash_received_at;
          v_cash_share.capture_due_at := null;
        end if;
        v_cash_window := public.cancellation_window(v_cash_share, v_kickoff, p_at);
        if v_cash_window = 'free' then
          v_cash_back := v_cash;
        elsif v_cash_window = 'middle' then
          v_cash_credit := v_cash - (least(v_value + v_cash,
                                           v_keep_unit * case when v_booking.payment_mode = 'pay_all'
                                                              then coalesce(v_booking.booked_capacity, v_booking.capacity) else 1 end)
                                     - v_kept);
          if v_cash_credit > 0 and v_action in ('keep', 'none') then
            v_action := 'keep_and_credit';
          end if;
        end if;
        v_window := coalesce(v_window, v_cash_window);
      elsif not v_late_team then
        v_cash_back := v_cash;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'share_id', v_share.id,
      'guarantee_id', null,
      'profile_id', v_share.profile_id,
      'is_booker', v_share.is_booker,
      'window', v_window,
      'action', v_action,
      'paid_cents', v_paid,
      'fee_cents', case when v_paid > 0 then coalesce(v_share.fee_cents, 0) else 0 end,
      'credit_used_cents', case when v_has_money then v_credit_left else 0 end,
      'value_cents', v_value,
      'kept_cents', v_kept,
      'credit_cents', v_credit,
      'refund_cents', v_refund,
      'needs_capture', v_capture,
      'stripe_intent_id', v_share.stripe_payment_intent_id,
      'cash_cents', v_cash,
      'cash_back_cents', v_cash_back,
      'cash_credit_cents', v_cash_credit
    ));
  end loop;

  if p_scope <> 'my_spot' then
    select * into v_guarantee from public.booking_guarantees where booking_id = p_booking_id and status <> 'cancelled';
    if v_guarantee.id is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'share_id', null, 'guarantee_id', v_guarantee.id, 'profile_id', v_guarantee.profile_id, 'is_booker', true,
        'window', null, 'action', 'release', 'paid_cents', 0, 'fee_cents', 0, 'credit_used_cents', 0,
        'value_cents', 0, 'kept_cents', 0, 'credit_cents', 0, 'refund_cents', 0, 'needs_capture', false,
        'stripe_intent_id', v_guarantee.stripe_payment_intent_id,
        'cash_cents', 0, 'cash_back_cents', 0, 'cash_credit_cents', 0));
    end if;
  end if;

  if p_scope = 'whole_team' and v_booking.payment_mode <> 'pay_all' and not v_late_team then
    select count(*) into v_taken from public.booking_payment_shares
    where booking_id = p_booking_id and not is_booker and status = 'paid' and amount_cents > 0;
    if v_taken > 0 then
      v_fee := jsonb_build_object('profile_id', v_booking.created_by, 'players', v_taken, 'amount_cents', public.rule_cancel_fee_cents() * v_taken);
    end if;
  end if;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'scope', p_scope,
    'payment_mode', v_booking.payment_mode,
    'kickoff_at', v_kickoff,
    'refunds_stop_at', v_kickoff - public.rule_refund_cutoff(),
    'cancels_booking', p_scope <> 'my_spot',
    'lines', v_lines,
    'booker_fee', v_fee,
    'quote', md5(jsonb_build_object('booking_id', p_booking_id, 'scope', p_scope, 'lines', v_lines,
                                    'booker_fee', v_fee)::text)
  );
end;
$function$;

-- add_booking_share_internal, from 20261115170000_pay_gipedo_dashboard_merge.sql
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

-- booking_detail, from 20261115190000_pay_app_rules.sql
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
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.gipedo_side is not null) then
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
