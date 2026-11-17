-- P6e: venue staff offer a player to a short team (docs/specs/05-product.md
-- section 12 item 11a; docs/specs/13-payments-bookings.md "Booking modes" and
-- "Venue-offered players", decided 17 November, Dimitris; for Panos to confirm).
--
-- Spec 13 already says: the booker accepts a player the venue offers from its
-- dashboard; "a player the venue provides plays free. The team covers his spot
-- like an empty one"; in a short game "a venue-provided player counts as an
-- empty spot". So:
--   - staff type a name (no Futty account) and offer him to a confirmed app
--     booking in an each-pays mode with an empty spot, until kickoff;
--   - only the booker accepts or declines, until kickoff; an unanswered offer
--     lapses at kickoff (worked out when read: no job);
--   - an accepted venue player takes a spot: app joins stop at capacity minus
--     accepted venue players. He's a guest in the booking's match
--     (match_players.guest_name); a booking with no match keeps him here only;
--   - staff can withdraw an offered or accepted player, the booker can remove
--     an accepted one, both until kickoff;
--   - he has no share and moves no money: the team's top-up covers his spot
--     and the venue never charges him. collection_amounts, start_collection,
--     send_short_game_warnings and every other money function are untouched.
--
-- Accepting and every app join lock the venue_bookings row (select ... for
-- update) before counting spots, so only one of them gets the last spot.
--
-- Re-created from their latest definitions (each change marked "P6e"):
--   add_booking_share_internal (20261116124400_pay_switching) an accepted
--                              venue player takes a spot
--   venue_booking_roster       (20261113220603_pay_dashboard_reads) adds
--                              venue_players and can_offer_player
--   booking_detail             (20261117090200_pay_booking_detail_cash) adds
--                              venue_players

insert into public.notification_types (type, always_sent) values
  ('venue_player_offered', false),
  ('venue_player_withdrawn', false),
  ('venue_player_accepted', false),
  ('venue_player_declined', false),
  ('venue_player_removed', false)
on conflict (type) do nothing;

create table public.booking_venue_players (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.venue_bookings (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40),
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'declined', 'withdrawn', 'removed')),
  offered_by uuid not null,
  offered_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  match_player_id uuid references public.match_players (id) on delete set null,
  check (status not in ('accepted', 'declined', 'removed') or answered_at is not null),
  check (status not in ('withdrawn', 'removed') or ended_at is not null)
);
create index booking_venue_players_booking_idx on public.booking_venue_players (booking_id);

alter table public.booking_venue_players enable row level security;
revoke all on public.booking_venue_players from public, anon, authenticated;
grant all on public.booking_venue_players to service_role;

-- Spots taken in a booking: shares that hold a spot, counted exactly as
-- add_booking_share_internal counts them, plus accepted venue players.
create or replace function public.booking_spots_taken(p_booking_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select ((select count(*) from public.booking_payment_shares s
           where s.booking_id = p_booking_id
             and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'))
        + (select count(*) from public.booking_venue_players vp
           where vp.booking_id = p_booking_id and vp.status = 'accepted'))::integer;
$$;

-- The venue players a reader sees. Staff see every offer; the booker sees
-- open and accepted ones, with what they can do; another player in the
-- booking sees accepted names only. An offer still open at kickoff (or on a
-- cancelled booking) reads as lapsed.
create or replace function public.booking_venue_players_json(p_booking_id uuid, p_viewer uuid, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select vb.created_by,
           vb.status = 'confirmed' and now() < public.booking_kickoff_at(vb.booking_day, vb.start_time) as active
    from public.venue_bookings vb where vb.id = p_booking_id
  ), p as (
    select vp.*, case when vp.status = 'offered' and not b.active then 'lapsed' else vp.status end as state, b.active,
           b.created_by
    from public.booking_venue_players vp cross join b
    where vp.booking_id = p_booking_id
  )
  select coalesce(jsonb_agg(
           case
             when p_staff then jsonb_build_object(
               'id', p.id, 'name', p.name, 'state', p.state, 'offered_at', p.offered_at,
               'answered_at', p.answered_at,
               'can_withdraw', p.active and p.state in ('offered', 'accepted'))
             when p.created_by = p_viewer then jsonb_build_object(
               'id', p.id, 'name', p.name, 'state', p.state,
               'can_answer', p.active and p.state = 'offered',
               'can_remove', p.active and p.state = 'accepted')
             else jsonb_build_object('name', p.name, 'state', p.state)
           end order by p.offered_at, p.id), '[]'::jsonb)
  from p
  where p_staff
     or (p.created_by = p_viewer and p.state in ('offered', 'accepted'))
     or p.state = 'accepted';
$$;

-- "Thursday 19 November at 19:00", as the venue notices say it (Cyprus).
create or replace function public.venue_player_when(p_booking public.venue_bookings)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format('%s at %s', public.venue_notice_day(p_booking.booking_day), to_char(p_booking.start_time, 'HH24:MI'));
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
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_booking.venue_id) then
    raise exception 'not_venue_staff';
  end if;
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
  -- The same lock every app join takes (add_booking_share_internal), before
  -- counting spots.
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id for update;
  if v_booking.created_by is distinct from v_uid then
    raise exception 'offer_not_found';
  end if;
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
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id for update;
  if not public.is_venue_staff(v_booking.venue_id) then
    raise exception 'not_venue_staff';
  end if;
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
  select * into v_booking from public.venue_bookings where id = v_offer.booking_id for update;
  if v_booking.created_by is distinct from v_uid then
    raise exception 'offer_not_found';
  end if;
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

-- add_booking_share_internal, from 20261116124400_pay_switching.sql
create or replace function public.add_booking_share_internal(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
  v_current_count integer;
  v_share record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;  -- P12: one at a time with a switch
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  v_total_needed := public.booking_total_shares_needed(p_booking_id);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due');
  -- P6e: an accepted venue player takes a spot, with no share. Counted under
  -- the lock above, as answer_venue_player counts it.
  v_current_count := v_current_count + (select count(*) from public.booking_venue_players vp
                                        where vp.booking_id = p_booking_id and vp.status = 'accepted');

  if v_current_count >= v_total_needed then
    return;
  end if;

  if v_booking.payment_mode is not null then
    select * into v_share from public.money_share(
      v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, false,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status)
    values
      (p_booking_id, p_profile_id, v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, false,
       case when v_booking.payment_mode in ('pay_all', 'gipedo_pano') then 'covered' else 'pending' end)
    on conflict (booking_id, profile_id) do nothing;
    return;
  end if;

  v_share_cents := v_booking.amount_cents / v_total_needed
                   + coalesce(v_booking.service_fee_cents_per_player, 0);

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$$;

-- venue_booking_roster, from 20261113220603_pay_dashboard_reads.sql
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
               'checked_in', v_match_id is not null and exists (
                 select 1 from public.match_attendance a where a.match_id = v_match_id and a.profile_id = s.profile_id))
             order by s.is_booker desc, s.created_at, s.id)
      from public.booking_payment_shares s
      -- Still in, as cancellation_plan counts them: not a player who left
      -- with credit, by forfeit or for a refund.
      where s.booking_id = v_booking.id and s.status in ('pending', 'authorized', 'paid', 'covered')), '[]'::jsonb));
end;
$$;

-- booking_detail, from 20261117090200_pay_booking_detail_cash.sql
create or replace function public.booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  -- P12: what switching 5 v 5 / 6 v 6 would do, on every booking.
  v_detail jsonb := public.booking_detail_modes(p_booking_id)
                    || jsonb_build_object('switch', public.booking_switch_info(p_booking_id, auth.uid()));
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_mine public.booking_payment_shares;
  v_opponent public.booking_payment_shares;
  v_booker_hold public.booking_payment_shares;
  v_settlement public.gipedo_settlements;
  v_pull jsonb;
  v_roster jsonb;
  v_cash_share public.booking_payment_shares;
  v_cash_plan jsonb;
  v_cash jsonb;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;

  -- Could the caller pay their own share in cash now, and for how much?
  -- Only the planner's refusals (raise exception) mean "no"; any other
  -- error still fails the call.
  select * into v_cash_share from public.booking_payment_shares
  where id = (v_detail -> 'me' ->> 'share_id')::uuid;
  if v_cash_share.id is not null and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') then
    begin
      v_cash_plan := public.share_payment_plan(v_cash_share, v_uid, 'cash', true, false);
      v_cash := jsonb_build_object('cash_cents', (v_cash_plan ->> 'cash_cents')::integer,
                                   'card_cents', (v_cash_plan ->> 'amount_cents')::integer);
    exception when raise_exception then
      v_cash := null;
    end;
  end if;
  v_detail := v_detail || jsonb_build_object('cash_allowed', v_cash is not null);
  if jsonb_typeof(v_detail -> 'me') = 'object' then
    v_detail := jsonb_set(v_detail, '{me,cash}', coalesce(v_cash, 'null'::jsonb));
  end if;
  -- P6e: the players the venue offered, as the caller may see them (the
  -- booker: open and accepted, with what they can do; another player:
  -- accepted names). booking_detail_modes above already refused anyone not
  -- in the booking.
  v_detail := v_detail || jsonb_build_object('venue_players',
                public.booking_venue_players_json(p_booking_id, v_uid, false));

  if not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.gipedo_side is not null) then
    return v_detail || jsonb_build_object('gipedo', null);
  end if;
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1;
  select * into v_mine from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid and gipedo_side is not null;
  select * into v_opponent from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.gipedo_side = 'b' and s.status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.reason = 'pull_out_fee');
  select * into v_booker_hold from public.booking_payment_shares
  where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
  select * into v_settlement from public.gipedo_settlements where share_id = v_mine.id;
  v_pull := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  -- A captain's card that is only held shows as held, not paid; one whose
  -- hold expired as unpaid.
  select coalesce(jsonb_agg(case when s.gipedo_side is not null and s.status = 'authorized'
                                 then r.e || jsonb_build_object('state', 'held')
                                 when s.gipedo_side is not null and s.status = 'expired'
                                 then r.e || jsonb_build_object('state', 'unpaid')
                                 else r.e end order by r.ord), '[]'::jsonb)
    into v_roster
  from jsonb_array_elements(v_detail -> 'roster') with ordinality as r(e, ord)
  left join public.booking_payment_shares s on s.id = (r.e ->> 'share_id')::uuid;

  return v_detail
    || jsonb_build_object('roster', v_roster)
    || jsonb_build_object('can_cancel', case when v_mine.id is not null and v_booking.payment_mode = 'gipedo_pano'
                                             then jsonb_build_object('my_spot', false, 'whole_team', false)
                                             else v_detail -> 'can_cancel' end)
    || jsonb_build_object('gipedo', jsonb_build_object(
      'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = v_booking.team_id),
      'opponent', jsonb_build_object(
        'state', case when v_opponent.status = 'authorized' then 'held' when v_opponent.id is not null then 'offered' else 'none' end,
        'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t
                 where t.id = v_post.matched_team_id and v_opponent.id is not null)),
      'my_side', v_mine.gipedo_side,
      'pull_out', v_pull - 'share_id' - 'side',
      'choice_due', v_booking.created_by = v_uid and v_booking.payment_mode = 'gipedo_pano'
                    and v_booking.status = 'confirmed' and v_booking.gipedo_no_opponent_at is not null
                    and v_booking.gipedo_choice is null
                    and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff(),
      'choice', v_booking.gipedo_choice,
      'play_normal_cents', case when v_booking.created_by = v_uid then v_booker_hold.amount_cents end,
      'settlement', case when v_settlement.id is null then null else jsonb_build_object(
        'reason', v_settlement.reason, 'capture_cents', v_settlement.capture_cents, 'status', v_settlement.status) end));
end;
$$;

revoke all on function public.booking_spots_taken(uuid) from public, anon, authenticated;
grant execute on function public.booking_spots_taken(uuid) to service_role;
revoke all on function public.booking_venue_players_json(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.booking_venue_players_json(uuid, uuid, boolean) to service_role;
revoke all on function public.venue_player_when(public.venue_bookings) from public, anon, authenticated;
grant execute on function public.venue_player_when(public.venue_bookings) to service_role;
revoke all on function public.offer_venue_player(uuid, text) from public, anon;
grant execute on function public.offer_venue_player(uuid, text) to authenticated, service_role;
revoke all on function public.answer_venue_player(uuid, boolean) from public, anon;
grant execute on function public.answer_venue_player(uuid, boolean) to authenticated, service_role;
revoke all on function public.withdraw_venue_player(uuid) from public, anon;
grant execute on function public.withdraw_venue_player(uuid) to authenticated, service_role;
revoke all on function public.remove_venue_player(uuid) from public, anon;
grant execute on function public.remove_venue_player(uuid) to authenticated, service_role;
-- Re-created functions keep their grants; restated as their migrations had them.
revoke all on function public.venue_booking_roster(uuid) from public, anon;
grant execute on function public.venue_booking_roster(uuid) to authenticated, service_role;
revoke all on function public.booking_detail(uuid) from public, anon;
grant execute on function public.booking_detail(uuid) to authenticated, service_role;
