-- B1c, part 2b (Booking v2, spec 13 "Invites, after payment", decided 20
-- and 23 November): "Pay the whole pitch and play". With no side B 24 hours
-- before kickoff, the lone captain pays the other half in the app, in
-- Stripe's payment sheet (Panos, 23 November): one payment, the other half
-- (rounded down, Futty absorbs an odd cent) plus that half's players at his
-- way to pay's fee: €22.75 paying for everyone (example 6a), €24.00 paying
-- for myself (6b).
--   * plan_other_half_payment / attach_other_half_intent: the pay-other-half
--     Edge Function starts the payment for exactly the server's amount.
--   * other_half_paid: only the verified webhook makes it count. It's
--     recorded in the money ledger (the venue the other half, Futty the fees
--     less Stripe's), the choice is "play_whole", and the other half is a
--     side B of his, covered: his players fill side A, then side B, for
--     nothing. Money that can't count (the booking was cancelled, the choice
--     already made, the wrong amount, a replaced payment) is given back.
--   * If he cancels later, both payments count as one "pay for everyone"
--     booking (decided 23 November): part 2c.
-- Re-created with only these changes: booking_no_opponent_choice
-- (20261123183000_pay_b1c_no_opponent.sql: "play_whole" is made by paying)
-- and accept_invite (20261123180000_pay_b1c_opposition.sql: a player joins
-- the side of the captain who invited him; a captain of both sides fills
-- side A first).

create table public.booking_other_half_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.venue_bookings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  pitch_cents integer not null check (pitch_cents >= 0),
  fee_cents integer not null check (fee_cents >= 0),
  amount_cents integer not null check (amount_cents > 0),
  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.booking_other_half_payments enable row level security;
revoke all on public.booking_other_half_payments from public, anon, authenticated;
grant select on public.booking_other_half_payments to authenticated;
grant select, insert, update, delete on public.booking_other_half_payments to service_role;
create policy "The captain reads his other-half payment" on public.booking_other_half_payments
  for select to authenticated using (profile_id = auth.uid());

-- The pay-other-half Edge Function's plan: the amounts from the server, for
-- the lone captain, while the 24-hour choice is open.
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

-- The payment the Edge Function created, for exactly the plan's amount and
-- only over the payment it replaced.
create or replace function public.attach_other_half_intent(
  p_payment_id uuid,
  p_profile_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_expected_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.booking_other_half_payments;
begin
  select * into v_payment from public.booking_other_half_payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'payment_not_found';
  end if;
  perform public.plan_other_half_payment(v_payment.booking_id, p_profile_id);
  select * into v_payment from public.booking_other_half_payments where id = p_payment_id;
  if v_payment.stripe_payment_intent_id is distinct from p_expected_intent_id
     or p_amount_cents is distinct from v_payment.amount_cents then
    raise exception 'payment_changed';
  end if;
  update public.booking_other_half_payments set stripe_payment_intent_id = p_intent_id where id = p_payment_id;
end;
$$;

-- The verified webhook: the other half was paid. Recorded first, then
-- either it counts (the choice is made, side B is his) or it's given back.
create or replace function public.other_half_paid(
  p_payment_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_stripe_fee_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.booking_other_half_payments;
  v_booking public.venue_bookings;
  v_reason text;
begin
  select * into v_payment from public.booking_other_half_payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'payment_not_found';
  end if;
  if v_payment.status = 'paid' and v_payment.stripe_payment_intent_id = p_intent_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select * into v_booking from public.venue_bookings where id = v_payment.booking_id for update;
  perform public.record_intent_capture(v_booking.id, null, null, p_intent_id, p_amount_cents,
                                       least(v_payment.fee_cents, p_amount_cents), p_stripe_fee_cents, 'other_half_paid');

  v_reason := case
    when v_payment.status = 'paid' then 'already_paid'
    when p_intent_id is distinct from v_payment.stripe_payment_intent_id then 'replaced_intent'
    when v_booking.status = 'cancelled' then 'booking_cancelled'
    when v_booking.no_opponent_choice is not null then 'already_chosen'
    when exists (select 1 from public.booking_sides s where s.booking_id = v_booking.id and s.side = 'b') then 'opposition_found'
    when p_amount_cents is distinct from v_payment.amount_cents then 'amount_mismatch'
  end;
  if v_reason is not null then
    return jsonb_build_object('result', 'refund', 'reason', v_reason, 'booking_id', v_booking.id);
  end if;

  update public.booking_other_half_payments set status = 'paid', paid_at = now() where id = p_payment_id;
  update public.venue_bookings set no_opponent_choice = 'play_whole' where id = v_booking.id;
  insert into public.booking_sides (booking_id, side, captain_id, payment_mode, pitch_cents, players, accepted_at, paid_at)
  values (v_booking.id, 'b', v_payment.profile_id, 'pay_all', v_payment.pitch_cents, v_booking.capacity / 2, now(), now());
  return jsonb_build_object('result', 'paid', 'booking_id', v_booking.id);
end;
$$;

-- Which side a player invited by p_inviter joins on a half pitch: side B
-- when side B's captain invited him, except that a captain of both sides
-- (he paid the whole pitch) fills side A first.
create or replace function public.invite_side(p_booking_id uuid, p_inviter uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.booking_sides s
                     where s.booking_id = p_booking_id and s.side = 'b' and s.captain_id = p_inviter) then 'a'
    when not exists (select 1 from public.booking_sides s
                     where s.booking_id = p_booking_id and s.side = 'a' and s.captain_id = p_inviter) then 'b'
    when (select count(*) from public.booking_payment_shares sh
          where sh.booking_id = p_booking_id and sh.side = 'a'
            and sh.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'))
         < (select s.players from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'a') then 'a'
    else 'b'
  end;
$$;

-- As in 20261123183000_pay_b1c_no_opponent.sql, but "play_whole" is made
-- by paying (pay-other-half), never by this call.
create or replace function public.booking_no_opponent_choice(p_booking_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_side := public.half_pitch_lone_side(p_booking_id);
  if v_booking.id is null or v_side.captain_id is distinct from auth.uid() then
    raise exception 'not_your_booking';
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
  if p_choice = 'play_whole' then
    raise exception 'play_whole_needs_payment';  -- made by paying: pay-other-half, other_half_paid
  end if;
  if p_choice is distinct from 'cancel' then
    raise exception 'invalid_choice';
  end if;

  update public.venue_bookings set no_opponent_choice = 'cancel' where id = p_booking_id;
  perform public.booking_cancel_free(p_booking_id, 'Nobody took it on, so it was cancelled free and everyone gets their money back.');
  return jsonb_build_object('result', 'cancelled');
end;
$$;

-- As in 20261123180000_pay_b1c_opposition.sql, with invite_side.
CREATE OR REPLACE FUNCTION public.accept_invite(p_invite_id uuid)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.invites;
  v_booking public.venue_bookings;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite from public.invites where id = p_invite_id for update;
  if v_invite.id is null or v_invite.invited_profile_id <> auth.uid() then
    raise exception 'not_your_invite';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;

  if v_invite.kind = 'team' then
    -- Lock the team so two acceptances can't both take its last place.
    perform 1 from public.teams where id = v_invite.team_id for update;
    if not public.team_has_room(v_invite.team_id, v_invite.team_role, v_invite.id) then
      raise exception 'team_full';
    end if;
    insert into public.team_members (team_id, profile_id, role)
    values (v_invite.team_id, auth.uid(), v_invite.team_role)
    on conflict (team_id, profile_id) do nothing;
  else
    select * into v_booking from public.venue_bookings where id = v_invite.booking_id for update;
    -- A walk-in or phone booking is never an app booking.
    if v_booking.booking_type = 'counter' then
      raise exception 'counter_booking';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    if v_booking.booking_day < v_now::date
       or (v_booking.booking_day = v_now::date and v_booking.start_time <= v_now::time) then
      raise exception 'slot_in_past';
    end if;
    perform public.assert_venue_live(v_booking.venue_id);
    -- B1c: on a half pitch a player joins the side of the captain who
    -- invited him (a captain of both sides fills side A first).
    if v_booking.booking_kind = 'half' then
      perform public.add_booking_side_share_internal(v_invite.booking_id, auth.uid(),
        public.invite_side(v_invite.booking_id, v_invite.invited_by));
    else
      perform public.add_booking_share_internal(v_invite.booking_id, auth.uid());
    end if;
  end if;

  update public.invites set status = 'accepted', responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$function$;

revoke all on function public.plan_other_half_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.plan_other_half_payment(uuid, uuid) to service_role;
revoke all on function public.attach_other_half_intent(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.attach_other_half_intent(uuid, uuid, text, integer, text) to service_role;
revoke all on function public.other_half_paid(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.other_half_paid(uuid, text, integer, integer) to service_role;
revoke all on function public.invite_side(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_side(uuid, uuid) to service_role;
