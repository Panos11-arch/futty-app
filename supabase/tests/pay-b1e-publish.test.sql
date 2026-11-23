-- B1e (Booking v2, spec 13 "Publish game" and "Invites, after payment"):
--   * On any booking, the booker (or side B's captain, for side B's spots)
--     publishes the open spots in the posts section; the slot stays booked.
--     Joiners pay as that side pays (nothing if the side paid for
--     everyone). Unpublish any time; the post closes when full.
--   * On a half pitch with no side B, side A's captain can publish a public
--     opposition post: the first player to accept becomes side B's captain,
--     exactly as with an invite. It closes 24 hours before kickoff, and
--     reopens if side B lapses or leaves before then.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.b1e_book(p_kind text, p_mode text, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
begin
  booker := tests.create_user('b1e-booker-' || gen_random_uuid() || '@futty.test');
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => p_kind);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = booking and profile_id = booker),
                           'pi_b1e_' || gen_random_uuid());
end;
$$;

create function tests.b1e_publish(p_booking uuid, p_as uuid, p_kind text)
returns public.squad_posts
language plpgsql
as $$
declare
  v public.squad_posts;
begin
  perform tests.act_as(p_as);
  v := public.publish_booking(p_booking, p_kind);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.b1e_join(p_post uuid, p_as uuid)
returns void
language plpgsql
as $$
begin
  perform tests.act_as(p_as);
  perform public.join_squad_post(p_post);
  perform tests.act_as_postgres();
end;
$$;

create function tests.b1e_user()
returns uuid
language sql
as $$ select tests.create_user('b1e-u-' || gen_random_uuid() || '@futty.test') $$;

-- 1. A whole pitch paid for everyone: the booker publishes his 9 open
--    spots; a joiner plays for nothing (covered); the slot stays booked.
do $$
declare
  s record := tests.b1e_book('whole', 'pay_all');
  p public.squad_posts := tests.b1e_publish(s.booking, s.booker, 'players');
  v_joiner uuid := tests.b1e_user();
begin
  assert (p.type, p.status, p.players_needed, p.venue_booking_id) = ('players', 'open', 9, s.booking) and p.side is null,
    format('the post: %s', row(p.type, p.status, p.players_needed, p.side));
  assert (tests.b1e_publish(s.booking, s.booker, 'players')).id = p.id, 'publishing again gives the same post';
  perform tests.b1e_join(p.id, v_joiner);
  assert (select status from public.booking_payment_shares where booking_id = s.booking and profile_id = v_joiner) = 'covered',
    'nothing to pay';
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'the slot stays booked';
end $$;

-- 2. Pay for myself: a joiner pays his own €4.80 share.
do $$
declare
  s record := tests.b1e_book('whole', 'each_pays_responsible');
  p public.squad_posts := tests.b1e_publish(s.booking, s.booker, 'players');
  v_joiner uuid := tests.b1e_user();
begin
  perform tests.b1e_join(p.id, v_joiner);
  assert (select (status, amount_cents) from public.booking_payment_shares where booking_id = s.booking and profile_id = v_joiner)
         = ('pending'::text, 480), 'his own share';
end $$;

-- 3. Only the booker publishes; unpublishing closes the post; a full post closes.
do $$
declare
  s record := tests.b1e_book('half', 'pay_all');
  p public.squad_posts;
  v_stranger uuid := tests.b1e_user();
begin
  assert tests.error_of(format('select tests.b1e_publish(%L, %L, ''players'')', s.booking, v_stranger)) = 'not_your_booking',
    'a stranger can''t';
  p := tests.b1e_publish(s.booking, s.booker, 'players');
  assert (p.players_needed, p.side) = (4, 'a'::text), 'side A''s 4 open spots';
  for i in 1..4 loop
    perform tests.b1e_join(p.id, tests.b1e_user());
  end loop;
  assert (select status from public.squad_posts where id = p.id) = 'closed', 'closed when full';
  assert (select count(*) from public.booking_payment_shares where booking_id = s.booking and side = 'a') = 5, 'side A is full';

  s := tests.b1e_book('whole', 'pay_all');
  p := tests.b1e_publish(s.booking, s.booker, 'players');
  perform tests.act_as(s.booker);
  perform public.unpublish_post(p.id);
  perform tests.act_as_postgres();
  assert (select status from public.squad_posts where id = p.id) = 'closed', 'unpublished';
  assert tests.error_of(format('select tests.b1e_join(%L, %L)', p.id, v_stranger)) = 'post_closed', 'can''t join it';
end $$;

-- 4. A public opposition post: the first player to accept becomes side B's
--    captain, as with an invite; the post is matched.
do $$
declare
  s record := tests.b1e_book('half', 'pay_all');
  p public.squad_posts := tests.b1e_publish(s.booking, s.booker, 'opposition');
  v_one uuid := tests.b1e_user();
  v_two uuid := tests.b1e_user();
  r jsonb;
begin
  assert (p.type, p.status) = ('opposition'::text, 'open'::text), 'an opposition post';
  perform tests.act_as(v_one);
  r := public.accept_opposition_post(p.id, 'pay_all');
  perform tests.act_as_postgres();
  assert (r ->> 'amount_cents')::integer = 2275, 'side B pays €22.75';
  assert (select captain_id from public.booking_sides where booking_id = s.booking and side = 'b') = v_one, 'he''s side B''s captain';
  assert (select status from public.squad_posts where id = p.id) = 'matched', 'matched';
  perform tests.act_as(v_two);
  assert tests.error_of(format('select public.accept_opposition_post(%L, ''pay_all'')', p.id)) = 'opposition_found', 'too late';
  perform tests.act_as_postgres();

  -- He doesn't pay within 15 minutes: the post opens again.
  update public.booking_sides set accepted_at = now() - interval '16 minutes' where booking_id = s.booking and side = 'b';
  perform public.booking_side_b_lapse_due();
  assert (select status from public.squad_posts where id = p.id) = 'open', 'reopened';
end $$;

-- 5. Opposition posts: a half pitch only, never once side B is found, closed
--    24 hours before kickoff; side B leaving before then reopens it.
do $$
declare
  s record := tests.b1e_book('half', 'pay_all');
  w record := tests.b1e_book('whole', 'pay_all');
  p public.squad_posts;
  v_one uuid := tests.b1e_user();
  r jsonb;
begin
  assert tests.error_of(format('select tests.b1e_publish(%L, %L, ''opposition'')', w.booking, w.booker)) = 'not_half_pitch',
    'a whole pitch has no opposition';
  p := tests.b1e_publish(s.booking, s.booker, 'opposition');
  perform tests.act_as(v_one);
  r := public.accept_opposition_post(p.id, 'pay_all');
  perform tests.act_as_postgres();
  perform tests.pay_ago((r ->> 'share_id')::uuid, 'pi_b1e_b_' || gen_random_uuid(), interval '2 hours');
  assert tests.error_of(format('select tests.b1e_publish(%L, %L, ''opposition'')', s.booking, s.booker)) = 'opposition_found',
    'not once side B is found';
  perform tests.cancel(s.booking, 'whole_team', v_one);
  assert (select status from public.squad_posts where id = p.id) = 'open', 'side B left: open again';
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform tests.act_as(tests.b1e_user());
  assert tests.error_of(format('select public.accept_opposition_post(%L, ''pay_all'')', p.id)) = 'opposition_closed',
    'closed 24 hours before kickoff';
  perform tests.act_as_postgres();
end $$;

-- 6. Side B's captain publishes side B's spots; joiners join side B.
do $$
declare
  s record := tests.b1e_book('half', 'pay_all');
  v_b uuid := tests.b1e_user();
  v_joiner uuid := tests.b1e_user();
  r jsonb;
  p public.squad_posts;
begin
  p := tests.b1e_publish(s.booking, s.booker, 'opposition');
  perform tests.act_as(v_b);
  r := public.accept_opposition_post(p.id, 'each_pays_responsible');
  perform tests.act_as_postgres();
  assert tests.error_of(format('select tests.b1e_publish(%L, %L, ''players'')', s.booking, v_b)) = 'side_not_paid',
    'not before side B has paid';
  perform tests.hold_share((r ->> 'share_id')::uuid, 'pi_b1e_b2_' || gen_random_uuid());
  p := tests.b1e_publish(s.booking, v_b, 'players');
  assert (p.side, p.players_needed) = ('b'::text, 4), 'side B''s spots';
  perform tests.b1e_join(p.id, v_joiner);
  assert (select (side, amount_cents) from public.booking_payment_shares where booking_id = s.booking and profile_id = v_joiner)
         = ('b'::text, 480), 'joins side B and pays his share';
end $$;

rollback;
