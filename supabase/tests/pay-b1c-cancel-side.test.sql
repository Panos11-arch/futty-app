-- B1c, part 2c (Booking v2, spec 13 "Cancellations (Booking v2)", decided
-- 20 and 23 November): each captain is the booker of his own half, and
-- today's cancellation rules apply per side. A captain's "Cancel the whole
-- team" on a half pitch cancels his side:
--   * side B leaves: the invite reopens; within 24 hours of kickoff the
--     24-hour choice applies again; under 6 hours nothing reopens (no refund,
--     the game stays);
--   * side A leaves: side B keeps the slot, its captain becomes the booker,
--     and the invite reopens on side B's behalf;
--   * after "Pay the whole pitch and play", both payments count as one
--     "pay for everyone" booking: in the middle window €1 per player (€10 on
--     5 v 5) is kept and the rest becomes credit at the venue.
-- €40.00 5-a-side pitch: a side paying for everyone pays €22.75.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

-- A half pitch made p_days ahead; side A (p_mode_a) paid 2 hours ago;
-- unless p_no_b, side B (p_mode_b) accepted and paid 2 hours ago too.
create function tests.b1c4_setup(p_mode_a text default 'pay_all', p_mode_b text default 'pay_all', p_no_b boolean default false,
                                 out venue uuid, out booking uuid, out a uuid, out b uuid, out spare uuid,
                                 out a_share uuid, out b_share uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
  r jsonb;
begin
  a := tests.create_user('b1c4-a-' || gen_random_uuid() || '@futty.test');
  b := tests.create_user('b1c4-b-' || gen_random_uuid() || '@futty.test');
  spare := tests.create_user('b1c4-s-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(a);
  v := public.book_slot(venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode_a, p_kind => 'half');
  perform tests.act_as_postgres();
  booking := v.id;
  a_share := (select id from public.booking_payment_shares where booking_id = booking and profile_id = a);
  perform tests.pay_ago(a_share, 'pi_b1c4_a_' || gen_random_uuid(), interval '2 hours');
  perform tests.act_as(a);
  perform public.invite_opposition(booking, array[b, spare]);
  perform tests.act_as_postgres();
  if not p_no_b then
    perform tests.act_as(b);
    r := public.accept_opposition((select id from public.booking_opposition_invites where booking_id = booking and invited_profile_id = b),
                                  p_mode_b);
    perform tests.act_as_postgres();
    b_share := (r ->> 'share_id')::uuid;
    perform tests.pay_ago(b_share, 'pi_b1c4_b_' || gen_random_uuid(), interval '2 hours');
  end if;
end;
$$;

-- 1. Side B's captain cancels his side more than 24 hours before kickoff:
--    today's rules for his share (pay for everyone, middle window: €1 for
--    each of his 5 players kept, the rest credit); the booking stays, side
--    B is free again and the invite reopens.
do $$
declare
  s record := tests.b1c4_setup();
  p jsonb := tests.plan(s.booking, 'whole_team', s.b);
  c jsonb;
  l public.booking_cancellation_lines;
begin
  assert not (p ->> 'cancels_booking')::boolean, 'his side, not the booking';
  assert jsonb_array_length(p -> 'lines') = 1, format('only side B''s money: %s', p -> 'lines');
  c := tests.cancel(s.booking, 'whole_team', s.b);
  l := tests.line(c, s.b_share);
  assert (l."window", l.action, l.kept_cents, l.credit_cents) = ('middle', 'keep_and_credit', 500, 1775),
    format('side B: %s', row(l."window", l.action, l.kept_cents, l.credit_cents));
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'the booking stays';
  assert not exists (select 1 from public.booking_sides where booking_id = s.booking and side = 'b'), 'side B is free';
  assert (select status from public.booking_payment_shares where id = s.a_share) in ('authorized', 'paid'), 'side A untouched';
  assert tests.notified(s.a, 'opposition_left') = 1, 'side A''s captain is told';
  perform tests.act_as(s.spare);
  perform public.accept_opposition((select id from public.booking_opposition_invites where booking_id = s.booking and invited_profile_id = s.spare),
                                   'pay_all');
  perform tests.act_as_postgres();
  assert (select captain_id from public.booking_sides where booking_id = s.booking and side = 'b') = s.spare, 'the invite reopened';
end $$;

-- 2. Within 24 hours of kickoff, the 24-hour choice applies again.
do $$
declare
  s record := tests.b1c4_setup();
begin
  perform tests.set_kickoff(s.booking, now() + interval '20 hours');
  perform tests.cancel(s.booking, 'whole_team', s.b);
  assert (select (no_opponent_at is not null, no_opponent_choice is null) from public.venue_bookings where id = s.booking)
         = (true, true), 'the choice is due again';
  assert tests.notified(s.a, 'no_opponent') = 1, 'side A''s captain is asked';
end $$;

-- 3. Under 6 hours: no refund, the game stays, nothing reopens (and the
--    no-opponent jobs leave it alone).
do $$
declare
  s record := tests.b1c4_setup();
  c jsonb;
begin
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  c := tests.cancel(s.booking, 'whole_team', s.b);
  assert ((tests.line(c, s.b_share)).action, (tests.line(c, s.b_share)).kept_cents) = ('keep', 2275), 'nothing back';
  perform public.booking_no_opponent_due();
  perform public.booking_no_opponent_auto_cancel_due();
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'the game stays';
  assert tests.notified(s.a, 'no_opponent') = 0, 'no choice to make';
end $$;

-- 4. Side A's captain cancels his half: side B keeps the slot, its captain
--    becomes the booker and the invite reopens on his behalf.
do $$
declare
  s record := tests.b1c4_setup();
  c jsonb;
  l public.booking_cancellation_lines;
  v_new uuid := tests.create_user('b1c4-n-' || gen_random_uuid() || '@futty.test');
begin
  c := tests.cancel(s.booking, 'whole_team', s.a);
  l := tests.line(c, s.a_share);
  assert (l.action, l.kept_cents, l.credit_cents) = ('keep_and_credit', 500, 1775), 'side A: today''s rules for his half';
  assert (select (status, created_by) from public.venue_bookings where id = s.booking) = ('confirmed'::text, s.b),
    'side B''s captain is the booker now';
  assert (select array_agg(side || ':' || captain_id::text) from public.booking_sides where booking_id = s.booking)
         = array['a:' || s.b::text], 'his side is side A';
  assert (select (side, is_booker) from public.booking_payment_shares where id = s.b_share) = ('a'::text, true), 'and his share';
  assert tests.notified(s.b, 'opposition_left') = 1, 'he''s told the slot is his';
  perform tests.act_as(s.b);
  assert public.invite_opposition(s.booking, array[v_new]) = 1, 'he invites the opposition';
  perform tests.act_as_postgres();
end $$;

-- 5. After "Pay the whole pitch and play", his two payments are one "pay for
--    everyone" booking: €1 for each of the 10 players (€10) kept in the
--    middle window, the rest (€35.50) credit at the venue.
do $$
declare
  s record := tests.b1c4_setup(p_no_b => true);
  v_id uuid;
  c jsonb;
  l public.booking_cancellation_lines;
  o public.booking_cancellation_lines;
begin
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();
  v_id := (public.plan_other_half_payment(s.booking, s.a) ->> 'payment_id')::uuid;
  perform public.attach_other_half_intent(v_id, s.a, 'pi_b1c4_oh', 2275, null);
  perform public.other_half_paid(v_id, 'pi_b1c4_oh', 2275, 47);
  c := tests.cancel(s.booking, 'whole_team', s.a);
  assert (c ->> 'cancels_booking')::boolean, 'the whole booking';
  l := tests.line(c, s.a_share);
  select * into o from public.booking_cancellation_lines
  where cancellation_id = (c ->> 'cancellation_id')::uuid and other_half_id = v_id;
  assert (l.kept_cents, l.credit_cents) = (500, 1775), format('his first payment: %s', row(l.kept_cents, l.credit_cents));
  assert (o.action, o.kept_cents, o.credit_cents, o.stripe_intent_id) = ('keep_and_credit', 500, 1775, 'pi_b1c4_oh'),
    format('the other half: %s', row(o.action, o.kept_cents, o.credit_cents));
  assert l.kept_cents + o.kept_cents = 1000 and l.credit_cents + o.credit_cents = 3550, '€10 kept, €35.50 credit';
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
end $$;

-- 6. Two guarantees (both sides pay for myself): a captain cancelling his
--    side releases only his own.
do $$
declare
  s record := tests.b1c4_setup('each_pays_responsible', 'each_pays_responsible');
begin
  perform tests.cancel(s.booking, 'whole_team', s.b);
  assert (select status from public.booking_guarantees where booking_id = s.booking and profile_id = s.b) = 'cancelled',
    'his guarantee goes';
  assert (select status from public.booking_guarantees where booking_id = s.booking and profile_id = s.a) <> 'cancelled',
    'side A''s stays';
end $$;

-- 7. Side B's captain paying for everyone can't leave "just his spot".
do $$
declare
  s record := tests.b1c4_setup();
begin
  assert tests.error_of(format('select tests.plan(%L, ''my_spot'', %L)', s.booking, s.b)) = 'use_whole_team',
    'his side or nothing';
end $$;

-- 8. A half pitch with no side B: cancelling cancels the booking, as before.
do $$
declare
  s record := tests.b1c4_setup(p_no_b => true);
  p jsonb := tests.plan(s.booking, 'whole_team', s.a);
begin
  assert (p ->> 'cancels_booking')::boolean, 'the booking';
  perform tests.cancel(s.booking, 'whole_team', s.a);
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
end $$;

rollback;
