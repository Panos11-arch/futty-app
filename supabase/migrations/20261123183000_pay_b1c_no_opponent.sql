-- B1c, part 2a (Booking v2, spec 13 "Invites, after payment", decided 20
-- and 23 November): no side B by 24 hours before kickoff. The captain left
-- on his own (side A's; side B's once part 2c lets side A leave) chooses:
--   * "Pay the whole pitch and play": one card payment at once, the other
--     half plus that half's players at his way to pay's fee (examples 6a and
--     6b). Its payment is part 2b; until then the choice is refused.
--   * "Cancel free": the booking is cancelled, nothing is kept, and what was
--     paid or held is given back by run-payment-jobs' release step.
-- No choice by 6 hours before kickoff = cancelled free. The same timing as
-- Gipedo Pano's decision 1 (rule_gipedo_opponent_lead, rule_refund_cutoff).
--
-- The other half is the half rounded down, as every Booking v2 split (Futty
-- absorbs an odd cent, decided 23 November).

alter table public.venue_bookings
  add column no_opponent_at timestamptz,
  add column no_opponent_choice text check (no_opponent_choice in ('play_whole', 'cancel', 'auto_cancel'));

insert into public.notification_types (type, always_sent) values ('no_opponent', true)
on conflict (type) do nothing;

-- The captain of a half pitch's lone side (no side B), or null.
create or replace function public.half_pitch_lone_side(p_booking_id uuid)
returns public.booking_sides
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.booking_sides s
  where s.booking_id = p_booking_id
    and (select count(*) from public.booking_sides o where o.booking_id = p_booking_id) = 1;
$$;

-- What "Pay the whole pitch and play" costs: the other half (rounded down)
-- and that half's players at the lone side's way to pay's fee.
create or replace function public.no_opponent_amounts(p_booking public.venue_bookings, p_side public.booking_sides,
                                                      out pitch_cents integer, out fee_cents integer, out amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p_booking.amount_cents / 2,
         public.money_fee_per_player_cents(p_side.payment_mode) * (p_booking.capacity / 2),
         p_booking.amount_cents / 2 + public.money_fee_per_player_cents(p_side.payment_mode) * (p_booking.capacity / 2);
$$;

-- The choice as the app shows it, from the server.
create or replace function public.booking_no_opponent_quote(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_money record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_side := public.half_pitch_lone_side(p_booking_id);
  if v_booking.id is null or v_side.captain_id is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;
  select * into v_money from public.no_opponent_amounts(v_booking, v_side);
  return jsonb_build_object(
    'booking_id', v_booking.id,
    'pitch_cents', v_money.pitch_cents,
    'fee_cents', v_money.fee_cents,
    'amount_cents', v_money.amount_cents,
    'due', v_booking.no_opponent_at is not null and v_booking.no_opponent_choice is null,
    'choose_by', public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff());
end;
$$;

-- Cancels a half pitch free: nothing is kept. What was paid or held stays
-- on its share for run-payment-jobs' release step, which gives it all back
-- (booking_money_to_release); covered spots and unstarted payments simply end.
create or replace function public.booking_cancel_free(p_booking_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_player uuid;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.status = 'cancelled' then
    return;
  end if;
  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and status = 'covered';
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and status = 'pending' and stripe_payment_intent_id is null;

  for v_player in
    select distinct s.profile_id from public.booking_payment_shares s where s.booking_id = p_booking_id
  loop
    perform public.send_notification(v_player, 'booking_cancelled', jsonb_build_object(
      'title', 'Game cancelled',
      'body', format('Your game at %s is cancelled. %s', public.booking_label(v_booking), p_body),
      'bookingId', p_booking_id));
  end loop;
end;
$$;

-- run-payment-jobs: 24 hours before kickoff, a confirmed half pitch with no
-- side B: the lone captain is asked to choose.
create or replace function public.booking_no_opponent_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_money record;
  v_count integer := 0;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.booking_kind = 'half' and b.status = 'confirmed' and b.no_opponent_at is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_gipedo_opponent_lead()
      and not exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b')
    for update of b
  loop
    v_side := public.half_pitch_lone_side(v_booking.id);
    if v_side.booking_id is null then
      continue;
    end if;
    update public.venue_bookings set no_opponent_at = now() where id = v_booking.id;
    select * into v_money from public.no_opponent_amounts(v_booking, v_side);
    perform public.send_notification(v_side.captain_id, 'no_opponent', jsonb_build_object(
      'title', 'No opponent yet',
      'body', format('Nobody has taken on your game at %s. Pay the whole pitch and play for %s more, or cancel free and '
                     || 'everyone gets their money back. If you don''t choose by %s before kickoff, it''s cancelled free.',
                     public.booking_label(v_booking), public.money_format_euros(v_money.amount_cents),
                     public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', v_booking.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The lone captain's choice. "play_whole" is paid in the app (part 2b).
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
    raise exception 'play_whole_not_available';  -- part 2b
  end if;
  if p_choice is distinct from 'cancel' then
    raise exception 'invalid_choice';
  end if;

  update public.venue_bookings set no_opponent_choice = 'cancel' where id = p_booking_id;
  perform public.booking_cancel_free(p_booking_id, 'Nobody took it on, so it was cancelled free and everyone gets their money back.');
  return jsonb_build_object('result', 'cancelled');
end;
$$;

-- run-payment-jobs: no choice by 6 hours before kickoff = cancelled free.
create or replace function public.booking_no_opponent_auto_cancel_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_count integer := 0;
begin
  for v_booking in
    select b.id from public.venue_bookings b
    where b.booking_kind = 'half' and b.status = 'confirmed'
      and b.no_opponent_at is not null and b.no_opponent_choice is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
    for update of b
  loop
    update public.venue_bookings set no_opponent_choice = 'auto_cancel' where id = v_booking;
    perform public.booking_cancel_free(v_booking,
      'Nobody took it on and no choice was made by ' || public.rule_duration_words(public.rule_refund_cutoff())
      || ' before kickoff, so it was cancelled free and everyone gets their money back.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.half_pitch_lone_side(uuid) from public, anon, authenticated;
grant execute on function public.half_pitch_lone_side(uuid) to service_role;
revoke all on function public.no_opponent_amounts(public.venue_bookings, public.booking_sides) from public, anon, authenticated;
grant execute on function public.no_opponent_amounts(public.venue_bookings, public.booking_sides) to service_role;
revoke all on function public.booking_cancel_free(uuid, text) from public, anon, authenticated;
grant execute on function public.booking_cancel_free(uuid, text) to service_role;
revoke all on function public.booking_no_opponent_due() from public, anon, authenticated;
grant execute on function public.booking_no_opponent_due() to service_role;
revoke all on function public.booking_no_opponent_auto_cancel_due() from public, anon, authenticated;
grant execute on function public.booking_no_opponent_auto_cancel_due() to service_role;
revoke all on function public.booking_no_opponent_quote(uuid) from public, anon;
grant execute on function public.booking_no_opponent_quote(uuid) to authenticated, service_role;
revoke all on function public.booking_no_opponent_choice(uuid, text) from public, anon;
grant execute on function public.booking_no_opponent_choice(uuid, text) to authenticated, service_role;
