-- B1c: on a half pitch both sides can cancel, one after the other (QA 24
-- November, third pass part 2: the second side's "Cancel whole team" failed
-- with a duplicate key on booking_cancellations_once_idx). Each side cancels
-- once, and the booking itself is cancelled once; the same side can't cancel
-- twice, even after side B was relabelled side A.
-- Spec 13, "Cancellations (Booking v2)": today's rules apply per side.
-- €40.00 5-a-side pitch: a side paying for everyone pays €22.75; cancelled in
-- the middle window, €1 for each of his 5 players (€5.00) is kept and
-- €17.75 becomes credit; under 6 hours nothing comes back (€22.75 kept).
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

-- A half pitch 3 days ahead; side A (p_mode_a) paid 2 hours ago; unless
-- p_no_b, side B (p_mode_b) accepted and paid 2 hours ago too. A whole pitch
-- when p_whole.
create function tests.b1c6_setup(p_mode_a text default 'pay_all', p_mode_b text default 'pay_all', p_no_b boolean default false,
                                 p_whole boolean default false,
                                 out venue uuid, out booking uuid, out a uuid, out b uuid,
                                 out a_share uuid, out b_share uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
  r jsonb;
begin
  a := tests.create_user('b1c6-a-' || gen_random_uuid() || '@futty.test');
  b := tests.create_user('b1c6-b-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(a);
  v := public.book_slot(venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode_a,
                        p_kind => case when p_whole then 'whole' else 'half' end);
  perform tests.act_as_postgres();
  booking := v.id;
  a_share := (select id from public.booking_payment_shares where booking_id = booking and profile_id = a);
  perform tests.pay_ago(a_share, 'pi_b1c6_a_' || gen_random_uuid(), interval '2 hours');
  if p_whole or p_no_b then
    return;
  end if;
  perform tests.act_as(a);
  perform public.invite_opposition(booking, array[b]);
  perform tests.act_as(b);
  r := public.accept_opposition((select id from public.booking_opposition_invites where booking_id = booking and invited_profile_id = b),
                                p_mode_b);
  perform tests.act_as_postgres();
  b_share := (r ->> 'share_id')::uuid;
  perform tests.pay_ago(b_share, 'pi_b1c6_b_' || gen_random_uuid(), interval '2 hours');
end;
$$;

-- A second row exactly like an existing cancellation (what a double submit
-- or a retry would write); the error, or null if it went in.
create function tests.b1c6_insert_again(p_cancellation uuid)
returns text
language sql
as $$
  select tests.error_of(format(
    'insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan, side_id)
     select booking_id, scope, cancelled_by, quote, plan, side_id from public.booking_cancellations where id = %L',
    p_cancellation));
$$;

-- 1. Side B cancels, then side A: each side's money follows today's rules
--    (€5.00 kept, €17.75 credit each), and only the second cancel ends the
--    booking.
do $$
declare
  s record := tests.b1c6_setup();
  cb jsonb;
  ca jsonb;
  l public.booking_cancellation_lines;
begin
  cb := tests.cancel(s.booking, 'whole_team', s.b);
  assert not (cb ->> 'cancels_booking')::boolean, 'side B: his side only';
  l := tests.line(cb, s.b_share);
  assert (l.action, l.kept_cents, l.credit_cents) = ('keep_and_credit', 500, 1775),
    format('side B: %s', row(l.action, l.kept_cents, l.credit_cents));
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'the booking stays';

  ca := tests.cancel(s.booking, 'whole_team', s.a);
  assert (ca ->> 'cancels_booking')::boolean, 'side A is the last side: the booking goes';
  l := tests.line(ca, s.a_share);
  assert (l.action, l.kept_cents, l.credit_cents) = ('keep_and_credit', 500, 1775),
    format('side A: %s', row(l.action, l.kept_cents, l.credit_cents));
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
  assert (select array_agg(ends_booking order by cancelled_at, ends_booking)
          from public.booking_cancellations where booking_id = s.booking) = array[false, true],
    'two cancellations, the second ends the booking';
end $$;

-- 2. The reverse: side A cancels, side B keeps the slot and becomes side A,
--    then he cancels too. Same amounts; the booking goes with him.
do $$
declare
  s record := tests.b1c6_setup();
  ca jsonb;
  cb jsonb;
  l public.booking_cancellation_lines;
begin
  ca := tests.cancel(s.booking, 'whole_team', s.a);
  l := tests.line(ca, s.a_share);
  assert (l.action, l.kept_cents, l.credit_cents) = ('keep_and_credit', 500, 1775),
    format('side A: %s', row(l.action, l.kept_cents, l.credit_cents));
  assert (select (side, captain_id) from public.booking_sides where booking_id = s.booking) = ('a'::text, s.b),
    'side B is side A now';

  cb := tests.cancel(s.booking, 'whole_team', s.b);
  assert (cb ->> 'cancels_booking')::boolean, 'the last side: the booking goes';
  l := tests.line(cb, s.b_share);
  assert (l.action, l.kept_cents, l.credit_cents) = ('keep_and_credit', 500, 1775),
    format('the former side B: %s', row(l.action, l.kept_cents, l.credit_cents));
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
end $$;

-- 3. Under 6 hours: side B pulls out (nothing back, €22.75 kept; his side
--    is marked as left and stays), then side A cancels (nothing back either)
--    and the booking goes.
do $$
declare
  s record := tests.b1c6_setup();
  cb jsonb;
  ca jsonb;
begin
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  cb := tests.cancel(s.booking, 'whole_team', s.b);
  assert ((tests.line(cb, s.b_share)).action, (tests.line(cb, s.b_share)).kept_cents) = ('keep', 2275), 'side B: nothing back';
  assert (select left_at is not null from public.booking_sides where booking_id = s.booking and side = 'b'), 'side B left';
  ca := tests.cancel(s.booking, 'whole_team', s.a);
  assert (ca ->> 'cancels_booking')::boolean, 'the booking goes';
  assert ((tests.line(ca, s.a_share)).action, (tests.line(ca, s.a_share)).kept_cents) = ('keep', 2275), 'side A: nothing back';
  assert (select status from public.venue_bookings where id = s.booking) = 'cancelled', 'cancelled';
end $$;

-- 4. The same side can't cancel twice: the app can't ask again, and a second
--    row for the same side is refused, also after the relabel (side B,
--    now side A) and for a side that left under 6 hours.
do $$
declare
  s record := tests.b1c6_setup();
  ca jsonb;
  e text;
begin
  ca := tests.cancel(s.booking, 'whole_team', s.a);
  assert tests.error_of(format('select tests.plan(%L, ''whole_team'', %L)', s.booking, s.a)) = 'not_your_booking',
    'side A''s captain has no side left to cancel';
  e := tests.b1c6_insert_again((ca ->> 'cancellation_id')::uuid);
  assert e like '%booking_cancellations_side_once_idx%', format('side A once: %s', e);
end $$;

do $$
declare
  s record := tests.b1c6_setup();
  cb jsonb;
  e text;
begin
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  cb := tests.cancel(s.booking, 'whole_team', s.b);
  assert tests.error_of(format('select tests.plan(%L, ''whole_team'', %L)', s.booking, s.b)) = 'not_your_booking',
    'a side that left can''t cancel again';
  e := tests.b1c6_insert_again((cb ->> 'cancellation_id')::uuid);
  assert e like '%booking_cancellations_side_once_idx%', format('side B once: %s', e);
end $$;

-- 5. A whole pitch still cancels once.
do $$
declare
  s record := tests.b1c6_setup(p_whole => true);
  c jsonb;
  e text;
begin
  c := tests.cancel(s.booking, 'whole_team', s.a);
  assert (c ->> 'cancels_booking')::boolean, 'the booking';
  assert (select side_id from public.booking_cancellations where id = (c ->> 'cancellation_id')::uuid) is null,
    'a whole pitch has no side';
  assert tests.error_of(format('select tests.plan(%L, ''whole_team'', %L)', s.booking, s.a)) = 'already_cancelled',
    'the app can''t ask again';
  e := tests.b1c6_insert_again((c ->> 'cancellation_id')::uuid);
  assert e like '%booking_cancellations_once_idx%', format('the booking once: %s', e);
end $$;

-- 6. A half pitch with no side B: cancelling cancels the booking, once.
do $$
declare
  s record := tests.b1c6_setup(p_no_b => true);
  c jsonb;
  e text;
begin
  c := tests.cancel(s.booking, 'whole_team', s.a);
  assert (c ->> 'cancels_booking')::boolean, 'the booking';
  e := tests.b1c6_insert_again((c ->> 'cancellation_id')::uuid);
  assert e like '%booking_cancellations_%once_idx%', format('once: %s', e);
end $$;

-- 7. A new side B (the invite reopened) can cancel its own side after the
--    first side B did.
do $$
declare
  s record := tests.b1c6_setup();
  v_new uuid := tests.create_user('b1c6-n-' || gen_random_uuid() || '@futty.test');
  r jsonb;
  v_share uuid;
  c jsonb;
begin
  perform tests.cancel(s.booking, 'whole_team', s.b);
  perform tests.act_as(s.a);
  perform public.invite_opposition(s.booking, array[v_new]);
  perform tests.act_as(v_new);
  r := public.accept_opposition((select id from public.booking_opposition_invites where booking_id = s.booking and invited_profile_id = v_new),
                                'pay_all');
  perform tests.act_as_postgres();
  v_share := (r ->> 'share_id')::uuid;
  perform tests.pay_ago(v_share, 'pi_b1c6_n_' || gen_random_uuid(), interval '2 hours');
  c := tests.cancel(s.booking, 'whole_team', v_new);
  assert ((tests.line(c, v_share)).kept_cents, (tests.line(c, v_share)).credit_cents) = (500, 1775), 'the new side B: today''s rules';
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'side A still plays';
end $$;

-- 8. After both sides cancelled, each captain still sees his own outcome
--    (my_cancellation_outcome reads the cancellation with his money, not
--    just the last one).
do $$
declare
  s record := tests.b1c6_setup();
  o jsonb;
begin
  perform tests.cancel(s.booking, 'whole_team', s.b);
  perform tests.cancel(s.booking, 'whole_team', s.a);
  perform tests.act_as(s.b);
  o := public.my_cancellation_outcome(s.booking);
  perform tests.act_as_postgres();
  assert o is not null, 'side B sees his outcome';
  assert (o -> 'lines' -> 0 ->> 'share_id')::uuid = s.b_share
         and (o -> 'lines' -> 0 ->> 'credit_cents')::integer = 1775, format('his own line: %s', o);
  perform tests.act_as(s.a);
  o := public.my_cancellation_outcome(s.booking);
  perform tests.act_as_postgres();
  assert (o -> 'lines' -> 0 ->> 'share_id')::uuid = s.a_share, format('side A sees his: %s', o);
end $$;

rollback;
