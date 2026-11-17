-- Lock order for the booker's answer and remove (Panos's review of #104).
--
-- answer_venue_player and remove_venue_player took the venue_bookings row lock
-- (select ... for update) before checking that the caller is the booker, so a
-- stranger with an offer id could hold the lock that every app join takes,
-- even though he then got offer_not_found. Now they check the booker with a
-- plain select first and lock only for the booker. created_by never changes,
-- so the plain read is enough for that check; everything after the lock is as
-- before.
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

