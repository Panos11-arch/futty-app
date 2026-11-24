-- B3 (Booking v2, spec 13 "Two kinds of booking", "Invites, after payment"):
-- booking_detail's 'v2' (both sides, their captains, paid or held, which
-- side each player is on, the opposition, the open posts and the
-- no-opponent choice), my_no_opponent_choices for Home, and the reminder 2
-- hours before the 6-hour cut-off (Panos, 23 November).
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.b3_setup(p_kind text default 'half', p_mode text default 'pay_all',
                               out venue uuid, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  booker := tests.create_user('b3-booker-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => p_kind);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = booking and profile_id = booker),
                           'pi_b3_a_' || gen_random_uuid());
end;
$$;

create function tests.b3_detail(p_booking uuid, p_as uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_as);
  v := public.booking_detail(p_booking);
  perform tests.act_as_postgres();
  return v -> 'v2';
end;
$$;

create function tests.b3_choices(p_as uuid)
returns setof uuid
language plpgsql
as $$
begin
  perform tests.act_as(p_as);
  return query select c.booking_id from public.my_no_opponent_choices() c;
  perform tests.act_as_postgres();
end;
$$;

-- 1. A booking made before Booking v2 has no 'v2'.
do $$
declare
  v_booker uuid := tests.create_user('b3-old-' || gen_random_uuid() || '@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
begin
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(v_booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  assert tests.b3_detail(v.id, v_booker) is null or jsonb_typeof(tests.b3_detail(v.id, v_booker)) = 'null', 'no v2';
end $$;

-- 2. A whole pitch: its kind and pitch name, no sides, no opposition; the
--    players post the booker published.
do $$
declare
  s record := tests.b3_setup('whole');
  v jsonb;
  v_post public.squad_posts;
begin
  v := tests.b3_detail(s.booking, s.booker);
  assert v ->> 'kind' = 'whole', format('kind: %s', v);
  assert v ->> 'pitch_label' = 'Pitch 1', 'the pitch name';
  assert v -> 'sides' = '[]'::jsonb, 'a whole pitch has no sides';
  assert jsonb_typeof(v -> 'opposition') = 'null', 'no opposition on a whole pitch';
  assert jsonb_typeof(v -> 'no_opponent') = 'null', 'no 24-hour choice on a whole pitch';
  assert jsonb_typeof(v -> 'posts' -> 'players') = 'null', 'nothing published yet';
  perform tests.act_as(s.booker);
  v_post := public.publish_booking(s.booking, 'players');
  perform tests.act_as_postgres();
  v := tests.b3_detail(s.booking, s.booker);
  assert v -> 'posts' ->> 'players' = v_post.id::text, 'the open players post, to unpublish';
end $$;

-- 3. A half pitch: side A with its captain, held; the opposition open; then
--    side B accepts and pays, and both captains see both sides, who is held
--    and which side each player is on.
do $$
declare
  s record := tests.b3_setup();
  v_b uuid := tests.create_user('b3-b-' || gen_random_uuid() || '@futty.test');
  v jsonb;
  v_acc jsonb;
begin
  update public.profiles set full_name = 'Andreas' where id = s.booker;
  update public.profiles set full_name = 'Bambos' where id = v_b;
  v := tests.b3_detail(s.booking, s.booker);
  assert v ->> 'kind' = 'half' and v ->> 'captain_of' = 'a' and v ->> 'my_side' = 'a', format('side A: %s', v);
  assert jsonb_array_length(v -> 'sides') = 1, 'one side so far';
  assert v -> 'sides' -> 0 ->> 'state' = 'held', format('side A''s captain is held: %s', v -> 'sides');
  assert v -> 'sides' -> 0 -> 'captain' ->> 'name' = 'Andreas', 'its captain';
  assert v -> 'sides' -> 0 ->> 'payment_mode' = 'pay_all', 'its way to pay';
  assert (v -> 'opposition' ->> 'open')::boolean and not (v -> 'opposition' ->> 'found')::boolean, 'opposition open';

  perform tests.act_as(s.booker);
  perform public.invite_opposition(s.booking, array[v_b]);
  perform tests.act_as_postgres();
  assert (tests.b3_detail(s.booking, s.booker) -> 'opposition' ->> 'invited')::integer = 1, 'one invite sent';

  perform tests.act_as(v_b);
  v_acc := public.accept_opposition((select id from public.booking_opposition_invites where booking_id = s.booking),
                                    'each_pays_responsible');
  perform tests.act_as_postgres();
  v := tests.b3_detail(s.booking, s.booker);
  assert jsonb_array_length(v -> 'sides') = 2, 'both sides';
  assert v -> 'sides' -> 1 ->> 'side' = 'b' and v -> 'sides' -> 1 ->> 'state' = 'unpaid', format('side B not paid yet: %s', v);
  assert (v -> 'opposition' ->> 'found')::boolean and not (v -> 'opposition' ->> 'open')::boolean, 'opposition found';

  perform tests.hold_share((v_acc ->> 'share_id')::uuid, 'pi_b3_b_' || gen_random_uuid());
  v := tests.b3_detail(s.booking, v_b);
  assert v ->> 'captain_of' = 'b' and v ->> 'my_side' = 'b', 'side B''s captain sees his side';
  assert v -> 'sides' -> 0 ->> 'state' = 'held' and v -> 'sides' -> 1 ->> 'state' = 'held', format('both held: %s', v);
  assert v -> 'sides' -> 1 -> 'captain' ->> 'name' = 'Bambos', 'side B''s captain';
  assert v -> 'sides' -> 1 ->> 'payment_mode' = 'each_pays_responsible', 'side B pays for myself';
  assert v -> 'roster_sides' ->> (v_acc ->> 'share_id') = 'b', 'his share is on side B';
  assert v -> 'roster_sides' ->> (select id::text from public.booking_payment_shares
                                  where booking_id = s.booking and profile_id = s.booker) = 'a', 'the booker''s on side A';
  assert jsonb_typeof(v -> 'no_opponent') = 'null', 'two sides: no 24-hour choice';
end $$;

-- 4. No side B 24 hours before kickoff: the lone captain's choice, with the
--    server's amount (example 6a, €22.75), in the booking and on Home; no
--    one else sees it.
do $$
declare
  s record := tests.b3_setup();
  e record := tests.b3_setup(p_mode => 'each_pays_responsible');
  v_other uuid := tests.create_user('b3-other-' || gen_random_uuid() || '@futty.test');
  v jsonb;
begin
  v := tests.b3_detail(s.booking, s.booker);
  assert not (v -> 'no_opponent' ->> 'due')::boolean, 'not due before 24 hours';
  assert not exists (select 1 from tests.b3_choices(s.booker)), 'not on Home yet';

  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform tests.set_kickoff(e.booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();
  v := tests.b3_detail(s.booking, s.booker);
  assert (v -> 'no_opponent' ->> 'due')::boolean, format('due: %s', v);
  assert (v -> 'no_opponent' ->> 'amount_cents', v -> 'no_opponent' ->> 'pitch_cents', v -> 'no_opponent' ->> 'fee_cents')
         = ('2275', '2000', '275'), format('6a: %s', v -> 'no_opponent');
  assert (tests.b3_detail(e.booking, e.booker) -> 'no_opponent' ->> 'amount_cents') = '2400', '6b: €24.00';
  assert (select array_agg(c) from tests.b3_choices(s.booker) c) = array[s.booking], 'on Home';
  assert not exists (select 1 from tests.b3_choices(v_other)), 'not for anyone else';

  perform tests.act_as(s.booker);
  perform public.booking_no_opponent_choice(s.booking, 'cancel');
  perform tests.act_as_postgres();
  assert not exists (select 1 from tests.b3_choices(s.booker)), 'gone from Home once chosen';
end $$;

-- 5. The reminder: once, 2 hours before the 6-hour cut-off, with the amount;
--    never before, never after the cut-off, never once chosen.
do $$
declare
  s record := tests.b3_setup();
  c record := tests.b3_setup();
  l record := tests.b3_setup();
begin
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform tests.set_kickoff(c.booking, now() + interval '23 hours');
  perform tests.set_kickoff(l.booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();

  perform tests.set_kickoff(s.booking, now() + interval '9 hours');
  assert public.booking_no_opponent_reminder_due() = 0, 'not 9 hours before kickoff';

  perform tests.act_as(c.booker);
  perform public.booking_no_opponent_choice(c.booking, 'cancel');
  perform tests.act_as_postgres();
  perform tests.set_kickoff(s.booking, now() + interval '7 hours 30 minutes');
  perform tests.set_kickoff(c.booking, now() + interval '7 hours 30 minutes');
  perform tests.set_kickoff(l.booking, now() + interval '5 hours');
  assert public.booking_no_opponent_reminder_due() = 1, 'only the one still to choose, before the cut-off';
  assert tests.notified(s.booker, 'no_opponent_reminder') = 1, 'the captain is reminded';
  assert (tests.last_notification(s.booker, 'no_opponent_reminder')).body like '%€22.75%', 'with the amount';
  assert (tests.last_notification(s.booker, 'no_opponent_reminder')).body like '%6 hours before kickoff%', 'and the cut-off';
  assert tests.notified(c.booker, 'no_opponent_reminder') = 0, 'not once chosen';
  assert tests.notified(l.booker, 'no_opponent_reminder') = 0, 'not after the cut-off';
  assert public.booking_no_opponent_reminder_due() = 0, 'once';
end $$;

-- 6. The reminder's lead is a rule: at 4 hours, 9 hours before kickoff is due.
do $$
declare
  s record := tests.b3_setup();
begin
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();
  update public.app_rules set no_opponent_reminder_hours = 4;
  perform tests.set_kickoff(s.booking, now() + interval '9 hours');
  assert public.booking_no_opponent_reminder_due() = 1, 'the rule decides';
  update public.app_rules set no_opponent_reminder_hours = 2;
end $$;

-- 7. Who can call what.
do $$
begin
  assert not has_function_privilege('authenticated', 'public.booking_v2_detail(uuid, uuid)', 'execute'), 'internal';
  assert not has_function_privilege('authenticated', 'public.booking_no_opponent_reminder_due()', 'execute'), 'the job only';
  assert not has_function_privilege('anon', 'public.my_no_opponent_choices()', 'execute'), 'not anon';
  assert has_function_privilege('authenticated', 'public.my_no_opponent_choices()', 'execute'), 'players';
end $$;

rollback;
