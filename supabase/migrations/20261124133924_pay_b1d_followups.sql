-- B1d follow-ups (spec 13 "Losers pay", Panos's answers of 24 November to
-- the questions in #181):
--   a. A side on its own, paying for myself, pulling out pays €1 from each
--      player who holds: as built, no change here (example 15b).
--   b. After a side pulls out less than 6 hours before kickoff, the
--      remaining side plays for nothing: losers_pay_pull_out marks the
--      booking (venue_bookings.losers_pay_pulled_out_at); a player who joins
--      afterwards is covered, with no hold and nothing to pay
--      (add_booking_side_share_internal, booking_post_quotes), and no
--      opposition post can open (opposition_open_error, which publish_booking,
--      reopen_opposition_post and booking_post_quotes use).
--   c. The remaining side's captain is told: "The other team pulled out.
--      They pay for the pitch, and your hold is released."
-- Re-created functions are copied from their latest migration with only
-- these changes: opposition_open_error (20261123180000_pay_b1c_opposition.sql),
-- add_booking_side_share_internal, booking_post_quotes
-- (20261124110000_pay_b1d_losers_pay.sql), losers_pay_pull_out
-- (20261124120000_pay_b1d_losers_pay_rules.sql). Their grants are unchanged.

alter table public.venue_bookings add column losers_pay_pulled_out_at timestamptz;

comment on column public.venue_bookings.losers_pay_pulled_out_at is
  'Losers pay: when a side pulled out less than 6 hours before kickoff and paid the pitch; the remaining side then plays for nothing.';

-- As in 20261123180000_pay_b1c_opposition.sql, plus (b).
create or replace function public.opposition_open_error(p_booking public.venue_bookings)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_booking.id is null then 'not_found'
    when p_booking.status = 'cancelled' then 'booking_cancelled'
    when p_booking.booking_kind is distinct from 'half' then 'not_half_pitch'
    when p_booking.status <> 'confirmed' then 'booking_not_confirmed'
    -- B1d follow-up (b): after a late pull-out the remaining side plays for nothing.
    when p_booking.losers_pay_pulled_out_at is not null then 'opposition_closed'
    when now() >= public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) - public.rule_gipedo_opponent_lead()
      then 'opposition_closed'
  end;
$$;

-- As in 20261124110000_pay_b1d_losers_pay.sql, plus (b).
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

  if v_booking.losers_pay_pulled_out_at is not null then
    -- B1d follow-up (b): the other side pulled out late and paid the pitch,
    -- so a new joiner is covered: no hold, nothing to pay.
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, side, gipedo_side)
    values (p_booking_id, p_profile_id, 0, 0, 0, 0, false, 'covered', p_side, null)
    on conflict (booking_id, profile_id) do nothing;
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

-- As in 20261124110000_pay_b1d_losers_pay.sql, plus (b).
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
        -- B1d follow-up (b): after a late pull-out a joiner pays nothing.
        case when m.mode = 'pay_all' or b.losers_pay_pulled_out_at is not null then 0 else x.card_cents end as card_cents,
        case when m.mode = 'pay_all' or b.losers_pay_pulled_out_at is not null then 0 else x.pitch_cents end as pitch_cents,
        case when m.mode = 'pay_all' or b.losers_pay_pulled_out_at is not null then 0 else x.fee_cents end as fee_cents
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

-- As in 20261124120000_pay_b1d_losers_pay_rules.sql, plus (b) and (c).
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
