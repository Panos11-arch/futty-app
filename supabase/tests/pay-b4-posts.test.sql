-- B4 (Booking v2, spec 13 "Publish game" and "Invites, after payment"): the
-- posts section ("Find a game") for Booking v2 posts.
--   * booking_post_quotes: each post's price for its side from the server
--     (a joiner pays nothing when his side paid for everyone, his own share
--     when it pays for myself), side B's price on an opposition post, whether
--     it's still open (full, unpublished, found, cancelled or closed 24 hours
--     before kickoff = not open) and whether it's the caller's to unpublish.
--   * opposition_post_detail: side B's accept screen for a public post.
--   * my_publishable_bookings: the caller's games he can publish or unpublish.
--   * Opposition posts close 24 hours before kickoff (booking_no_opponent_due).
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.b4_book(p_kind text, p_mode text, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
begin
  booker := tests.create_user('b4-booker-' || gen_random_uuid() || '@futty.test');
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => p_kind);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = booking and profile_id = booker),
                           'pi_b4_' || gen_random_uuid());
end;
$$;

create function tests.b4_publish(p_booking uuid, p_as uuid, p_kind text)
returns uuid
language plpgsql
as $$
declare
  v public.squad_posts;
begin
  perform tests.act_as(p_as);
  v := public.publish_booking(p_booking, p_kind);
  perform tests.act_as_postgres();
  return v.id;
end;
$$;

-- One post's quote, as p_as sees it.
create function tests.b4_quote(p_post uuid, p_as uuid,
  out post_id uuid, out kind text, out side text, out mine boolean, out open boolean, out closes_at timestamptz,
  out join_cents integer, out join_pitch_cents integer, out join_fee_cents integer,
  out pay_all_cents integer, out each_pays_cents integer, out guarantee_cents integer)
language plpgsql
as $$
begin
  perform tests.act_as(p_as);
  select * into post_id, kind, side, mine, open, closes_at, join_cents, join_pitch_cents, join_fee_cents,
                pay_all_cents, each_pays_cents, guarantee_cents
  from public.booking_post_quotes(array[p_post]);
  perform tests.act_as_postgres();
end;
$$;

create function tests.b4_user()
returns uuid
language sql
as $$ select tests.create_user('b4-u-' || gen_random_uuid() || '@futty.test') $$;

-- 1. Joining a whole pitch: nothing when the booker paid for everyone,
--    €4.80 when each pays for myself (€4.00 for a Premium player).
do $$
declare
  a record := tests.b4_book('whole', 'pay_all');
  b record := tests.b4_book('whole', 'each_pays_responsible');
  v_player uuid := tests.b4_user();
  v_premium uuid := tests.b4_user();
  q record;
  pa uuid := tests.b4_publish(a.booking, a.booker, 'players');
  pb uuid := tests.b4_publish(b.booking, b.booker, 'players');
begin
  perform tests.make_premium(v_premium);
  q := tests.b4_quote(pa, v_player);
  assert (q.kind, q.open, q.mine, q.join_cents, q.join_fee_cents) = ('players'::text, true, false, 0, 0),
    format('pay for everyone: nothing to pay (%s)', q);
  q := tests.b4_quote(pb, v_player);
  assert (q.join_cents, q.join_pitch_cents, q.join_fee_cents) = (480, 400, 80),
    format('pay for myself: €4.80 (%s)', q);
  q := tests.b4_quote(pb, v_premium);
  assert (q.join_cents, q.join_fee_cents) = (400, 0), format('Premium: €4.00 (%s)', q);
  assert q.closes_at = public.booking_kickoff_at(tests.cyprus_today() + 3, '12:00'), 'a players post closes at kickoff';

  -- The booker's own post is his to unpublish.
  q := tests.b4_quote(pa, a.booker);
  assert q.mine, 'his post';
  -- Each quote matches what joining actually charges.
  perform tests.act_as(v_player);
  perform public.join_squad_post(pb);
  perform tests.act_as_postgres();
  assert (select amount_cents from public.booking_payment_shares where booking_id = b.booking and profile_id = v_player) = 480,
    'the share he joins with is the quote';
end $$;

-- 2. A half pitch: each side's players post is priced as that side pays.
do $$
declare
  s record := tests.b4_book('half', 'pay_all');
  v_b uuid := tests.b4_user();
  v_player uuid := tests.b4_user();
  r jsonb;
  pa uuid;
  pb uuid;
  q record;
begin
  pa := tests.b4_publish(s.booking, s.booker, 'players');
  q := tests.b4_quote(pa, v_player);
  assert (q.side, q.join_cents) = ('a'::text, 0), format('side A paid for everyone (%s)', q);

  pb := tests.b4_publish(s.booking, s.booker, 'opposition');
  perform tests.act_as(v_b);
  r := public.accept_opposition_post(pb, 'each_pays_responsible');
  perform tests.act_as_postgres();
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_b4_b_' || gen_random_uuid());
  pb := tests.b4_publish(s.booking, v_b, 'players');
  q := tests.b4_quote(pb, v_player);
  assert (q.side, q.join_cents, q.join_pitch_cents, q.join_fee_cents) = ('b'::text, 480, 400, 80),
    format('side B pays for myself: €4.80 (%s)', q);
  assert (tests.b4_quote(pb, v_b)).mine, 'side B''s captain unpublishes side B''s post';
  assert not (tests.b4_quote(pb, s.booker)).mine, 'not side A''s captain';
end $$;

-- 3. An opposition post: side B's price before accepting (examples 4 and 5),
--    and a Premium captain pays no fee on his own spot.
do $$
declare
  s record := tests.b4_book('half', 'pay_all');
  p uuid := tests.b4_publish(s.booking, s.booker, 'opposition');
  v_captain uuid := tests.b4_user();
  v_premium uuid := tests.b4_user();
  q record;
  d record;
begin
  perform tests.make_premium(v_premium);
  q := tests.b4_quote(p, v_captain);
  assert (q.kind, q.side, q.open, q.mine) = ('opposition'::text, 'b'::text, true, false), format('open (%s)', q);
  assert (q.pay_all_cents, q.each_pays_cents, q.guarantee_cents) = (2275, 480, 2000),
    format('pay for everyone €22.75; pay for myself €4.80 and a €20.00 guarantee (%s)', q);
  assert q.closes_at = public.booking_kickoff_at(tests.cyprus_today() + 3, '12:00') - interval '24 hours',
    'closes 24 hours before kickoff';
  assert (tests.b4_quote(p, v_premium)).pay_all_cents = 2220, 'Premium: €20.00 + 4 × €0.55';
  assert (tests.b4_quote(p, s.booker)).mine, 'side A''s captain unpublishes it';

  perform tests.act_as(v_captain);
  select * into d from public.opposition_post_detail(p);
  perform tests.act_as_postgres();
  assert (d.post_id, d.side_pitch_cents, d.side_players, d.pay_all_cents, d.each_pays_cents, d.guarantee_cents, d.found)
         = (p, 2000, 5, 2275, 480, 2000, false), format('the accept screen (%s)', d);
  assert d.pitch_label = 'Pitch 1', format('the pitch (%s)', d.pitch_label);
end $$;

-- 4. Not open: full, unpublished, found, closed 24 hours before kickoff,
--    cancelled. booking_no_opponent_due closes the opposition post.
do $$
declare
  s record := tests.b4_book('half', 'pay_all');
  w record := tests.b4_book('whole', 'pay_all');
  p uuid := tests.b4_publish(s.booking, s.booker, 'opposition');
  pw uuid := tests.b4_publish(w.booking, w.booker, 'players');
  v_one uuid := tests.b4_user();
  d record;
begin
  perform tests.act_as(w.booker);
  perform public.unpublish_post(pw);
  perform tests.act_as_postgres();
  assert not (tests.b4_quote(pw, v_one)).open, 'unpublished';

  perform tests.act_as(v_one);
  perform public.accept_opposition_post(p, 'pay_all');
  perform tests.act_as_postgres();
  assert not (tests.b4_quote(p, tests.b4_user())).open, 'opposition found';
  perform tests.act_as(tests.b4_user());
  select * into d from public.opposition_post_detail(p);
  perform tests.act_as_postgres();
  assert d.found, '"Opposition found"';

  s := tests.b4_book('half', 'pay_all');
  p := tests.b4_publish(s.booking, s.booker, 'opposition');
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  assert not (tests.b4_quote(p, v_one)).open, 'closed 24 hours before kickoff';
  perform public.booking_no_opponent_due();
  assert (select status from public.squad_posts where id = p) = 'closed', 'the job closes it';

  s := tests.b4_book('half', 'pay_all');
  p := tests.b4_publish(s.booking, s.booker, 'opposition');
  update public.venue_bookings set status = 'cancelled' where id = s.booking;
  assert not (tests.b4_quote(p, v_one)).open, 'the booking was cancelled';
end $$;

-- 5. Old posts (made before Booking v2) have no quote; too many ids are refused.
do $$
declare
  v_post uuid;
begin
  insert into public.squad_posts (type, venue_id, scheduled_at, format, status, posted_by, players_needed)
  values ('players', tests.create_venue(), now() + interval '2 days', '5-a-side', 'open', tests.b4_user(), 3)
  returning id into v_post;
  perform tests.act_as(tests.b4_user());
  assert not exists (select 1 from public.booking_post_quotes(array[v_post])), 'no quote';
  assert tests.error_of(format('select * from public.booking_post_quotes(%L)',
                               array(select gen_random_uuid() from generate_series(1, 51)))) = 'too_many_posts', '50 at most';
  perform tests.act_as_postgres();
end $$;

-- 6. My publishable games: what I captain, with my open spots and my posts.
do $$
declare
  s record := tests.b4_book('half', 'pay_all');
  w record := tests.b4_book('whole', 'each_pays_responsible');
  v_stranger uuid := tests.b4_user();
  p uuid := tests.b4_publish(s.booking, s.booker, 'players');
  g record;
begin
  perform tests.act_as(s.booker);
  select * into g from public.my_publishable_bookings() where booking_id = s.booking;
  perform tests.act_as_postgres();
  assert (g.kind, g.side, g.open_spots, g.players_post_id, g.opposition_post_id, g.can_publish_players, g.can_publish_opposition)
         is not distinct from ('half'::text, 'a'::text, 4, p, null::uuid, true, true), format('side A (%s)', g);
  assert g.venue_name is not null and g.booking_day = tests.cyprus_today() + 3, 'when and where';

  perform tests.act_as(w.booker);
  select * into g from public.my_publishable_bookings() where booking_id = w.booking;
  perform tests.act_as_postgres();
  assert (g.kind, g.side, g.open_spots, g.can_publish_players, g.can_publish_opposition)
         is not distinct from ('whole'::text, null::text, 9, true, false), format('a whole pitch has no opposition (%s)', g);

  perform tests.act_as(v_stranger);
  assert not exists (select 1 from public.my_publishable_bookings()), 'nothing of someone else''s';
  perform tests.act_as_postgres();

  -- Within 24 hours: no more opposition.
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform tests.act_as(s.booker);
  select * into g from public.my_publishable_bookings() where booking_id = s.booking;
  perform tests.act_as_postgres();
  assert not g.can_publish_opposition, 'opposition closed';
end $$;

-- 7. Grants: signed-in players only.
do $$
begin
  perform tests.act_as_anon();
  assert tests.error_of('select * from public.booking_post_quotes(''{}'')') like 'permission denied%', 'anon: quotes';
  assert tests.error_of(format('select * from public.opposition_post_detail(%L)', gen_random_uuid())) like 'permission denied%',
    'anon: detail';
  assert tests.error_of('select * from public.my_publishable_bookings()') like 'permission denied%', 'anon: my games';
  perform tests.act_as_postgres();
end $$;

rollback;
