-- QA 24 November (T3, second pass S1): cancelling a booking closes its open
-- posts on the server at once, so the game leaves Home's "Need players" and
-- Find a game. Whatever cancels the booking (the booker, cancel free, the
-- venue, the unpaid-booking job), the same trigger closes them.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.qp_book(p_kind text, p_mode text, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
begin
  booker := tests.create_user('qp-' || gen_random_uuid() || '@futty.test');
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => p_kind);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((tests.share_of(booking, booker)).id, 'pi_qp_' || gen_random_uuid());
end;
$$;

create function tests.qp_publish(p_booking uuid, p_as uuid, p_kind text)
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

-- What another player's Home and Find a game list read: open posts.
create function tests.qp_listed(p_post uuid)
returns boolean
language plpgsql
as $$
declare
  v boolean;
begin
  perform tests.act_as(tests.create_user('qp-viewer-' || gen_random_uuid() || '@futty.test'));
  v := exists (select 1 from public.squad_posts where id = p_post and status = 'open');
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- 1. The allowed case: a booking that stays on keeps its post open.
do $$
declare
  s record := tests.qp_book('whole', 'pay_all');
  v_post uuid := tests.qp_publish(s.booking, s.booker, 'players');
begin
  assert tests.qp_listed(v_post), 'an open game is listed';
end $$;

-- 2. T3 / S1: the booker cancels the whole team; the post closes at once.
do $$
declare
  s record := tests.qp_book('whole', 'pay_all');
  v_post uuid := tests.qp_publish(s.booking, s.booker, 'players');
begin
  perform tests.cancel(s.booking, 'whole_team', s.booker);
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
  assert (select status from public.squad_posts where id = v_post) = 'closed', 'its post is closed at once';
  assert not tests.qp_listed(v_post), 'it leaves Need players and Find a game';
end $$;

-- 3. A half pitch with a players post and a public opposition post, cancelled
--    by any other path (here the venue's status change): both close.
do $$
declare
  s record := tests.qp_book('half', 'pay_all');
  v_opp uuid := tests.qp_publish(s.booking, s.booker, 'opposition');
  v_players uuid := tests.qp_publish(s.booking, s.booker, 'players');
begin
  update public.venue_bookings set status = 'cancelled' where id = s.booking;
  assert (select count(*) from public.squad_posts where id in (v_opp, v_players) and status = 'closed') = 2,
    'every open post of the booking closes';
end $$;

-- 4. Only open posts change, and only the cancelled booking's.
do $$
declare
  s record := tests.qp_book('whole', 'pay_all');
  t record := tests.qp_book('whole', 'pay_all');
  v_matched uuid := tests.qp_publish(s.booking, s.booker, 'players');
  v_other uuid := tests.qp_publish(t.booking, t.booker, 'players');
begin
  update public.squad_posts set status = 'matched' where id = v_matched;
  perform tests.cancel(s.booking, 'whole_team', s.booker);
  assert (select status from public.squad_posts where id = v_matched) = 'matched', 'a matched post is left as it was';
  assert tests.qp_listed(v_other), 'another booking''s post stays open';
end $$;

-- 5. The trigger's function is internal: nobody calls it from the app.
do $$
begin
  assert not has_function_privilege('authenticated', 'public.close_posts_of_cancelled_booking()', 'execute'),
    'not for authenticated';
  assert not has_function_privilege('anon', 'public.close_posts_of_cancelled_booking()', 'execute'), 'not for anon';
end $$;

rollback;
