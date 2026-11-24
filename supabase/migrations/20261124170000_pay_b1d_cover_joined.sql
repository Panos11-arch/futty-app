-- B1d, question 1 from #185 (decided by Panos, 24 November; spec 13
-- "Pulling out", rule 4): after a side pulls out less than 6 hours before
-- kickoff, every player on the remaining side who hasn't placed a hold yet is
-- covered (no hold asked; a hold request already started is cancelled), not
-- only players who join afterwards. Players who already hold are released,
-- as before.
-- losers_pay_pull_out is copied from 20261124133924_pay_b1d_followups.sql with
-- only that loop added; its grants are unchanged.

-- As in 20261124133924_pay_b1d_followups.sql, plus the remaining side's unheld players covered.
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
    -- B1d follow-up (b): from now on the remaining side plays for nothing.
    update public.venue_bookings set losers_pay_pulled_out_at = now() where id = p_booking_id;
    v_count := public.losers_pay_settle_booking(p_booking_id, case when v_side.side = 'a' then 'side_b_won' else 'side_a_won' end);
    update public.booking_payment_shares set status = 'cancelled'
    where booking_id = p_booking_id and side = v_side.side and status in ('pending', 'covered');
    update public.squad_posts set status = 'closed'
    where venue_booking_id = p_booking_id and type = 'players' and side = v_side.side and status = 'open';
    update public.booking_sides set left_at = now() where booking_id = p_booking_id and side = v_side.side;
    select * into v_other from public.booking_sides where booking_id = p_booking_id and side <> v_side.side;
    -- Question 1 from #185 (24 November): every player on the remaining side
    -- who hasn't placed a hold yet is covered: no hold is asked, and a hold
    -- request he started is cancelled at Stripe (money_releases) and
    -- remembered, so a late confirmation of it is released, never taken.
    -- Players who already hold were settled as the winning side above.
    for v_share in
      select * from public.booking_payment_shares s
      where s.booking_id = p_booking_id and s.side = v_other.side and s.status = 'pending' and s.gipedo_side is not null
      order by s.created_at
      for update
    loop
      if v_share.stripe_payment_intent_id is not null then
        insert into public.money_releases (booking_id, share_id, stripe_intent_id, reason)
        values (p_booking_id, v_share.id, v_share.stripe_payment_intent_id, 'losers_pay_covered')
        on conflict (stripe_intent_id) where status = 'pending' do nothing;
      end if;
      update public.booking_payment_shares
      set status = 'covered', amount_cents = 0, pitch_cents = 0, fee_cents = 0, cash_cents = 0, gipedo_side = null,
          stripe_payment_intent_id = null,
          replaced_intent_ids = case when v_share.stripe_payment_intent_id is null then replaced_intent_ids
                                     else array_append(replaced_intent_ids, v_share.stripe_payment_intent_id) end
      where id = v_share.id;
    end loop;
    perform public.send_notification(v_other.captain_id, 'opposition_left', jsonb_build_object(
      'title', 'The other side pulled out',
      -- B1d follow-up (c): Panos's words (24 November).
      'body', 'The other team pulled out. They pay for the pitch, and your hold is released.',
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
