-- B1d rules (spec 13 "Losers pay (Gipedo Pano in Booking v2)", decided by
-- Panos on 24 November): examples 12a-16, each at the spec's amount on its
-- €40.00 5-a-side pitch (5 v 5), and the B1e fix (publishing an open
-- players post again counts its joiners).
--   1. "Pay the whole pitch and play": an ordinary whole-pitch booking with
--      the same way to pay; the holds pay for it (12a, 12b).
--   2. A pay-for-everyone side pulling out more than 6 hours before
--      kickoff: €1 per player of his side from the captain's hold (13).
--   3. Less than 6 hours before kickoff: as the losing side (14a, 14b).
--   4. A side on its own: €1 per player, the booking cancelled; once the
--      24-hour choice is open, "Cancel free" (15a, 15b).
--   5. Losers pay from 24 hours to 5 days ahead.
--   6. A player leaving after the guarantee was counted: the captain's
--      guarantee goes up €9.60 at once (16).
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.lp_user(p_premium boolean default false)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.create_user('lr-' || gen_random_uuid() || '@futty.test');
begin
  if p_premium then
    perform tests.make_premium(v);
  end if;
  return v;
end;
$$;

-- A Losers pay half pitch, side A paying p_mode; the booker's hold placed.
create function tests.lp_book(p_mode text, p_days integer default 3, out booking uuid, out booker uuid, out venue uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  venue := tests.create_venue(p_pitches => 0);
  booker := tests.lp_user();
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(venue, tests.cyprus_today() + p_days, '12:00', '13:00', 1, '5-a-side', 5, p_mode,
                        p_kind => 'half', p_losers_pay => true);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((tests.share_of(booking, booker)).id, 'pi_lr_a_' || gen_random_uuid());
end;
$$;

-- Side B's captain accepts the public opposition post and places his hold.
create function tests.lp_side_b(p_booking uuid, p_booker uuid, p_mode text)
returns uuid
language plpgsql
as $$
declare
  v_post public.squad_posts;
  v_b uuid := tests.lp_user();
  r jsonb;
begin
  perform tests.act_as(p_booker);
  v_post := public.publish_booking(p_booking, 'opposition');
  perform tests.act_as(v_b);
  r := public.accept_opposition_post(v_post.id, p_mode, p_losers_pay => true);
  perform tests.act_as_postgres();
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_lr_b_' || gen_random_uuid());
  return v_b;
end;
$$;

-- n more players join p_side through its post and hold; then p_unheld more join without holding.
create function tests.lp_players(p_booking uuid, p_captain uuid, p_n integer, p_unheld integer default 0)
returns uuid[]
language plpgsql
as $$
declare
  v_post public.squad_posts;
  v_ids uuid[] := '{}';
  v_p uuid;
begin
  perform tests.act_as(p_captain);
  v_post := public.publish_booking(p_booking, 'players');
  perform tests.act_as_postgres();
  for i in 1..(p_n + p_unheld) loop
    v_p := tests.lp_user();
    perform tests.act_as(v_p);
    perform public.join_squad_post(v_post.id);
    perform tests.act_as_postgres();
    if i <= p_n then
      perform tests.hold_share((tests.share_of(p_booking, v_p)).id, 'pi_lr_p_' || gen_random_uuid());
    end if;
    v_ids := v_ids || v_p;
  end loop;
  return v_ids;
end;
$$;

create function tests.lp_sum(p_booking uuid, p_reason text, out capture integer, out venue integer, out futty integer,
                             out n integer)
language sql
as $$
  select coalesce(sum(capture_cents), 0)::integer, coalesce(sum(venue_cents), 0)::integer,
         coalesce(sum(futty_cents), 0)::integer, count(*)::integer
  from public.gipedo_settlements where booking_id = p_booking and reason = p_reason;
$$;

-- The 24-hour choice is open: kickoff in 20 hours, the job has run.
create function tests.lp_choice_open(p_booking uuid)
returns void
language plpgsql
as $$
begin
  perform tests.set_kickoff(p_booking, now() + interval '20 hours');
  perform public.losers_pay_count_guarantees();
  perform public.booking_no_opponent_due();
end;
$$;

-- 1. Rule 5: Losers pay is booked 24 hours to 5 days ahead.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0, p_open => '00:00', p_close => '23:30');
  v_user uuid := tests.lp_user();
  v_slot record := tests.slot_starting_in(interval '20 hours');
  q jsonb;
begin
  if v_slot.start_time >= time '22:30' then
    v_slot := tests.slot_starting_in(interval '18 hours');
  end if;
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(v_user);
  assert tests.error_of(format(
    'select public.book_slot(%L, %L, %L, %L, 1, ''5-a-side'', 5, ''pay_all'', p_kind => ''half'', p_losers_pay => true)',
    v_venue, v_slot.day, v_slot.start_time, v_slot.start_time + interval '1 hour')) = 'losers_pay_too_soon',
    'rule 5: not less than 24 hours ahead';
  q := public.booking_quote_v2(v_venue, v_slot.day, v_slot.start_time, v_slot.start_time + interval '1 hour', '5-a-side');
  assert not (q #>> '{half,losers_pay,available}')::boolean, 'rule 5: not offered at checkout under 24 hours';
  assert (q #>> '{half,available}')::boolean, 'an ordinary half pitch still is';
  q := public.booking_quote_v2(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', '5-a-side');
  assert (q #>> '{half,losers_pay,available}')::boolean, 'offered 3 days ahead';
  perform tests.act_as_postgres();
end $$;

-- 2. Example 12a: no opponent, "Pay the whole pitch and play", side A paid
--    for everyone: the captain's €45.50 hold is the whole pitch's payment.
do $$
declare
  s record := tests.lp_book('pay_all');
  v_player uuid;
  d jsonb;
  c record;
  r jsonb;
  t record;
  v_row public.gipedo_settlements;
  v public.booking_payment_shares;
begin
  v_player := (tests.lp_players(s.booking, s.booker, 0, p_unheld => 1))[1];
  perform tests.lp_choice_open(s.booking);
  perform tests.act_as(s.booker);
  assert (public.booking_detail(s.booking) #>> '{v2,losers_pay}')::boolean, 'the booking says it''s Losers pay';
  d := public.booking_detail(s.booking) #> '{v2,no_opponent}';
  select * into c from public.my_no_opponent_choices() x where x.booking_id = s.booking;
  perform tests.act_as_postgres();
  assert (d ->> 'losers_pay')::boolean and (d ->> 'amount_cents')::integer = 0 and (d ->> 'taken_cents')::integer = 4550,
    format('12a: nothing more to pay, the €45.50 hold is taken (%s)', d);
  assert (c.losers_pay, c.payment_mode, c.amount_cents, c.taken_cents) = (true, 'pay_all'::text, 0, 4550),
    'and on Home';
  assert (select body from public.notifications where profile_id = s.booker and type = 'no_opponent'
          order by created_at desc limit 1) like '%your €45.50 hold is the payment%', 'the notification says so';

  perform tests.act_as(s.booker);
  r := public.booking_no_opponent_choice(s.booking, 'play_whole');
  perform tests.act_as_postgres();
  assert (r ->> 'result', (r ->> 'taken_cents')::integer) = ('play_whole'::text, 4550), format('played whole (%s)', r);
  assert (select (losers_pay, booking_kind, no_opponent_choice, payment_mode) from public.venue_bookings where id = s.booking)
         = (false, 'whole'::text, 'play_whole'::text, 'pay_all'::text), 'an ordinary whole-pitch booking, paid for everyone';
  assert not exists (select 1 from public.booking_sides where booking_id = s.booking), 'no sides';
  perform tests.act_as(s.booker);
  assert not (public.booking_detail(s.booking) #>> '{v2,losers_pay}')::boolean, 'no longer Losers pay';
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.booking_payment_shares where booking_id = s.booking and side is not null), 'no side on shares';
  assert (tests.share_of(s.booking, v_player)).status = 'covered', 'the player is still covered';
  t := tests.lp_sum(s.booking, 'play_whole');
  assert (t.capture, t.venue, t.futty, t.n) = (4550, 4000, 550, 1), format('12a: €45.50; venue €40.00, Futty €5.50 (%s)', t);

  -- Carried out at Stripe: the share is an ordinary paid share, in the ledger.
  select * into v_row from public.gipedo_settlements where booking_id = s.booking and reason = 'play_whole';
  perform public.gipedo_settlement_done(v_row.id, 'captured', 4550, 90);
  v := tests.share_of(s.booking, s.booker);
  assert (v.status, v.gipedo_side) is not distinct from ('paid'::text, null::text), 'paid, an ordinary share';
  assert exists (select 1 from public.money_ledger l where l.share_id = v.id and l.kind = 'capture' and l.amount_cents = 4550
                   and l.venue_cents = 4000 and l.reason = 'losers_pay_play_whole'), 'in the ledger';

  perform tests.act_as(s.booker);
  assert tests.error_of(format('select public.booking_no_opponent_choice(%L, ''play_whole'')', s.booking)) = 'not_your_booking',
    'chosen once (it is no longer a half pitch)';
  perform tests.act_as_postgres();
end $$;

-- 3. Example 12b: side A paid for myself, the captain and 4 players held.
--    Each player's €4.80 is taken from his hold (€24.00 from the 5), the
--    rest released; the captain's guarantee is the whole pitch's €40.00.
do $$
declare
  s record := tests.lp_book('each_pays_responsible');
  v_players uuid[];
  d jsonb;
  r jsonb;
  t record;
  g public.booking_guarantees;
  v_post uuid;
begin
  v_players := tests.lp_players(s.booking, s.booker, 4);
  v_post := (select id from public.squad_posts where venue_booking_id = s.booking and type = 'players');
  perform tests.lp_choice_open(s.booking);
  assert (select status from public.booking_guarantees where booking_id = s.booking) = 'cancelled',
    'every spot held at 24 hours: no Losers pay guarantee';
  perform tests.act_as(s.booker);
  d := public.booking_detail(s.booking) #> '{v2,no_opponent}';
  r := public.booking_no_opponent_choice(s.booking, 'play_whole');
  perform tests.act_as_postgres();
  assert ((d ->> 'taken_cents')::integer, (d ->> 'player_cents')::integer, (d ->> 'guarantee_cents')::integer) = (480, 480, 4000),
    format('12b: €4.80 each, a €40.00 guarantee (%s)', d);
  assert (select (losers_pay, booking_kind, payment_mode) from public.venue_bookings where id = s.booking)
         = (false, 'whole'::text, 'each_pays_responsible'::text), 'an ordinary whole-pitch booking, paid for myself';
  t := tests.lp_sum(s.booking, 'play_whole');
  assert (t.capture, t.venue, t.futty, t.n) = (2400, 2000, 400, 5), format('12b: 5 × €4.80 = €24.00 (%s)', t);
  assert (select count(*) from public.booking_payment_shares
          where booking_id = s.booking and (amount_cents, pitch_cents, fee_cents) = (480, 400, 80)) = 5, 'each share €4.80';
  select * into g from public.booking_guarantees where booking_id = s.booking;
  assert (g.amount_cents, g.counted) = (4000, true) and g.status <> 'cancelled',
    format('12b: the whole pitch''s €40.00 guarantee (%s)', row(g.amount_cents, g.status));
  assert (select status from public.squad_posts where id = v_post) = 'closed', 'side A''s post closed when side A filled';
  perform tests.act_as(s.booker);
  assert (select (p.players_needed, p.side) is not distinct from (5, null::text)
          from public.publish_booking(s.booking, 'players') p), 'publishing now offers the whole pitch''s 5 open spots';
  perform tests.act_as_postgres();

  -- After the match it's collected as any whole pitch paid for myself.
  update public.gipedo_settlements set status = 'done', outcome = 'captured' where booking_id = s.booking;
  update public.booking_payment_shares set status = 'paid', gipedo_side = null where booking_id = s.booking;
  perform tests.end_match(s.booking);
  assert exists (select 1 from public.collections_due() c where c.booking_id = s.booking and c.side is null),
    'collected as a whole pitch';
end $$;

-- 4. Rule 1, a guarantee already held for unheld spots is held again for the
--    whole pitch: the old hold is released, then placed for €40.00.
do $$
declare
  s record := tests.lp_book('each_pays_responsible');
  g public.booking_guarantees;
  v_old text;
begin
  perform tests.lp_players(s.booking, s.booker, 2, p_unheld => 2);
  perform tests.lp_choice_open(s.booking);
  update public.booking_guarantees set stripe_customer_id = 'cus_lr' where booking_id = s.booking;
  g := tests.hold_guarantee(s.booking, 'pi_lr_g_old');
  assert (g.amount_cents, g.status) = (1920, 'held'::text), 'held for the 2 unheld spots: €19.20';
  perform tests.act_as(s.booker);
  perform public.booking_no_opponent_choice(s.booking, 'play_whole');
  perform tests.act_as_postgres();
  select * into g from public.booking_guarantees where booking_id = s.booking;
  assert (g.amount_cents, g.status, g.stripe_payment_intent_id) is not distinct from (4000, 'scheduled'::text, null::text),
    format('to be held for €40.00 (%s)', row(g.amount_cents, g.status));
  assert exists (select 1 from public.money_releases r where r.stripe_intent_id = 'pi_lr_g_old' and r.status = 'pending'
                   and r.guarantee_id = g.id and r.reason = 'losers_pay_play_whole'), 'the €19.20 hold is released';
  assert exists (select 1 from public.guarantees_due_for_hold() d where d.guarantee_id = g.id and d.amount_cents = 4000), 'held again';
  g := tests.hold_guarantee(s.booking, 'pi_lr_g_new');
  assert (g.amount_cents, g.status, g.stripe_payment_intent_id) = (4000, 'held'::text, 'pi_lr_g_new'::text), 'held: €40.00';
end $$;

-- 5. Example 13: side B pays for everyone and pulls out more than 6 hours
--    before kickoff: €5.00 from its captain's €45.50 hold, €40.50 released.
do $$
declare
  s record := tests.lp_book('each_pays_responsible');
  v_b uuid := tests.lp_side_b(s.booking, s.booker, 'pay_all');
  q jsonb;
  r jsonb;
  t record;
  v_row public.gipedo_settlements;
begin
  perform tests.lp_players(s.booking, v_b, 0, p_unheld => 2);
  perform tests.act_as(v_b);
  q := public.losers_pay_pull_out_quote(s.booking);
  r := public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  assert (q ->> 'kind', (q ->> 'capture_cents')::integer, (q ->> 'released_cents')::integer, (q ->> 'cancels_booking')::boolean)
         = ('fee'::text, 500, 4050, false), format('13: the quote (%s)', q);
  assert r ->> 'result' = 'pulled_out', 'pulled out';
  t := tests.lp_sum(s.booking, 'pull_out_fee');
  assert (t.capture, t.venue, t.futty, t.n) = (500, 0, 500, 1), format('13: €5.00 from the captain''s hold (%s)', t);
  assert not exists (select 1 from public.booking_sides where booking_id = s.booking and side = 'b'), 'side B is gone';
  assert (select status from public.squad_posts where venue_booking_id = s.booking and type = 'opposition') = 'open',
    'the opposition post opens again';
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'side A keeps the slot';
  select * into v_row from public.gipedo_settlements where booking_id = s.booking and reason = 'pull_out_fee';
  perform public.gipedo_settlement_done(v_row.id, 'captured', 500, 20);
  assert (tests.share_of(s.booking, v_b)).status = 'forfeited', '€5.00 kept';
  assert exists (select 1 from public.money_ledger l where l.share_id = v_row.share_id and l.kind = 'capture'
                   and l.amount_cents = 500 and l.reason = 'losers_pay_pull_out_fee'), 'in the ledger';

  -- Side A paying for everyone pulls out with side B there: side B keeps the slot.
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  perform tests.act_as(s.booker);
  perform public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  t := tests.lp_sum(s.booking, 'pull_out_fee');
  assert (t.capture, t.n) = (500, 1), format('side A: €5.00 (%s)', t);
  assert (select captain_id from public.booking_sides where booking_id = s.booking and side = 'a') = v_b,
    'side B''s captain has the slot';
end $$;

-- 6. Examples 14a and 14b: a side pulling out less than 6 hours before
--    kickoff pays as the losing side; the other side's holds are released.
do $$
declare
  s record;
  v_b uuid;
  q jsonb;
  r jsonb;
  t record;
begin
  -- 14a: side B pays for myself, all 5 held.
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  perform tests.lp_players(s.booking, v_b, 4);
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  perform tests.act_as(v_b);
  q := public.losers_pay_pull_out_quote(s.booking);
  r := public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  assert (q ->> 'kind', (q ->> 'capture_cents')::integer) = ('lost'::text, 4800), format('14a: the quote (%s)', q);
  assert r ->> 'result' = 'lost', 'as the losing side';
  t := tests.lp_sum(s.booking, 'lost');
  assert (t.capture, t.venue, t.futty, t.n) = (4800, 4000, 800, 5), format('14a: 5 × €9.60 = €48.00; venue €40.00 (%s)', t);
  t := tests.lp_sum(s.booking, 'won');
  assert (t.capture, t.n) = (0, 1), 'side A''s €45.50 released';
  assert (select left_at is not null from public.booking_sides where booking_id = s.booking and side = 'b'), 'side B left';
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'side A''s game goes ahead';
  assert not exists (select 1 from public.squad_posts where venue_booking_id = s.booking and type = 'opposition'
                       and status = 'open'), 'nothing reopens';
  perform tests.end_match(s.booking);
  perform public.sync_booking_match(s.booking);
  update public.matches set status = 'confirmed', side_a_score = 0, side_b_score = 3, confirmed_at = now(),
                            confirmed_via = 'agreed' where booking_id = s.booking;
  assert public.losers_pay_settle_from_results() = 0, 'settled once';

  -- 14b: side B paid for everyone.
  s := tests.lp_book('each_pays_responsible');
  v_b := tests.lp_side_b(s.booking, s.booker, 'pay_all');
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  perform tests.act_as(v_b);
  perform public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  t := tests.lp_sum(s.booking, 'lost');
  assert (t.capture, t.venue, t.futty, t.n) = (4550, 4000, 550, 1), format('14b: €45.50; venue €40.00 (%s)', t);
  assert (select sum(capture_cents) from public.gipedo_settlements where booking_id = s.booking and profile_id = s.booker) = 0,
    'side A''s hold and guarantee released';
end $$;

-- 7. Examples 15a and 15b: a side on its own pulls out more than 24 hours
--    before kickoff: €1 per player kept, the booking cancelled.
do $$
declare
  s record;
  q jsonb;
  r jsonb;
  t record;
begin
  -- 15a: paying for everyone.
  s := tests.lp_book('pay_all');
  perform tests.act_as(s.booker);
  q := public.losers_pay_pull_out_quote(s.booking);
  r := public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  assert (q ->> 'kind', (q ->> 'capture_cents')::integer, (q ->> 'released_cents')::integer, (q ->> 'cancels_booking')::boolean)
         = ('alone'::text, 500, 4050, true), format('15a: the quote (%s)', q);
  assert r ->> 'result' = 'cancelled', 'cancelled';
  t := tests.lp_sum(s.booking, 'pull_out_fee');
  assert (t.capture, t.venue, t.futty) = (500, 0, 500), format('15a: €5.00 (%s)', t);
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'the booking is cancelled';
  assert not exists (select 1 from public.booking_money_to_release(s.booking) m where m.kind = 'share'),
    'the hold is settled (€5.00 taken, the rest released), not released twice';

  -- 15b: paying for myself, the captain and 2 players held, 1 never held.
  s := tests.lp_book('each_pays_responsible');
  perform tests.lp_players(s.booking, s.booker, 2, p_unheld => 1);
  perform tests.act_as(s.booker);
  q := public.losers_pay_pull_out_quote(s.booking);
  perform public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  assert ((q ->> 'capture_cents')::integer, (q ->> 'released_cents')::integer) = (300, 2580), format('15b: the quote (%s)', q);
  t := tests.lp_sum(s.booking, 'pull_out_fee');
  assert (t.capture, t.futty, t.n) = (300, 300, 3), format('15b: €1.00 from each of the 3 holds (%s)', t);
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
  assert (select count(*) from public.booking_payment_shares where booking_id = s.booking and status = 'pending') = 0,
    'the unheld share is cancelled';

  -- Once the 24-hour choice is open: "Cancel free" instead.
  s := tests.lp_book('pay_all');
  perform tests.lp_choice_open(s.booking);
  perform tests.act_as(s.booker);
  q := public.losers_pay_pull_out_quote(s.booking);
  r := public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  assert (q ->> 'kind', (q ->> 'capture_cents')::integer) = ('cancel_free'::text, 0), format('cancel free: the quote (%s)', q);
  assert r ->> 'result' = 'cancelled_free', 'cancelled free';
  assert not exists (select 1 from public.gipedo_settlements where booking_id = s.booking), 'nothing taken';
  assert (select (status, no_opponent_choice) from public.venue_bookings where id = s.booking) = ('cancelled'::text, 'cancel'::text),
    'cancelled free';
  assert exists (select 1 from public.bookings_with_money_to_release() m where m.booking_id = s.booking), 'everything released';
end $$;

-- 8. Example 16: a player leaves after the guarantee was counted: the
--    captain's guarantee goes up €9.60, to €28.80, and is held again at once.
do $$
declare
  s record := tests.lp_book('pay_all');
  v_b uuid := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  v_players uuid[];
  g public.booking_guarantees;
  q jsonb;
  r public.gipedo_settlements;
  t record;
begin
  v_players := tests.lp_players(s.booking, v_b, 2, p_unheld => 2);
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.losers_pay_count_guarantees();
  update public.booking_guarantees set stripe_customer_id = 'cus_lr' where booking_id = s.booking;
  g := tests.hold_guarantee(s.booking, 'pi_lr_16_old');
  assert (g.amount_cents, g.status) = (1920, 'held'::text), '2 spots never held: €19.20';

  update public.booking_payment_shares set held_at = now() - interval '2 hours'
  where booking_id = s.booking and profile_id = v_players[1];
  perform tests.act_as(v_players[1]);
  q := public.losers_pay_leave_quote(s.booking);
  perform public.losers_pay_leave(s.booking);
  perform tests.act_as_postgres();
  assert (q ->> 'window', (q ->> 'held_cents')::integer, (q ->> 'capture_cents')::integer, (q ->> 'credit_cents')::integer,
          (q ->> 'released_cents')::integer) = ('middle'::text, 960, 480, 380, 480), format('16: his quote (%s)', q);
  r := (select x from public.gipedo_settlements x where x.booking_id = s.booking and x.profile_id = v_players[1]);
  assert (r.reason, r.capture_cents, r.credit_cents) = ('left'::text, 480, 380), 'his €4.80 share, €3.80 credit';
  select * into g from public.booking_guarantees where booking_id = s.booking;
  assert (g.amount_cents, g.status) = (2880, 'scheduled'::text), format('16: the guarantee goes up to €28.80 (%s)', g.amount_cents);
  assert exists (select 1 from public.money_releases m where m.stripe_intent_id = 'pi_lr_16_old' and m.status = 'pending'),
    'the €19.20 hold is released';
  assert exists (select 1 from public.guarantees_due_for_hold() d where d.guarantee_id = g.id and d.amount_cents = 2880),
    'held at once';
  g := tests.hold_guarantee(s.booking, 'pi_lr_16_new');

  -- Side B loses: the 2 holds left (€19.20) and the guarantee (€28.80).
  perform tests.end_match(s.booking);
  perform public.sync_booking_match(s.booking);
  update public.matches set status = 'confirmed', side_a_score = 2, side_b_score = 0, confirmed_at = now(),
                            confirmed_via = 'agreed' where booking_id = s.booking;
  perform public.losers_pay_settle_from_results();
  assert (select capture_cents from public.gipedo_settlements where booking_id = s.booking and guarantee_id = g.id) = 2880,
    '16: the guarantee: €28.80';
  t := tests.lp_sum(s.booking, 'lost');
  assert (t.capture, t.venue, t.futty) = (4800, 4000, 800), format('16: €48.00; venue €40.00 (%s)', t);

  -- Every spot held when counted (no guarantee): a player leaving gives the captain one, €9.60.
  s := tests.lp_book('each_pays_responsible');
  v_players := tests.lp_players(s.booking, s.booker, 4);
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.losers_pay_count_guarantees();
  assert (select status from public.booking_guarantees where booking_id = s.booking) = 'cancelled', 'none needed';
  perform tests.act_as(v_players[1]);
  perform public.losers_pay_leave(s.booking);
  perform tests.act_as_postgres();
  select * into g from public.booking_guarantees where booking_id = s.booking;
  assert (g.amount_cents, g.counted) = (960, true) and g.status <> 'cancelled', format('a €9.60 hold (%s)', row(g.amount_cents, g.status));

  -- Before the guarantee is counted, leaving changes nothing: the count covers his spot.
  s := tests.lp_book('each_pays_responsible');
  v_players := tests.lp_players(s.booking, s.booker, 1);
  perform tests.act_as(v_players[1]);
  perform public.losers_pay_leave(s.booking);
  perform tests.act_as_postgres();
  assert (select (amount_cents, counted) from public.booking_guarantees where booking_id = s.booking) = (3840, false),
    'not counted yet: unchanged';
  -- A player whose side paid for everyone holds nothing: nothing to take.
  s := tests.lp_book('pay_all');
  v_players := tests.lp_players(s.booking, s.booker, 0, p_unheld => 1);
  perform tests.act_as(v_players[1]);
  q := public.losers_pay_leave_quote(s.booking);
  perform tests.act_as_postgres();
  assert (q ->> 'held')::boolean = false and (q ->> 'capture_cents')::integer = 0, format('covered: nothing (%s)', q);
end $$;

-- 9. B1e fix: publishing an open players post again counts its joiners.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_booker uuid := tests.lp_user();
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_p uuid;
begin
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all',
                                p_kind => 'whole');
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_lr_w_' || gen_random_uuid());
  perform tests.act_as(v_booker);
  v_post := public.publish_booking(v_booking.id, 'players');
  perform tests.act_as_postgres();
  assert v_post.players_needed = 9, '9 open spots';
  for i in 1..2 loop
    v_p := tests.lp_user();
    perform tests.act_as(v_p);
    perform public.join_squad_post(v_post.id);
  end loop;
  perform tests.act_as(v_booker);
  v_post := public.publish_booking(v_booking.id, 'players');
  assert v_post.players_needed = 9, format('2 joined + 7 open = 9 (%s)', v_post.players_needed);
  v_p := tests.lp_user();
  perform tests.act_as(v_p);
  perform public.join_squad_post(v_post.id);
  perform tests.act_as_postgres();
  assert (select count(*) from public.squad_post_joiners where post_id = v_post.id) = 3, 'the next joiner gets in';
end $$;

-- 10. Grants.
do $$
begin
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.losers_pay_leave_quote(%L)', gen_random_uuid())) like 'permission denied%', 'anon: leave quote';
  assert tests.error_of(format('select public.losers_pay_pull_out_quote(%L)', gen_random_uuid())) like 'permission denied%', 'anon: pull-out quote';
  perform tests.act_as(tests.lp_user());
  assert tests.error_of(format('select public.losers_pay_play_whole(%L)', gen_random_uuid())) like 'permission denied%', 'internal: play whole';
  assert tests.error_of(format('select public.guarantee_set_amount(%L, 1, now(), ''x'')', gen_random_uuid())) like 'permission denied%',
    'internal: guarantee amount';
  assert tests.error_of(format('select public.losers_pay_leave_quote(%L)', gen_random_uuid())) = 'not_losers_pay', 'a player can ask';
  perform tests.act_as_postgres();
end $$;

rollback;
