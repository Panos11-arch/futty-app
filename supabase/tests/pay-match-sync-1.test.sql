-- Keeping each booking's match in step (docs/specs/match-record.md sections
-- 1a and 6.1, contract 1; decided 11 November, spec 13 "Bookings and their
-- match"): create_match_for_booking runs whenever a booking made since P4a
-- becomes confirmed, whenever a share starts or stops holding a spot, when
-- a confirmed booking is moved, and when the booking is cancelled (the
-- match is voided). A booking going back to pending_payment needs nothing.
-- A failure never blocks the payment or cancellation: it is recorded and
-- retried (booking_match_syncs).
begin;

-- 1. The booker pays: confirmed, so the match exists, booker on side a.
--    Players join: they're in it. Held -> paid changes nothing.
do $$
declare
  v_booker uuid := tests.create_user('sync-confirm-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_match public.matches;
  v_late uuid := tests.create_user('sync-confirm-late@futty.test');
  v_updated timestamptz;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'sync-confirm');
  assert (tests.match_of(v_booking.id)).id is null, 'no match while the booking waits for payment';

  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_c0', interval '10 minutes');
  v_match := tests.match_of(v_booking.id);
  assert v_match.id is not null and v_match.status = 'scheduled'
         and v_match.kickoff_at = tests.kickoff_of(v_booking.id), format('a match once confirmed, got %s', row_to_json(v_match));
  assert (tests.in_match(v_booking.id, v_booker)).side = 'a', 'the booker is on side a';
  assert (tests.in_match(v_booking.id, (tests.player(v_booking.id, 1)).profile_id)).id is not null,
    'players who joined before confirmation are in it';

  perform tests.join_booking(v_booking.id, v_late);
  assert (tests.in_match(v_booking.id, v_late)).left_at is null and (tests.in_match(v_booking.id, v_late)).id is not null,
    'a player who joins later is added';

  select updated_at into v_updated from public.matches where id = v_match.id;
  perform public.share_captured((tests.player(v_booking.id, 0)).id, 680, tests.stripe_fee(680));
  assert (tests.player(v_booking.id, 0)).status = 'paid', 'taken';
  assert (select count(*) from public.matches where booking_id = v_booking.id) = 1, 'still one match';
  assert not exists (select 1 from public.booking_match_syncs), 'nothing failed';
end $$;

-- 2. Pay for everyone: the covered players are in the match.
do $$
declare
  v_booker uuid := tests.create_user('sync-payall-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_joiner uuid := tests.create_user('sync-payall-joiner@futty.test');
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 3, tests.cyprus_today() + 3, p_label => 'sync-payall');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_pa0', interval '10 minutes');
  assert (select count(*) from public.match_players mp join public.matches m on m.id = mp.match_id
          where m.booking_id = v_booking.id and mp.left_at is null) = 4, 'the booker and the 3 covered players';
  perform tests.join_booking(v_booking.id, v_joiner);
  assert (tests.in_match(v_booking.id, v_joiner)).id is not null, 'a covered player who joins later too';
end $$;

-- 3. A player cancels their own spot (free hour, middle window, late):
--    they leave the match each time.
do $$
declare
  v_booker uuid := tests.create_user('sync-cancel-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_free public.booking_payment_shares;
  v_middle public.booking_payment_shares;
  v_late public.booking_payment_shares;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'sync-cancel');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_x0', interval '2 hours');
  v_free := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_sync_x1', interval '10 minutes');
  v_middle := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_sync_x2', interval '2 hours');

  perform tests.cancel(v_booking.id, 'my_spot', v_free.profile_id);
  assert (tests.in_match(v_booking.id, v_free.profile_id)).left_at is not null, 'free hour: left the match';
  perform tests.cancel(v_booking.id, 'my_spot', v_middle.profile_id);
  assert (tests.player(v_booking.id, 2)).status = 'credited', 'middle window: credit';
  assert (tests.in_match(v_booking.id, v_middle.profile_id)).left_at is not null, 'middle window: left the match';

  v_late := tests.pay_ago((tests.player(v_booking.id, 3)).id, 'pi_sync_x3', interval '2 hours');
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours');
  perform tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  assert (tests.player(v_booking.id, 3)).status = 'forfeited', 'late: forfeited';
  assert (tests.in_match(v_booking.id, v_late.profile_id)).left_at is not null, 'late: left the match';
  assert (tests.in_match(v_booking.id, v_booker)).left_at is null, 'the booker is still in it';
  assert (tests.match_of(v_booking.id)).status = 'scheduled', 'the match goes on';
end $$;

-- 4. The booker cancels the whole team, or the venue cancels: the match is void.
do $$
declare
  v_owner uuid := tests.create_user('sync-void-owner@futty.test');
  v_booker uuid := tests.create_user('sync-void-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_team public.venue_bookings;
  v_venue_cancel public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_team := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                       '12:00', '13:00', 'sync-void-team');
  perform tests.pay_ago((tests.player(v_team.id, 0)).id, 'pi_sync_v0', interval '2 hours');
  v_venue_cancel := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 1, tests.cyprus_today() + 3,
                                               '14:00', '15:00', 'sync-void-venue');
  perform tests.pay_ago((tests.player(v_venue_cancel.id, 0)).id, 'pi_sync_v1', interval '2 hours');

  perform tests.cancel(v_team.id, 'whole_team', v_booker);
  assert (tests.match_of(v_team.id)).status = 'void', 'whole team cancelled: void';
  perform tests.cancel(v_venue_cancel.id, 'venue', v_owner);
  assert (tests.match_of(v_venue_cancel.id)).status = 'void', 'venue cancelled: void';
  assert not exists (select 1 from public.booking_match_syncs), 'nothing failed';
end $$;

-- 5. A booking that was never paid expires: no match, and nothing fails.
do $$
declare
  v_booker uuid := tests.create_user('sync-expire-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'sync-expire');
  update public.venue_bookings set created_at = now() - interval '20 minutes' where id = v_booking.id;
  assert public.expire_unpaid_booking(v_booking.id), 'expired';
  assert (tests.match_of(v_booking.id)).id is null, 'no match';
  assert not exists (select 1 from public.booking_match_syncs where booking_id = v_booking.id), 'nothing to retry';
end $$;

-- 6. Back to pending_payment (the booker's payment undone): the match is
--    left as it is, and confirming again re-syncs it.
do $$
declare
  v_booker uuid := tests.create_user('sync-undo-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_match public.matches;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'sync-undo');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_u0', interval '10 minutes');
  v_match := tests.match_of(v_booking.id);
  update public.venue_bookings set status = 'pending_payment', payment_window_started_at = now() where id = v_booking.id;
  assert tests.match_of(v_booking.id) = v_match, 'the match is untouched';
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  assert (tests.match_of(v_booking.id)).id = v_match.id and (tests.match_of(v_booking.id)).status = 'scheduled',
    'confirmed again: the same match';
end $$;

-- 7. The venue moves a confirmed booking: kickoff and end follow it.
do $$
declare
  v_booker uuid := tests.create_user('sync-move-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_match public.matches;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'sync-move');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_m0', interval '10 minutes');
  update public.venue_bookings set start_time = '18:00', end_time = '19:00' where id = v_booking.id;
  v_match := tests.match_of(v_booking.id);
  assert v_match.kickoff_at = tests.kickoff_of(v_booking.id)
         and v_match.ends_at = public.booking_kickoff_at(tests.cyprus_today() + 3, '19:00'),
    format('the match follows the move, got %s', row_to_json(v_match));
  assert v_match.result_deadline_at = v_match.ends_at + interval '24 hours', 'and its result deadline';
end $$;

-- 8. After kickoff the roster is fixed: a cancellation after kickoff isn't possible,
--    but a share leaving (e.g. a refund) doesn't change the match.
do $$
declare
  v_booker uuid := tests.create_user('sync-kickoff-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'sync-kickoff');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_k0', interval '2 hours');
  v_player := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_sync_k1', interval '2 hours');
  perform tests.set_kickoff(v_booking.id, now() - interval '10 minutes');
  update public.booking_payment_shares set status = 'refunded' where id = v_player.id;
  assert (tests.in_match(v_booking.id, v_player.profile_id)).left_at is null, 'after kickoff the roster stays';
end $$;

-- 9. Owner blocks and bookings made before P4a never get a match.
do $$
declare
  v_owner uuid := tests.create_user('sync-block-owner@futty.test');
  v_booker uuid := tests.create_user('sync-legacy-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_block uuid;
  v_legacy uuid;
begin
  perform tests.act_as(v_owner);
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status,
                                     created_by, amount_cents, booking_type)
  values (v_venue, tests.cyprus_today() + 3, '09:00', '10:00', 1, 0, 'Training', 'confirmed', v_owner, 0, 'owner_block')
  returning id into v_block;
  perform tests.act_as_postgres();
  assert (tests.match_of(v_block)).id is null, 'an owner block is not a game';

  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status,
                                     created_by, amount_cents, booking_type, payment_mode)
  values (v_venue, tests.cyprus_today() + 3, '20:00', '21:00', 1, 10, '5-a-side', 'confirmed', v_booker, 6000,
          'user_booking', null)
  returning id into v_legacy;
  assert (tests.match_of(v_legacy)).id is null, 'a booking from before P4a keeps the old match logic';
  assert not exists (select 1 from public.booking_match_syncs), 'and nothing is queued';
end $$;

rollback;

-- 10. A failure in the match code never blocks the payment or the
--     cancellation: it is recorded, the founders alerted at the third, and
--     the retry clears it once the match code works.
begin;
do $$
declare
  v_booker uuid := tests.create_user('sync-fail-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_sync public.booking_match_syncs;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'sync-fail');
  alter function public.create_match_for_booking(uuid) rename to create_match_for_booking_real;
  execute $f$ create function public.create_match_for_booking(p_booking_id uuid) returns uuid
              language plpgsql as $b$ begin raise exception 'match_code_broken'; end $b$ $f$;

  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_f0', interval '10 minutes');
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the booking is still confirmed';
  select * into v_sync from public.booking_match_syncs where booking_id = v_booking.id;
  assert v_sync.attempts = 1 and v_sync.last_error = 'match_code_broken' and v_sync.next_attempt_at > now(),
    format('recorded for a retry, got %s', row_to_json(v_sync));
  assert (select count(*) from public.booking_match_syncs_due()) = 0, 'not due until its back-off';

  update public.booking_match_syncs set next_attempt_at = now() where booking_id = v_booking.id;
  assert (select booking_id from public.booking_match_syncs_due()) = v_booking.id, 'due';
  assert not public.sync_booking_match(v_booking.id), 'fails again';
  assert not public.sync_booking_match(v_booking.id), 'and again';
  assert (select attempts from public.booking_match_syncs where booking_id = v_booking.id) = 3, '3 attempts';
  assert exists (select 1 from public.admin_alerts where kind = 'match_sync_failed' and booking_id = v_booking.id),
    'the founders are alerted at the third';

  drop function public.create_match_for_booking(uuid);
  alter function public.create_match_for_booking_real(uuid) rename to create_match_for_booking;
  assert public.sync_booking_match(v_booking.id), 'works once the match code does';
  assert (tests.match_of(v_booking.id)).id is not null, 'the match exists';
  assert not exists (select 1 from public.booking_match_syncs where booking_id = v_booking.id), 'nothing left to retry';
end $$;
rollback;

-- 11. The match code raising an error never blocks the booking: the
--     confirmation, a player joining and the cancellation all succeed, and
--     the retry is queued each time. One alert only, at the third failure.
begin;
do $$
declare
  v_booker uuid := tests.create_user('sync-raise-booker@futty.test');
  v_joiner uuid := tests.create_user('sync-raise-joiner@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_sync public.booking_match_syncs;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'sync-raise');
  alter function public.create_match_for_booking(uuid) rename to create_match_for_booking_real;
  execute $f$ create function public.create_match_for_booking(p_booking_id uuid) returns uuid
              language plpgsql as $b$ begin raise exception 'match_code_broken'; end $b$ $f$;

  -- The booker pays: the booking is confirmed regardless.
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_r0', interval '10 minutes');
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'confirmed';
  assert (tests.player(v_booking.id, 0)).status = 'authorized', 'the payment is held';
  assert (tests.match_of(v_booking.id)).id is null, 'no match yet';
  select * into v_sync from public.booking_match_syncs where booking_id = v_booking.id;
  assert v_sync.attempts = 1 and v_sync.last_error = 'match_code_broken', format('retry queued, got %s', row_to_json(v_sync));
  assert v_sync.next_attempt_at between now() + interval '59 seconds' and now() + interval '61 seconds', 'first retry in 1 minute';

  -- A player joins: they're in the booking, the retry is queued again.
  perform tests.join_booking(v_booking.id, v_joiner);
  assert exists (select 1 from public.booking_payment_shares where booking_id = v_booking.id and profile_id = v_joiner),
    'the join went through';
  select * into v_sync from public.booking_match_syncs where booking_id = v_booking.id;
  assert v_sync.attempts = 2 and v_sync.next_attempt_at between now() + interval '299 seconds' and now() + interval '301 seconds',
    format('second failure: 5 minutes, got %s', row_to_json(v_sync));
  assert not exists (select 1 from public.admin_alerts where kind = 'match_sync_failed' and booking_id = v_booking.id),
    'no alert before the third failure';

  -- The booker cancels the whole team: cancelled regardless.
  perform tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert (select status from public.venue_bookings where id = v_booking.id) = 'cancelled', 'cancelled';
  -- No match was ever made, so a cancelled booking has nothing to void.
  assert not exists (select 1 from public.booking_match_syncs where booking_id = v_booking.id), 'nothing left to retry';
  drop function public.create_match_for_booking(uuid);
  alter function public.create_match_for_booking_real(uuid) rename to create_match_for_booking;
end $$;
rollback;

-- 12. Back-off: 1, 5, 15, then every 60 minutes; one alert, at the third.
--     Retries stop once the booking's match is void.
begin;
do $$
declare
  v_booker uuid := tests.create_user('sync-backoff-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_sync public.booking_match_syncs;
  v_expected interval[] := array[interval '1 minute', interval '5 minutes', interval '15 minutes',
                                 interval '60 minutes', interval '60 minutes', interval '60 minutes'];
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'sync-backoff');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_b0', interval '10 minutes');
  assert (tests.match_of(v_booking.id)).id is not null, 'the match exists';

  alter function public.create_match_for_booking(uuid) rename to create_match_for_booking_real;
  execute $f$ create function public.create_match_for_booking(p_booking_id uuid) returns uuid
              language plpgsql as $b$ begin raise exception 'match_code_broken'; end $b$ $f$;
  for i in 1 .. 6 loop
    assert not public.sync_booking_match(v_booking.id), format('failure %s', i);
    select * into v_sync from public.booking_match_syncs where booking_id = v_booking.id;
    assert v_sync.attempts = i and v_sync.next_attempt_at = now() + v_expected[i],
      format('failure %s: next try after %s, got %s', i, v_expected[i], row_to_json(v_sync));
  end loop;
  assert (select count(*) from public.admin_alerts where kind = 'match_sync_failed' and booking_id = v_booking.id) = 1,
    'the founders are alerted once';
  drop function public.create_match_for_booking(uuid);
  alter function public.create_match_for_booking_real(uuid) rename to create_match_for_booking;

  -- The match is voided (the booking cancelled): the retry is dropped.
  perform tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert (tests.match_of(v_booking.id)).status = 'void', 'void';
  insert into public.booking_match_syncs (booking_id, attempts, next_attempt_at) values (v_booking.id, 7, now())
  on conflict (booking_id) do update set next_attempt_at = now();
  assert public.sync_booking_match(v_booking.id), 'nothing to do for a void match';
  assert not exists (select 1 from public.booking_match_syncs where booking_id = v_booking.id), 'retries stop';
end $$;
rollback;

-- 13. A friendly agreed for a booking re-syncs its match (so a pickup can
--     become a named game), found through squad_posts.venue_booking_id.
--     The payment-mode rule still applies. Here the match code only records
--     that it was called; match-record 1, 2 and 6 test what it then does.
begin;
create temp table sync_calls (booking_id uuid);
grant all on sync_calls to public;
do $$
declare
  v_booker uuid := tests.create_user('sync-friendly-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_home uuid;
  v_away uuid;
  v_confirmed public.venue_bookings;
  v_other public.venue_bookings;
  v_pending public.venue_bookings;
  v_legacy uuid;
  v_post uuid;
  v_other_post uuid;
  v_pending_post uuid;
  v_legacy_post uuid;
  v_open_post uuid;
  v_friendly uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  insert into public.teams (name) values ('Sync Home') returning id into v_home;
  insert into public.teams (name) values ('Sync Away') returning id into v_away;
  v_confirmed := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                            '12:00', '13:00', 'sync-friendly-a');
  v_other := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                        '14:00', '15:00', 'sync-friendly-b');
  v_pending := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          '16:00', '17:00', 'sync-friendly-c');
  perform tests.act_as_postgres();
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status,
                                     created_by, amount_cents, booking_type, payment_mode)
  values (v_venue, tests.cyprus_today() + 3, '20:00', '21:00', 1, 10, '5-a-side', 'confirmed', v_booker, 6000,
          'user_booking', null)
  returning id into v_legacy;

  alter function public.create_match_for_booking(uuid) rename to create_match_for_booking_real;
  execute $f$ create function public.create_match_for_booking(p_booking_id uuid) returns uuid
              language plpgsql as $b$ begin insert into pg_temp.sync_calls values (p_booking_id); return null; end $b$ $f$;
  update public.venue_bookings set status = 'confirmed' where id in (v_confirmed.id, v_other.id);
  delete from pg_temp.sync_calls;

  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id) values
    ('opposition', v_home, v_venue, v_confirmed.id, v_booker, v_away) returning id into v_post;
  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id) values
    ('opposition', v_home, v_venue, v_other.id, v_booker, v_away) returning id into v_other_post;
  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id) values
    ('opposition', v_home, v_venue, v_pending.id, v_booker, v_away) returning id into v_pending_post;
  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id) values
    ('opposition', v_home, v_venue, v_legacy, v_booker, v_away) returning id into v_legacy_post;
  insert into public.squad_posts (type, team_id, venue_id, posted_by, matched_team_id) values
    ('opposition', v_home, v_venue, v_booker, v_away) returning id into v_open_post;

  -- Agreed for a confirmed booking: its match is re-synced.
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id) values (v_post, v_home, v_away)
  returning id into v_friendly;
  assert (select array_agg(booking_id) from pg_temp.sync_calls) = array[v_confirmed.id],
    format('re-synced the booking, got %s', (select array_agg(booking_id) from pg_temp.sync_calls));

  -- Something else about the friendly changes: nothing to do.
  delete from pg_temp.sync_calls;
  update public.friendly_matches set status = 'confirmed', home_score = 2, away_score = 1 where id = v_friendly;
  assert not exists (select 1 from pg_temp.sync_calls), 'a score is not a reason to re-sync';

  -- Moved to another booking's post: both bookings are re-synced.
  update public.friendly_matches set squad_post_id = v_other_post where id = v_friendly;
  assert (select array_agg(booking_id order by booking_id) from pg_temp.sync_calls)
         = (select array_agg(x order by x) from unnest(array[v_confirmed.id, v_other.id]) x),
    format('both bookings, got %s', (select array_agg(booking_id) from pg_temp.sync_calls));

  -- Not a booking with a match to have: nothing is called.
  delete from pg_temp.sync_calls;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id) values
    (v_pending_post, v_home, v_away), (v_legacy_post, v_home, v_away), (v_open_post, v_home, v_away), (null, v_home, v_away);
  assert not exists (select 1 from pg_temp.sync_calls), 'waiting for payment, before P4a, no booking or no post: nothing';
  assert not exists (select 1 from public.booking_match_syncs), 'and nothing is queued';

  drop function public.create_match_for_booking(uuid);
  alter function public.create_match_for_booking_real(uuid) rename to create_match_for_booking;
end $$;
rollback;

-- 14. The match code failing never blocks agreeing the friendly: it is
--     created, and the retry is queued.
begin;
do $$
declare
  v_booker uuid := tests.create_user('sync-friendly-fail-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_home uuid;
  v_away uuid;
  v_booking public.venue_bookings;
  v_post uuid;
  v_sync public.booking_match_syncs;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  insert into public.teams (name) values ('Fail Home') returning id into v_home;
  insert into public.teams (name) values ('Fail Away') returning id into v_away;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'sync-friendly-fail');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sync_ff0', interval '10 minutes');
  perform tests.act_as_postgres();
  assert (tests.match_of(v_booking.id)).id is not null, 'the pickup match exists';
  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id)
  values ('opposition', v_home, v_venue, v_booking.id, v_booker, v_away) returning id into v_post;

  alter function public.create_match_for_booking(uuid) rename to create_match_for_booking_real;
  execute $f$ create function public.create_match_for_booking(p_booking_id uuid) returns uuid
              language plpgsql as $b$ begin raise exception 'match_code_broken'; end $b$ $f$;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id) values (v_post, v_home, v_away);
  assert exists (select 1 from public.friendly_matches where squad_post_id = v_post), 'the friendly is agreed';
  select * into v_sync from public.booking_match_syncs where booking_id = v_booking.id;
  assert v_sync.attempts = 1 and v_sync.last_error = 'match_code_broken', format('retry queued, got %s', row_to_json(v_sync));

  drop function public.create_match_for_booking(uuid);
  alter function public.create_match_for_booking_real(uuid) rename to create_match_for_booking;
end $$;
rollback;

-- 15. Who may call what.
begin;
do $$
begin
  assert has_function_privilege('service_role', 'public.sync_booking_match(uuid)', 'execute'), 'the job';
  assert has_function_privilege('service_role', 'public.booking_match_syncs_due()', 'execute'), 'the job';
  assert not has_function_privilege('authenticated', 'public.sync_booking_match(uuid)', 'execute'), 'not players';
  assert not has_function_privilege('authenticated', 'public.booking_match_syncs_due()', 'execute'), 'not players';
  assert not has_function_privilege('anon', 'public.sync_booking_match(uuid)', 'execute'), 'not anon';
  assert not has_table_privilege('authenticated', 'public.booking_match_syncs', 'select'), 'players can''t read it';
end $$;
rollback;
