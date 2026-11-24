-- B1d follow-ups (spec 13 "Losers pay", answered by Panos on 24 November,
-- questions from #181), on the €40.00 5-a-side pitch (5 v 5):
--   a. A side on its own, paying for myself, pulling out: €1 from each
--      player who holds, as built (example 15b: €3.00 with 3 holds).
--   b. After a side pulls out less than 6 hours before kickoff, the
--      remaining side plays for nothing: a player who joins it afterwards is
--      covered (no hold, nothing to pay), and no opposition post can open.
--   c. The remaining side's captain is told: "The other team pulled out.
--      They pay for the pitch, and your hold is released."
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.lf_user()
returns uuid
language sql
as $$ select tests.create_user('lf-' || gen_random_uuid() || '@futty.test') $$;

-- A Losers pay half pitch, side A paying p_mode; the booker's hold placed.
create function tests.lf_book(p_mode text, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
begin
  booker := tests.lf_user();
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode,
                        p_kind => 'half', p_losers_pay => true);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((tests.share_of(booking, booker)).id, 'pi_lf_a_' || gen_random_uuid());
end;
$$;

-- Side B's captain accepts the public opposition post and places his hold.
create function tests.lf_side_b(p_booking uuid, p_booker uuid, p_mode text)
returns uuid
language plpgsql
as $$
declare
  v_post public.squad_posts;
  v_b uuid := tests.lf_user();
  r jsonb;
begin
  perform tests.act_as(p_booker);
  v_post := public.publish_booking(p_booking, 'opposition');
  perform tests.act_as(v_b);
  r := public.accept_opposition_post(v_post.id, p_mode, p_losers_pay => true);
  perform tests.act_as_postgres();
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_lf_b_' || gen_random_uuid());
  return v_b;
end;
$$;

-- A new player joins the captain's side through its players post (no hold placed).
create function tests.lf_join(p_booking uuid, p_captain uuid, out player uuid, out post uuid)
language plpgsql
as $$
declare
  v_post public.squad_posts;
begin
  perform tests.act_as(p_captain);
  v_post := public.publish_booking(p_booking, 'players');
  player := tests.lf_user();
  perform tests.act_as(player);
  perform public.join_squad_post(v_post.id);
  perform tests.act_as_postgres();
  post := v_post.id;
end;
$$;

-- 1. Before any pull-out, a joiner on a Losers pay side paying for myself
--    holds twice his share (€9.60): the allowed case the rest builds on.
do $$
declare
  s record;
  j record;
  v_share public.booking_payment_shares;
begin
  s := tests.lf_book('each_pays_responsible');
  perform tests.lf_side_b(s.booking, s.booker, 'pay_all');
  j := tests.lf_join(s.booking, s.booker);
  v_share := tests.share_of(s.booking, j.player);
  assert (v_share.status, v_share.gipedo_side, v_share.amount_cents) = ('pending'::text, 'a'::text, 960),
    format('before a pull-out a joiner holds €9.60 (%s)', row_to_json(v_share));
end $$;

-- 2. (b, c) Side B pulls out less than 6 hours before kickoff and pays as
--    the losing side (14b). Side A plays for nothing: its captain is told,
--    its holds are released, and a player who joins now is covered: no
--    hold and nothing to pay, as Find a game's quote shows.
do $$
declare
  s record;
  v_b uuid;
  j record;
  v_share public.booking_payment_shares;
  v_note public.notifications;
  q record;
begin
  s := tests.lf_book('each_pays_responsible');
  v_b := tests.lf_side_b(s.booking, s.booker, 'pay_all');
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  perform tests.act_as(v_b);
  assert public.losers_pay_pull_out(s.booking) ->> 'result' = 'lost', 'side B pays as the losing side';
  perform tests.act_as_postgres();

  assert (select sum(capture_cents) from public.gipedo_settlements where booking_id = s.booking and reason = 'lost') = 4550,
    '14b: side B''s €45.50 is taken';
  assert (select coalesce(sum(capture_cents), 0) from public.gipedo_settlements
          where booking_id = s.booking and profile_id = s.booker) = 0, 'side A''s hold is released';

  v_note := tests.last_notification(s.booker, 'opposition_left');
  assert v_note.body = 'The other team pulled out. They pay for the pitch, and your hold is released.',
    format('c: the remaining captain''s words (%s)', v_note.body);

  j := tests.lf_join(s.booking, s.booker);
  v_share := tests.share_of(s.booking, j.player);
  assert (v_share.status, v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents) = ('covered'::text, 0, 0, 0)
         and v_share.gipedo_side is null,
    format('b: a new joiner is covered, with no hold (%s)', row_to_json(v_share));
  assert v_share.stripe_payment_intent_id is null, 'b: no hold is placed for him';

  perform tests.act_as(tests.lf_user());
  select * into q from public.booking_post_quotes(array[j.post]);
  perform tests.act_as_postgres();
  assert (q.join_cents, q.join_pitch_cents, q.join_fee_cents) = (0, 0, 0),
    format('b: Find a game shows nothing to pay (%s)', row_to_json(q));
end $$;

-- 3. (b) No opposition post can open after a late pull-out, even when the
--    opponent lead is shorter than the time left (app_rules can change).
do $$
declare
  s record;
  v_b uuid;
  v_post uuid;
  q record;
begin
  update public.app_rules set gipedo_opponent_hours = 1;
  s := tests.lf_book('pay_all');
  v_b := tests.lf_side_b(s.booking, s.booker, 'pay_all');
  select id into v_post from public.squad_posts where venue_booking_id = s.booking and type = 'opposition';
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  perform tests.act_as(v_b);
  perform public.losers_pay_pull_out(s.booking);
  perform tests.act_as_postgres();

  assert public.opposition_open_error((select b from public.venue_bookings b where b.id = s.booking)) = 'opposition_closed',
    'b: the opposition is closed for good';
  perform public.reopen_opposition_post(s.booking);
  assert (select status from public.squad_posts where id = v_post) <> 'open', 'b: the old opposition post stays shut';
  perform tests.act_as(s.booker);
  assert tests.error_of(format('select public.publish_booking(%L, ''opposition'')', s.booking))
         in ('opposition_closed', 'opposition_found'), 'b: the captain can''t publish one';
  select * into q from public.booking_post_quotes(array[v_post]);
  perform tests.act_as_postgres();
  assert not q.open, 'b: Find a game shows it closed';
  update public.app_rules set gipedo_opponent_hours = 24;
end $$;

-- 4. (b) A pull-out more than 6 hours before kickoff is not this case: the
--    slot stays the remaining side's and its opposition can reopen.
do $$
declare
  s record;
  v_b uuid;
begin
  s := tests.lf_book('pay_all');
  v_b := tests.lf_side_b(s.booking, s.booker, 'pay_all');
  perform tests.act_as(v_b);
  assert public.losers_pay_pull_out(s.booking) ->> 'result' = 'pulled_out', 'early: the €1 per player fee';
  perform tests.act_as_postgres();
  assert public.opposition_open_error((select b from public.venue_bookings b where b.id = s.booking)) is null,
    'early: the opposition can open again';
end $$;

-- 5. (a) A side on its own, paying for myself, captain and 2 players held,
--    2 spots never held: €1 from each of the 3 holds, €3.00 (15b).
do $$
declare
  s record;
  v_post public.squad_posts;
  v_p uuid;
begin
  s := tests.lf_book('each_pays_responsible');
  perform tests.act_as(s.booker);
  v_post := public.publish_booking(s.booking, 'players');
  perform tests.act_as_postgres();
  for i in 1..4 loop
    v_p := tests.lf_user();
    perform tests.act_as(v_p);
    perform public.join_squad_post(v_post.id);
    perform tests.act_as_postgres();
    if i <= 2 then
      perform tests.hold_share((tests.share_of(s.booking, v_p)).id, 'pi_lf_p_' || gen_random_uuid());
    end if;
  end loop;
  perform tests.act_as(s.booker);
  assert public.losers_pay_pull_out(s.booking) ->> 'result' = 'cancelled', 'the booking is cancelled';
  perform tests.act_as_postgres();
  assert (select (sum(capture_cents), count(*)) from public.gipedo_settlements
          where booking_id = s.booking and reason = 'pull_out_fee') = (300::bigint, 3::bigint),
    '15b: €1.00 from each of the 3 holds; spots never held pay nothing';
end $$;

rollback;
