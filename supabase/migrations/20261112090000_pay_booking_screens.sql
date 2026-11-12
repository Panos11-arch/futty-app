-- P5: what the booking screens show, computed on the server
-- (docs/specs/13-payments-bookings.md; 15-design.md section 5). The app
-- only displays these amounts and never computes a price, fee or total.
--
--   booking_search_options()  the caller's booking window and whether any
--                             live venue offers 6 v 6 on a 5-a-side pitch
--   venues_free_at(...)       live venues free at a day and time, with the
--                             price per player
--   booking_quote(...)        checkout: both modes priced for the caller,
--                             credit, cash, the non-refundable notice
--   booking_detail(id)        a booking for a player in it: roster with
--                             paid state, next cancellation cutoff
--   my_owed()                 the caller's debts and failed payments
--   my_credit()               the caller's credit per venue, with expiry
--   venue_page(id)            now also says whether 6 v 6 is allowed
--
-- Decided 12 November (spec 13, "Booking screens"):
--   - "Players per side" shows when any live venue allows 6 v 6 on a
--     5-a-side pitch; choosing 6 v 6 lists only those venues.
--   - Cash is offered by the server's rules only: each-pays modes, never
--     with credit, never to a player in debt. There is no venue setting.
--   - Everyone in a booking sees the roster's names and paid state; only
--     the booker sees everyone's amounts, the others only their own.
--
-- Every function is security definer with search_path = '', checks the
-- caller (signed in; may see the venue; is in the booking; only their own
-- debts and credit), and is callable by authenticated and service_role.
-- book_slot stays the authority: a quote is a preview it re-checks.

-- The caller's booking window (days after today in Cyprus: 7, or 14 for
-- Premium, as book_slot) and whether "players per side" can be offered.
create or replace function public.booking_search_options()
returns jsonb
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
  v_premium := coalesce((select is_premium from public.profiles where id = auth.uid()), false);
  return jsonb_build_object(
    'today', (now() at time zone 'Asia/Nicosia')::date,
    'window_days', case when v_premium then 14 else 7 end,
    'is_premium', v_premium,
    'six_on_five_available', exists (
      select 1 from public.venues v
      where v.is_live and v.allows_6v6_on_5s
        and (exists (select 1 from public.pitches p where p.venue_id = v.id and p.is_open and '5-a-side' = any (p.formats))
             or exists (select 1 from public.pitch_combinations c where c.venue_id = v.id and c.format = '5-a-side')))
  );
end;
$$;

-- The checks book_slot makes on a slot, before anything is priced. Raises
-- the same error codes. Returns the number of players the booking is for.
create or replace function public.booking_slot_checked(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_players_per_side integer,
  p_premium boolean
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_hours record;
  v_six_on_five boolean;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not v_venue.is_live then
    raise exception 'venue_not_live';
  end if;
  if p_day is null or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;
  if p_day < v_now::date or (p_day = v_now::date and p_start <= v_now::time) then
    raise exception 'slot_in_past';
  end if;
  if p_day - v_now::date > (case when p_premium then 14 else 7 end) then
    raise exception 'beyond_booking_window';
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
  return case when v_six_on_five then 12 else public.format_player_count(p_format) * 2 end;
end;
$$;

-- Live venues free for a game of p_minutes from p_start on p_day, with what
-- each player pays when each pays their own share (a standard account: the
-- pitch part plus the 80 service fee) and up to three later free start
-- times that day. 6 v 6 on a 5-a-side pitch lists only venues allowing it.
create or replace function public.venues_free_at(
  p_day date,
  p_start time,
  p_minutes integer,
  p_format text,
  p_players_per_side integer default 5
)
returns table (
  venue_id uuid,
  name text,
  city text,
  address text,
  photo_path text,
  pitch_cents integer,
  player_cents integer,
  next_starts time[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_premium boolean;
  v_end_at timestamp;
  v_end time;
  v_six_on_five boolean := p_players_per_side = 6 and p_format = '5-a-side';
  v_venue record;
  v_players integer;
  v_price integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_minutes is null or p_minutes < 30 or p_minutes % 30 <> 0 or p_day is null or p_start is null then
    raise exception 'invalid_time_range';
  end if;
  v_premium := coalesce((select is_premium from public.profiles where id = auth.uid()), false);
  if p_day - v_now::date > (case when v_premium then 14 else 7 end) then
    raise exception 'beyond_booking_window';
  end if;
  v_end_at := p_day + p_start + make_interval(mins => p_minutes);
  if v_end_at > p_day + 1 then
    return;
  end if;
  v_end := case when v_end_at = p_day + 1 then time '24:00' else v_end_at::time end;

  for v_venue in
    select v.id, v.name, v.city, v.address from public.venues v
    where v.is_live and (not v_six_on_five or v.allows_6v6_on_5s)
    order by v.name, v.id
  loop
    begin
      v_players := public.booking_slot_checked(v_venue.id, p_day, p_start, v_end, p_format, p_players_per_side, v_premium);
    exception when others then
      continue;
    end;
    v_price := public.slot_price_cents(v_venue.id, p_day, p_start, v_end, p_format);
    if v_price is null or public.pick_pitches(v_venue.id, p_day, p_start, v_end, p_format, v_six_on_five) is null then
      continue;
    end if;
    venue_id := v_venue.id;
    name := v_venue.name;
    city := v_venue.city;
    address := v_venue.address;
    photo_path := (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                   order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1);
    pitch_cents := v_price;
    player_cents := (select m.card_cents
                     from public.money_share(v_price, v_players, 'each_pays_own_spot', false, false, 'card') m);
    next_starts := array(select f.start_time
                         from public.venue_free_slots(v_venue.id, p_day, p_format, p_minutes, p_players_per_side) f
                         where f.start_time > p_start order by f.start_time limit 3);
    return next;
  end loop;
end;
$$;

-- Checkout for one slot, before booking: both modes priced for the caller
-- from the venue's data. The same checks as book_slot (same error codes).
--   pay_all     the booker pays for everyone (55 per player; a Premium
--               booker's own spot is free)
--   each_pays   what each player pays (a standard account) and what the
--               caller pays as the booker, by card or with cash at the venue
--   with_credit what's left to pay by card when the caller uses their
--               credit at this venue (null when they have none)
--   non_refundable  kickoff is less than 6 hours away: the notice must be
--               accepted before paying
create or replace function public.booking_quote(
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
  v_kickoff timestamptz;
  v_credit integer;
  v_in_debt boolean;
  v_all record;
  v_mine record;
  v_each record;
  v_cash record;
  v_all_credit jsonb;
  v_mine_credit jsonb;
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
  if public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format,
                         p_players_per_side = 6 and p_format = '5-a-side') is null then
    raise exception 'slot_full';
  end if;

  select * into v_all from public.money_share(v_price, v_players, 'pay_all', true, v_premium, 'card');
  select * into v_mine from public.money_share(v_price, v_players, 'each_pays_own_spot', true, v_premium, 'card');
  select * into v_each from public.money_share(v_price, v_players, 'each_pays_own_spot', false, false, 'card');
  select * into v_cash from public.money_share(v_price, v_players, 'each_pays_own_spot', true, v_premium, 'cash');

  v_credit := public.venue_credit_available_cents(v_uid, p_venue_id);
  if v_credit > 0 then
    select jsonb_build_object('credit_cents', c.credit_cents, 'fee_cents', c.fee_cents, 'card_cents', c.card_cents)
      into v_all_credit from public.money_credit_payment(v_all.pitch_cents, v_all.fee_cents, v_credit) c;
    select jsonb_build_object('credit_cents', c.credit_cents, 'fee_cents', c.fee_cents, 'card_cents', c.card_cents)
      into v_mine_credit from public.money_credit_payment(v_mine.pitch_cents, v_mine.fee_cents, v_credit) c;
  end if;

  v_in_debt := public.profile_has_debt(v_uid);
  v_kickoff := public.booking_kickoff_at(p_day, p_start);

  return jsonb_build_object(
    'venue_id', p_venue_id,
    'day', p_day,
    'start_time', p_start,
    'end_time', p_end,
    'format', p_format,
    'players_per_side', p_players_per_side,
    'players', v_players,
    'pitch_cents', v_price,
    'is_premium', v_premium,
    'kickoff_at', v_kickoff,
    'refunds_stop_at', v_kickoff - interval '6 hours',
    'non_refundable', public.money_is_non_refundable(now(), v_kickoff),
    'pay_all', jsonb_build_object(
      'pitch_cents', v_all.pitch_cents, 'fee_cents', v_all.fee_cents, 'card_cents', v_all.card_cents,
      'with_credit', v_all_credit),
    'each_pays', jsonb_build_object(
      'player_cents', v_each.card_cents, 'player_pitch_cents', v_each.pitch_cents, 'player_fee_cents', v_each.fee_cents,
      'mine', jsonb_build_object('pitch_cents', v_mine.pitch_cents, 'fee_cents', v_mine.fee_cents,
                                 'card_cents', v_mine.card_cents, 'with_credit', v_mine_credit),
      'cash', jsonb_build_object('card_cents', v_cash.card_cents, 'cash_cents', v_cash.cash_cents)),
    'credit', jsonb_build_object(
      'available_cents', v_credit,
      'expires_at', (select min(c.expires_at) from public.venue_credits c
                     where c.profile_id = v_uid and c.venue_id = p_venue_id and c.expires_at > now() and c.remaining_cents > 0)),
    'in_debt', v_in_debt,
    'cash_allowed', not v_in_debt,
    'cancellation', public.cancellation_terms()
  );
end;
$$;

-- A booking for a player in it (the booker, or anyone holding a spot in it,
-- now or before). Everyone sees the roster's names and paid state; amounts
-- only for the caller's own spot, or every spot for the booker.
--   state  in_app (paid by card), cash (to pay at the venue), cash_paid
--          (the venue ticked it), unpaid, covered (the booker paid for it)
--   next_cutoff  the caller's free hour ending (free_hour_ends), else
--          refunds stopping 6 hours before kickoff (refunds_stop); null
--          once refunds have stopped or the booking is cancelled
create or replace function public.booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_venue public.venues;
  v_me public.booking_payment_shares;
  v_is_booker boolean;
  v_kickoff timestamptz;
  v_refunds_stop timestamptz;
  v_active boolean;
  v_free_until timestamptz;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null
     or not (v_booking.created_by = v_uid
             or exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.profile_id = v_uid)) then
    raise exception 'booking_not_found';
  end if;
  select * into v_venue from public.venues where id = v_booking.venue_id;
  select * into v_me from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid
  order by (status not in ('cancelled', 'refunded')) desc, created_at desc
  limit 1;
  v_is_booker := v_booking.created_by = v_uid;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  v_refunds_stop := v_kickoff - interval '6 hours';
  v_active := v_booking.status <> 'cancelled' and now() < v_kickoff;

  if v_me.status = 'authorized' and v_me.capture_due_at > now() then
    v_free_until := v_me.capture_due_at;
  end if;
  if v_active then
    if v_free_until is not null and v_free_until < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'free_hour_ends', 'at', v_free_until);
    elsif now() < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'refunds_stop', 'at', v_refunds_stop);
    end if;
  end if;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', v_booking.id, 'status', v_booking.status, 'booking_day', v_booking.booking_day,
      'start_time', v_booking.start_time, 'end_time', v_booking.end_time, 'format', v_booking.format,
      'capacity', v_booking.capacity,
      'players_per_side', v_booking.capacity / 2,
      'payment_mode', v_booking.payment_mode,
      'kickoff_at', v_kickoff,
      'ends_at', public.booking_ends_at(v_booking.booking_day, v_booking.end_time),
      'refunds_stop_at', v_refunds_stop,
      'payment_window_ends_at', case when v_booking.status = 'pending_payment'
                                     then public.booking_payment_window_ends_at(v_booking) end),
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address,
      'google_maps_link', v_venue.google_maps_link,
      'photo_path', (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                     order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1)),
    'is_booker', v_is_booker,
    'me', case when v_me.id is null then null else jsonb_build_object(
      'share_id', v_me.id, 'status', v_me.status, 'payment_method', v_me.payment_method,
      'amount_cents', v_me.amount_cents, 'pitch_cents', v_me.pitch_cents, 'fee_cents', v_me.fee_cents,
      'cash_cents', v_me.cash_cents, 'free_until', v_free_until) end,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'profile_id', s.profile_id,
               'name', public.profile_display_name(s.profile_id),
               'username', p.username,
               'is_booker', s.is_booker,
               'is_me', s.profile_id = v_uid,
               'state', case
                          when s.status = 'covered' then 'covered'
                          when s.status = 'pending' then 'unpaid'
                          when s.payment_method = 'cash' and s.cash_received_at is not null then 'cash_paid'
                          when s.payment_method = 'cash' then 'cash'
                          else 'in_app' end,
               'amount_cents', case when v_is_booker or s.profile_id = v_uid then s.amount_cents end,
               'cash_cents', case when v_is_booker or s.profile_id = v_uid then s.cash_cents end)
             order by s.is_booker desc, s.created_at, s.id)
      from public.booking_payment_shares s
      left join public.profiles p on p.id = s.profile_id
      where s.booking_id = p_booking_id and s.status not in ('cancelled', 'refunded')), '[]'::jsonb),
    'next_cutoff', v_next,
    'can_cancel', jsonb_build_object(
      'my_spot', v_active and v_me.id is not null and v_me.status not in ('cancelled', 'refunded')
                 and not (v_me.is_booker and v_booking.payment_mode = 'pay_all'),
      'whole_team', v_active and v_is_booker)
  );
end;
$$;

-- What the caller owes and any payment of theirs that failed or is due
-- (spec 13, "Debt" and "When money is held and taken"). Only the caller's
-- own. blocked: an unpaid debt blocks booking, joining and cash everywhere.
--   debts     unpaid debts, to a venue or to Futty ("Pay what I owe")
--   payments  card_failed: their guarantee hold failed, replace the card;
--             payment_due: their spot isn't paid yet, before kickoff;
--             cash_unpaid: after the match, their cash part wasn't ticked
create or replace function public.my_owed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  return jsonb_build_object(
    'blocked', public.profile_has_debt(v_uid),
    'debt_cents', coalesce((select sum(d.amount_cents) from public.venue_debts d
                            where d.profile_id = v_uid and d.settled_at is null), 0),
    'debts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'debt_id', d.id, 'owed_to', d.owed_to, 'venue_id', d.venue_id, 'venue_name', v.name,
               'booking_id', d.booking_id, 'amount_cents', d.amount_cents, 'reason', d.reason,
               'created_at', d.created_at)
             order by d.created_at, d.id)
      from public.venue_debts d
      left join public.venues v on v.id = d.venue_id
      where d.profile_id = v_uid and d.settled_at is null), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(x.item order by x.kickoff, x.kind)
      from (
        select 'card_failed' as kind, public.booking_kickoff_at(b.booking_day, b.start_time) as kickoff,
               jsonb_build_object('kind', 'card_failed', 'booking_id', b.id, 'share_id', null,
                                  'venue_name', v.name, 'booking_day', b.booking_day, 'start_time', b.start_time,
                                  'amount_cents', g.amount_cents) as item
        from public.booking_guarantees g
        join public.venue_bookings b on b.id = g.booking_id
        join public.venues v on v.id = b.venue_id
        where g.profile_id = v_uid and g.status = 'failed' and b.status <> 'cancelled'
          and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
        union all
        select 'payment_due', public.booking_kickoff_at(b.booking_day, b.start_time),
               jsonb_build_object('kind', 'payment_due', 'booking_id', b.id, 'share_id', s.id,
                                  'venue_name', v.name, 'booking_day', b.booking_day, 'start_time', b.start_time,
                                  'amount_cents', s.amount_cents)
        from public.booking_payment_shares s
        join public.venue_bookings b on b.id = s.booking_id
        join public.venues v on v.id = b.venue_id
        where s.profile_id = v_uid and s.status = 'pending' and b.payment_mode is not null
          and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
          and (b.status = 'confirmed'
               or (b.status = 'pending_payment' and s.is_booker and now() <= public.booking_payment_window_ends_at(b)))
        union all
        select 'cash_unpaid', public.booking_kickoff_at(b.booking_day, b.start_time),
               jsonb_build_object('kind', 'cash_unpaid', 'booking_id', b.id, 'share_id', s.id,
                                  'venue_name', v.name, 'booking_day', b.booking_day, 'start_time', b.start_time,
                                  'amount_cents', (select a.due_pitch_cents from public.collection_amounts(b.id) a
                                                   where a.share_id = s.id))
        from public.booking_payment_shares s
        join public.venue_bookings b on b.id = s.booking_id
        join public.venues v on v.id = b.venue_id
        where s.profile_id = v_uid and s.payment_method = 'cash' and s.status in ('authorized', 'paid')
          and s.cash_received_at is null and b.status <> 'cancelled'
          and now() >= public.booking_ends_at(b.booking_day, b.end_time)
          and not public.collection_is_due(b)
          and not exists (select 1 from public.booking_collections c where c.booking_id = b.id)
      ) x), '[]'::jsonb)
  );
end;
$$;

-- The caller's credit, per venue: what they can spend there now and each
-- credit's expiry (soonest first). Only the caller's own.
create or replace function public.my_credit()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'venue_id', t.venue_id, 'venue_name', t.venue_name, 'available_cents', t.available_cents,
             'credits', t.credits)
           order by t.soonest, t.venue_name)
    from (
      select c.venue_id, v.name as venue_name, sum(c.remaining_cents)::integer as available_cents,
             min(c.expires_at) as soonest,
             jsonb_agg(jsonb_build_object('credit_id', c.id, 'remaining_cents', c.remaining_cents,
                                          'expires_at', c.expires_at)
                       order by c.expires_at, c.id) as credits
      from public.venue_credits c
      join public.venues v on v.id = c.venue_id
      where c.profile_id = auth.uid() and c.expires_at > now() and c.remaining_cents > 0
      group by c.venue_id, v.name
    ) t), '[]'::jsonb);
end;
$$;

-- As in 20261111164706_pay_venue_pages, plus allows_6v6_on_5s, so the
-- booking form offers "Players per side" only where the venue allows it.
create or replace function public.venue_page(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  if not public.venue_visible(p_venue_id) then
    raise exception 'venue_not_found';
  end if;
  select * into v_venue from public.venues where id = p_venue_id;

  return jsonb_build_object(
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address,
      'google_maps_link', v_venue.google_maps_link, 'phone', v_venue.phone, 'website', v_venue.website,
      'instagram', v_venue.instagram, 'is_live', v_venue.is_live, 'allows_6v6_on_5s', v_venue.allows_6v6_on_5s),
    'bookable', v_venue.is_live and exists (select 1 from public.price_rules r where r.venue_id = p_venue_id),
    'cancellation', public.cancellation_terms(),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('storage_path', p.storage_path, 'pitch_id', p.pitch_id)
                                         order by p.pitch_id nulls first, p.sort_order, p.storage_path)
                        from public.venue_photos p where p.venue_id = p_venue_id), '[]'::jsonb),
    'amenities', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'note', a.note) order by a.kind)
                           from public.venue_amenities a where a.venue_id = p_venue_id), '[]'::jsonb),
    'pitches', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', p.id, 'name', p.name, 'size', p.size, 'formats', to_jsonb(p.formats),
                                  'surface', p.surface, 'indoor', p.indoor, 'description', p.description,
                                  'is_open', p.is_open) order by p.sort_order, p.name)
                         from public.pitches p where p.venue_id = p_venue_id), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
                                 'format', r.format, 'hour_cents', r.price_cents, 'peak_hour_cents', r.peak_cents,
                                 'weekend_hour_cents', r.weekend_cents)
                               order by public.format_player_count(r.format))
                        from public.price_rules r where r.venue_id = p_venue_id), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', h.opens, 'closes', h.closes)
                                        order by h.weekday)
                       from public.opening_hours h where h.venue_id = p_venue_id), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', i.id, 'name', i.name, 'description', i.description, 'price_cents', i.price_cents,
                                 'offer_text', i.offer_text, 'offer_price_cents', i.offer_price_cents,
                                 'photo_path', i.photo_path, 'available_from', i.available_from,
                                 'available_to', i.available_to, 'available_weekdays', to_jsonb(i.available_weekdays))
                               order by i.name)
                        from public.venue_menu_items i
                        where i.venue_id = p_venue_id and i.active and i.is_post_match_offer), '[]'::jsonb)
  );
end;
$$;

-- The app may call these; booking_slot_checked is internal.
revoke all on function public.booking_slot_checked(uuid, date, time, time, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.booking_slot_checked(uuid, date, time, time, text, integer, boolean) to service_role;
revoke all on function public.booking_search_options() from public, anon;
grant execute on function public.booking_search_options() to authenticated, service_role;
revoke all on function public.venues_free_at(date, time, integer, text, integer) from public, anon;
grant execute on function public.venues_free_at(date, time, integer, text, integer) to authenticated, service_role;
revoke all on function public.booking_quote(uuid, date, time, time, text, integer) from public, anon;
grant execute on function public.booking_quote(uuid, date, time, time, text, integer) to authenticated, service_role;
revoke all on function public.booking_detail(uuid) from public, anon;
grant execute on function public.booking_detail(uuid) to authenticated, service_role;
revoke all on function public.my_owed() from public, anon;
grant execute on function public.my_owed() to authenticated, service_role;
revoke all on function public.my_credit() from public, anon;
grant execute on function public.my_credit() to authenticated, service_role;
revoke all on function public.venue_page(uuid) from public, anon;
grant execute on function public.venue_page(uuid) to authenticated, service_role;
