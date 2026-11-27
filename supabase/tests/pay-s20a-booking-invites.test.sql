-- S20A (b): player invites (spec 13 "Player invites (S20A, decided 27
-- November)", with #245; migration pay_s20a_booking_invites).
--   - Invites close when the side is full or at kickoff, whichever comes
--     first; filling the side expires the others, and a spot that reopens
--     doesn't revive them.
--   - The spot is taken at accept (booking_full once the side is full).
--   - A card player has 15 minutes to pay or hold (kickoff if sooner), or his
--     acceptance lapses; Losers pay too. A cash player never lapses.
--   - A late hold or charge after the lapse gives back only itself.
--   - A lapsed player can be invited again: his share row comes back as a new
--     attempt, and late money on his old intent gives back only itself.
--   - Invite a team, invite all friends.
-- Amounts are spec 13's €40.00 5-a-side pitch.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.s20b_user(p_label text, p_age integer default 30)
returns uuid
language sql
as $$
  select tests.create_user(format('s20b-%s-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)),
    jsonb_build_object(
      'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
      'full_name', 'S20b ' || p_label,
      'username', 's20b' || replace(left(gen_random_uuid()::text, 12), '-', '')));
$$;

-- A booking 3 days away on a €40.00 5-a-side pitch (10 players), the
-- booker's share held: whole pitch, or half (side A) with p_losers_pay.
create function tests.s20b_book(p_mode text default 'each_pays_responsible', p_kind text default 'whole',
                                p_losers_pay boolean default false, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
begin
  booker := tests.s20b_user('booker');
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode,
                        p_kind => p_kind, p_losers_pay => p_losers_pay);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((tests.share_of(booking, booker)).id, 'pi_s20b_a_' || gen_random_uuid());
end;
$$;

-- p_as invites p_profile (by username, as the app does); returns the invite.
create function tests.s20b_invite(p_booking uuid, p_as uuid, p_profile uuid)
returns uuid
language plpgsql
as $$
declare
  v_username text := (select username from public.profiles where id = p_profile);
begin
  perform tests.act_as(p_as);
  perform public.add_booking_player(p_booking, v_username);
  perform tests.act_as_postgres();
  return (select id from public.invites
          where kind = 'booking' and booking_id = p_booking and invited_profile_id = p_profile and status = 'pending');
end;
$$;

create function tests.s20b_accept(p_invite uuid, p_as uuid, p_method text default null)
returns public.invites
language plpgsql
as $$
declare
  v public.invites;
begin
  perform tests.act_as(p_as);
  v := public.accept_invite(p_invite, p_method);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s20b_invite_status(p_invite uuid)
returns text language sql as $$ select status from public.invites where id = p_invite $$;

-- Fills a whole-pitch booking up to p_active active shares (the booker is one).
create function tests.s20b_fill(p_booking uuid, p_active integer)
returns void
language plpgsql
as $$
begin
  while (select count(*) from public.booking_payment_shares
         where booking_id = p_booking and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'))
        < p_active loop
    perform tests.join_booking(p_booking, tests.s20b_user('filler'));
  end loop;
end;
$$;

create function tests.s20b_lapse_now(p_share uuid)
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  update public.booking_payment_shares set pay_by = now() - interval '1 second' where id = p_share;
  perform tests.act_as_service_role();
  v := public.booking_player_lapse_due();
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s20b_notified(p_profile uuid, p_type text)
returns integer
language sql
as $$ select count(*)::integer from public.notifications where profile_id = p_profile and type = p_type $$;

-- ---- 1. A card acceptance: the spot now, 15 minutes to pay or hold --------------------------
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('p1');
  v_invite uuid;
  v public.booking_payment_shares;
begin
  v_invite := tests.s20b_invite(b.booking, b.booker, p);
  assert tests.s20b_notified(p, 'booking_invite') = 1, 'the invite is a notification (push)';
  perform tests.s20b_accept(v_invite, p);
  v := tests.share_of(b.booking, p);
  assert v.status = 'pending' and v.payment_method = 'card', 'his share is taken at accept: ' || v.status;
  assert v.pay_by between now() + interval '14 minutes 59 seconds' and now() + interval '15 minutes 1 second',
    'card: 15 minutes to pay or hold, got ' || v.pay_by;
  assert tests.s20b_invite_status(v_invite) = 'accepted', 'the invite is accepted';
end $$;

-- Accepting less than 15 minutes before kickoff: it lapses at kickoff.
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('late');
  v_invite uuid;
  v_kickoff timestamptz := date_trunc('minute', now()) + interval '10 minutes';
begin
  v_invite := tests.s20b_invite(b.booking, b.booker, p);
  perform tests.set_kickoff(b.booking, v_kickoff);
  perform tests.s20b_accept(v_invite, p);
  assert (tests.share_of(b.booking, p)).pay_by = v_kickoff,
    format('pay_by is kickoff %s, got %s', v_kickoff, (tests.share_of(b.booking, p)).pay_by);
end $$;

-- A pay-for-everyone booking: the share is covered, nothing to pay, no pay_by.
do $$
declare
  b record := tests.s20b_book('pay_all');
  p uuid := tests.s20b_user('covered');
begin
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p);
  assert (tests.share_of(b.booking, p)).status = 'covered' and (tests.share_of(b.booking, p)).pay_by is null,
    'pay for everyone: covered, no pay_by';
end $$;

-- ---- 2. Cash (section 1, waiting on Panos): keeps the spot, never lapses ---------------------
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('cash');
  v public.booking_payment_shares;
begin
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p, 'cash');
  v := tests.share_of(b.booking, p);
  assert v.payment_method = 'cash' and v.pay_by is null and v.status = 'pending', 'cash: saved, no pay_by';
  -- €0.80 in the app, €4.00 in cash at the venue (spec 13 example 3).
  assert v.amount_cents = 80 and v.cash_cents = 400, format('cash amounts 80 / 400, got %s / %s', v.amount_cents, v.cash_cents);
  perform tests.act_as_service_role();
  assert public.booking_player_lapse_due() = 0, 'cash never lapses';
  perform tests.act_as_postgres();
  assert (tests.share_of(b.booking, p)).status = 'pending', 'still in';
end $$;

do $$
declare
  b record := tests.s20b_book('each_pays_responsible', 'half');
  p uuid := tests.s20b_user('cash-half');
  v_invite uuid;
begin
  v_invite := tests.s20b_invite(b.booking, b.booker, p);
  assert tests.error_as(p, format('select public.accept_invite(%L, ''cash'')', v_invite)) = 'cash_whole_pitch_only',
    'no cash on a half pitch';
  assert tests.error_as(p, format('select public.accept_invite(%L, ''bitcoin'')', v_invite)) = 'invalid_method',
    'only card or cash';
  assert tests.s20b_invite_status(v_invite) = 'pending', 'nothing changed';
end $$;

-- ---- 3. Closing: kickoff, and the side full --------------------------------------------------
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('kick');
  q uuid := tests.s20b_user('kick2');
  v_invite uuid;
  v_error text;
begin
  v_invite := tests.s20b_invite(b.booking, b.booker, p);
  perform tests.set_kickoff(b.booking, now() - interval '1 minute');
  perform tests.act_as(b.booker);
  v_error := tests.error_of(format('select public.add_booking_player(%L, %L)', b.booking,
                                   (select username from public.profiles where id = q)));
  perform tests.act_as_postgres();
  assert v_error = 'invites_closed', 'no invite from kickoff, got ' || coalesce(v_error, 'no error');
  assert tests.error_as(p, format('select public.accept_invite(%L)', v_invite)) = 'invite_expired',
    'no accept from kickoff';
  perform tests.act_as_service_role();
  assert public.booking_invites_expire_due() >= 1, 'the job expires pending invites at kickoff';
  assert public.booking_invites_expire_due() = 0, 'once';
  perform tests.act_as_postgres();
  assert tests.s20b_invite_status(v_invite) = 'expired', 'expired';
end $$;

-- Filling the side expires every other pending invite for it, at once; a
-- spot that reopens doesn't revive them: a new invite does.
do $$
declare
  b record := tests.s20b_book();
  a uuid := tests.s20b_user('first');
  c uuid := tests.s20b_user('second');
  d uuid := tests.s20b_user('third');
  v_a uuid;
  v_c uuid;
  v_d uuid;
  v_error text;
begin
  perform tests.s20b_fill(b.booking, 9);
  v_a := tests.s20b_invite(b.booking, b.booker, a);
  v_c := tests.s20b_invite(b.booking, b.booker, c);
  v_d := tests.s20b_invite(b.booking, b.booker, d);
  perform tests.s20b_accept(v_a, a);
  assert tests.s20b_invite_status(v_a) = 'accepted', 'the first to accept takes the last spot';
  assert tests.s20b_invite_status(v_c) = 'expired' and tests.s20b_invite_status(v_d) = 'expired',
    'filling the side expires the others in the same transaction';
  assert tests.error_as(c, format('select public.accept_invite(%L)', v_c)) = 'invite_expired', 'expired: refused';
  assert tests.share_of(b.booking, c) is null or (tests.share_of(b.booking, c)).id is null, 'and no share';
  perform tests.act_as(b.booker);
  v_error := tests.error_of(format('select public.add_booking_player(%L, %L)', b.booking,
                                   (select username from public.profiles where id = c)));
  perform tests.act_as_postgres();
  assert v_error = 'booking_full', 'no invite while full, got ' || coalesce(v_error, 'no error');

  -- The first player's acceptance lapses: a spot reopens, the old invites stay expired.
  assert tests.s20b_lapse_now((tests.share_of(b.booking, a)).id) = 1, 'a lapse';
  assert tests.s20b_invite_status(v_c) = 'expired', 'a reopened spot doesn''t revive them';
  assert tests.error_as(c, format('select public.accept_invite(%L)', v_c)) = 'invite_expired', 'still refused';
  v_c := tests.s20b_invite(b.booking, b.booker, c);
  perform tests.s20b_accept(v_c, c);
  assert (tests.share_of(b.booking, c)).status = 'pending', 'the captain invites again, and that one works';
end $$;

-- A full side at accept (a race the expiry didn't see): booking_full, no share.
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('full');
  v_invite uuid;
begin
  perform tests.s20b_fill(b.booking, 9);
  v_invite := tests.s20b_invite(b.booking, b.booker, p);
  -- Taken by someone else without the trigger seeing it (a venue player).
  perform tests.join_booking(b.booking, tests.s20b_user('other'));
  update public.invites set status = 'pending' where id = v_invite;
  assert tests.error_as(p, format('select public.accept_invite(%L)', v_invite)) = 'booking_full', 'booking_full';
  assert (tests.share_of(b.booking, p)).id is null, 'no share';
  assert tests.s20b_invite_status(v_invite) = 'pending', 'the refusal changed nothing';
end $$;

-- On a half pitch only the side that filled expires.
do $$
declare
  b record := tests.s20b_book('each_pays_responsible', 'half');
  a uuid := tests.s20b_user('half-a');
  c uuid := tests.s20b_user('half-c');
  v_a uuid;
  v_c uuid;
  i integer;
begin
  for i in 1 .. 3 loop
    perform public.add_booking_side_share_internal(b.booking, tests.s20b_user('half-fill'), 'a');
  end loop;
  v_a := tests.s20b_invite(b.booking, b.booker, a);
  v_c := tests.s20b_invite(b.booking, b.booker, c);
  perform tests.s20b_accept(v_a, a);
  assert (tests.share_of(b.booking, a)).side = 'a', 'joins side A';
  assert tests.s20b_invite_status(v_c) = 'expired', 'side A full: its other invite expires';
end $$;

-- ---- 4. The lapse job ------------------------------------------------------------------------
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('lapse');
  q uuid := tests.s20b_user('next');
  v_invite uuid;
  v public.booking_payment_shares;
  v_intent text := 'pi_s20b_lapse_' || gen_random_uuid();
begin
  v_invite := tests.s20b_invite(b.booking, b.booker, p);
  perform tests.s20b_accept(v_invite, p);
  v := tests.share_of(b.booking, p);
  perform tests.pay_share(v.id, v_intent);  -- he started paying, nothing held yet

  -- Not due at 14 minutes.
  update public.booking_payment_shares set pay_by = now() + interval '1 minute' where id = v.id;
  perform tests.act_as_service_role();
  assert public.booking_player_lapse_due() = 0, 'not due yet';
  perform tests.act_as_postgres();

  assert tests.s20b_lapse_now(v.id) = 1, 'due: one lapse';
  v := tests.share_of(b.booking, p);
  assert v.status = 'cancelled' and v.pay_by is null, 'his share is cancelled';
  assert tests.s20b_invite_status(v_invite) = 'lapsed', 'his acceptance lapsed';
  assert exists (select 1 from public.money_releases where share_id = v.id and stripe_intent_id = v_intent
                   and reason = 'player_lapsed' and status = 'pending'), 'his started payment is queued for release';
  assert tests.s20b_notified(p, 'booking_spot_lapsed') = 1, 'he is told';
  assert tests.s20b_notified(b.booker, 'booking_spot_released') = 1, 'his captain is told a spot opened';
  perform tests.act_as_service_role();
  assert public.booking_player_lapse_due() = 0, 'runs once';
  perform tests.act_as_postgres();
  -- The spot is free: another invitee can take it.
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, q), q);
  assert (tests.share_of(b.booking, q)).status = 'pending', 'the spot reopened';
end $$;

-- A hold that arrived before the job: never lapses.
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('held');
  v public.booking_payment_shares;
begin
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p);
  v := tests.share_of(b.booking, p);
  perform tests.hold_share(v.id, 'pi_s20b_held_' || gen_random_uuid());
  assert tests.s20b_lapse_now(v.id) = 0, 'a held share isn''t picked';
  assert (tests.share_of(b.booking, p)).status = 'authorized', 'still held';
end $$;

-- Only the jobs' service role runs them.
do $$
begin
  perform tests.act_as(tests.s20b_user('nosy'));
  assert tests.error_of('select public.booking_player_lapse_due()') like 'permission denied%', 'authenticated: refused';
  assert tests.error_of('select public.booking_invites_expire_due()') like 'permission denied%', 'authenticated: refused';
  assert tests.error_of('select public.booking_invite_revive_share(gen_random_uuid(), gen_random_uuid(), null)')
         like 'permission denied%', 'internal helpers: refused';
  perform tests.act_as_anon();
  assert tests.error_of('select public.accept_invite(gen_random_uuid())') like 'permission denied%', 'anon: refused';
  assert tests.error_of('select public.invite_all_friends_to_booking(gen_random_uuid())') like 'permission denied%',
    'anon: refused';
  perform tests.act_as_postgres();
end $$;

-- ---- 5. Losers pay: 15 minutes to place his hold, twice his share ---------------------------
do $$
declare
  b record := tests.s20b_book('each_pays_responsible', 'half', true);
  p uuid := tests.s20b_user('lp');
  v public.booking_payment_shares;
  v_guarantees text;
begin
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p);
  v := tests.share_of(b.booking, p);
  -- Spec 13 example 8a: 2 × €4.80 = €9.60.
  assert v.amount_cents = 960 and v.gipedo_side = 'a', format('his hold is €9.60, got %s', v.amount_cents);
  assert v.pay_by between now() + interval '14 minutes 59 seconds' and now() + interval '15 minutes 1 second',
    'Losers pay: 15 minutes too';
  select string_agg(format('%s:%s:%s', id, status, amount_cents), ',' order by id) into v_guarantees
  from public.booking_guarantees where booking_id = b.booking;
  assert tests.s20b_lapse_now(v.id) = 1, 'it lapses';
  assert (select coalesce(string_agg(format('%s:%s:%s', id, status, amount_cents), ',' order by id), '')
          from public.booking_guarantees where booking_id = b.booking) = coalesce(v_guarantees, ''),
    'the captain''s guarantee is unchanged';
end $$;

-- ---- 6. Races: money that arrives after the lapse gives back only itself ---------------------
-- A hold after the lapse.
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('race-hold');
  o uuid := tests.s20b_user('race-other');
  v public.booking_payment_shares;
  v_other public.booking_payment_shares;
  v_booker public.booking_payment_shares;
  v_intent text := 'pi_s20b_rh_' || gen_random_uuid();
  v_plan jsonb;
  r jsonb;
begin
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, o), o);
  perform tests.hold_share((tests.share_of(b.booking, o)).id, 'pi_s20b_ro_' || gen_random_uuid());
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p);
  v := tests.share_of(b.booking, p);
  v_plan := tests.pay_share(v.id, v_intent);
  v_other := tests.share_of(b.booking, o);
  v_booker := tests.share_of(b.booking, b.booker);
  assert tests.s20b_lapse_now(v.id) = 1, 'lapsed';

  r := public.share_payment_held(v.id, v_intent, (v_plan ->> 'amount_cents')::integer, 'pm_late', now());
  assert r ->> 'result' = 'release' and r ->> 'reason' = 'share_cancelled', 'late hold: released alone, got ' || r::text;
  assert (select status from public.venue_bookings where id = b.booking) <> 'cancelled', 'the game is still on';
  assert (tests.share_of(b.booking, o)).status = v_other.status, 'the other player''s hold is untouched';
  assert (tests.share_of(b.booking, b.booker)).status = v_booker.status, 'the booker''s share is untouched';
  assert (tests.share_of(b.booking, p)).status = 'cancelled', 'his share stays cancelled';
end $$;

-- A charge (taken at once, less than 6 hours before kickoff) after the lapse.
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('race-charge');
  v public.booking_payment_shares;
  v_booker public.booking_payment_shares;
  v_intent text := 'pi_s20b_rc_' || gen_random_uuid();
  v_plan jsonb;
  r jsonb;
begin
  perform tests.set_kickoff(b.booking, now() + interval '5 hours');
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p);
  v := tests.share_of(b.booking, p);
  v_plan := tests.pay_share(v.id, v_intent, 'card', true);
  assert v_plan ->> 'capture_method' = 'immediate', 'taken at once';
  v_booker := tests.share_of(b.booking, b.booker);
  assert tests.s20b_lapse_now(v.id) = 1, 'lapsed';

  r := public.share_payment_captured(v.id, v_intent, (v_plan ->> 'amount_cents')::integer, 'pm_late',
                                     (v_plan ->> 'fee_cents')::integer, 30, now());
  assert r ->> 'result' = 'refund' and r ->> 'reason' = 'share_cancelled', 'late charge: refunded alone, got ' || r::text;
  assert exists (select 1 from public.money_ledger where stripe_id = v_intent and kind = 'capture'),
    'the capture is in the ledger';
  assert (select status from public.venue_bookings where id = b.booking) <> 'cancelled', 'the game is still on';
  assert (tests.share_of(b.booking, b.booker)).status = v_booker.status, 'the booker''s share is untouched';
end $$;

-- ---- 7. A lapsed player invited again: his share comes back as a new attempt -----------------
do $$
declare
  b record := tests.s20b_book();
  p uuid := tests.s20b_user('again');
  v public.booking_payment_shares;
  v_old text := 'pi_s20b_old_' || gen_random_uuid();
  v_plan jsonb;
  r jsonb;
begin
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p);
  v := tests.share_of(b.booking, p);
  v_plan := tests.pay_share(v.id, v_old);
  assert tests.s20b_lapse_now(v.id) = 1, 'lapsed';

  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, p), p);
  v := tests.share_of(b.booking, p);
  assert v.status = 'pending' and v.offer_attempt = 2, format('the same row, attempt 2, got %s %s', v.status, v.offer_attempt);
  assert v.replaced_intent_ids @> array[v_old], 'the old intent is kept as replaced';
  assert v.stripe_payment_intent_id is null and v.pay_by > now(), 'no payment yet, a new 15 minutes';
  assert (public.plan_share_payment(v.id, p, 'card', false) ->> 'offer_attempt')::integer = 2,
    'the new payment is keyed on attempt 2 (a new Stripe request)';

  -- Late money on the OLD intent gives back only itself; the new share is untouched.
  r := public.share_payment_held(v.id, v_old, (v_plan ->> 'amount_cents')::integer, 'pm_old', now());
  assert r ->> 'result' = 'release' and r ->> 'reason' = 'replaced_intent', 'old hold: released, got ' || r::text;
  r := public.share_payment_captured(v.id, v_old, (v_plan ->> 'amount_cents')::integer, 'pm_old', 80, 30, now());
  assert r ->> 'result' = 'refund' and r ->> 'reason' = 'replaced_intent', 'old charge: refunded, got ' || r::text;
  v := tests.share_of(b.booking, p);
  assert v.status = 'pending' and v.stripe_payment_intent_id is null, 'his new share is untouched';
end $$;

-- ---- 8. Invite a team, invite all friends ----------------------------------------------------
do $$
declare
  b record := tests.s20b_book();
  m1 uuid := tests.s20b_user('m1');
  m2 uuid := tests.s20b_user('m2-blocked');
  m3 uuid := tests.s20b_user('m3-minor', 14);
  m4 uuid := tests.s20b_user('m4-invited');
  m5 uuid := tests.s20b_user('m5');
  outsider uuid := tests.s20b_user('outsider');
  v_team uuid;
  v integer;
begin
  insert into public.teams (name, city, created_by) values ('S20b FC', 'Nicosia', m1) returning id into v_team;
  perform tests.join_team(v_team, m1, 'captain');
  perform tests.join_team(v_team, b.booker);
  perform tests.join_team(v_team, m2);
  perform tests.join_team(v_team, m3);
  perform tests.join_team(v_team, m4);
  perform tests.join_team(v_team, m5);
  insert into public.blocked_users (blocker_id, blocked_id) values (m2, b.booker);
  perform tests.s20b_invite(b.booking, b.booker, m4);

  perform tests.act_as(b.booker);
  v := public.invite_team_to_booking(b.booking, v_team);
  perform tests.act_as_postgres();
  assert v = 2, format('m1 and m5 invited (blocked, minor and already invited skipped), got %s', v);
  assert exists (select 1 from public.invites where booking_id = b.booking and invited_profile_id = m1 and status = 'pending')
     and exists (select 1 from public.invites where booking_id = b.booking and invited_profile_id = m5 and status = 'pending')
     and not exists (select 1 from public.invites where booking_id = b.booking and invited_profile_id in (m2, m3)),
    'the right members';
  assert tests.error_as(outsider, format('select public.invite_team_to_booking(%L, %L)', b.booking, v_team)) = 'not_member',
    'only a member invites his team';
  update public.teams set deleted_at = now() where id = v_team;
  assert tests.error_as(b.booker, format('select public.invite_team_to_booking(%L, %L)', b.booking, v_team)) = 'team_deleted',
    'not a deleted team';
  update public.teams set deleted_at = null where id = v_team;
  assert tests.error_as(m1, format('select public.invite_team_to_booking(%L, %L)', b.booking, v_team)) = 'not_your_booking',
    'only who may invite to the booking';
end $$;

do $$
declare
  b record := tests.s20b_book();
  f1 uuid := tests.s20b_user('f1');
  f2 uuid := tests.s20b_user('f2-blocked');
  f3 uuid := tests.s20b_user('f3');
  stranger uuid := tests.s20b_user('stranger');
  v integer;
begin
  insert into public.friendships (requester_id, addressee_id, status, accepted_at) values
    (b.booker, f1, 'accepted', now()), (f2, b.booker, 'accepted', now()), (b.booker, f3, 'accepted', now());
  insert into public.friendships (requester_id, addressee_id, status) values (b.booker, stranger, 'pending');
  insert into public.blocked_users (blocker_id, blocked_id) values (b.booker, f2);
  perform tests.s20b_accept(tests.s20b_invite(b.booking, b.booker, f3), f3);  -- already in

  perform tests.act_as(b.booker);
  v := public.invite_all_friends_to_booking(b.booking);
  perform tests.act_as_postgres();
  assert v = 1, format('only f1 (a blocked friend, a pending request and a player already in are skipped), got %s', v);
  assert exists (select 1 from public.invites where booking_id = b.booking and invited_profile_id = f1 and status = 'pending'),
    'f1 invited';
  perform tests.act_as(b.booker);
  v := public.invite_all_friends_to_booking(b.booking);
  perform tests.act_as_postgres();
  assert v = 0, 'nobody twice';
end $$;

rollback;
