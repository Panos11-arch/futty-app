-- B1c, part 2d (Booking v2, spec 13): each captain is the booker of his own
-- half, so a half pitch is collected side by side 2 hours after the match:
-- only a side paying for myself has a collection, against its own players
-- and its own captain's guarantee (his side's half). And the odd cent: each
-- side pays its half rounded down, the venue still gets the full pitch price
-- and Futty absorbs the cent (decided 23 November), as one ledger transfer
-- once the match is over.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.b1c5_setup(p_mode_a text, p_mode_b text, p_price integer default 4000,
                                 out booking uuid, out a uuid, out b uuid)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
  r jsonb;
begin
  a := tests.create_user('b1c5-a-' || gen_random_uuid() || '@futty.test');
  b := tests.create_user('b1c5-b-' || gen_random_uuid() || '@futty.test');
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', p_price);
  perform tests.act_as(a);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode_a, p_kind => 'half');
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = booking and profile_id = a),
                           'pi_b1c5_a_' || gen_random_uuid());
  perform tests.act_as(a);
  perform public.invite_opposition(booking, array[b]);
  perform tests.act_as(b);
  r := public.accept_opposition((select id from public.booking_opposition_invites where booking_id = booking), p_mode_b);
  perform tests.act_as_postgres();
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_b1c5_b_' || gen_random_uuid());
  -- Side B pays for myself: two players join and never pay.
  if p_mode_b = 'each_pays_responsible' then
    perform public.add_booking_side_share_internal(booking, tests.create_user('b1c5-u1-' || gen_random_uuid() || '@futty.test'), 'b');
    perform public.add_booking_side_share_internal(booking, tests.create_user('b1c5-u2-' || gen_random_uuid() || '@futty.test'), 'b');
  end if;
  -- The match is over, more than 2 hours ago.
  perform tests.set_kickoff(booking, now() - interval '3 hours 30 minutes');
end;
$$;

-- 1. Side A pays for everyone, side B pays for myself: only side B is
--    collected, from side B's unpaid players, against side B's captain's
--    €20.00 guarantee.
do $$
declare
  s record := tests.b1c5_setup('pay_all', 'each_pays_responsible');
  v jsonb;
  c public.booking_collections;
begin
  assert (select array_agg(coalesce(d.side, '-')) from public.collections_due() d where d.booking_id = s.booking) = array['b'],
    'only side B is due';
  v := public.start_collection(s.booking, 'b');
  select * into c from public.booking_collections where id = (v ->> 'collection_id')::uuid;
  assert (c.side, c.payment_mode) = ('b'::text, 'each_pays_responsible'::text), 'side B''s collection';
  assert c.guarantee_id = (select id from public.booking_guarantees where booking_id = s.booking and profile_id = s.b),
    'against side B''s captain''s guarantee';
  assert (select count(*) from public.booking_collection_items i
          join public.booking_payment_shares sh on sh.id = i.share_id
          where i.collection_id = c.id and sh.side = 'b' and i.kind = 'unpaid_share') = 2, 'his two unpaid players';
  assert not exists (select 1 from public.booking_collection_items i
                     join public.booking_payment_shares sh on sh.id = i.share_id
                     where i.collection_id = c.id and sh.side = 'a'), 'nothing of side A';
  assert not exists (select 1 from public.collections_due() d where d.booking_id = s.booking and d.collection_id is null),
    'started once';
  assert tests.error_of(format('select public.start_collection(%L)', s.booking)) = 'side_required', 'a half pitch needs its side';
  assert public.payout_ready_at((select b from public.venue_bookings b where b.id = s.booking)) is null,
    'the venue''s payout waits for side B''s collection';
end $$;

-- 2. Both sides pay for myself: two collections, each its captain's guarantee.
do $$
declare
  s record := tests.b1c5_setup('each_pays_responsible', 'each_pays_responsible');
  ca jsonb;
  cb jsonb;
  ga uuid;
  gb uuid;
begin
  assert (select array_agg(d.side order by d.side) from public.collections_due() d where d.booking_id = s.booking)
         = array['a', 'b'], 'both sides are due';
  ca := public.start_collection(s.booking, 'a');
  cb := public.start_collection(s.booking, 'b');
  ga := (select guarantee_id from public.booking_collections where id = (ca ->> 'collection_id')::uuid);
  gb := (select guarantee_id from public.booking_collections where id = (cb ->> 'collection_id')::uuid);
  assert ga = (select id from public.booking_guarantees where booking_id = s.booking and profile_id = s.a), 'side A''s';
  assert gb = (select id from public.booking_guarantees where booking_id = s.booking and profile_id = s.b), 'side B''s';
end $$;

-- 3. Both sides pay for everyone: nothing to collect.
do $$
declare
  s record := tests.b1c5_setup('pay_all', 'pay_all');
begin
  assert not exists (select 1 from public.collections_due() d where d.booking_id = s.booking), 'nothing due';
end $$;

-- 4. The odd cent: a €45.55 pitch, each side €22.77, the venue €45.54 from
--    the two payments; once the match is over one transfer gives the venue
--    the last cent, from Futty.
do $$
declare
  s record := tests.b1c5_setup('pay_all', 'pay_all', 4555);
  e record := tests.b1c5_setup('pay_all', 'pay_all', 4000);
  l record;
begin
  perform public.booking_odd_cent_due();
  select * into l from public.money_ledger where booking_id = s.booking and kind = 'transfer';
  assert (l.amount_cents, l.venue_cents, l.futty_cents, l.reason) = (1, 1, -1, 'odd_cent_absorbed'),
    format('the cent: %s', row(l.amount_cents, l.venue_cents, l.futty_cents, l.reason));
  perform public.booking_odd_cent_due();
  assert (select count(*) from public.money_ledger where booking_id = s.booking and kind = 'transfer') = 1, 'once';
  assert not exists (select 1 from public.money_ledger where booking_id = e.booking and kind = 'transfer'),
    'an even price has no odd cent';
end $$;

-- 5. Not before the match is over.
do $$
declare
  s record := tests.b1c5_setup('pay_all', 'pay_all', 4555);
begin
  perform tests.set_kickoff(s.booking, now() + interval '2 days');
  perform public.booking_odd_cent_due();
  assert not exists (select 1 from public.money_ledger where booking_id = s.booking and kind = 'transfer'), 'not yet';
end $$;

-- 6. The jobs are the server's.
do $$
declare
  s record := tests.b1c5_setup('pay_all', 'pay_all');
begin
  perform tests.act_as(s.a);
  assert tests.error_of('select public.booking_odd_cent_due()') like '%permission denied%', 'server only';
  assert tests.error_of(format('select public.start_collection(%L, ''a'')', s.booking)) like '%permission denied%', 'server only';
  perform tests.act_as_postgres();
end $$;

rollback;
