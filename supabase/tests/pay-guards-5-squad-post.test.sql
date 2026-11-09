-- P2 rule 5: create_squad_post only links the caller's own booking, at the
-- same venue and format; the post takes the booking's time.
begin;

do $$
declare
  v_booker uuid := tests.create_user('squad-booker@futty.test');
  v_other uuid := tests.create_user('squad-other@futty.test');
  v_venue uuid := tests.create_venue();
  v_other_venue uuid := tests.create_venue();
  v_day date := tests.cyprus_today() + 2;
  v_kickoff timestamptz := (v_day + time '18:00') at time zone 'Asia/Nicosia';
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_error text;
begin
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5);

  -- Another user's booking can't be linked to a squad post.
  perform tests.act_as(v_other);
  v_error := tests.error_of(format(
    'select public.create_squad_post(%L::uuid, %L::timestamptz, ''5-a-side'', ''players'', p_players_needed => 3, p_venue_booking_id => %L::uuid)',
    v_venue, v_kickoff, v_booking.id));
  assert v_error = 'not_your_booking', format('linking someone else''s booking: got %s', coalesce(v_error, 'success'));

  -- Calls in the shape of the old 8-argument version are guarded too.
  v_error := tests.error_of(format(
    'select public.create_squad_post(%L::uuid, %L::timestamptz, ''5-a-side'', ''players'', null, null, 3, %L::uuid)',
    v_venue, v_kickoff, v_booking.id));
  assert v_error = 'not_your_booking', format('8-argument version: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_booker);
  v_error := tests.error_of(format(
    'select public.create_squad_post(%L::uuid, %L::timestamptz, ''5-a-side'', ''players'', p_players_needed => 3, p_venue_booking_id => %L::uuid)',
    v_other_venue, v_kickoff, v_booking.id));
  assert v_error = 'booking_mismatch', format('different venue: got %s', coalesce(v_error, 'success'));

  v_error := tests.error_of(format(
    'select public.create_squad_post(%L::uuid, %L::timestamptz, ''7-a-side'', ''players'', p_players_needed => 3, p_venue_booking_id => %L::uuid)',
    v_venue, v_kickoff, v_booking.id));
  assert v_error = 'booking_mismatch', format('different format: got %s', coalesce(v_error, 'success'));

  -- The booker's own post is accepted, and its time comes from the booking
  -- even when the app sent a different one (a phone not on Cyprus time).
  v_post := public.create_squad_post(
    v_venue, v_kickoff + interval '2 hours', '5-a-side', 'players',
    p_players_needed => 3, p_venue_booking_id => v_booking.id);
  assert v_post.scheduled_at = v_kickoff,
    format('post time should be the booking''s %s, got %s', v_kickoff, v_post.scheduled_at);

  -- The broken 4-argument version (it wrote to columns that don't exist) is gone.
  assert not exists (
    select 1 from pg_proc where proname = 'create_squad_post' and pronargs = 4
  ), 'the 4-argument create_squad_post should be dropped';
end $$;

select 'pay-guards rule 5 (squad post links) passed' as result;

rollback;
