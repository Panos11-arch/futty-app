-- Lock order for venue-offered players (Panos's review of #104).
--
-- answer_venue_player and remove_venue_player took the venue_bookings row lock
-- (select ... for update) before checking that the caller is the booker, so a
-- stranger with an offer id could hold the lock that every app join takes,
-- even though he then got offer_not_found. offer_venue_player and
-- withdraw_venue_player did the same before checking that the caller is venue
-- staff. Now each checks the caller with a plain select first (created_by for
-- the booker, venue_id for staff) and locks only for the right caller. Neither
-- column changes once a booking exists, so the plain read is enough for the
-- check; everything after the lock is as before, with the same errors.
--
-- Re-created from their latest definitions in
-- 20261117153008_pay_venue_player.sql; the only change in each is the order,
-- marked "Lock order". create or replace keeps their grants (authenticated and
-- service_role; not public or anon), so none are repeated here.

-- The booker accepts (p_accept) or declines an open offer.
create or replace function public.answer_venue_player(p_offer_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.booking_venue_players;
  v_booking public.venue_bookings;
  v_match public.matches;
  v_match_player uuid;
  v_staff uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_offer from public.booking_venue_players where id = p_offer_id;
  if v_offer.id is null then
    raise exception 'offer_not_found';
  end if;
  -- Lock order: check the booker with a plain select first, so a stranger
  -- never takes the booking lock.
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id;
  if v_booking.created_by is distinct from v_uid then
    raise exception 'offer_not_found';
  end if;
  -- The same lock every app join takes (add_booking_share_internal), before
  -- counting spots.
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id for update;
  select * into v_offer from public.booking_venue_players where id = p_offer_id for update;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'offer_not_open';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'offer_closed';
  end if;

  if p_accept then
    if public.booking_spots_taken(v_booking.id) >= public.booking_total_shares_needed(v_booking.id) then
      raise exception 'no_empty_spot';
    end if;
    -- A guest in the match: on the booker's side in a named game; in a
    -- pickup game, like every player but the booker, with no side yet. A
    -- booking with no match keeps him here only.
    select * into v_match from public.matches where booking_id = v_booking.id and status <> 'void';
    if v_match.id is not null then
      insert into public.match_players (match_id, guest_name, side)
      values (v_match.id, v_offer.name, case when v_match.kind = 'named' then 'a' end)
      returning id into v_match_player;
    end if;
    update public.booking_venue_players
    set status = 'accepted', answered_at = now(), match_player_id = v_match_player
    where id = p_offer_id
    returning * into v_offer;
  else
    update public.booking_venue_players set status = 'declined', answered_at = now()
    where id = p_offer_id
    returning * into v_offer;
  end if;

  for v_staff in select public.venue_staff_profiles(v_booking.venue_id) loop
    perform public.venue_staff_notify_once(v_booking.venue_id, v_staff,
      case when p_accept then 'venue_player_accepted' else 'venue_player_declined' end, p_offer_id::text,
      jsonb_build_object(
        'title', case when p_accept then 'Player accepted' else 'Player declined' end,
        'body', case when p_accept
                     then format('%s accepted %s for %s. %s plays free; the team''s amounts don''t change.',
                                 public.profile_display_name(v_uid), v_offer.name, public.venue_player_when(v_booking),
                                 v_offer.name)
                     else format('%s declined %s for %s.',
                                 public.profile_display_name(v_uid), v_offer.name, public.venue_player_when(v_booking))
                end,
        'bookingId', v_booking.id,
        'offerId', p_offer_id,
        'name', v_offer.name));
  end loop;

  return jsonb_build_object('id', v_offer.id, 'name', v_offer.name, 'state', v_offer.status);
end;
$$;


-- The booker removes an accepted venue player, until kickoff.
create or replace function public.remove_venue_player(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.booking_venue_players;
  v_booking public.venue_bookings;
  v_staff uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_offer from public.booking_venue_players where id = p_offer_id;
  if v_offer.id is null then
    raise exception 'offer_not_found';
  end if;
  -- Lock order: check the booker with a plain select first, so a stranger
  -- never takes the booking lock.
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id;
  if v_booking.created_by is distinct from v_uid then
    raise exception 'offer_not_found';
  end if;
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id for update;
  select * into v_offer from public.booking_venue_players where id = p_offer_id for update;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'offer_not_open';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'booking_started';
  end if;

  update public.match_players set left_at = now() where id = v_offer.match_player_id and left_at is null;
  update public.booking_venue_players set status = 'removed', ended_at = now()
  where id = p_offer_id
  returning * into v_offer;

  for v_staff in select public.venue_staff_profiles(v_booking.venue_id) loop
    perform public.venue_staff_notify_once(v_booking.venue_id, v_staff, 'venue_player_removed', p_offer_id::text,
      jsonb_build_object(
        'title', 'Venue player removed',
        'body', format('%s removed %s from %s.',
                       public.profile_display_name(v_uid), v_offer.name, public.venue_player_when(v_booking)),
        'bookingId', v_booking.id,
        'offerId', p_offer_id,
        'name', v_offer.name));
  end loop;

  return jsonb_build_object('id', v_offer.id, 'name', v_offer.name, 'state', v_offer.status);
end;
$$;


-- Staff offer a player called p_name. Returns { id, name, state }.
create or replace function public.offer_venue_player(p_booking_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_name text := btrim(coalesce(p_name, ''));
  v_offer public.booking_venue_players;
  v_open integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  -- Lock order: check staff with a plain select first, so a non-staff caller
  -- never takes the booking lock.
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_booking.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.booking_type <> 'user_booking' then
    raise exception 'not_an_app_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  if v_booking.payment_mode is null or v_booking.payment_mode not in ('each_pays_responsible', 'each_pays_own_spot') then
    raise exception 'not_each_pays';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'booking_started';
  end if;
  if v_name = '' then
    raise exception 'name_required';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'name_too_long';
  end if;
  select count(*) into v_open from public.booking_venue_players
  where booking_id = p_booking_id and status = 'offered';
  if public.booking_spots_taken(p_booking_id) + v_open >= public.booking_total_shares_needed(p_booking_id) then
    raise exception 'no_empty_spot';
  end if;

  insert into public.booking_venue_players (booking_id, venue_id, name, offered_by)
  values (p_booking_id, v_booking.venue_id, v_name, v_uid)
  returning * into v_offer;

  perform public.send_notification(v_booking.created_by, 'venue_player_offered', jsonb_build_object(
    'title', coalesce((select v.name from public.venues v where v.id = v_booking.venue_id), 'The venue')
             || ' offered a player',
    'body', format('%s for %s. %s plays free; the team''s amounts don''t change.',
                   v_name, public.venue_player_when(v_booking), v_name),
    'bookingId', p_booking_id,
    'offerId', v_offer.id,
    'name', v_name,
    'venueId', v_booking.venue_id,
    'actions', jsonb_build_array('accept', 'decline')));

  return jsonb_build_object('id', v_offer.id, 'name', v_offer.name, 'state', v_offer.status);
end;
$$;

-- Staff withdraw an offered or accepted player, until kickoff.
create or replace function public.withdraw_venue_player(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.booking_venue_players;
  v_booking public.venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_offer from public.booking_venue_players where id = p_offer_id;
  if v_offer.id is null then
    raise exception 'offer_not_found';
  end if;
  -- Lock order: check staff with a plain select first, so a non-staff caller
  -- never takes the booking lock.
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id;
  if not public.is_venue_staff(v_booking.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id for update;
  select * into v_offer from public.booking_venue_players where id = p_offer_id for update;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  if v_offer.status not in ('offered', 'accepted') then
    raise exception 'offer_not_open';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception '%', case when v_offer.status = 'offered' then 'offer_closed' else 'booking_started' end;
  end if;

  update public.match_players set left_at = now() where id = v_offer.match_player_id and left_at is null;
  update public.booking_venue_players set status = 'withdrawn', ended_at = now()
  where id = p_offer_id
  returning * into v_offer;

  perform public.send_notification(v_booking.created_by, 'venue_player_withdrawn', jsonb_build_object(
    'title', 'Venue player withdrawn',
    'body', format('%s withdrew %s from %s.',
                   coalesce((select v.name from public.venues v where v.id = v_booking.venue_id), 'The venue'),
                   v_offer.name, public.venue_player_when(v_booking)),
    'bookingId', v_booking.id,
    'offerId', p_offer_id,
    'name', v_offer.name,
    'venueId', v_booking.venue_id));

  return jsonb_build_object('id', v_offer.id, 'name', v_offer.name, 'state', v_offer.status);
end;
$$;
