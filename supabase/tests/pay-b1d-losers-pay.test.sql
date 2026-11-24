-- B1d (spec 13 "Losers pay (Gipedo Pano in Booking v2)", examples 7a-10b and
-- 11): Losers pay on a half pitch, each side with its own way to pay, up to
-- 5 days ahead. Every amount below is the spec's, on its €40.00 5-a-side
-- pitch (5 v 5).
--   * Pay for everyone: the captain is held for the whole pitch + €0.55 for
--     all 10 players (€45.50; Premium captain €44.95).
--   * Pay for myself: each player is held for twice his share with the fee
--     (€9.60; Premium €8.00). 24 hours before kickoff (or at once if later)
--     the side's captain gets a guarantee hold only for the side's spots
--     still without a hold, at the same per-spot amount.
--   * Nothing is taken before the result. The losing side's holds are taken
--     in full (players' holds first, then the captain's guarantee), the
--     winners' released; a draw or dispute takes half of every hold (rounded
--     down, Futty absorbs the cent). The venue always gets the full pitch.
--   * Side B accepts Losers pay knowingly (no way to accept without it).
--   * Pulling out (decided 23 November): a player leaving a pay-for-myself
--     side pays as today for his €4.80 share, the rest released; a whole
--     pay-for-myself side pulling out more than 6 hours before kickoff pays
--     €1 per player from each player's own hold, the rest released.
--   * No opponent: "Cancel free" releases everything.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.lp_user(p_premium boolean default false)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.create_user('lp-' || gen_random_uuid() || '@futty.test');
begin
  if p_premium then
    perform tests.make_premium(v);
  end if;
  return v;
end;
$$;

-- A Losers pay half pitch, side A paying p_mode; the booker's hold placed.
create function tests.lp_book(p_mode text, p_premium boolean default false, p_days integer default 3,
                              out booking uuid, out booker uuid, out venue uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  venue := tests.create_venue(p_pitches => 0);
  booker := tests.lp_user(p_premium);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(venue, tests.cyprus_today() + p_days, '12:00', '13:00', 1, '5-a-side', 5, p_mode,
                        p_kind => 'half', p_losers_pay => true);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((tests.share_of(booking, booker)).id, 'pi_lp_a_' || gen_random_uuid());
end;
$$;

-- Side B's captain accepts the public opposition post and places his hold.
create function tests.lp_side_b(p_booking uuid, p_booker uuid, p_mode text, p_premium boolean default false)
returns uuid
language plpgsql
as $$
declare
  v_post public.squad_posts;
  v_b uuid := tests.lp_user(p_premium);
  r jsonb;
begin
  perform tests.act_as(p_booker);
  v_post := public.publish_booking(p_booking, 'opposition');
  perform tests.act_as(v_b);
  r := public.accept_opposition_post(v_post.id, p_mode, p_losers_pay => true);
  perform tests.act_as_postgres();
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_lp_b_' || gen_random_uuid());
  return v_b;
end;
$$;

-- n more players join p_side (through its published post) and, if p_hold, place their holds;
-- then p_unheld more join without holding. Published once per side.
create function tests.lp_players(p_booking uuid, p_captain uuid, p_side text, p_n integer, p_hold boolean default true,
                                 p_unheld integer default 0)
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
    if p_hold and i <= p_n then
      perform tests.hold_share((tests.share_of(p_booking, v_p)).id, 'pi_lp_p_' || gen_random_uuid());
    end if;
    v_ids := v_ids || v_p;
  end loop;
  return v_ids;
end;
$$;

-- The match is played and its result confirmed (p_a:p_b), or disputed.
create function tests.lp_result(p_booking uuid, p_a integer, p_b integer, p_disputed boolean default false)
returns integer
language plpgsql
as $$
begin
  perform tests.end_match(p_booking);
  perform public.sync_booking_match(p_booking);
  update public.matches
  set status = case when p_disputed then 'disputed' else 'confirmed' end,
      side_a_score = p_a, side_b_score = p_b, confirmed_at = now(),
      confirmed_via = case when p_disputed then null else 'agreed' end
  where booking_id = p_booking;
  return public.losers_pay_settle_from_results();
end;
$$;

-- A player's settlement (his hold), or with p_guarantee his guarantee's.
create function tests.lp_row(p_booking uuid, p_profile uuid, p_guarantee boolean default false)
returns public.gipedo_settlements
language sql
as $$
  select g.* from public.gipedo_settlements g
  where g.booking_id = p_booking and g.profile_id = p_profile
    and (g.guarantee_id is not null) = p_guarantee;
$$;

create function tests.lp_taken(p_booking uuid, out capture integer, out venue integer, out futty integer)
language sql
as $$
  select coalesce(sum(capture_cents), 0)::integer, coalesce(sum(venue_cents), 0)::integer, coalesce(sum(futty_cents), 0)::integer
  from public.gipedo_settlements where booking_id = p_booking;
$$;

-- 1. Booking: half pitch only, up to 5 days ahead; the holds of examples 7a, 8a and 11.
do $$
declare
  s record;
  v public.booking_payment_shares;
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_user uuid := tests.lp_user();
begin
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(v_user);
  assert tests.error_of(format(
    'select public.book_slot(%L, %L, ''12:00'', ''13:00'', 1, ''5-a-side'', 5, ''pay_all'', p_kind => ''whole'', p_losers_pay => true)',
    v_venue, tests.cyprus_today() + 3)) = 'losers_pay_half_pitch_only', 'half pitch only';
  assert tests.error_of(format(
    'select public.book_slot(%L, %L, ''12:00'', ''13:00'', 1, ''5-a-side'', 5, ''pay_all'', p_kind => ''half'', p_losers_pay => true)',
    v_venue, tests.cyprus_today() + 6)) = 'losers_pay_too_far_ahead', 'at most 5 days ahead';
  assert tests.error_of(format(
    'select public.book_slot(%L, %L, ''12:00'', ''13:00'', 1, ''5-a-side'', 5, ''gipedo_pano'', p_kind => ''half'')',
    v_venue, tests.cyprus_today() + 3)) = 'losers_pay_needs_way_to_pay', 'Losers pay is chosen with a way to pay';
  perform tests.act_as_postgres();

  s := tests.lp_book('pay_all');
  v := tests.share_of(s.booking, s.booker);
  assert (v.amount_cents, v.pitch_cents, v.fee_cents, v.gipedo_side, v.side, v.status) = (4550, 4000, 550, 'a'::text, 'a'::text, 'authorized'::text),
    format('7a: the captain is held for €45.50 (%s)', row(v.amount_cents, v.pitch_cents, v.fee_cents, v.gipedo_side, v.status));
  assert (select losers_pay from public.venue_bookings where id = s.booking), 'a Losers pay booking';
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'confirmed once held';
  assert not exists (select 1 from public.booking_guarantees where booking_id = s.booking), 'no guarantee when paying for everyone';
  update public.booking_payment_shares set capture_due_at = now() - interval '1 minute' where id = v.id;
  assert not exists (select 1 from public.shares_due_for_capture() d where d.share_id = v.id), 'nothing is taken before the result';

  s := tests.lp_book('pay_all', p_premium => true);
  assert (tests.share_of(s.booking, s.booker)).amount_cents = 4495, '11: a Premium captain is held €44.95';

  s := tests.lp_book('each_pays_responsible');
  v := tests.share_of(s.booking, s.booker);
  assert (v.amount_cents, v.pitch_cents, v.fee_cents) = (960, 800, 160), format('8a: €9.60 (%s)', v.amount_cents);
  assert (select (amount_cents, counted) from public.booking_guarantees where booking_id = s.booking)
         = (3840, false), 'the guarantee waits to be counted 24 hours before kickoff';

  s := tests.lp_book('each_pays_responsible', p_premium => true);
  assert (tests.share_of(s.booking, s.booker)).amount_cents = 800, '11: a Premium player is held €8.00';
end $$;

-- 2. Side B accepts knowingly; side B's and joiners' holds.
do $$
declare
  s record := tests.lp_book('pay_all');
  v_post public.squad_posts;
  v_b uuid := tests.lp_user();
  r jsonb;
  v_a_players uuid[];
  v_b_players uuid[];
begin
  perform tests.act_as(s.booker);
  v_post := public.publish_booking(s.booking, 'opposition');
  perform tests.act_as(v_b);
  assert tests.error_of(format('select public.accept_opposition_post(%L, ''pay_all'')', v_post.id)) = 'accept_losers_pay',
    'no way to accept without accepting Losers pay';
  r := public.accept_opposition_post(v_post.id, 'each_pays_responsible', p_losers_pay => true);
  perform tests.act_as_postgres();
  assert (r ->> 'amount_cents')::integer = 960, 'side B''s captain: €9.60';
  assert (select (gipedo_side, amount_cents) from public.booking_payment_shares where id = (r ->> 'share_id')::uuid)
         = ('b'::text, 960), 'his hold';
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_lp_b_' || gen_random_uuid());

  v_a_players := tests.lp_players(s.booking, s.booker, 'a', 1, p_hold => false);
  assert (tests.share_of(s.booking, v_a_players[1])).status = 'covered', 'side A paid for everyone: covered';
  v_b_players := tests.lp_players(s.booking, v_b, 'b', 1, p_hold => false);
  assert ((tests.share_of(s.booking, v_b_players[1])).amount_cents, (tests.share_of(s.booking, v_b_players[1])).gipedo_side)
         = (960, 'b'::text), 'a side B joiner is held €9.60';
  -- A joiner pays his hold whenever he joins: only side B's captain has the payment window.
  update public.booking_payment_shares set created_at = now() - interval '1 hour'
  where booking_id = s.booking and profile_id = v_b_players[1];
  perform tests.hold_share((tests.share_of(s.booking, v_b_players[1])).id, 'pi_lp_j_' || gen_random_uuid());
  assert (tests.share_of(s.booking, v_b_players[1])).status = 'authorized', 'held';

end $$;

-- 3. Examples 7a, 7b, 7c: both sides pay for everyone.
do $$
declare
  s record;
  v_b uuid;
  t record;
begin
  -- 7a: side B loses: its €45.50 is taken, side A's released.
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'pay_all');
  assert tests.lp_result(s.booking, 3, 1) = 2, 'both holds settle';
  assert ((tests.lp_row(s.booking, v_b)).reason, (tests.lp_row(s.booking, v_b)).capture_cents) = ('lost'::text, 4550), '7a: €45.50 taken';
  assert ((tests.lp_row(s.booking, s.booker)).reason, (tests.lp_row(s.booking, s.booker)).capture_cents) = ('won'::text, 0), 'released';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4550, 4000, 550), format('7a: venue €40.00, Futty €5.50 (%s)', t);
  assert public.losers_pay_settle_from_results() = 0, 'settled once';

  -- 7b: a draw: €22.75 from each captain.
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'pay_all');
  perform tests.lp_result(s.booking, 2, 2);
  assert ((tests.lp_row(s.booking, s.booker)).capture_cents, (tests.lp_row(s.booking, v_b)).capture_cents) = (2275, 2275), '7b';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4550, 4000, 550), format('7b (%s)', t);

  -- 7c: the same draw with a Premium captain on side B (held €44.95).
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'pay_all', p_premium => true);
  assert (tests.share_of(s.booking, v_b)).amount_cents = 4495, 'held €44.95';
  perform tests.lp_result(s.booking, 1, 1);
  assert ((tests.lp_row(s.booking, s.booker)).capture_cents, (tests.lp_row(s.booking, v_b)).capture_cents) = (2275, 2247),
    '7c: €22.75 and €22.47';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4522, 4000, 522), format('7c: €45.22; venue €40.00, Futty €5.22 (%s)', t);

  -- A dispute settles as a draw.
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'pay_all');
  perform tests.lp_result(s.booking, 3, 0, p_disputed => true);
  assert ((tests.lp_row(s.booking, s.booker)).reason, (tests.lp_row(s.booking, v_b)).capture_cents) = ('split'::text, 2275), 'a dispute: half';
end $$;

-- 4. Examples 8a, 8b: both sides pay for myself, every player held.
do $$
declare
  s record;
  v_b uuid;
  v_a_players uuid[];
  v_b_players uuid[];
  t record;
begin
  s := tests.lp_book('each_pays_responsible');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  v_a_players := tests.lp_players(s.booking, s.booker, 'a', 4);
  v_b_players := tests.lp_players(s.booking, v_b, 'b', 4);
  perform tests.lp_result(s.booking, 2, 0);
  assert (select count(*) from public.gipedo_settlements where booking_id = s.booking and side = 'b' and capture_cents = 960) = 5,
    '8a: side B''s five holds of €9.60';
  assert (select count(*) from public.gipedo_settlements where booking_id = s.booking and side = 'a' and capture_cents = 0) = 5,
    'side A''s released';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4800, 4000, 800), format('8a: €48.00; venue €40.00, Futty €8.00 (%s)', t);

  s := tests.lp_book('each_pays_responsible');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  v_a_players := tests.lp_players(s.booking, s.booker, 'a', 4);
  v_b_players := tests.lp_players(s.booking, v_b, 'b', 4);
  perform tests.lp_result(s.booking, 1, 1);
  assert (select count(*) from public.gipedo_settlements where booking_id = s.booking and capture_cents = 480) = 10,
    '8b: €4.80 from each of the 10';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4800, 4000, 800), format('8b (%s)', t);
end $$;

-- 5. Examples 9a, 9b, 9c: side A pays for everyone, side B for myself.
do $$
declare
  s record;
  v_b uuid;
  t record;
begin
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  perform tests.lp_players(s.booking, v_b, 'b', 4);
  perform tests.lp_result(s.booking, 0, 2);
  assert (tests.lp_row(s.booking, s.booker)).capture_cents = 4550, '9a: side A''s €45.50 taken';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4550, 4000, 550), format('9a (%s)', t);

  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  perform tests.lp_players(s.booking, v_b, 'b', 4);
  perform tests.lp_result(s.booking, 2, 0);
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4800, 4000, 800), format('9b: side B''s €48.00 (%s)', t);
  assert (tests.lp_row(s.booking, s.booker)).capture_cents = 0, 'side A released';

  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  perform tests.lp_players(s.booking, v_b, 'b', 4);
  perform tests.lp_result(s.booking, 0, 0);
  assert (tests.lp_row(s.booking, s.booker)).capture_cents = 2275, '9c: side A''s captain €22.75';
  assert (select count(*) from public.gipedo_settlements where booking_id = s.booking and side = 'b' and capture_cents = 480) = 5,
    'each side B player €4.80';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4675, 4000, 675), format('9c: €46.75 (%s)', t);
end $$;

-- 6. Examples 10a, 10b: 2 of side B's 5 players never held. 24 hours before
--    kickoff side B's captain gets a guarantee for those 2 spots: €19.20.
do $$
declare
  s record;
  v_b uuid;
  g public.booking_guarantees;
  t record;
begin
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  perform tests.lp_players(s.booking, v_b, 'b', 2, p_unheld => 2);
  perform public.losers_pay_count_guarantees();
  assert not (select counted from public.booking_guarantees where booking_id = s.booking and profile_id = v_b),
    'not before 24 hours before kickoff';
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  assert public.losers_pay_count_guarantees() >= 1, 'counted';
  select * into g from public.booking_guarantees where booking_id = s.booking and profile_id = v_b;
  assert (g.amount_cents, g.counted) = (1920, true), format('10a: 2 × €9.60 = €19.20 (%s)', g.amount_cents);
  update public.booking_guarantees set stripe_customer_id = 'cus_lp' where id = g.id;  -- test users have no Stripe customer
  assert exists (select 1 from public.guarantees_due_for_hold() d where d.guarantee_id = g.id), 'then held';
  perform tests.hold_guarantee(s.booking);
  perform tests.lp_result(s.booking, 3, 0);
  assert (tests.lp_row(s.booking, v_b, p_guarantee => true)).capture_cents = 1920, 'the captain''s guarantee: €19.20';
  assert (select count(*) from public.gipedo_settlements where booking_id = s.booking and side = 'b' and guarantee_id is null
            and capture_cents = 960) = 3, 'the 3 players'' holds first: €28.80';
  t := tests.lp_taken(s.booking);
  assert (t.capture, t.venue, t.futty) = (4800, 4000, 800), format('10a: €48.00 (%s)', t);

  -- 10b: side B wins: nothing taken from side B; its holds and guarantee released.
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  perform tests.lp_players(s.booking, v_b, 'b', 2, p_unheld => 2);
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.losers_pay_count_guarantees();
  perform tests.hold_guarantee(s.booking);
  perform tests.lp_result(s.booking, 0, 1);
  assert (select coalesce(sum(capture_cents), 0) from public.gipedo_settlements where booking_id = s.booking and side = 'b') = 0,
    '10b: nothing from side B';
  assert (tests.lp_row(s.booking, v_b, p_guarantee => true)).reason = 'won', 'the guarantee released';
  assert (tests.lp_row(s.booking, s.booker)).capture_cents = 4550, 'side A pays';

  -- Every spot held by 24 hours before kickoff: no guarantee.
  s := tests.lp_book('each_pays_responsible');
  perform tests.lp_players(s.booking, s.booker, 'a', 4);
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.losers_pay_count_guarantees();
  assert (select status from public.booking_guarantees where booking_id = s.booking) = 'cancelled', 'nothing to guarantee';
end $$;

-- 7. The settlement is carried out by the Gipedo Pano machinery: a guarantee
--    taken is recorded against the guarantee in the ledger.
do $$
declare
  s record := tests.lp_book('pay_all');
  v_b uuid := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  g public.booking_guarantees;
  r public.gipedo_settlements;
begin
  perform tests.lp_players(s.booking, v_b, 'b', 1, p_unheld => 3);
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.losers_pay_count_guarantees();
  g := tests.hold_guarantee(s.booking);
  assert g.amount_cents = 2880, '3 spots without a hold: €28.80';
  perform tests.lp_result(s.booking, 5, 0);
  r := tests.lp_row(s.booking, v_b, p_guarantee => true);
  -- Earlier examples' settlements are still due in this transaction: out of the way.
  update public.gipedo_settlements set claimed_at = now() where booking_id <> s.booking and status = 'due';
  assert exists (select 1 from public.gipedo_settlements_due() d where d.settlement_id = r.id and d.hold_live
                   and d.stripe_payment_intent_id = g.stripe_payment_intent_id and d.capture_cents = 2880), 'due at Stripe';
  perform public.gipedo_settlement_done(r.id, 'captured', 2880, 68);
  assert exists (select 1 from public.money_ledger l where l.kind = 'capture' and l.guarantee_id = g.id and l.amount_cents = 2880
                   and l.venue_cents = 2400), 'in the ledger against the guarantee';
  r := tests.lp_row(s.booking, s.booker);
  perform public.gipedo_settlement_done(r.id, 'released');
  assert (tests.share_of(s.booking, s.booker)).status = 'cancelled', 'the winner''s hold released';
end $$;

-- 8. Pulling out (decided by Panos, 23 November).
do $$
declare
  s record;
  v_b uuid;
  v_players uuid[];
  v_share public.booking_payment_shares;
  r public.gipedo_settlements;
begin
  -- Rule 1: a player leaves a pay-for-myself side in his free hour: all released.
  s := tests.lp_book('each_pays_responsible');
  v_players := tests.lp_players(s.booking, s.booker, 'a', 2);
  perform tests.act_as(v_players[1]);
  perform public.losers_pay_leave(s.booking);
  perform tests.act_as_postgres();
  r := tests.lp_row(s.booking, v_players[1]);
  assert (r.reason, r.capture_cents) = ('left'::text, 0), format('free hour: everything back (%s)', row(r.reason, r.capture_cents));

  -- After his free hour: his €4.80 share is taken, €1 kept and €3.80 becomes credit; the rest released.
  update public.booking_payment_shares set held_at = now() - interval '2 hours' where booking_id = s.booking and profile_id = v_players[2];
  perform tests.act_as(v_players[2]);
  perform public.losers_pay_leave(s.booking);
  perform tests.act_as_postgres();
  r := tests.lp_row(s.booking, v_players[2]);
  assert (r.capture_cents, r.venue_cents, r.futty_cents, r.credit_cents) = (480, 400, 80, 380),
    format('€4.80 taken, €3.80 credit (%s)', row(r.capture_cents, r.venue_cents, r.futty_cents, r.credit_cents));
  perform public.gipedo_settlement_done(r.id, 'captured', 480, 32);
  assert (select sum(amount_cents) from public.venue_credits where profile_id = v_players[2]) = 380, 'his €3.80 credit';

  -- Less than 6 hours before kickoff: his €4.80 share, nothing back.
  s := tests.lp_book('each_pays_responsible');
  v_players := tests.lp_players(s.booking, s.booker, 'a', 1);
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  perform tests.act_as(v_players[1]);
  perform public.losers_pay_leave(s.booking);
  perform tests.act_as_postgres();
  r := tests.lp_row(s.booking, v_players[1]);
  assert (r.capture_cents, r.credit_cents) = (480, 0), 'under 6 hours: nothing back';
  perform tests.act_as(s.booker);
  assert tests.error_of(format('select public.losers_pay_leave(%L)', s.booking)) = 'captain_pulls_out_side',
    'a captain pulls his whole side out instead';
  perform tests.act_as_postgres();

  -- Rule 2: a whole pay-for-myself side pulls out more than 6 hours before kickoff: €1 from each player's own hold.
  s := tests.lp_book('pay_all');
  v_b := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
  v_players := tests.lp_players(s.booking, v_b, 'b', 2, p_unheld => 1);
  perform tests.act_as(v_b);
  perform public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();
  assert (select count(*) from public.gipedo_settlements where booking_id = s.booking and side = 'b'
            and reason = 'pull_out_fee' and capture_cents = 100 and futty_cents = 100) = 3, '€1 from each of the 3 holds';
  assert not exists (select 1 from public.booking_sides where booking_id = s.booking and side = 'b'), 'side B is gone';
  assert (select status from public.squad_posts where venue_booking_id = s.booking and type = 'opposition') = 'open',
    'the opposition post opens again';
  assert (select status from public.booking_payment_shares where booking_id = s.booking and side = 'b' and status = 'pending'
          limit 1) is null, 'shares never held are cancelled';
end $$;

-- 9. No opponent 24 hours before kickoff: "Cancel free" releases every hold.
do $$
declare
  s record := tests.lp_book('each_pays_responsible');
begin
  perform tests.lp_players(s.booking, s.booker, 'a', 1);
  perform tests.set_kickoff(s.booking, now() + interval '20 hours');
  perform public.booking_no_opponent_due();
  perform tests.act_as(s.booker);
  assert (public.booking_no_opponent_choice(s.booking, 'cancel')) ->> 'result' = 'cancelled', 'cancelled free';
  perform tests.act_as_postgres();
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
  assert not exists (select 1 from public.gipedo_settlements where booking_id = s.booking and capture_cents > 0), 'nothing taken';
  assert not exists (select 1 from public.guarantees_due_for_hold() d where d.booking_id = s.booking), 'no guarantee is held';
  assert exists (select 1 from public.bookings_with_money_to_release() r where r.booking_id = s.booking), 'the holds are released';
end $$;

-- 10. A Losers pay booking never goes through Gipedo Pano's or the usual
--     cancellation: it has its own ways out, and no Gipedo Pano panel.
do $$
declare
  s record := tests.lp_book('each_pays_responsible');
  v_players uuid[] := tests.lp_players(s.booking, s.booker, 'a', 1);
begin
  assert tests.error_of(format('select tests.cancel(%L, ''my_spot'', %L)', s.booking, v_players[1])) = 'use_losers_pay_leave',
    'a player leaves with losers_pay_leave';
  perform tests.act_as(s.booker);
  assert tests.error_of(format('select public.gipedo_pull_out(%L)', s.booking)) = 'use_losers_pay_pull_out',
    'not Gipedo Pano''s pull-out';
  assert public.booking_detail(s.booking) -> 'gipedo' = 'null'::jsonb, 'no Gipedo Pano panel';
  perform tests.act_as_postgres();
  perform tests.set_kickoff(s.booking, now() + interval '20 hours');
  perform public.booking_no_opponent_due();
  -- A lone side pulling out and "Pay the whole pitch and play" (decided 24
  -- November): pay-b1d-losers-pay-rules.test.sql. The holds pay for the
  -- whole pitch, never a payment sheet.
  assert tests.error_of(format('select public.plan_other_half_payment(%L, %L)', s.booking, s.booker))
         = 'losers_pay_play_whole_not_available', '"Pay the whole pitch and play" on Losers pay needs no payment';
end $$;

-- 11. What the app shows, from the server: the checkout's holds, side B's
--     holds on a public post, a joiner's hold.
do $$
declare
  s record := tests.lp_book('pay_all');
  v_user uuid := tests.lp_user();
  q jsonb;
  d record;
  v_post public.squad_posts;
  pq record;
  v_b uuid;
begin
  perform tests.act_as(v_user);
  q := public.booking_quote_v2(s.venue, tests.cyprus_today() + 3, '14:00', '15:00', '5-a-side');
  perform tests.act_as_postgres();
  assert (q #>> '{half,losers_pay,available}')::boolean, 'offered';
  assert (q #>> '{half,losers_pay,pay_all,card_cents}')::integer = 4550, '7a at checkout';
  assert (q #>> '{half,losers_pay,pay_for_myself,card_cents}')::integer = 960, '8a at checkout';
  assert (q #>> '{half,losers_pay,pay_for_myself,spot_cents}')::integer = 960, 'per spot';
  perform tests.act_as(v_user);
  q := public.booking_quote_v2(s.venue, tests.cyprus_today() + 6, '14:00', '15:00', '5-a-side');
  perform tests.act_as_postgres();
  assert not (q #>> '{half,losers_pay,available}')::boolean, 'not more than 5 days ahead';

  perform tests.act_as(s.booker);
  v_post := public.publish_booking(s.booking, 'opposition');
  perform tests.act_as(v_user);
  select * into d from public.opposition_post_detail(v_post.id);
  select * into pq from public.booking_post_quotes(array[v_post.id]);
  perform tests.act_as_postgres();
  assert (d.losers_pay, d.losers_pay_all_cents, d.losers_each_pays_cents, d.losers_spot_cents) = (true, 4550, 960, 960),
    format('side B sees Losers pay and its holds (%s)', row(d.losers_pay, d.losers_pay_all_cents, d.losers_each_pays_cents));
  assert (pq.pay_all_cents, pq.each_pays_cents) = (4550, 960), 'and on the card in Find a game';

  v_b := tests.lp_user();
  perform tests.act_as(v_b);
  perform public.accept_opposition_post(v_post.id, 'each_pays_responsible', p_losers_pay => true);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(s.booking, v_b)).id, 'pi_lp_q_' || gen_random_uuid());
  perform tests.act_as(v_b);
  v_post := public.publish_booking(s.booking, 'players');
  perform tests.act_as(v_user);
  select * into pq from public.booking_post_quotes(array[v_post.id]);
  perform tests.act_as_postgres();
  assert (pq.join_cents, pq.join_pitch_cents, pq.join_fee_cents) = (960, 800, 160), 'a side B joiner is held €9.60';
end $$;

-- 12. After the match only the settlement takes money: no collection of a
--     pay-for-myself side, and no second odd cent (the settlement gives the
--     venue the full pitch).
do $$
declare
  s record := tests.lp_book('each_pays_responsible');
  v_b uuid := tests.lp_side_b(s.booking, s.booker, 'each_pays_responsible');
begin
  update public.venue_bookings set amount_cents = 4001 where id = s.booking;
  perform tests.end_match(s.booking);
  assert not exists (select 1 from public.collections_due() c where c.booking_id = s.booking), 'no collection';
  perform public.booking_odd_cent_due();
  assert not exists (select 1 from public.money_ledger l where l.booking_id = s.booking and l.reason = 'odd_cent_absorbed'),
    'no separate odd cent';
end $$;

-- 13. Grants.
do $$
begin
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.losers_pay_leave(%L)', gen_random_uuid())) like 'permission denied%', 'anon: leave';
  assert tests.error_of(format('select public.losers_pay_pull_out(%L)', gen_random_uuid())) like 'permission denied%', 'anon: pull out';
  perform tests.act_as(tests.lp_user());
  assert tests.error_of('select public.losers_pay_settle_from_results()') like 'permission denied%', 'internal: settle';
  assert tests.error_of('select public.losers_pay_count_guarantees()') like 'permission denied%', 'internal: guarantees';
  perform tests.act_as_postgres();
end $$;

rollback;
