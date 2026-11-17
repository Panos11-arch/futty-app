-- P6e no-shows (docs/specs/13-payments-bookings.md "No-shows", decided 17
-- November, Anghelo and Dimitris; for Panos to confirm; match-record.md
-- section 4.4, question 9).
--
-- A no-show is a player who held a spot in the booking (their share is
-- pending, authorized, paid or covered and match_players.left_at is null)
-- with no match_attendance row. A side b squad member without a spot, a guest
-- (a venue-offered player is one) and a void match never count.
--   not_yet     until 1 hour after the end (QR check-in still open)
--   missing     from then until result_deadline_at ("Didn't check in")
--   no_show     final at result_deadline_at, when captain_mark_attendance closes
--   checked_in  any match_attendance row (QR, captain or venue)
--
-- Staff can tick a spot holder who came but didn't scan (method 'venue'),
-- from 60 minutes before kickoff until result_deadline_at, and undo only
-- their own venue tick, unless the player has already voted for man of the
-- match (check_in_used). A venue tick counts like any check-in (decision
-- 1b.2); match_attendance_motm_vote_open already sends motm_vote_open for it
-- once per player per match. No forfeit is recorded here (question 10.1
-- stays open) and no money moves.

alter table public.match_attendance drop constraint match_attendance_method_check;
alter table public.match_attendance add constraint match_attendance_method_check
  check (method in ('qr', 'captain', 'venue'));

-- Holds a spot in the match's booking (not a guest, not a squad member
-- without a spot, not a player who left).
create or replace function public.match_spot_holder(p_match_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.match_players mp
    join public.booking_payment_shares s on s.id = mp.share_id
    where mp.match_id = p_match_id and mp.profile_id = p_profile_id and mp.left_at is null
      and s.status in ('pending', 'authorized', 'paid', 'covered'));
$$;

-- checked_in, not_yet, missing or no_show; null for anyone who isn't a spot
-- holder, and for a void match.
create or replace function public.match_attendance_state(p_match_id uuid, p_profile_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if v_match.id is null or v_match.status = 'void' or not public.match_spot_holder(p_match_id, p_profile_id) then
    return null;
  end if;
  if exists (select 1 from public.match_attendance a where a.match_id = p_match_id and a.profile_id = p_profile_id) then
    return 'checked_in';
  end if;
  if now() < v_match.ends_at + interval '1 hour' then
    return 'not_yet';
  end if;
  if now() < v_match.result_deadline_at then
    return 'missing';
  end if;
  return 'no_show';
end;
$$;

-- A player's final no-shows at one venue.
create or replace function public.venue_no_show_count(p_venue_id uuid, p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where mp.profile_id = p_profile_id and m.venue_id = p_venue_id
    and public.match_attendance_state(m.id, p_profile_id) = 'no_show';
$$;

-- Staff may change attendance now: not void, from 60 minutes before kickoff
-- until the result deadline (as captain_mark_attendance).
create or replace function public.venue_attendance_open(p_match public.matches)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_match.status <> 'void'
     and now() >= p_match.kickoff_at - interval '60 minutes'
     and now() < p_match.result_deadline_at;
$$;

-- The caller is staff of the match's venue, the player holds a spot, and the
-- window is open. Returns the match.
create or replace function public.venue_attendance_check(p_match_id uuid, p_profile_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match_not_found';
  end if;
  if not public.is_venue_staff(v_match.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if not public.match_spot_holder(p_match_id, p_profile_id) then
    raise exception 'not_in_match';
  end if;
  if not public.venue_attendance_open(v_match) then
    raise exception 'check_in_closed';
  end if;
  return v_match;
end;
$$;

-- Staff tick a spot holder who came. Idempotent: a QR or captain check-in is
-- kept as it is.
create or replace function public.venue_mark_arrived(p_match_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.venue_attendance_check(p_match_id, p_profile_id);
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  values (p_match_id, p_profile_id, 'venue', auth.uid())
  on conflict (match_id, profile_id) do nothing;
end;
$$;

-- Staff undo a venue tick (never a QR or captain check-in), unless the
-- player has used it: voted for man of the match. When A5 adds ratings, a
-- rating by the player must refuse this too.
create or replace function public.venue_unmark_arrived(p_match_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method text;
begin
  perform public.venue_attendance_check(p_match_id, p_profile_id);
  select a.method into v_method from public.match_attendance a
  where a.match_id = p_match_id and a.profile_id = p_profile_id for update;
  if v_method is null then
    raise exception 'not_checked_in';
  end if;
  if v_method <> 'venue' then
    raise exception 'not_venue_check_in';
  end if;
  if exists (select 1 from public.motm_votes v where v.match_id = p_match_id and v.voter_profile_id = p_profile_id) then
    raise exception 'check_in_used';
  end if;
  delete from public.match_attendance where match_id = p_match_id and profile_id = p_profile_id;
end;
$$;

-- venue_booking_roster, from 20261117153008_pay_venue_player.sql
create or replace function public.venue_booking_roster(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_match_id uuid;
  v_match public.matches;
  v_started boolean;
  v_ended boolean;
  v_base jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_booking.venue_id) then
    raise exception 'not_venue_staff';
  end if;

  v_base := jsonb_build_object(
    'booking_id', v_booking.id,
    'kind', case v_booking.booking_type when 'user_booking' then 'app' else v_booking.booking_type end,
    'status', v_booking.status,
    'booking_day', v_booking.booking_day,
    'start_time', v_booking.start_time,
    'end_time', v_booking.end_time,
    'format', v_booking.format,
    'capacity', v_booking.capacity,
    'note', v_booking.note);

  if v_booking.booking_type = 'counter' then
    return v_base || (
      select jsonb_build_object(
               'source', c.source,
               'contact', jsonb_build_object('id', ct.id, 'name', ct.name, 'phone', ct.phone),
               'venue_price_cents', c.venue_price_cents,
               'charged_cents', c.charged_cents,
               'paid_method', c.paid_method,
               'paid_at', c.paid_at,
               'cancelled_at', c.cancelled_at,
               'players', '[]'::jsonb)
      from public.venue_counter_bookings c
      join public.venue_contacts ct on ct.id = c.contact_id
      where c.booking_id = v_booking.id);
  end if;

  if v_booking.booking_type <> 'user_booking' then
    return v_base || jsonb_build_object('players', '[]'::jsonb);
  end if;

  select id into v_match_id from public.matches where booking_id = v_booking.id;
  -- P6e no-shows: the match, for each player's attendance below.
  select * into v_match from public.matches where id = v_match_id;
  v_started := exists (select 1 from public.booking_collections c where c.booking_id = v_booking.id);
  v_ended := v_booking.booking_day + v_booking.end_time <= (now() at time zone 'Asia/Nicosia');

  return v_base || jsonb_build_object(
    'payment_mode', v_booking.payment_mode,
    'booker_name', public.profile_display_name(v_booking.created_by),
    'match_id', v_match_id,
    'collection_started', v_started,
    'can_run_collection', v_booking.status = 'confirmed' and not v_started and v_ended
                          and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot'),
    -- P6e: the players the venue offered, and whether staff can offer one now
    -- (offer_venue_player's own checks).
    'venue_players', public.booking_venue_players_json(v_booking.id, auth.uid(), true),
    'can_offer_player', v_booking.status = 'confirmed'
                        and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
                        and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)
                        and public.booking_spots_taken(v_booking.id)
                            + (select count(*) from public.booking_venue_players vp
                               where vp.booking_id = v_booking.id and vp.status = 'offered')
                            < public.booking_total_shares_needed(v_booking.id),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'profile_id', s.profile_id,
               'name', public.profile_display_name(s.profile_id),
               'is_booker', s.is_booker,
               'payment_method', s.payment_method,
               'state', case
                          when s.status = 'covered' then 'covered'
                          when s.status = 'pending' then 'unpaid'
                          when s.payment_method = 'cash' and s.cash_received_at is not null then 'cash_paid'
                          when s.payment_method = 'cash' then 'cash'
                          else 'in_app' end,
               'amount_cents', s.amount_cents,
               'pitch_cents', s.pitch_cents,
               'fee_cents', s.fee_cents,
               'cash_cents', s.cash_cents,
               'checked_in', a.profile_id is not null,
               -- P6e no-shows: attendance (checked_in, not_yet, missing,
               -- no_show; null with no match yet), how they checked in, what
               -- staff can do now, and their final no-shows at this venue.
               'attendance', public.match_attendance_state(v_match_id, s.profile_id),
               'check_in_method', a.method,
               'can_mark_arrived', v_match.id is not null and a.profile_id is null
                                   and public.match_spot_holder(v_match_id, s.profile_id)
                                   and public.venue_attendance_open(v_match),
               'can_unmark_arrived', v_match.id is not null and a.method is not distinct from 'venue'
                                     and public.venue_attendance_open(v_match)
                                     and not exists (select 1 from public.motm_votes mv
                                                     where mv.match_id = v_match_id and mv.voter_profile_id = s.profile_id),
               'no_show_count', public.venue_no_show_count(v_booking.venue_id, s.profile_id))
             order by s.is_booker desc, s.created_at, s.id)
      from public.booking_payment_shares s
      -- P6e no-shows: the player's check-in, if any (was an exists in checked_in).
      left join public.match_attendance a on a.match_id = v_match_id and a.profile_id = s.profile_id
      -- Still in, as cancellation_plan counts them: not a player who left
      -- with credit, by forfeit or for a refund.
      where s.booking_id = v_booking.id and s.status in ('pending', 'authorized', 'paid', 'covered')), '[]'::jsonb));
end;
$$;

-- venue_customer, from 20261117004318_pay_dashboard_customer_states.sql
create or replace function public.venue_customer(p_venue_id uuid, p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.venue_contacts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_kind is null or p_kind not in ('player', 'contact') then
    raise exception 'invalid_kind';
  end if;

  if p_kind = 'contact' then
    select * into v_contact from public.venue_contacts where id = p_id and venue_id = p_venue_id;
    if v_contact.id is null then
      raise exception 'customer_not_found';
    end if;
    return jsonb_build_object(
      'kind', 'contact',
      'contact_id', v_contact.id,
      'name', v_contact.name,
      'phone', v_contact.phone,
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'booking_id', b.id,
                 'source', c.source,
                 'booking_status', b.status,
                 'booking_day', b.booking_day,
                 'start_time', b.start_time,
                 'end_time', b.end_time,
                 'format', b.format,
                 'venue_price_cents', c.venue_price_cents,
                 'charged_cents', c.charged_cents,
                 'paid_method', c.paid_method)
               order by b.booking_day desc, b.start_time desc, b.id)
        from public.venue_counter_bookings c
        join public.venue_bookings b on b.id = c.booking_id
        where c.contact_id = v_contact.id), '[]'::jsonb));
  end if;

  if p_id is null or not public.venue_has_customer(p_venue_id, p_id) then
    raise exception 'customer_not_found';
  end if;
  return jsonb_build_object(
    'kind', 'player',
    'profile_id', p_id,
    'name', public.profile_display_name(p_id),
    'debt_cents', (select coalesce(sum(d.amount_cents), 0) from public.venue_debts d
                   where d.profile_id = p_id and d.owed_to = 'venue' and d.venue_id = p_venue_id and d.settled_at is null),
    'credit_cents', (select coalesce(sum(c.remaining_cents), 0) from public.venue_credits c
                     where c.profile_id = p_id and c.venue_id = p_venue_id
                       and c.expires_at > now() and c.remaining_cents > 0),
    -- P6e no-shows: their final no-shows at this venue.
    'no_show_count', public.venue_no_show_count(p_venue_id, p_id),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booking_id', b.id,
               'booking_status', b.status,
               'booking_day', b.booking_day,
               'start_time', b.start_time,
               'end_time', b.end_time,
               'format', b.format,
               'is_booker', coalesce(s.is_booker, b.created_by = p_id),
               'share_status', s.status,
               'payment_method', s.payment_method,
               'amount_cents', s.amount_cents,
               'cash_cents', s.cash_cents,
               'cash_received', case when s.payment_method = 'cash' then s.cash_received_at is not null end,
               -- P6e no-shows: a final no-show in this booking's match.
               'no_show', coalesce(public.match_attendance_state(m.id, p_id) = 'no_show', false))
             order by b.booking_day desc, b.start_time desc, b.id)
      from public.venue_bookings b
      -- Their share in it, or none: a game they booked with no share (free).
      left join public.booking_payment_shares s on s.booking_id = b.id and s.profile_id = p_id
      -- P6e no-shows: the booking's match, if it has one.
      left join public.matches m on m.booking_id = b.id
      where b.venue_id = p_venue_id and b.booking_type = 'user_booking'
        and (s.id is not null or b.created_by = p_id)), '[]'::jsonb),
    'debts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'debt_id', d.id,
               'booking_id', d.booking_id,
               'amount_cents', d.amount_cents,
               'reason', d.reason,
               'created_at', d.created_at,
               'settled_at', d.settled_at,
               'settled_by', d.settled_by)
             order by d.created_at desc, d.id)
      from public.venue_debts d
      where d.profile_id = p_id and d.owed_to = 'venue' and d.venue_id = p_venue_id), '[]'::jsonb),
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'credit_id', c.id,
               'amount_cents', c.amount_cents,
               'remaining_cents', c.remaining_cents,
               'issued_at', c.issued_at,
               'expires_at', c.expires_at,
               'available', c.expires_at > now() and c.remaining_cents > 0,
               'expired', c.expires_at <= now())
             order by c.expires_at desc, c.id)
      from public.venue_credits c
      where c.profile_id = p_id and c.venue_id = p_venue_id), '[]'::jsonb));
end;
$$;

-- Internal: service_role only.
revoke all on function public.match_spot_holder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_spot_holder(uuid, uuid) to service_role;
revoke all on function public.match_attendance_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_attendance_state(uuid, uuid) to service_role;
revoke all on function public.venue_no_show_count(uuid, uuid) from public, anon, authenticated;
grant execute on function public.venue_no_show_count(uuid, uuid) to service_role;
revoke all on function public.venue_attendance_open(public.matches) from public, anon, authenticated;
grant execute on function public.venue_attendance_open(public.matches) to service_role;
revoke all on function public.venue_attendance_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.venue_attendance_check(uuid, uuid) to service_role;
-- What the app may call: they check the caller themselves.
revoke all on function public.venue_mark_arrived(uuid, uuid) from public, anon;
grant execute on function public.venue_mark_arrived(uuid, uuid) to authenticated, service_role;
revoke all on function public.venue_unmark_arrived(uuid, uuid) from public, anon;
grant execute on function public.venue_unmark_arrived(uuid, uuid) to authenticated, service_role;
-- Re-created functions keep their grants; restated as their migrations had them.
revoke all on function public.venue_booking_roster(uuid) from public, anon;
grant execute on function public.venue_booking_roster(uuid) to authenticated, service_role;
revoke all on function public.venue_customer(uuid, text, uuid) from public, anon;
grant execute on function public.venue_customer(uuid, text, uuid) to authenticated, service_role;
