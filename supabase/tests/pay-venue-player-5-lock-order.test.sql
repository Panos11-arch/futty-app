-- Venue-offered players: lock order (Panos's review of #104).
--   answer_venue_player and remove_venue_player check that the caller is the
--   booker with a plain select before they take the venue_bookings row lock,
--   so a stranger gets offer_not_found without ever locking the booking (and
--   can't hold up joins, which take the same lock).
--
-- How "not locked" is checked: a row lock taken inside a call that then fails
-- is released when that call's sub-transaction rolls back, so pg_locks shows
-- nothing afterwards, and a second session can't see this test's uncommitted
-- rows. But SELECT ... FOR UPDATE stamps the locker into the row's xmax, and
-- the stamp stays after the rollback. So: note the booking row's xmax, let the
-- stranger call, and check xmax hasn't changed; then take a nowait lock from a
-- second statement to show the row is free.
--   The booking and offers are inserted directly with triggers off
-- (session_replication_role = replica), not through book_slot,
-- add_booking_share_internal or offer_venue_player: those, and the booking
-- insert's own triggers, lock the booking FOR UPDATE in this transaction, and
-- Postgres doesn't stamp again a lock the transaction already holds, so the
-- check would pass either way. Inserted this way the booking row starts with
-- no lock at all (xmax = 0). Triggers are back on before the stranger calls.
--   The booker's own answer and remove are in pay-venue-player-2-answer.
begin;

-- p_sql, run by p_stranger, fails with offer_not_found and leaves the booking
-- row unlocked.
create or replace function tests.vplo_stranger_never_locks(p_stranger uuid, p_booking uuid, p_sql text, p_what text)
returns void
language plpgsql
as $$
declare
  v_xmax text := (select xmax::text from public.venue_bookings where id = p_booking);
  v_error text;
begin
  v_error := tests.error_as(p_stranger, p_sql);
  assert v_error = 'offer_not_found', format('%s: a stranger gets offer_not_found, got %s', p_what, v_error);
  assert (select xmax::text from public.venue_bookings where id = p_booking) = v_xmax,
    format('%s: the stranger never took the booking row lock', p_what);
  -- A second statement can take the lock straight away.
  assert tests.error_of(format('select 1 from public.venue_bookings where id = %L for update nowait', p_booking)) is null,
    format('%s: the booking row is free', p_what);
end;
$$;

do $$
declare
  v_owner uuid := tests.create_user('vplo-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booker uuid := tests.create_user('vplo-booker@futty.test');
  v_stranger uuid := tests.create_user('vplo-stranger@futty.test');
  v_booking uuid;
  v_offered uuid;
  v_accepted uuid;
begin
  set local session_replication_role = replica;
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status,
                                     created_by, booking_type, payment_mode)
  values (v_venue, tests.cyprus_today() + 3, '19:00', '20:00', 1, 10, '5-a-side', 'confirmed',
          v_booker, 'user_booking', 'each_pays_own_spot')
  returning id into v_booking;
  insert into public.booking_venue_players (booking_id, venue_id, name, offered_by)
  values (v_booking, v_venue, 'Andreas', v_owner)
  returning id into v_offered;
  insert into public.booking_venue_players (booking_id, venue_id, name, offered_by, status, answered_at)
  values (v_booking, v_venue, 'Marios', v_owner, 'accepted', now())
  returning id into v_accepted;
  set local session_replication_role = origin;
  assert (select xmax::text from public.venue_bookings where id = v_booking) = '0', 'the booking row starts unlocked';

  perform tests.vplo_stranger_never_locks(v_stranger, v_booking,
    format('select public.answer_venue_player(%L, true)', v_offered), 'answer (accept)');
  perform tests.vplo_stranger_never_locks(v_stranger, v_booking,
    format('select public.answer_venue_player(%L, false)', v_offered), 'answer (decline)');
  perform tests.vplo_stranger_never_locks(v_stranger, v_booking,
    format('select public.remove_venue_player(%L)', v_accepted), 'remove');

  assert (select status from public.booking_venue_players where id = v_offered) = 'offered', 'the offer is untouched';
  assert (select status from public.booking_venue_players where id = v_accepted) = 'accepted', 'the player stays';
end $$;

rollback;
