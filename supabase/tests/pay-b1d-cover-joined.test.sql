-- B1d, question 1 from #185 (decided by Panos, 24 November; spec 13
-- "Pulling out", rule 4): after a side pulls out less than 6 hours before
-- kickoff, every player on the remaining side who hasn't placed a hold yet is
-- covered: no hold is asked and a hold request already started is cancelled.
-- Players who already hold are released, as before. On the €40.00 5-a-side
-- pitch: a Losers pay hold paying for myself is €9.60, paying for everyone
-- €45.50 (examples 7a, 8a, 14b).
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.cj_user()
returns uuid
language sql
as $$ select tests.create_user('cj-' || gen_random_uuid() || '@futty.test') $$;

-- Side A pays for myself (the booker holds €9.60); side B's captain pays for
-- everyone and holds €45.50. Side A's post: p1 holds, p2 joins and asks for
-- nothing yet, p3 starts paying (an intent, not confirmed).
create function tests.cj_book(out booking uuid, out booker uuid, out side_b uuid, out p1 uuid, out p2 uuid, out p3 uuid,
                               out p3_intent text)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
  v_post public.squad_posts;
  r jsonb;
begin
  booker := tests.cj_user();
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible',
                        p_kind => 'half', p_losers_pay => true);
  booking := v.id;
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(booking, booker)).id, 'pi_cj_a_' || gen_random_uuid());

  perform tests.act_as(booker);
  v_post := public.publish_booking(booking, 'opposition');
  side_b := tests.cj_user();
  perform tests.act_as(side_b);
  r := public.accept_opposition_post(v_post.id, 'pay_all', p_losers_pay => true);
  perform tests.act_as_postgres();
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_cj_b_' || gen_random_uuid());

  perform tests.act_as(booker);
  v_post := public.publish_booking(booking, 'players');
  p1 := tests.cj_user();
  p2 := tests.cj_user();
  p3 := tests.cj_user();
  perform tests.act_as(p1);
  perform public.join_squad_post(v_post.id);
  perform tests.act_as(p2);
  perform public.join_squad_post(v_post.id);
  perform tests.act_as(p3);
  perform public.join_squad_post(v_post.id);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(booking, p1)).id, 'pi_cj_p1_' || gen_random_uuid());
  p3_intent := 'pi_cj_p3_' || gen_random_uuid();
  perform tests.pay_share((tests.share_of(booking, p3)).id, p3_intent);
end;
$$;

-- 1. The allowed case before any pull-out: each unheld player is asked for
--    a €9.60 hold; p3's request is open.
do $$
declare
  s record := tests.cj_book();
begin
  assert ((tests.share_of(s.booking, s.p2)).status, (tests.share_of(s.booking, s.p2)).amount_cents) = ('pending'::text, 960),
    'p2 is asked for €9.60';
  assert (tests.share_of(s.booking, s.p3)).stripe_payment_intent_id = s.p3_intent, 'p3 started paying';
end $$;

-- 2. Side B pulls out 5 hours before kickoff and pays as the losing side
--    (14b: €45.50 taken, venue €40.00). Side A's unheld players are covered,
--    p3's hold request is cancelled; the booker and p1 are released.
do $$
declare
  s record := tests.cj_book();
  v_share public.booking_payment_shares;
  r jsonb;
begin
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  perform tests.act_as(s.side_b);
  assert public.losers_pay_pull_out(s.booking) ->> 'result' = 'lost', 'as the losing side';
  perform tests.act_as_postgres();

  assert (select (sum(capture_cents), sum(venue_cents)) from public.gipedo_settlements
          where booking_id = s.booking and reason = 'lost') = (4550::bigint, 4000::bigint), '14b: €45.50 taken, venue €40.00';

  for v_share in select * from public.booking_payment_shares where booking_id = s.booking and profile_id in (s.p2, s.p3) loop
    assert (v_share.status, v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents) = ('covered'::text, 0, 0, 0)
           and v_share.gipedo_side is null and v_share.stripe_payment_intent_id is null,
      format('an unheld player is covered, nothing asked (%s)', row_to_json(v_share));
  end loop;
  assert exists (select 1 from public.money_releases where booking_id = s.booking and stripe_intent_id = s.p3_intent
                   and status = 'pending'), 'p3''s hold request is cancelled at Stripe by the release job';
  assert s.p3_intent = any ((tests.share_of(s.booking, s.p3)).replaced_intent_ids), 'p3''s old request is remembered';

  -- Held players are released as before: a won settlement, nothing taken.
  assert (select count(*) from public.gipedo_settlements
          where booking_id = s.booking and reason = 'won' and capture_cents = 0 and share_id is not null
            and profile_id in (s.booker, s.p1)) = 2, 'the booker''s and p1''s €9.60 holds are released';
  assert not exists (select 1 from public.gipedo_settlements
                     where booking_id = s.booking and profile_id <> s.side_b and capture_cents > 0),
    'nothing is taken from side A, its captain''s guarantee included';
  assert (tests.share_of(s.booking, s.p1)).status = 'authorized', 'p1''s share is left to its settlement';

  -- Nothing more is asked of p2: create-share-payment's plan refuses.
  assert tests.error_of(format('select public.plan_share_payment(%L, %L, ''card'', false)',
                               (tests.share_of(s.booking, s.p2)).id, s.p2)) = 'share_not_pending', 'no hold asked';

  -- If p3 confirms the old request anyway, it's released, never taken.
  r := public.share_payment_held((tests.share_of(s.booking, s.p3)).id, s.p3_intent, 960, 'pm_cj', now());
  assert r ->> 'result' = 'release', format('a late hold is released (%s)', r);
  assert (tests.share_of(s.booking, s.p3)).status = 'covered', 'p3 stays covered';
end $$;

-- 3. More than 6 hours before kickoff it's a €1 per player pull-out, not
--    this case: side A's unheld players are still asked to hold.
do $$
declare
  s record := tests.cj_book();
begin
  perform tests.act_as(s.side_b);
  assert public.losers_pay_pull_out(s.booking) ->> 'result' = 'pulled_out', 'an early pull-out';
  perform tests.act_as_postgres();
  assert ((tests.share_of(s.booking, s.p2)).status, (tests.share_of(s.booking, s.p2)).amount_cents) = ('pending'::text, 960),
    'p2 is still asked for €9.60';
  assert not exists (select 1 from public.money_releases where booking_id = s.booking and stripe_intent_id = s.p3_intent),
    'p3''s request stands';
end $$;

rollback;
