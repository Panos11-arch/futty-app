-- B1d rules (spec 13 "Losers pay (Gipedo Pano in Booking v2)", decided by
-- Panos on 24 November; examples 12a-16 on the €40.00 5-a-side pitch):
--   1. "Pay the whole pitch and play" on Losers pay: an ordinary whole-pitch
--      booking with the same way to pay, no Losers pay, no payment sheet
--      (booking_no_opponent_choice 'play_whole', losers_pay_play_whole).
--      Paying for everyone: the captain's €45.50 hold is taken as the
--      payment. Paying for myself: each player's normal €4.80 is taken from
--      his hold and the rest released; the captain's guarantee is the
--      whole pitch's (€40.00) for unpaid spots, as on any whole pitch.
--   2. A pay-for-everyone side pulling out more than 6 hours before
--      kickoff: €1 per player of his side (€5.00) from the captain's hold.
--   3. Any side pulling out less than 6 hours before kickoff pays as the
--      losing side (losers_pay_settle_booking); the other side's holds are
--      released, the venue gets the full pitch, nothing reopens.
--   4. A side on its own pulling out: €1 per player of his side kept, the
--      rest released, the booking cancelled; once the 24-hour choice is
--      open, "Cancel free" instead.
--   5. Losers pay is booked 24 hours to 5 days ahead (book_slot,
--      booking_quote_v2).
--   6. A player leaving a pay-for-myself side after the captain's guarantee
--      was counted: the guarantee goes up by that spot (€9.60) and is held
--      again at once (guarantee_set_amount releases the old hold).
--   The app reads what leaving or pulling out costs from the server
--   (losers_pay_leave_quote, losers_pay_pull_out_quote) and, for the
--   no-opponent choice, what the holds pay (booking_v2_detail,
--   my_no_opponent_choices).
-- Also (B1e): publishing an open players post again counts the players who
-- already joined it (players_needed = joiners so far + open spots).
-- Re-created functions are copied from their latest migration with only
-- these changes: book_slot, booking_quote_v2, gipedo_settlement_done,
-- losers_pay_leave, losers_pay_pull_out (20261124110000_pay_b1d_losers_pay.sql),
-- booking_no_opponent_choice (20261123190000_pay_b1c_pay_whole.sql),
-- no_opponent_amounts (20261123183000_pay_b1c_no_opponent.sql),
-- booking_v2_detail, my_no_opponent_choices (20261124090000_pay_b3_after_pay.sql),
-- booking_no_opponent_due (20261124100000_pay_b4_posts.sql),
-- booking_side_left, publish_booking (20261123220000_pay_b1e_publish.sql).

alter table public.gipedo_settlements drop constraint gipedo_settlements_reason_check;
alter table public.gipedo_settlements add constraint gipedo_settlements_reason_check
  check (reason in ('lost', 'won', 'split', 'pull_out_fee', 'play_normal', 'left', 'play_whole'));

-- A guarantee's amount changed (rule 1: the whole pitch's; rule 6: one more
-- spot). Counted, and held for the new amount from p_hold_due_at: a hold
-- already placed is released (money_releases, run-payment-jobs) and placed
-- again, under a new idempotency key (the guarantee's next attempt).
create function public.guarantee_set_amount(p_guarantee_id uuid, p_amount_cents integer, p_hold_due_at timestamptz,
                                            p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
begin
  select * into v_guarantee from public.booking_guarantees where id = p_guarantee_id for update;
  if v_guarantee.id is null then
    return;
  end if;
  if v_guarantee.status = 'held' and v_guarantee.amount_cents = p_amount_cents then
    update public.booking_guarantees set counted = true where id = p_guarantee_id;
    return;
  end if;
  if v_guarantee.status = 'held' and v_guarantee.stripe_payment_intent_id is not null then
    insert into public.money_releases (booking_id, guarantee_id, stripe_intent_id, reason)
    values (v_guarantee.booking_id, v_guarantee.id, v_guarantee.stripe_payment_intent_id, p_reason)
    on conflict (stripe_intent_id) where status = 'pending' do nothing;
  end if;
  update public.booking_guarantees
  set amount_cents = p_amount_cents, counted = true, hold_due_at = p_hold_due_at,
      status = case when stripe_payment_method_id is null then 'awaiting_card' else 'scheduled' end,
      next_attempt_at = case when stripe_payment_method_id is null then null else greatest(now(), p_hold_due_at) end,
      stripe_payment_intent_id = null, held_at = null, last_error = null, failure_notified_at = null
  where id = p_guarantee_id;
end;
$$;

-- What "Pay the whole pitch and play" takes on Losers pay, from the holds:
-- paying for everyone, the captain's hold; paying for myself, the
-- captain's own normal share and each player's (half his hold), with the
-- whole pitch's guarantee for unpaid spots.
create function public.losers_pay_play_whole_amounts(p_booking public.venue_bookings, p_side public.booking_sides,
                                                     out taken_cents integer, out player_cents integer,
                                                     out guarantee_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hold integer;
begin
  select s.pitch_cents + s.fee_cents into v_hold from public.booking_payment_shares s
  where s.booking_id = p_booking.id and s.profile_id = p_side.captain_id and s.gipedo_side is not null
    and s.status in ('pending', 'authorized', 'expired');
  if p_side.payment_mode = 'pay_all' then
    taken_cents := v_hold;
  else
    taken_cents := (select (s.pitch_cents / 2) + (s.fee_cents / 2) from public.booking_payment_shares s
                    where s.booking_id = p_booking.id and s.profile_id = p_side.captain_id and s.gipedo_side is not null
                      and s.status in ('pending', 'authorized', 'expired'));
    player_cents := (select (m.pitch_cents / 2) + (m.fee_cents / 2)
                     from public.money_losers_pay_hold(p_booking.amount_cents, p_booking.capacity, 'each_pays_responsible',
                                                       false, false) m);
    guarantee_cents := p_booking.amount_cents;
  end if;
end;
$$;

-- What "Pay the whole pitch and play" is, in a notification's words.
create function public.no_opponent_play_words(p_booking public.venue_bookings, p_side public.booking_sides)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_money record;
  v_lp record;
begin
  if p_booking.losers_pay then
    select * into v_lp from public.losers_pay_play_whole_amounts(p_booking, p_side);
    if p_side.payment_mode = 'pay_all' then
      return format('Play it as a whole pitch (your %s hold is the payment)', public.money_format_euros(v_lp.taken_cents));
    end if;
    return format('Play it as a whole pitch (each player pays %s from his hold, and your %s guarantee covers unpaid spots)',
                  public.money_format_euros(v_lp.player_cents), public.money_format_euros(v_lp.guarantee_cents));
  end if;
  select * into v_money from public.no_opponent_amounts(p_booking, p_side);
  return format('Pay the whole pitch and play for %s more', public.money_format_euros(v_money.amount_cents));
end;
$$;

-- As in 20261123183000_pay_b1c_no_opponent.sql, plus 24 November: on
-- Losers pay nothing more is paid (the holds pay for the whole pitch).
create or replace function public.no_opponent_amounts(p_booking public.venue_bookings, p_side public.booking_sides,
                                                      out pitch_cents integer, out fee_cents integer, out amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_booking.losers_pay then 0 else p_booking.amount_cents / 2 end,
         case when p_booking.losers_pay then 0
              else public.money_fee_per_player_cents(p_side.payment_mode) * (p_booking.capacity / 2) end,
         case when p_booking.losers_pay then 0
              else p_booking.amount_cents / 2 + public.money_fee_per_player_cents(p_side.payment_mode) * (p_booking.capacity / 2) end;
$$;

-- Rule 1 (24 November): "Pay the whole pitch and play" on Losers pay. The
-- booking becomes an ordinary whole-pitch booking with the lone side's way
-- to pay, no Losers pay. Its holds are taken by the Gipedo Pano machinery
-- ('play_whole' settlements, keyed on the settlement id at Stripe, in the
-- ledger): paying for everyone, the captain's hold in full; paying for
-- myself, each player's normal share (half his hold), the rest released,
-- and the captain's guarantee becomes the whole pitch's.
create function public.losers_pay_play_whole(p_booking_id uuid)
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
  v_lp record;
  v_pitch integer;
  v_fee integer;
  v_open integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_side := public.half_pitch_lone_side(p_booking_id);
  select * into v_lp from public.losers_pay_play_whole_amounts(v_booking, v_side);

  for v_share in
    select * from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.side = v_side.side and s.gipedo_side is not null
      and s.status in ('authorized', 'expired')
      and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id)
    order by s.created_at
    for update
  loop
    if v_side.payment_mode = 'pay_all' then
      v_pitch := v_share.pitch_cents;
      v_fee := v_share.fee_cents;
    else
      -- His normal share: half his hold.
      v_pitch := v_share.pitch_cents / 2;
      v_fee := v_share.fee_cents / 2;
      update public.booking_payment_shares set pitch_cents = v_pitch, fee_cents = v_fee, amount_cents = v_pitch + v_fee
      where id = v_share.id;
    end if;
    insert into public.gipedo_settlements
      (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
    values (p_booking_id, v_share.id, v_share.profile_id, v_side.side, 'play_whole', v_pitch + v_fee, v_pitch, v_fee);
  end loop;

  if v_side.payment_mode = 'each_pays_responsible' then
    -- Players who haven't held yet pay their normal share, as on any whole pitch.
    update public.booking_payment_shares
    set pitch_cents = pitch_cents / 2, fee_cents = fee_cents / 2, amount_cents = (pitch_cents / 2) + (fee_cents / 2),
        gipedo_side = null
    where booking_id = p_booking_id and side = v_side.side and gipedo_side is not null and status = 'pending';
    select * into v_guarantee from public.booking_guarantees
    where booking_id = p_booking_id and profile_id = v_side.captain_id;
    if v_guarantee.id is null then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (p_booking_id, v_side.captain_id, v_booking.amount_cents,
              public.money_guarantee_hold_due_at(v_booking.created_at,
                                                 public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)));
    else
      perform public.guarantee_set_amount(v_guarantee.id, v_booking.amount_cents,
        public.money_guarantee_hold_due_at(v_booking.created_at,
                                           public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)),
        'losers_pay_play_whole');
    end if;
  end if;

  update public.booking_payment_shares set side = null where booking_id = p_booking_id;
  delete from public.booking_sides where booking_id = p_booking_id;
  update public.venue_bookings
  set losers_pay = false, booking_kind = 'whole', no_opponent_choice = 'play_whole', created_by = v_side.captain_id
  where id = p_booking_id;
  update public.squad_posts set status = 'closed'
  where venue_booking_id = p_booking_id and type = 'opposition' and status = 'open';
  -- An open players post now has the whole pitch's open spots (and its joiners).
  v_open := v_booking.capacity - (select count(*) from public.booking_payment_shares s
                                  where s.booking_id = p_booking_id
                                    and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'));
  update public.squad_posts p
  set side = null,
      players_needed = greatest(v_open, 0) + (select count(*) from public.squad_post_joiners j where j.post_id = p.id),
      total = greatest(v_open, 0) + (select count(*) from public.squad_post_joiners j where j.post_id = p.id)
  where p.venue_booking_id = p_booking_id and p.type = 'players' and p.status = 'open';

  return jsonb_build_object('result', 'play_whole', 'booking_id', p_booking_id, 'payment_mode', v_side.payment_mode,
                            'taken_cents', v_lp.taken_cents, 'player_cents', v_lp.player_cents,
                            'guarantee_cents', v_lp.guarantee_cents);
end;
$$;

-- As in 20261123190000_pay_b1c_pay_whole.sql, plus 24 November: on Losers
-- pay, "play_whole" is this call (the holds pay for it, no payment sheet).
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
  if p_choice = 'play_whole' and v_booking.losers_pay then
    return public.losers_pay_play_whole(p_booking_id);  -- 24 November
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

-- What a player leaving takes from his hold (rule 1 of 23 November): his
-- normal share (half his hold) as today, free in his first hour, then €1
-- kept and the rest venue credit, less than 6 hours before kickoff nothing
-- back; the rest of his hold released.
create function public.losers_pay_leave_amounts(p_share public.booking_payment_shares, p_kickoff timestamptz,
                                                out leave_window text, out held_cents integer, out capture_cents integer,
                                                out venue_cents integer, out futty_cents integer, out credit_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window_share public.booking_payment_shares := p_share;
  v_pitch integer := p_share.pitch_cents / 2;
  v_fee integer := p_share.fee_cents / 2;
begin
  held_cents := p_share.pitch_cents + p_share.fee_cents;
  v_window_share.capture_due_at := null;
  leave_window := public.cancellation_window(v_window_share, p_kickoff, now());
  capture_cents := 0;
  credit_cents := 0;
  if leave_window = 'middle' then
    capture_cents := v_pitch + v_fee;
    credit_cents := capture_cents - least(public.rule_cancel_fee_cents(), capture_cents);
  elsif leave_window = 'late' then
    capture_cents := v_pitch + v_fee;
  end if;
  venue_cents := case when capture_cents > 0 then v_pitch else 0 end;
  futty_cents := case when capture_cents > 0 then v_fee else 0 end;
end;
$$;

-- The caller's Losers pay share he could leave, checked as losers_pay_leave does.
create function public.losers_pay_leaving_share(p_booking public.venue_bookings, p_uid uuid)
returns public.booking_payment_shares
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
begin
  if p_booking.id is null or not p_booking.losers_pay then
    raise exception 'not_losers_pay';
  end if;
  if now() >= public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) then
    raise exception 'booking_started';
  end if;
  select * into v_share from public.booking_payment_shares
  where booking_id = p_booking.id and profile_id = p_uid
    and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due');
  if v_share.id is null then
    raise exception 'not_in_booking';
  end if;
  if exists (select 1 from public.booking_sides s where s.booking_id = p_booking.id and s.side = v_share.side
             and s.captain_id = p_uid) then
    raise exception 'captain_pulls_out_side';
  end if;
  return v_share;
end;
$$;

-- What leaving costs, for the app's confirmation (the server's amounts).
create function public.losers_pay_leave_quote(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_share := public.losers_pay_leaving_share(v_booking, auth.uid());
  if v_share.status <> 'authorized' or v_share.gipedo_side is null then
    -- Nothing held (his side paid for everyone, or he never held): his spot is simply free again.
    return jsonb_build_object('booking_id', p_booking_id, 'held', false, 'window', null, 'held_cents', 0,
                              'capture_cents', 0, 'credit_cents', 0, 'released_cents', 0);
  end if;
  select * into v from public.losers_pay_leave_amounts(v_share,
    public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time));
  return jsonb_build_object('booking_id', p_booking_id, 'held', true, 'window', v.leave_window,
                            'held_cents', v.held_cents, 'capture_cents', v.capture_cents, 'credit_cents', v.credit_cents,
                            'released_cents', v.held_cents - v.capture_cents,
                            'venue_name', (select name from public.venues where id = v_booking.venue_id));
end;
$$;

-- As in 20261124110000_pay_b1d_losers_pay.sql (rule 1 of 23 November), plus
-- rule 6 (24 November): a player leaving a pay-for-myself side after his
-- captain's guarantee was counted: the captain's guarantee goes up by that
-- spot, at the same per-spot amount (€9.60), and is held at once.
create or replace function public.losers_pay_leave(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_side public.booking_sides;
  v_guarantee public.booking_guarantees;
  v_spot record;
  v record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_share := public.losers_pay_leaving_share(v_booking, auth.uid());
  select * into v_share from public.booking_payment_shares where id = v_share.id for update;
  select * into v_side from public.booking_sides where booking_id = p_booking_id and side = v_share.side;

  delete from public.squad_post_joiners j using public.squad_posts p
  where j.post_id = p.id and p.venue_booking_id = p_booking_id and j.profile_id = auth.uid();

  if v_share.status <> 'authorized' or v_share.gipedo_side is null then
    update public.booking_payment_shares set status = 'cancelled' where id = v_share.id;
    return jsonb_build_object('result', 'left', 'capture_cents', 0, 'credit_cents', 0);
  end if;
  if exists (select 1 from public.gipedo_settlements g where g.share_id = v_share.id) then
    raise exception 'already_settled';
  end if;

  select * into v from public.losers_pay_leave_amounts(v_share,
    public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time));
  insert into public.gipedo_settlements
    (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents, credit_cents)
  values (p_booking_id, v_share.id, v_share.profile_id, v_share.side, 'left', v.capture_cents, v.venue_cents,
          v.futty_cents, v.credit_cents);

  -- Rule 6: his spot was counted as held; now the captain covers it.
  if v_side.payment_mode = 'each_pays_responsible' then
    select * into v_guarantee from public.booking_guarantees
    where booking_id = p_booking_id and profile_id = v_side.captain_id and counted;
    if v_guarantee.id is not null then
      select * into v_spot from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity,
                                                             'each_pays_responsible', false, false);
      perform public.guarantee_set_amount(v_guarantee.id,
        case when v_guarantee.status = 'cancelled' then 0 else v_guarantee.amount_cents end + v_spot.card_cents,
        now(), 'losers_pay_player_left');
    end if;
  end if;
  return jsonb_build_object('result', 'left', 'capture_cents', v.capture_cents, 'credit_cents', v.credit_cents);
end;
$$;

-- How a side's pull-out goes (24 November): 'fee' (an opponent, more than
-- 6 hours before kickoff: €1 per player), 'lost' (an opponent, less than 6
-- hours: as the losing side), 'alone' (no opponent, before the 24-hour
-- choice: €1 per player, the booking cancelled) or 'cancel_free' (no
-- opponent once the 24-hour choice is open).
create function public.losers_pay_pull_out_kind(p_booking public.venue_bookings, p_side public.booking_sides)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.booking_sides s
                 where s.booking_id = p_booking.id and s.side <> p_side.side and s.left_at is null) then
      case when now() >= public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) - public.rule_refund_cutoff()
           then 'lost' else 'fee' end
    when now() >= public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) - public.rule_gipedo_opponent_lead()
      then 'cancel_free'
    else 'alone'
  end;
$$;

-- The caller's side he could pull out, checked as losers_pay_pull_out does.
create function public.losers_pay_pulling_side(p_booking public.venue_bookings, p_uid uuid)
returns public.booking_sides
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_side public.booking_sides;
begin
  if p_booking.id is null or not p_booking.losers_pay then
    raise exception 'not_losers_pay';
  end if;
  if p_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  select * into v_side from public.booking_sides
  where booking_id = p_booking.id and captain_id = p_uid and left_at is null
  order by side limit 1;
  if v_side.booking_id is null then
    raise exception 'not_your_booking';
  end if;
  if now() >= public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) then
    raise exception 'booking_started';
  end if;
  return v_side;
end;
$$;

-- What pulling the side out takes, for the app's confirmation: what is
-- taken from the side's holds (and the captain's guarantee) and what is
-- released, from the server.
create function public.losers_pay_pull_out_quote(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_kind text;
  v_spot record;
  v_held integer;
  v_holds integer;
  v_capture integer := 0;
  v_guarantee public.booking_guarantees;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_side := public.losers_pay_pulling_side(v_booking, auth.uid());
  v_kind := public.losers_pay_pull_out_kind(v_booking, v_side);
  select * into v_spot from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity, 'each_pays_responsible',
                                                         false, false);
  select count(*), coalesce(sum(s.pitch_cents + s.fee_cents), 0) into v_holds, v_held
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.side = v_side.side and s.gipedo_side is not null and s.status = 'authorized'
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id);

  if v_kind in ('fee', 'alone') then
    if v_side.payment_mode = 'pay_all' then
      v_capture := least(public.rule_cancel_fee_cents() * v_side.players, v_held);
    else
      v_capture := (select coalesce(sum(least(public.rule_cancel_fee_cents(), s.pitch_cents + s.fee_cents)), 0)
                    from public.booking_payment_shares s
                    where s.booking_id = p_booking_id and s.side = v_side.side and s.gipedo_side is not null
                      and s.status = 'authorized'
                      and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id));
    end if;
  elsif v_kind = 'lost' then
    v_capture := v_held;
    if v_side.payment_mode = 'each_pays_responsible' then
      select * into v_guarantee from public.booking_guarantees
      where booking_id = p_booking_id and profile_id = v_side.captain_id and status <> 'cancelled';
      if v_guarantee.id is not null then
        -- Counted at once if it isn't yet: the spots without a hold, at most the guarantee.
        v_capture := v_capture + least(v_guarantee.amount_cents, greatest(v_side.players - v_holds, 0) * v_spot.card_cents);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'booking_id', p_booking_id, 'kind', v_kind, 'side', v_side.side, 'payment_mode', v_side.payment_mode,
    'players', v_side.players, 'fee_per_player_cents', public.rule_cancel_fee_cents(),
    'held_cents', v_held, 'capture_cents', v_capture,
    'released_cents', case when v_kind = 'lost' then 0 else v_held - v_capture end,
    'cancels_booking', v_kind in ('alone', 'cancel_free'),
    'cutoff_at', public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff());
end;
$$;

-- As in 20261124110000_pay_b1d_losers_pay.sql (rule 2 of 23 November), plus
-- the rules of 24 November: a pay-for-everyone side pays €1 per player of
-- his side from the captain's hold; less than 6 hours before kickoff a side
-- pays as the losing side; a side on its own pays the €1 per player and
-- the booking is cancelled, or once the 24-hour choice is open it's
-- cancelled free.
create or replace function public.losers_pay_pull_out(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_other public.booking_sides;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_kind text;
  v_fee integer;
  v_count integer := 0;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_side := public.losers_pay_pulling_side(v_booking, auth.uid());
  v_kind := public.losers_pay_pull_out_kind(v_booking, v_side);

  if v_kind = 'cancel_free' then
    -- Rule 4: once the 24-hour choice is open, "Cancel free" instead.
    update public.venue_bookings set no_opponent_choice = 'cancel' where id = p_booking_id;
    perform public.booking_cancel_free(p_booking_id, 'The captain cancelled it free, so everyone gets their money back.');
    return jsonb_build_object('result', 'cancelled_free', 'holds', 0);
  end if;

  if v_kind = 'lost' then
    -- Rule 3: as the losing side. Its guarantee is counted first if due.
    perform public.losers_pay_count_guarantees();
    v_count := public.losers_pay_settle_booking(p_booking_id, case when v_side.side = 'a' then 'side_b_won' else 'side_a_won' end);
    update public.booking_payment_shares set status = 'cancelled'
    where booking_id = p_booking_id and side = v_side.side and status in ('pending', 'covered');
    update public.squad_posts set status = 'closed'
    where venue_booking_id = p_booking_id and type = 'players' and side = v_side.side and status = 'open';
    update public.booking_sides set left_at = now() where booking_id = p_booking_id and side = v_side.side;
    select * into v_other from public.booking_sides where booking_id = p_booking_id and side <> v_side.side;
    select coalesce(username, full_name, 'The other captain') into v_name from public.profiles where id = auth.uid();
    perform public.send_notification(v_other.captain_id, 'opposition_left', jsonb_build_object(
      'title', 'The other side pulled out',
      'body', format('%s pulled their side out of %s less than %s before kickoff, so they pay the pitch and your holds '
                     || 'are released. Your game goes ahead.',
                     v_name, public.booking_label(v_booking), public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', p_booking_id));
    return jsonb_build_object('result', 'lost', 'holds', v_count);
  end if;

  -- 'fee' and 'alone': €1 per player of his side.
  for v_share in
    select * from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.side = v_side.side and s.gipedo_side is not null and s.status = 'authorized'
      and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id)
    order by s.created_at
    for update
  loop
    if v_side.payment_mode = 'pay_all' then
      -- Rule 2 (24 November): from the captain's hold, for every player of his side.
      v_fee := least(public.rule_cancel_fee_cents() * v_side.players, v_share.pitch_cents + v_share.fee_cents);
    else
      -- Rule 2 (23 November): from each player's own hold.
      v_fee := least(public.rule_cancel_fee_cents(), v_share.pitch_cents + v_share.fee_cents);
    end if;
    insert into public.gipedo_settlements
      (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
    values (p_booking_id, v_share.id, v_share.profile_id, v_side.side, 'pull_out_fee', v_fee, 0, v_fee);
    v_count := v_count + 1;
  end loop;
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and side = v_side.side and status in ('pending', 'covered');

  if v_kind = 'alone' then
    -- Rule 4: nobody is left, so the booking is cancelled; the release step
    -- gives back the guarantee and whatever isn't being settled.
    update public.squad_posts set status = 'closed' where venue_booking_id = p_booking_id and status = 'open';
    perform public.booking_cancel_free(p_booking_id,
      format('The captain pulled the side out, so %s per player was kept and the rest is released.',
             public.money_format_euros(public.rule_cancel_fee_cents())));
    return jsonb_build_object('result', 'cancelled', 'holds', v_count);
  end if;

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

-- As in 20261124090000_pay_b3_after_pay.sql, plus 24 November: on Losers
-- pay, what the holds pay for the whole pitch.
drop function public.my_no_opponent_choices();
create function public.my_no_opponent_choices()
returns table (
  booking_id uuid,
  venue_name text,
  booking_day date,
  start_time time,
  end_time time,
  pitch_label text,
  amount_cents integer,
  choose_by timestamptz,
  losers_pay boolean,
  payment_mode text,
  taken_cents integer,
  player_cents integer,
  guarantee_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, v.name, b.booking_day, b.start_time, b.end_time,
         public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp where bp.booking_id = b.id)),
         (public.no_opponent_amounts(b, l)).amount_cents,
         public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff(),
         b.losers_pay, l.payment_mode,
         case when b.losers_pay then (public.losers_pay_play_whole_amounts(b, l)).taken_cents end,
         case when b.losers_pay then (public.losers_pay_play_whole_amounts(b, l)).player_cents end,
         case when b.losers_pay then (public.losers_pay_play_whole_amounts(b, l)).guarantee_cents end
  from public.venue_bookings b
  join public.venues v on v.id = b.venue_id
  cross join lateral public.half_pitch_lone_side(b.id) l
  where b.booking_kind = 'half' and b.status = 'confirmed'
    and b.no_opponent_at is not null and b.no_opponent_choice is null
    and l.captain_id = auth.uid()
    and now() < public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
  order by b.booking_day, b.start_time;
$$;

-- As in 20261124110000_pay_b1d_losers_pay.sql, plus rule 5 (24 November): Losers pay at least 24 hours ahead.
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
    -- 24 November: and at least 24 hours ahead, as today's Gipedo Pano.
    if public.booking_kickoff_at(p_day, p_start) < now() + public.rule_gipedo_opponent_lead() then
      raise exception 'losers_pay_too_soon';
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

-- As in 20261124110000_pay_b1d_losers_pay.sql, plus rule 5: Losers pay is offered 24 hours to 5 days ahead.
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
        'available', public.half_pitch_enabled() and v_kickoff <= now() + public.rule_gipedo_max_ahead()
                     and v_kickoff >= now() + public.rule_gipedo_opponent_lead(),  -- 24 November: 24 hours to 5 days ahead
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

-- As in 20261124090000_pay_b3_after_pay.sql, plus 24 November: whether it's Losers pay and, on Losers pay, what the holds pay for the whole pitch.
create or replace function public.booking_v2_detail(p_booking_id uuid, p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_lone public.booking_sides;
  v_money record;
  v_captain_of text;
  v_my_side text;
  v_cutoff timestamptz;
  v_lp record;  -- 24 November: Losers pay, played as a whole pitch
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.booking_kind is null then
    return null;
  end if;
  v_cutoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff();

  select s.side into v_captain_of from public.booking_sides s
  where s.booking_id = p_booking_id and s.captain_id = p_uid and s.left_at is null
  order by s.side limit 1;
  select s.side into v_my_side from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.profile_id = p_uid
    and s.status in ('pending', 'authorized', 'paid', 'covered');

  select null::integer as pitch_cents, null::integer as fee_cents, null::integer as amount_cents into v_money;
  select null::integer as taken_cents, null::integer as player_cents, null::integer as guarantee_cents into v_lp;
  if v_booking.booking_kind = 'half' then
    v_lone := public.half_pitch_lone_side(p_booking_id);
    if v_lone.captain_id = p_uid then
      select * into v_money from public.no_opponent_amounts(v_booking, v_lone);
      if v_booking.losers_pay then
        select * into v_lp from public.losers_pay_play_whole_amounts(v_booking, v_lone);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'kind', v_booking.booking_kind,
    'losers_pay', v_booking.losers_pay,  -- 24 November: the app's ways out of a Losers pay game
    'pitch_label', public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp
                                                   where bp.booking_id = p_booking_id)),
    'captain_of', v_captain_of,
    'my_side', coalesce(v_my_side, v_captain_of),
    -- Each side: its captain, his team, its way to pay and whether the
    -- captain's own payment is held (not yet taken) or paid.
    'sides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'side', s.side,
               'captain', jsonb_build_object('id', p.id, 'name', coalesce(p.full_name, p.username)),
               'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = s.team_id),
               'payment_mode', s.payment_mode,
               'players', s.players,
               'state', case
                          when s.left_at is not null then 'left'
                          when cs.status = 'paid' then 'paid'
                          when cs.status = 'authorized' then 'held'
                          when s.paid_at is not null then 'paid'
                          else 'unpaid' end)
             order by s.side)
      from public.booking_sides s
      join public.profiles p on p.id = s.captain_id
      left join public.booking_payment_shares cs
        on cs.booking_id = s.booking_id and cs.profile_id = s.captain_id and cs.side = s.side
      where s.booking_id = p_booking_id), '[]'::jsonb),
    -- Which side each player in the roster is on (by share id).
    'roster_sides', coalesce((
      select jsonb_object_agg(s.id, s.side) from public.booking_payment_shares s
      where s.booking_id = p_booking_id and s.side is not null), '{}'::jsonb),
    'opposition', case when v_booking.booking_kind = 'half' then jsonb_build_object(
      'found', exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'b'
                       and s.left_at is null),
      'open', public.opposition_open_error(v_booking) is null
              and not exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'b'),
      'invited', (select count(*) from public.booking_opposition_invites i where i.booking_id = p_booking_id)) end,
    -- The open posts the caller can unpublish: his side's players post and,
    -- for side A's captain, the opposition post.
    'posts', jsonb_build_object(
      'players', (select sp.id from public.squad_posts sp
                  where sp.venue_booking_id = p_booking_id and sp.type = 'players' and sp.status = 'open'
                    and sp.side is not distinct from (case when v_booking.booking_kind = 'half' then v_captain_of end)
                    and (v_captain_of is not null or v_booking.created_by = p_uid)
                  limit 1),
      'opposition', (select sp.id from public.squad_posts sp
                     where sp.venue_booking_id = p_booking_id and sp.type = 'opposition' and sp.status = 'open'
                       and v_captain_of = 'a'
                     limit 1)),
    'no_opponent', case when v_money.amount_cents is not null then jsonb_build_object(
      'due', v_booking.status = 'confirmed' and v_booking.no_opponent_at is not null
             and v_booking.no_opponent_choice is null and now() < v_cutoff,
      'choice', v_booking.no_opponent_choice,
      'pitch_cents', v_money.pitch_cents,
      'fee_cents', v_money.fee_cents,
      'amount_cents', v_money.amount_cents,
      'choose_by', v_cutoff,
      -- 24 November: on Losers pay the holds pay for the whole pitch (nothing more to pay).
      'losers_pay', v_booking.losers_pay,
      'taken_cents', v_lp.taken_cents,
      'player_cents', v_lp.player_cents,
      'guarantee_cents', v_lp.guarantee_cents) end
  );
end;
$$;

-- As in 20261124100000_pay_b4_posts.sql, plus 24 November: the Losers pay words (no_opponent_play_words).
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
    -- B4: opposition posts close 24 hours before kickoff.
    update public.squad_posts set status = 'closed'
    where venue_booking_id = v_booking.id and type = 'opposition' and status = 'open';
    v_side := public.half_pitch_lone_side(v_booking.id);
    if v_side.booking_id is null then
      continue;
    end if;
    update public.venue_bookings set no_opponent_at = now() where id = v_booking.id;
    select * into v_money from public.no_opponent_amounts(v_booking, v_side);
    perform public.send_notification(v_side.captain_id, 'no_opponent', jsonb_build_object(
      'title', 'No opponent yet',
      'body', format('Nobody has taken on your game at %s. %s, or cancel free and '
                     || 'everyone gets their money back. If you don''t choose by %s before kickoff, it''s cancelled free.',
                     public.booking_label(v_booking), public.no_opponent_play_words(v_booking, v_side),
                     public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', v_booking.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- As in 20261123220000_pay_b1e_publish.sql, plus 24 November: the Losers pay words (no_opponent_play_words).
create or replace function public.booking_side_left(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_left public.booking_sides;
  v_stays public.booking_sides;
  v_kickoff timestamptz;
  v_name text;
  v_money record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  select * into v_left from public.booking_sides
  where booking_id = p_booking_id and captain_id = p_profile_id and left_at is null order by side limit 1;
  select * into v_stays from public.booking_sides
  where booking_id = p_booking_id and side <> v_left.side and left_at is null;
  if v_left.booking_id is null or v_stays.booking_id is null then
    return;
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  select coalesce(username, full_name, 'The other captain') into v_name from public.profiles where id = p_profile_id;

  -- Under 6 hours: nothing comes back and nothing reopens; the game goes ahead.
  if now() >= v_kickoff - public.rule_refund_cutoff() then
    update public.booking_sides set left_at = now() where booking_id = p_booking_id and side = v_left.side;
    perform public.send_notification(v_stays.captain_id, 'opposition_left', jsonb_build_object(
      'title', 'The other side cancelled',
      'body', format('%s cancelled their side of %s less than %s before kickoff. Your game goes ahead.',
                     v_name, public.booking_label(v_booking), public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', p_booking_id));
    return;
  end if;

  delete from public.booking_sides where booking_id = p_booking_id and side = v_left.side;
  if v_left.side = 'a' then
    -- Side B keeps the slot: it becomes side A, its captain the booker.
    update public.booking_sides set side = 'a' where booking_id = p_booking_id and side = 'b';
    update public.booking_payment_shares set side = 'a' where booking_id = p_booking_id and side = 'b';
    update public.booking_payment_shares set is_booker = (profile_id = v_stays.captain_id)
    where booking_id = p_booking_id and (is_booker or profile_id = v_stays.captain_id);
    update public.venue_bookings set created_by = v_stays.captain_id where id = p_booking_id;
    v_stays.side := 'a';
  end if;
  perform public.reopen_opposition_post(p_booking_id);  -- B1e

  if now() >= v_kickoff - public.rule_gipedo_opponent_lead() then
    -- Within 24 hours: the 24-hour choice applies again.
    update public.venue_bookings set no_opponent_at = now(), no_opponent_choice = null where id = p_booking_id;
    select * into v_booking from public.venue_bookings where id = p_booking_id;
    select * into v_money from public.no_opponent_amounts(v_booking, v_stays);
    perform public.send_notification(v_stays.captain_id, 'no_opponent', jsonb_build_object(
      'title', 'No opponent any more',
      'body', format('%s cancelled their side of %s. %s, or cancel free and '
                     || 'everyone gets their money back. If you don''t choose by %s before kickoff, it''s cancelled free.',
                     v_name, public.booking_label(v_booking), public.no_opponent_play_words(v_booking, v_stays),
                     public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', p_booking_id));
  else
    update public.venue_bookings set no_opponent_at = null, no_opponent_choice = null where id = p_booking_id;
  end if;

  perform public.send_notification(v_stays.captain_id, 'opposition_left', jsonb_build_object(
    'title', case when v_left.side = 'a' then 'The slot is yours' else 'Your opponent cancelled' end,
    'body', case when v_left.side = 'a'
                 then format('%s cancelled their half of %s. The slot is yours: invite an opponent.', v_name, public.booking_label(v_booking))
                 else format('%s cancelled their side of %s, so your invite is open again.', v_name, public.booking_label(v_booking)) end,
    'bookingId', p_booking_id));
end;
$$;

-- As in 20261123220000_pay_b1e_publish.sql, plus the B1e fix: publishing an open players post again counts its joiners.
create or replace function public.publish_booking(p_booking_id uuid, p_kind text)
returns public.squad_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_error text;
  v_needed integer;
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_kind is null or p_kind not in ('players', 'opposition') then
    raise exception 'invalid_kind';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.booking_kind is null then
    raise exception 'not_found';
  end if;
  if v_booking.booking_kind = 'half' then
    select * into v_side from public.booking_sides
    where booking_id = p_booking_id and captain_id = auth.uid() and left_at is null
    order by side limit 1;
    if v_side.booking_id is null or (p_kind = 'opposition' and v_side.side <> 'a') then
      raise exception 'not_your_booking';
    end if;
  elsif v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  if p_kind = 'opposition' then
    v_error := public.opposition_open_error(v_booking);
    if v_error is not null then
      raise exception '%', v_error;
    end if;
    if exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'b') then
      raise exception 'opposition_found';
    end if;
    select * into v_post from public.squad_posts
    where venue_booking_id = p_booking_id and type = 'opposition' and status = 'open';
    if v_post.id is null then
      insert into public.squad_posts (type, venue_id, scheduled_at, format, status, posted_by, venue_booking_id,
                                      players_needed, total, filled, side)
      values ('opposition', v_booking.venue_id, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time),
              v_booking.format, 'open', auth.uid(), p_booking_id, v_booking.capacity / 2, v_booking.capacity / 2, 0, 'b')
      returning * into v_post;
    end if;
    return v_post;
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  if v_side.side = 'b' and v_side.paid_at is null then
    raise exception 'side_not_paid';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'booking_started';
  end if;
  v_needed := coalesce(v_side.players, v_booking.capacity)
    - (select count(*) from public.booking_payment_shares s
       where s.booking_id = p_booking_id and (v_side.side is null or s.side = v_side.side)
         and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'));
  if v_needed <= 0 then
    raise exception 'booking_full';
  end if;

  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'players' and status = 'open' and side is not distinct from v_side.side;
  if v_post.id is not null then
    -- 24 November: the players who already joined it count too, or the next
    -- joiner would find it full (squad_full): joiners so far + open spots.
    v_needed := v_needed + (select count(*) from public.squad_post_joiners j
                            where j.post_id = v_post.id
                              and exists (select 1 from public.booking_payment_shares s
                                          where s.booking_id = p_booking_id and s.profile_id = j.profile_id
                                            and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')));
    update public.squad_posts set players_needed = v_needed, total = v_needed where id = v_post.id returning * into v_post;
    return v_post;
  end if;
  insert into public.squad_posts (type, venue_id, scheduled_at, format, status, posted_by, venue_booking_id,
                                  players_needed, total, filled, side)
  values ('players', v_booking.venue_id, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time),
          v_booking.format, 'open', auth.uid(), p_booking_id, v_needed, v_needed, 0, v_side.side)
  returning * into v_post;
  return v_post;
end;
$$;

-- As in 20261124110000_pay_b1d_losers_pay.sql, plus rule 1 (24 November): a 'play_whole' settlement makes the share an ordinary one.
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
  v_name := case when v_booking.losers_pay or v_row.reason = 'play_whole' then 'Losers pay' else 'Gipedo Pano' end;

  if p_outcome = 'captured' then
    if v_row.capture_cents = 0 or p_amount_cents is distinct from v_row.capture_cents then
      raise exception 'amount_mismatch';
    end if;
    perform public.record_intent_capture(v_row.booking_id, v_row.share_id, v_row.guarantee_id, v_intent,
      p_amount_cents, v_row.futty_cents, coalesce(p_stripe_fee_cents, 0),
      case when v_booking.losers_pay or v_row.reason = 'play_whole' then 'losers_pay_' else 'gipedo_' end || v_row.reason);
    if v_row.share_id is not null then
      update public.booking_payment_shares
      set status = case when v_row.reason = 'pull_out_fee' then 'forfeited'
                        when v_row.reason = 'left' and v_row.credit_cents > 0 then 'credited'
                        when v_row.reason = 'left' then 'forfeited'
                        else 'paid' end,
          paid_at = now(),
          -- 24 November: played as a whole pitch, it's an ordinary share now.
          gipedo_side = case when v_row.reason = 'play_whole' then null else gipedo_side end
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
      case when v_booking.losers_pay or v_row.reason = 'play_whole' then 'losers_pay_' else 'gipedo_' end || v_row.reason);
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

revoke all on function public.guarantee_set_amount(uuid, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.guarantee_set_amount(uuid, integer, timestamptz, text) to service_role;
revoke all on function public.losers_pay_play_whole_amounts(public.venue_bookings, public.booking_sides) from public, anon, authenticated;
grant execute on function public.losers_pay_play_whole_amounts(public.venue_bookings, public.booking_sides) to service_role;
revoke all on function public.no_opponent_play_words(public.venue_bookings, public.booking_sides) from public, anon, authenticated;
grant execute on function public.no_opponent_play_words(public.venue_bookings, public.booking_sides) to service_role;
revoke all on function public.losers_pay_play_whole(uuid) from public, anon, authenticated;
grant execute on function public.losers_pay_play_whole(uuid) to service_role;
revoke all on function public.losers_pay_leave_amounts(public.booking_payment_shares, timestamptz) from public, anon, authenticated;
grant execute on function public.losers_pay_leave_amounts(public.booking_payment_shares, timestamptz) to service_role;
revoke all on function public.losers_pay_leaving_share(public.venue_bookings, uuid) from public, anon, authenticated;
grant execute on function public.losers_pay_leaving_share(public.venue_bookings, uuid) to service_role;
revoke all on function public.losers_pay_pull_out_kind(public.venue_bookings, public.booking_sides) from public, anon, authenticated;
grant execute on function public.losers_pay_pull_out_kind(public.venue_bookings, public.booking_sides) to service_role;
revoke all on function public.losers_pay_pulling_side(public.venue_bookings, uuid) from public, anon, authenticated;
grant execute on function public.losers_pay_pulling_side(public.venue_bookings, uuid) to service_role;
revoke all on function public.losers_pay_leave_quote(uuid) from public, anon;
grant execute on function public.losers_pay_leave_quote(uuid) to authenticated, service_role;
revoke all on function public.losers_pay_pull_out_quote(uuid) from public, anon;
grant execute on function public.losers_pay_pull_out_quote(uuid) to authenticated, service_role;
revoke all on function public.my_no_opponent_choices() from public, anon;
grant execute on function public.my_no_opponent_choices() to authenticated, service_role;
