-- P6e no-shows: staff mark a spot holder arrived (docs/specs/13-payments-bookings.md
-- "No-shows"; match-record.md section 5.4).
--   venue_mark_arrived writes a match_attendance row with method 'venue',
--   from 60 minutes before kickoff until result_deadline_at, for a spot
--   holder only; idempotent, and an existing QR or captain row is kept.
--   venue_unmark_arrived removes only a venue tick, in the same window, and
--   is refused once the player has used the check-in (a man-of-the-match
--   vote: check_in_used).
--   A venue tick sends motm_vote_open as a captain's late tick does: once
--   per player per match, only while voting is open, never for a forfeit.
--   No money moves.
begin;

create function tests.ns_game(p_venue uuid, p_others integer, p_day date, p_label text)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
begin
  v_booking := tests.booking_with_players(tests.create_user(format('%s-booker@futty.test', p_label)), p_venue,
                                          'each_pays_own_spot', p_others, p_day, '12:00', '13:00', p_label);
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id returning * into v_booking;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  return v_booking;
end;
$$;

create function tests.ns_times(p_match uuid, p_kickoff timestamptz, p_ends timestamptz)
returns void
language sql
as $$
  update public.matches set kickoff_at = p_kickoff, ends_at = p_ends, result_deadline_at = p_ends + interval '24 hours'
  where id = p_match;
$$;

create function tests.ns_mark(p_user uuid, p_match uuid, p_profile uuid)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.venue_mark_arrived(%L, %L)', p_match, p_profile));
$$;

create function tests.ns_unmark(p_user uuid, p_match uuid, p_profile uuid)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.venue_unmark_arrived(%L, %L)', p_match, p_profile));
$$;

-- 1. Marking arrived and undoing it.
do $$
declare
  v_owner uuid := tests.create_user('ns4-owner@futty.test');
  v_b public.venue_bookings := tests.ns_game(tests.create_venue(p_owner => v_owner), 3, tests.next_weekday(3), 'ns4');
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_p uuid := (tests.player(v_b.id, 1)).profile_id;
  v_qr uuid := (tests.player(v_b.id, 2)).profile_id;
  v_left uuid := (tests.player(v_b.id, 3)).profile_id;
  v_squad uuid := tests.create_user('ns4-squad@futty.test');
  v_row public.match_attendance;
begin
  update public.booking_payment_shares set status = 'credited' where id = (tests.player(v_b.id, 3)).id;
  update public.match_players set left_at = now() where match_id = v_m and profile_id = v_left;
  insert into public.match_players (match_id, profile_id, side) values (v_m, v_squad, 'b');

  -- Kickoff in 60 minutes and one second: too early. Exactly 60: open.
  perform tests.ns_times(v_m, now() + interval '60 minutes 1 second', now() + interval '2 hours');
  assert tests.ns_mark(v_owner, v_m, v_p) = 'check_in_closed', 'not more than 60 minutes before kickoff';
  perform tests.ns_times(v_m, now() + interval '60 minutes', now() + interval '2 hours');
  assert tests.ns_mark(v_owner, v_m, v_p) is null, 'marked 60 minutes before kickoff';
  select * into v_row from public.match_attendance where match_id = v_m and profile_id = v_p;
  assert v_row.method = 'venue' and v_row.checked_in_by = v_owner, format('a venue tick by staff, got %s', row_to_json(v_row));
  assert tests.ns_mark(v_owner, v_m, v_p) is null, 'marking again is fine';
  assert (select count(*) from public.match_attendance where match_id = v_m and profile_id = v_p) = 1, 'one row';

  -- Only spot holders.
  assert tests.ns_mark(v_owner, v_m, v_left) = 'not_in_match', 'left the game';
  assert tests.ns_mark(v_owner, v_m, v_squad) = 'not_in_match', 'squad member without a spot';
  assert tests.ns_mark(v_owner, v_m, tests.create_user('ns4-stranger@futty.test')) = 'not_in_match', 'stranger';
  assert tests.ns_mark(v_owner, gen_random_uuid(), v_p) = 'match_not_found', 'no such match';

  -- A QR check-in is kept as it is, and staff can't remove it.
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_qr, 'qr', v_qr);
  assert tests.ns_mark(v_owner, v_m, v_qr) is null, 'already checked in: fine';
  assert (select method from public.match_attendance where match_id = v_m and profile_id = v_qr) = 'qr', 'QR row kept';
  assert tests.ns_unmark(v_owner, v_m, v_qr) = 'not_venue_check_in', 'a QR check-in can''t be removed';
  update public.match_attendance set method = 'captain' where match_id = v_m and profile_id = v_qr;
  assert tests.ns_unmark(v_owner, v_m, v_qr) = 'not_venue_check_in', 'nor a captain''s tick';
  assert tests.ns_unmark(v_owner, v_m, (tests.player(v_b.id, 0)).profile_id) = 'not_checked_in', 'nothing to undo';

  -- Undo a venue tick.
  assert tests.ns_unmark(v_owner, v_m, v_p) is null, 'undone';
  assert not exists (select 1 from public.match_attendance where match_id = v_m and profile_id = v_p), 'row removed';

  -- Open until the deadline, closed at it.
  perform tests.ns_times(v_m, now() - interval '25 hours', now() - interval '24 hours' + interval '1 second');
  assert tests.ns_mark(v_owner, v_m, v_p) is null, 'open until the deadline';
  assert tests.ns_unmark(v_owner, v_m, v_p) is null, 'undo open until the deadline';
  perform tests.ns_times(v_m, now() - interval '25 hours', now() - interval '24 hours');
  assert tests.ns_mark(v_owner, v_m, v_p) = 'check_in_closed', 'closed at the deadline';
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_p, 'venue', v_owner);
  assert tests.ns_unmark(v_owner, v_m, v_p) = 'check_in_closed', 'undo closed at the deadline';

  -- A void match.
  perform tests.ns_times(v_m, now() - interval '10 minutes', now() + interval '50 minutes');
  update public.matches set status = 'void' where id = v_m;
  assert tests.ns_mark(v_owner, v_m, (tests.player(v_b.id, 0)).profile_id) = 'check_in_closed', 'void';
end $$;

-- 2. A venue tick counts as a check-in (form) and sends motm_vote_open once.
do $$
declare
  v_owner uuid := tests.create_user('ns5-owner@futty.test');
  v_b public.venue_bookings := tests.ns_game(tests.create_venue(p_owner => v_owner), 2, tests.next_weekday(3), 'ns5');
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_p uuid := (tests.player(v_b.id, 1)).profile_id;
  v_q uuid := (tests.player(v_b.id, 2)).profile_id;
  v_f public.venue_bookings := tests.ns_game(tests.create_venue(p_owner => v_owner), 1, tests.next_weekday(4), 'ns5f');
  v_fm uuid := (tests.match_of(v_f.id)).id;
  v_fp uuid := (tests.player(v_f.id, 1)).profile_id;
begin
  update public.match_players set side = 'a' where match_id = v_m and profile_id in (v_b.created_by, v_p);
  update public.match_players set side = 'b' where match_id = v_m and profile_id = v_q;
  perform tests.ns_times(v_m, now() - interval '3 hours', now() - interval '2 hours');
  update public.matches set status = 'confirmed', side_a_score = 3, side_b_score = 1,
                            confirmed_via = 'agreed', confirmed_at = now() - interval '1 hour'
  where id = v_m;
  assert tests.notified(v_p, 'motm_vote_open', v_m) = 0, 'not checked in: not told yet';

  assert tests.ns_mark(v_owner, v_m, v_p) is null, 'ticked while voting is open';
  assert tests.notified(v_p, 'motm_vote_open', v_m) = 1, 'told once';
  -- Undo and tick again: still once (match_notification_log).
  assert tests.ns_unmark(v_owner, v_m, v_p) is null, 'undone';
  assert tests.ns_mark(v_owner, v_m, v_p) is null, 'ticked again';
  assert tests.notified(v_p, 'motm_vote_open', v_m) = 1, 'still told once';
  -- It counts for form like any check-in (decision 1b.2).
  assert exists (select 1 from public.player_form where profile_id = v_p and match_id = v_m and result = 'W'),
    'in the player''s form';

  -- Voting closed: ticked, but nobody is told.
  update public.matches set confirmed_at = now() - interval '24 hours' where id = v_m;
  assert tests.ns_mark(v_owner, v_m, v_q) is null, 'ticked after voting closed';
  assert tests.notified(v_q, 'motm_vote_open', v_m) = 0, 'voting closed: not told';

  -- A forfeit has no vote.
  perform tests.ns_times(v_fm, now() - interval '3 hours', now() - interval '2 hours');
  perform tests.act_as_service_role();
  perform public.record_match_forfeit(v_fm, 'b', 'pulled_out');
  perform tests.act_as_postgres();
  assert tests.ns_mark(v_owner, v_fm, v_fp) is null, 'ticked in a forfeit';
  assert tests.notified(v_fp, 'motm_vote_open', v_fm) = 0, 'forfeit: not told';
end $$;

-- 3. A check-in that was used can't be undone.
do $$
declare
  v_owner uuid := tests.create_user('ns6-owner@futty.test');
  v_b public.venue_bookings := tests.ns_game(tests.create_venue(p_owner => v_owner), 2, tests.next_weekday(3), 'ns6');
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_p uuid := (tests.player(v_b.id, 1)).profile_id;
  v_q uuid := (tests.player(v_b.id, 2)).profile_id;
begin
  update public.match_players set side = 'a' where match_id = v_m;
  perform tests.ns_times(v_m, now() - interval '3 hours', now() - interval '2 hours');
  update public.matches set status = 'confirmed', side_a_score = 2, side_b_score = 2,
                            confirmed_via = 'agreed', confirmed_at = now() - interval '1 hour'
  where id = v_m;
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_q, 'qr', v_q);
  assert tests.ns_mark(v_owner, v_m, v_p) is null, 'ticked';
  assert tests.error_as(v_p, format('select public.cast_motm_vote(%L, %L)', v_m, tests.player_id(v_m, v_q))) is null,
    'the ticked player votes';
  assert tests.ns_unmark(v_owner, v_m, v_p) = 'check_in_used', 'refused once they voted';
  assert exists (select 1 from public.match_attendance where match_id = v_m and profile_id = v_p), 'tick kept';
end $$;

-- 4. No money moves.
do $$
declare
  v_owner uuid := tests.create_user('ns7-owner@futty.test');
  v_b public.venue_bookings := tests.ns_game(tests.create_venue(p_owner => v_owner), 2, tests.next_weekday(3), 'ns7');
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_p uuid := (tests.player(v_b.id, 1)).profile_id;
  v_before text;
  v_after text;
begin
  perform tests.pay_ago((tests.player(v_b.id, 1)).id, 'pi_ns7_1');
  perform tests.ns_times(v_m, now() - interval '3 hours', now() - interval '2 hours');
  v_before := (select row(count(*), sum(amount_cents), sum(venue_cents))::text from public.money_ledger)
           || (select row(count(*), sum(amount_cents), string_agg(status, ',' order by id))::text
               from public.booking_payment_shares where booking_id = v_b.id)
           || (select row(count(*), sum(amount_cents))::text from public.venue_debts)
           || (select row(count(*), sum(remaining_cents))::text from public.venue_credits);
  assert tests.ns_mark(v_owner, v_m, v_p) is null, 'ticked';
  assert tests.ns_unmark(v_owner, v_m, v_p) is null, 'undone';
  v_after := (select row(count(*), sum(amount_cents), sum(venue_cents))::text from public.money_ledger)
          || (select row(count(*), sum(amount_cents), string_agg(status, ',' order by id))::text
              from public.booking_payment_shares where booking_id = v_b.id)
          || (select row(count(*), sum(amount_cents))::text from public.venue_debts)
          || (select row(count(*), sum(remaining_cents))::text from public.venue_credits);
  assert v_before = v_after, format('nothing changed: %s vs %s', v_before, v_after);

  -- A final no-show still holds their paid share.
  perform tests.ns_times(v_m, now() - interval '26 hours', now() - interval '25 hours');
  assert (select status from public.booking_payment_shares where id = (tests.player(v_b.id, 1)).id) in ('authorized', 'paid'),
    'their share is untouched';
end $$;

rollback;
