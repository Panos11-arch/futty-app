-- P6a: a walk-in or phone booking is never an app booking (docs/specs/13-
-- payments-bookings.md "Venue dashboard": no match, no players, no payment
-- mode, no collection).
--
-- A counter booking's created_by is the staff member who added it and its
-- payment_mode is null, so every path that trusts "the booker", or treats a
-- null payment mode as a booking from before P4a, would accept it: the
-- cancel-booking Edge Function (cancel_booking_internal, then
-- cancel_booking_for) would cancel it without the reversing counter_paid
-- row, and add_booking_player / accept_invite / create_squad_post would put
-- players on it priced from the amount staff typed, which they could then
-- pay by card through Stripe. Each of those now refuses it (counter_booking),
-- and add_booking_share_internal, the one place players are added and priced,
-- refuses it whatever calls it. create_match_for_booking treats it like an
-- owner block (not_a_game). Only cancel_counter_booking cancels it.
--
-- The functions below are their current definitions with only that check
-- added; CREATE OR REPLACE keeps their grants. The old 3-hour auto-cancel
-- (bookings_needing_share_cancellation) also requires an app booking.
--
-- Ticked cash in cancellations (decided 13 November, Dimitris; for Panos to
-- confirm): cancellation_plan works out each share's ticked cash beside its
-- card amounts, as if it had been paid by card (cash_cents, cash_back_cents,
-- cash_credit_cents); cancel_booking_internal hands back cash_back_cents
-- (a reversing cash_received row) and cancellation_issue_credit adds
-- cash_credit_cents to the share's credit. The card amounts, which alone
-- reach Stripe, are unchanged.

alter table public.booking_cancellation_lines
  add column cash_cents integer not null default 0 check (cash_cents >= 0),
  add column cash_back_cents integer not null default 0 check (cash_back_cents >= 0),
  add column cash_credit_cents integer not null default 0 check (cash_credit_cents >= 0),
  add constraint booking_cancellation_lines_cash_check check (cash_back_cents + cash_credit_cents <= cash_cents);

create or replace function public.cancellation_quote(p_booking_id uuid, p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_booking public.venue_bookings;
begin
  -- A walk-in or phone booking is never an app booking. Only its own staff
  -- (and the staff member who added it) are told so; anyone else gets the
  -- error they'd get for someone else's app booking, so it can't be probed.
  select * into v_booking from public.venue_bookings b where b.id = p_booking_id;
  if v_booking.booking_type = 'counter' then
    if auth.uid() is null then
      raise exception 'not_authenticated';
    end if;
    if p_scope is null or p_scope not in ('my_spot', 'whole_team', 'venue') then
      raise exception 'invalid_scope';
    end if;
    if v_booking.created_by = auth.uid() or public.is_venue_staff(v_booking.venue_id) then
      raise exception 'counter_booking';
    end if;
    raise exception '%', case p_scope when 'whole_team' then 'not_your_booking'
                                      when 'venue' then 'not_your_venue'
                                      else 'not_in_booking' end;
  end if;
  v_plan := public.cancellation_plan(p_booking_id, p_scope, auth.uid(), now());
  return v_plan || jsonb_build_object(
    'guarantee_hold_placed',
    p_scope <> 'my_spot' and exists (
      select 1 from public.booking_guarantees g
      where g.booking_id = p_booking_id and g.status = 'held'));
end;
$$;

CREATE OR REPLACE FUNCTION public.add_booking_share_internal(p_booking_id uuid, p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
  v_current_count integer;
  v_share record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
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
       case when v_booking.payment_mode = 'pay_all' then 'covered' else 'pending' end)
    on conflict (booking_id, profile_id) do nothing;
    return;
  end if;

  v_share_cents := v_booking.amount_cents / v_total_needed
                   + coalesce(v_booking.service_fee_cents_per_player, 0);

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_invite(p_invite_id uuid)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.invites;
  v_booking public.venue_bookings;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite from public.invites where id = p_invite_id for update;
  if v_invite.id is null or v_invite.invited_profile_id <> auth.uid() then
    raise exception 'not_your_invite';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;

  if v_invite.kind = 'team' then
    -- Lock the team so two acceptances can't both take its last place.
    perform 1 from public.teams where id = v_invite.team_id for update;
    if not public.team_has_room(v_invite.team_id, v_invite.team_role, v_invite.id) then
      raise exception 'team_full';
    end if;
    insert into public.team_members (team_id, profile_id, role)
    values (v_invite.team_id, auth.uid(), v_invite.team_role)
    on conflict (team_id, profile_id) do nothing;
  else
    select * into v_booking from public.venue_bookings where id = v_invite.booking_id for update;
    -- A walk-in or phone booking is never an app booking.
    if v_booking.booking_type = 'counter' then
      raise exception 'counter_booking';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    if v_booking.booking_day < v_now::date
       or (v_booking.booking_day = v_now::date and v_booking.start_time <= v_now::time) then
      raise exception 'slot_in_past';
    end if;
    perform public.assert_venue_live(v_booking.venue_id);
    perform public.add_booking_share_internal(v_invite.booking_id, auth.uid());
  end if;

  update public.invites set status = 'accepted', responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_booking_player(p_booking_id uuid, p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_profile_id uuid;
  v_inviter text;
  v_venue_name text;
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  select id into v_profile_id from public.profiles where lower(username) = lower(trim(p_username));
  if v_profile_id is null then
    raise exception 'player_not_found';
  end if;
  if v_profile_id = auth.uid()
     or exists (select 1 from public.booking_payment_shares where booking_id = p_booking_id and profile_id = v_profile_id) then
    raise exception 'already_in_booking';
  end if;
  if exists (
    select 1 from public.invites
    where kind = 'booking' and booking_id = p_booking_id and invited_profile_id = v_profile_id and status = 'pending'
  ) then
    raise exception 'already_invited';
  end if;

  select coalesce(username, full_name, 'A player') into v_inviter from public.profiles where id = auth.uid();
  select name into v_venue_name from public.venues where id = v_booking.venue_id;

  insert into public.invites (kind, booking_id, invited_profile_id, invited_by)
  values ('booking', p_booking_id, v_profile_id, auth.uid())
  returning * into v_invite;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    v_profile_id, 'booking_invite', 'Game invite',
    format('%s invited you to play at %s on %s at %s.', v_inviter, v_venue_name,
           to_char(v_booking.booking_day, 'Dy DD Mon'), to_char(v_booking.start_time, 'HH24:MI')),
    jsonb_build_object('inviteId', v_invite.id, 'bookingId', p_booking_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_squad_post(p_venue_id uuid, p_scheduled_at timestamp with time zone, p_format text, p_post_type text, p_level text DEFAULT NULL::text, p_team_id uuid DEFAULT NULL::uuid, p_players_needed integer DEFAULT NULL::integer, p_venue_booking_id uuid DEFAULT NULL::uuid, p_position_needed text DEFAULT NULL::text, p_level_needed text DEFAULT NULL::text, p_payment_mode text DEFAULT 'split'::text)
 RETURNS public.squad_posts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_scheduled_at timestamptz := p_scheduled_at;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_payment_mode not in ('split', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;

  if p_post_type = 'opposition' then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
    ) then
      raise exception 'not_captain';
    end if;
  elsif p_post_type = 'players' then
    if p_players_needed is null or p_players_needed < 1 then
      raise exception 'players_needed_required';
    end if;
    -- Gipedo Pano only makes sense once there are two full rosters with a
    -- winner and a loser; a "need players" post never gets there.
    if p_payment_mode <> 'split' then
      raise exception 'invalid_payment_mode';
    end if;
  else
    raise exception 'invalid_post_type';
  end if;

  if p_venue_booking_id is not null then
    select * into v_booking from public.venue_bookings where id = p_venue_booking_id;
    if v_booking.id is null or v_booking.created_by is distinct from auth.uid() then
      raise exception 'not_your_booking';
    end if;
    -- A walk-in or phone booking is never an app booking.
    if v_booking.booking_type = 'counter' then
      raise exception 'counter_booking';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    if v_booking.venue_id is distinct from p_venue_id or v_booking.format is distinct from p_format then
      raise exception 'booking_mismatch';
    end if;
    v_scheduled_at := (v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia';
  end if;

  perform public.assert_venue_live(p_venue_id);

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, level, team_id, players_needed, posted_by, status,
     venue_booking_id, position_needed, level_needed, payment_mode)
  values
    (p_venue_id, v_scheduled_at, p_format, p_post_type, p_level, p_team_id, p_players_needed, auth.uid(), 'open',
     p_venue_booking_id, p_position_needed, p_level_needed, p_payment_mode)
  returning * into v_post;

  return v_post;
end;
$function$;

CREATE OR REPLACE FUNCTION public.booking_detail(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_venue public.venues;
  v_me public.booking_payment_shares;
  v_is_booker boolean;
  v_kickoff timestamptz;
  v_refunds_stop timestamptz;
  v_active boolean;
  v_free_until timestamptz;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null
     or not (v_booking.created_by = v_uid
             or exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.profile_id = v_uid)) then
    raise exception 'booking_not_found';
  end if;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  select * into v_venue from public.venues where id = v_booking.venue_id;
  select * into v_me from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid
  order by (status not in ('cancelled', 'refunded')) desc, created_at desc
  limit 1;
  v_is_booker := v_booking.created_by = v_uid;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  v_refunds_stop := v_kickoff - interval '6 hours';
  v_active := v_booking.status <> 'cancelled' and now() < v_kickoff;

  if v_me.status = 'authorized' and v_me.capture_due_at > now() then
    v_free_until := v_me.capture_due_at;
  end if;
  if v_active then
    if v_free_until is not null and v_free_until < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'free_hour_ends', 'at', v_free_until);
    elsif now() < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'refunds_stop', 'at', v_refunds_stop);
    end if;
  end if;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', v_booking.id, 'status', v_booking.status, 'booking_day', v_booking.booking_day,
      'start_time', v_booking.start_time, 'end_time', v_booking.end_time, 'format', v_booking.format,
      'capacity', v_booking.capacity,
      'players_per_side', v_booking.capacity / 2,
      'payment_mode', v_booking.payment_mode,
      'kickoff_at', v_kickoff,
      'ends_at', public.booking_ends_at(v_booking.booking_day, v_booking.end_time),
      'refunds_stop_at', v_refunds_stop,
      'payment_window_ends_at', case when v_booking.status = 'pending_payment'
                                     then public.booking_payment_window_ends_at(v_booking) end),
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address,
      'google_maps_link', v_venue.google_maps_link,
      'photo_path', (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                     order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1)),
    'is_booker', v_is_booker,
    'me', case when v_me.id is null then null else jsonb_build_object(
      'share_id', v_me.id, 'status', v_me.status, 'payment_method', v_me.payment_method,
      'amount_cents', v_me.amount_cents, 'pitch_cents', v_me.pitch_cents, 'fee_cents', v_me.fee_cents,
      'cash_cents', v_me.cash_cents, 'free_until', v_free_until) end,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'profile_id', s.profile_id,
               'name', public.profile_display_name(s.profile_id),
               'username', p.username,
               'is_booker', s.is_booker,
               'is_me', s.profile_id = v_uid,
               'state', case
                          when s.status = 'covered' then 'covered'
                          when s.status = 'pending' then 'unpaid'
                          when s.payment_method = 'cash' and s.cash_received_at is not null then 'cash_paid'
                          when s.payment_method = 'cash' then 'cash'
                          else 'in_app' end,
               'amount_cents', case when v_is_booker or s.profile_id = v_uid then s.amount_cents end,
               'cash_cents', case when v_is_booker or s.profile_id = v_uid then s.cash_cents end)
             order by s.is_booker desc, s.created_at, s.id)
      from public.booking_payment_shares s
      left join public.profiles p on p.id = s.profile_id
      where s.booking_id = p_booking_id and s.status not in ('cancelled', 'refunded')), '[]'::jsonb),
    'next_cutoff', v_next,
    'can_cancel', jsonb_build_object(
      'my_spot', v_active and v_me.id is not null and v_me.status not in ('cancelled', 'refunded')
                 and not (v_me.is_booker and v_booking.payment_mode = 'pay_all'),
      'whole_team', v_active and v_is_booker)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking_for(p_booking_id uuid, p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;

  if v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;

  if v_booking.status = 'confirmed'
     and now() >= ((v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia') - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;

  -- Returned so the Edge Function knows what it was before (no separate,
  -- racy pre-read needed).
  return v_booking.status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking_internal(p_booking_id uuid, p_scope text, p_profile_id uuid, p_expected_quote text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_venue_name text;
  v_plan jsonb;
  v_line jsonb;
  v_row public.booking_cancellation_lines;
  v_cancellation_id uuid;
  v_fee_id uuid;
  v_status text;
  v_work boolean;
  v_pm text;
  v_who text;
  v_body text;
  v_profile uuid;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.id is not null and v_booking.payment_mode is null then
    return jsonb_build_object('legacy', true);
  end if;
  perform 1 from public.booking_payment_shares where booking_id = p_booking_id for update;
  perform 1 from public.booking_guarantees where booking_id = p_booking_id for update;
  perform 1 from public.booking_cancellation_lines where booking_id = p_booking_id and work = 'pending' for update;

  v_plan := public.cancellation_plan(p_booking_id, p_scope, p_profile_id, now());
  if p_expected_quote is null then
    raise exception 'quote_required';
  end if;
  if v_plan ->> 'quote' is distinct from p_expected_quote then
    raise exception 'quote_changed';
  end if;

  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan)
  values (p_booking_id, p_scope, p_profile_id, v_plan ->> 'quote', v_plan)
  returning id into v_cancellation_id;

  for v_line in select * from jsonb_array_elements(v_plan -> 'lines') loop
    v_work := case v_line ->> 'action'
      when 'release' then v_line ->> 'stripe_intent_id' is not null
      when 'keep' then (v_line ->> 'needs_capture')::boolean
      when 'keep_and_credit' then (v_line ->> 'needs_capture')::boolean
      when 'refund_choice' then true
      else false end;

    if p_scope = 'venue' and v_line ->> 'share_id' is not null then
      update public.booking_cancellation_lines
      set work = 'done', outcome = 'superseded', done_at = now()
      where share_id = (v_line ->> 'share_id')::uuid and work = 'pending' and action in ('keep', 'keep_and_credit');
    end if;

    insert into public.booking_cancellation_lines (
      cancellation_id, booking_id, share_id, guarantee_id, profile_id, venue_id, is_booker, "window", action,
      paid_cents, fee_cents, credit_used_cents, value_cents, kept_cents, credit_cents, refund_cents, needs_capture,
      stripe_intent_id, reason, work, next_attempt_at, choose_by, cash_cents, cash_back_cents, cash_credit_cents)
    values (
      v_cancellation_id, p_booking_id, (v_line ->> 'share_id')::uuid, (v_line ->> 'guarantee_id')::uuid,
      (v_line ->> 'profile_id')::uuid, v_booking.venue_id, (v_line ->> 'is_booker')::boolean, v_line ->> 'window',
      v_line ->> 'action', (v_line ->> 'paid_cents')::integer, (v_line ->> 'fee_cents')::integer,
      (v_line ->> 'credit_used_cents')::integer, (v_line ->> 'value_cents')::integer, (v_line ->> 'kept_cents')::integer,
      (v_line ->> 'credit_cents')::integer, (v_line ->> 'refund_cents')::integer, (v_line ->> 'needs_capture')::boolean,
      v_line ->> 'stripe_intent_id', p_scope || '_' || (v_line ->> 'action'),
      case when v_work then 'pending' else 'none' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + interval '48 hours'
           when v_work then now() + interval '2 minutes' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + interval '48 hours' end,
      coalesce((v_line ->> 'cash_cents')::integer, 0), coalesce((v_line ->> 'cash_back_cents')::integer, 0),
      coalesce((v_line ->> 'cash_credit_cents')::integer, 0))
    returning * into v_row;

    if v_row.guarantee_id is not null then
      update public.booking_guarantees set status = 'cancelled', next_attempt_at = null where id = v_row.guarantee_id;
      continue;
    end if;

    v_status := case v_row.action
      when 'none' then 'cancelled' when 'release' then 'cancelled' when 'keep' then 'forfeited'
      when 'keep_and_credit' then 'credited' when 'refund_choice' then 'refund_due' end;
    update public.booking_payment_shares set status = v_status where id = v_row.share_id;
    if not v_row.needs_capture then
      perform public.cancellation_issue_credit(v_row, p_scope);
    end if;
    -- Ticked cash a card player would get back: the venue hands it back
    -- (once; a reversing cash_received row).
    if v_row.cash_back_cents > 0 then
      perform public.reverse_cash_received(v_row.share_id);
    end if;
  end loop;

  if p_scope <> 'my_spot' then
    update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  end if;

  if v_plan -> 'booker_fee' <> 'null'::jsonb then
    select coalesce(s.stripe_payment_method_id, g.stripe_payment_method_id) into v_pm
    from public.booking_payment_shares s
    left join public.booking_guarantees g on g.booking_id = s.booking_id
    where s.booking_id = p_booking_id and s.is_booker;
    insert into public.booking_cancellation_fees (cancellation_id, booking_id, profile_id, players, amount_cents,
      stripe_customer_id, stripe_payment_method_id, next_attempt_at, stop_at)
    values (v_cancellation_id, p_booking_id, v_booking.created_by, (v_plan -> 'booker_fee' ->> 'players')::integer,
      (v_plan -> 'booker_fee' ->> 'amount_cents')::integer,
      (select stripe_customer_id from public.profiles where id = v_booking.created_by), v_pm,
      now() + interval '2 minutes', (v_plan ->> 'kickoff_at')::timestamptz)
    returning id into v_fee_id;
  end if;

  select name into v_venue_name from public.venues where id = v_booking.venue_id;
  if p_scope = 'my_spot' then
    for v_profile in
      select distinct profile_id from public.booking_payment_shares
      where booking_id = p_booking_id and profile_id <> p_profile_id
        and status in ('pending', 'authorized', 'paid', 'covered')
    loop
      perform public.send_notification(v_profile, 'booking_spot_released', jsonb_build_object(
        'title', 'A spot opened up',
        'body', format('A player dropped out of your game at %s on %s at %s. Invite someone to fill the spot.',
                       v_venue_name, to_char(v_booking.booking_day, 'FMDay DD Mon'), to_char(v_booking.start_time, 'HH24:MI')),
        'bookingId', p_booking_id
      ));
    end loop;
  else
    v_who := case when p_scope = 'venue' then v_venue_name else 'The booker' end;
    for v_row in
      select * from public.booking_cancellation_lines
      where cancellation_id = v_cancellation_id and share_id is not null and profile_id <> p_profile_id
    loop
      v_body := format('%s cancelled your game at %s on %s at %s. ', v_who, v_venue_name,
                       to_char(v_booking.booking_day, 'FMDay DD Mon'), to_char(v_booking.start_time, 'HH24:MI'))
        || case v_row.action
             when 'refund_choice' then format('You get %s back. Choose venue credit within 48 hours, or it goes back to your card.',
                                              public.money_format_euros(v_row.refund_cents))
             when 'release' then case when v_row.refund_cents > 0 then 'Your payment hold was released, so you won''t be charged.'
                                      else 'You weren''t charged.' end
             when 'keep' then 'It was cancelled less than 6 hours before kickoff, so no money goes back.'
             else 'You weren''t charged.'
           end;
      perform public.send_notification(v_row.profile_id, 'booking_cancelled', jsonb_build_object(
        'title', 'Game cancelled',
        'body', v_body,
        'bookingId', p_booking_id,
        'cancellationLineId', v_row.id,
        'action', v_row.action,
        'refundCents', v_row.refund_cents
      ));
    end loop;
  end if;

  return v_plan || jsonb_build_object('cancellation_id', v_cancellation_id, 'fee_id', v_fee_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_match_for_booking(p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_match public.matches;
  v_kickoff timestamptz;
  v_ends timestamptz;
  v_friendly public.friendly_matches;
  v_post_team uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_label_a text := 'Bibs';
  v_label_b text := 'Non-bibs';
  v_captain_b uuid;
  v_side_a_team uuid;
  v_side_b_team uuid;
  v_cancelled_at timestamptz;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_booking.booking_type in ('owner_block', 'counter') then
    raise exception 'not_a_game';
  end if;

  select * into v_match from public.matches where booking_id = p_booking_id for update;

  if v_booking.status = 'cancelled' then
    if v_match.id is null then
      raise exception 'booking_not_confirmed';
    end if;
    -- When the whole booking was cancelled; now if that isn't recorded.
    select min(c.cancelled_at) into v_cancelled_at
    from public.booking_cancellations c
    where c.booking_id = p_booking_id and c.scope <> 'my_spot';
    if v_match.status in ('scheduled', 'played') and coalesce(v_cancelled_at, now()) < v_match.ends_at then
      update public.matches set status = 'void' where id = v_match.id;
    end if;
    return v_match.id;
  end if;

  if v_booking.status is distinct from 'confirmed' then
    if v_match.id is not null then
      return v_match.id;
    end if;
    raise exception 'booking_not_confirmed';
  end if;

  -- Closed, or past kickoff: nothing changes (no error).
  if v_match.id is not null and (v_match.status not in ('scheduled', 'played') or now() >= v_match.kickoff_at) then
    return v_match.id;
  end if;

  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  v_ends := public.booking_kickoff_at(v_booking.booking_day, v_booking.end_time);
  if v_ends <= v_kickoff then
    v_ends := v_ends + interval '1 day';  -- ends at or after midnight
  end if;

  -- A named game: the booking's squad post led to a friendly match.
  select fm.id, sp.team_id into v_friendly.id, v_post_team
  from public.squad_posts sp
  join public.friendly_matches fm on fm.squad_post_id = sp.id
  where sp.venue_booking_id = p_booking_id
    and coalesce(fm.status, '') <> 'cancelled'
    and fm.home_team_id is not null and fm.away_team_id is not null
  order by fm.id
  limit 1;

  if v_friendly.id is not null then
    select * into v_friendly from public.friendly_matches where id = v_friendly.id;
    -- The booker's team is side a.
    v_team_a := case
      when v_booking.team_id in (v_friendly.home_team_id, v_friendly.away_team_id) then v_booking.team_id
      when v_post_team in (v_friendly.home_team_id, v_friendly.away_team_id) then v_post_team
      when exists (select 1 from public.team_members tm
                   where tm.team_id = v_friendly.away_team_id and tm.profile_id = v_booking.created_by)
           and not exists (select 1 from public.team_members tm
                           where tm.team_id = v_friendly.home_team_id and tm.profile_id = v_booking.created_by)
        then v_friendly.away_team_id
      else v_friendly.home_team_id
    end;
    v_team_b := case when v_team_a = v_friendly.home_team_id then v_friendly.away_team_id else v_friendly.home_team_id end;
    v_label_a := coalesce((select t.name from public.teams t where t.id = v_team_a), v_label_a);
    v_label_b := coalesce((select t.name from public.teams t where t.id = v_team_b), v_label_b);
    v_captain_b := (select tm.profile_id from public.team_members tm
                    where tm.team_id = v_team_b and tm.role = 'captain'
                    order by tm.joined_at, tm.id limit 1);
  end if;

  if v_match.id is not null then
    update public.matches
    set kickoff_at = v_kickoff,
        ends_at = v_ends,
        result_deadline_at = v_ends + interval '24 hours',
        venue_id = v_booking.venue_id,
        format = v_booking.format,
        players_per_side = greatest(v_booking.capacity / 2, 1)
    where id = v_match.id
    returning * into v_match;

    -- Decision 1b.1: the friendly was agreed after the match was made.
    if v_match.kind = 'pickup' and v_friendly.id is not null and v_match.status = 'scheduled'
       and not exists (select 1 from public.match_result_submissions r where r.match_id = v_match.id) then
      update public.matches
      set kind = 'named', friendly_match_id = v_friendly.id
      where id = v_match.id
      returning * into v_match;

      update public.match_sides ms
      set team_id = v.team_id, label = v.label, captain_profile_id = v.captain
      from (values ('a', v_team_a, v_label_a, v_booking.created_by),
                   ('b', v_team_b, v_label_b, v_captain_b)) as v(side, team_id, label, captain)
      where ms.match_id = v_match.id and ms.side = v.side;
    end if;
  else
    insert into public.matches (booking_id, venue_id, friendly_match_id, kind, format, players_per_side,
                                kickoff_at, ends_at, result_deadline_at)
    values (p_booking_id, v_booking.venue_id, v_friendly.id,
            case when v_friendly.id is not null then 'named' else 'pickup' end, v_booking.format,
            greatest(v_booking.capacity / 2, 1), v_kickoff, v_ends, v_ends + interval '24 hours')
    returning * into v_match;

    insert into public.match_sides (match_id, side, team_id, label, captain_profile_id)
    values
      (v_match.id, 'a', v_team_a, v_label_a, v_booking.created_by),
      (v_match.id, 'b', v_team_b, v_label_b, v_captain_b);

    insert into public.match_check_in_codes (match_id, code)
    values (v_match.id, encode(extensions.gen_random_bytes(16), 'hex'));
  end if;

  select ms.team_id into v_side_a_team from public.match_sides ms where ms.match_id = v_match.id and ms.side = 'a';
  select ms.team_id into v_side_b_team from public.match_sides ms where ms.match_id = v_match.id and ms.side = 'b';

  if v_match.kind = 'named' then
    -- Named roster (decision 1b.1): spot holders, then side b's team
    -- members without a spot. Sides are set on every call.
    insert into public.match_players (match_id, profile_id, share_id, side)
    select v_match.id, r.profile_id, r.share_id, r.side
    from (
      select s.profile_id, s.id as share_id,
             case
               when s.profile_id <> v_booking.created_by
                and exists (select 1 from public.team_members tm
                            where tm.team_id = v_side_b_team and tm.profile_id = s.profile_id)
                and not exists (select 1 from public.team_members tm
                                where tm.team_id = v_side_a_team and tm.profile_id = s.profile_id)
                 then 'b'
               else 'a'
             end as side
      from public.booking_payment_shares s
      where s.booking_id = p_booking_id
        and s.status in ('pending', 'authorized', 'paid', 'covered')
      union all
      select distinct tm.profile_id, null::uuid, 'b'
      from public.team_members tm
      where tm.team_id = v_side_b_team
        and tm.profile_id is not null
        and not exists (select 1 from public.booking_payment_shares s
                        where s.booking_id = p_booking_id and s.profile_id = tm.profile_id
                          and s.status in ('pending', 'authorized', 'paid', 'covered'))
    ) r
    on conflict (match_id, profile_id) where profile_id is not null
    do update set side = excluded.side, share_id = excluded.share_id, left_at = null;
  else
    -- Pickup roster: the booker is on Bibs and the others choose.
    insert into public.match_players (match_id, profile_id, share_id, side)
    select v_match.id, s.profile_id, s.id,
           case when s.profile_id = v_booking.created_by then 'a' end
    from public.booking_payment_shares s
    where s.booking_id = p_booking_id
      and s.status in ('pending', 'authorized', 'paid', 'covered')
    on conflict (match_id, profile_id) where profile_id is not null
    do update set share_id = excluded.share_id, left_at = null;
  end if;

  -- Anyone who no longer holds a spot (and, in a named game, isn't on side
  -- b's team) has left.
  update public.match_players mp
  set left_at = now()
  where mp.match_id = v_match.id
    and mp.profile_id is not null
    and mp.left_at is null
    and not exists (
      select 1 from public.booking_payment_shares s
      where s.booking_id = p_booking_id and s.profile_id = mp.profile_id
        and s.status in ('pending', 'authorized', 'paid', 'covered')
    )
    and not (v_match.kind = 'named' and exists (
      select 1 from public.team_members tm where tm.team_id = v_side_b_team and tm.profile_id = mp.profile_id
    ));

  return v_match.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancellation_plan(p_booking_id uuid, p_scope text, p_profile_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_kickoff timestamptz;
  v_own public.booking_payment_shares;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_late_team boolean;
  v_lines jsonb := '[]'::jsonb;
  v_has_money boolean;
  v_value integer;
  v_paid integer;
  v_card_taken boolean;
  v_window text;
  v_action text;
  v_kept integer;
  v_credit integer;
  v_refund integer;
  v_capture boolean;
  v_keep_unit integer;
  v_taken integer;
  v_fee jsonb := null;
  v_cash integer;
  v_cash_back integer;
  v_cash_credit integer;
  v_cash_share public.booking_payment_shares;
  v_cash_window text;
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_scope is null or p_scope not in ('my_spot', 'whole_team', 'venue') then
    raise exception 'invalid_scope';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.payment_mode is null then
    raise exception 'legacy_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if p_at >= v_kickoff then
    raise exception 'booking_started';
  end if;

  if p_scope = 'whole_team' and v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;
  if p_scope = 'venue' and not exists (
    select 1 from public.venues where id = v_booking.venue_id and owner_profile_id = p_profile_id
  ) then
    raise exception 'not_your_venue';
  end if;
  if p_scope = 'my_spot' then
    select * into v_own from public.booking_payment_shares
    where booking_id = p_booking_id and profile_id = p_profile_id
      and status in ('pending', 'authorized', 'paid', 'covered');
    if v_own.id is null then
      raise exception 'not_in_booking';
    end if;
    if v_own.is_booker and v_booking.payment_mode = 'pay_all' then
      raise exception 'use_whole_team';
    end if;
  end if;

  v_late_team := p_at > v_kickoff - interval '6 hours';
  v_keep_unit := 100;

  for v_share in
    select s.* from public.booking_payment_shares s
    where s.booking_id = p_booking_id
      and (s.status in ('pending', 'authorized', 'paid', 'covered')
           -- Q1: forfeited by a late cancellation of the player's own spot
           -- (not the €1 of a middle-window one).
           or (p_scope = 'venue' and s.status = 'forfeited'
               and exists (select 1 from public.booking_cancellation_lines l
                           where l.share_id = s.id and l."window" = 'late')))
      and (p_scope <> 'my_spot' or s.id = v_own.id)
    order by s.is_booker desc, s.created_at, s.id
  loop
    v_kept := 0;
    v_credit := 0;
    v_refund := 0;
    v_capture := false;
    v_window := null;

    if v_share.status = 'forfeited' then
      v_card_taken := v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null
        and exists (select 1 from public.money_ledger m
                    where m.kind = 'capture' and m.stripe_id = v_share.stripe_payment_intent_id);
      v_window := 'venue';
      if v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null and not v_card_taken then
        -- The card part was never taken: whatever hold is left is released.
        v_paid := v_share.amount_cents;
        v_value := v_paid + v_share.credit_cents;
        v_action := 'release';
      else
        v_paid := case when v_card_taken then v_share.amount_cents else 0 end;
        v_value := v_paid + v_share.credit_cents;
        v_action := case when v_value > 0 then 'refund_choice' else 'none' end;
        if v_value = 0 then
          v_window := null;
        end if;
      end if;
      v_refund := v_value;
      v_has_money := v_value > 0;
    else
      v_has_money := v_share.status in ('authorized', 'paid') and v_share.amount_cents + v_share.credit_cents > 0;
      v_value := case when v_has_money then v_share.amount_cents + v_share.credit_cents else 0 end;
      v_paid := case when v_has_money then v_share.amount_cents else 0 end;

      if not v_has_money then
        v_action := case when v_share.stripe_payment_intent_id is not null and v_share.status = 'pending'
                         then 'release' else 'none' end;
      elsif p_scope = 'venue' then
        v_window := 'venue';
        v_action := case when v_share.status = 'authorized' then 'release' else 'refund_choice' end;
        v_refund := v_value;
      elsif p_scope = 'my_spot' or v_share.is_booker then
        v_window := public.cancellation_window(v_share, v_kickoff, p_at);
        if v_window = 'free' then
          v_action := 'release';
          v_refund := v_value;
        elsif v_window = 'middle' then
          v_kept := least(v_value, v_keep_unit * case when v_booking.payment_mode = 'pay_all' then v_booking.capacity else 1 end);
          v_credit := v_value - v_kept;
          v_action := case when v_credit > 0 then 'keep_and_credit' else 'keep' end;
          v_capture := v_share.status = 'authorized';
        else
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        end if;
      else
        v_window := 'other';
        if v_late_team then
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        elsif v_share.status = 'authorized' then
          v_action := 'release';
          v_refund := v_value;
        else
          v_action := 'refund_choice';
          v_refund := v_value;
        end if;
      end if;
    end if;

    -- Ticked cash (decided 13 November, Dimitris; for Panos to confirm)
    -- follows the cancellation rules as if it had been paid by card, beside
    -- the card amounts above, which alone reach Stripe: it goes back where a
    -- card player gets money back (the venue cancelling, a cancel in the
    -- free hour, a whole-team cancel more than 6 hours before kickoff); in
    -- the middle window the €1 is kept over card and cash together and the
    -- rest of the cash becomes credit at the venue; a late cancel keeps it.
    v_cash := coalesce((select sum(m.venue_cents) from public.money_ledger m
                        where m.share_id = v_share.id and m.kind = 'cash_received'), 0);
    v_cash_back := 0;
    v_cash_credit := 0;
    if v_cash > 0 then
      if p_scope = 'venue' then
        v_cash_back := v_cash;
      elsif p_scope = 'my_spot' or v_share.is_booker then
        -- The window a card player who paid then would be in; with nothing
        -- paid in the app, the cash is the payment.
        v_cash_share := v_share;
        if v_cash_share.held_at is null and v_cash_share.paid_at is null then
          v_cash_share.held_at := v_cash_share.cash_received_at;
          v_cash_share.capture_due_at := null;
        end if;
        v_cash_window := public.cancellation_window(v_cash_share, v_kickoff, p_at);
        if v_cash_window = 'free' then
          v_cash_back := v_cash;
        elsif v_cash_window = 'middle' then
          v_cash_credit := v_cash - (least(v_value + v_cash,
                                           v_keep_unit * case when v_booking.payment_mode = 'pay_all'
                                                              then v_booking.capacity else 1 end)
                                     - v_kept);
          if v_cash_credit > 0 and v_action in ('keep', 'none') then
            v_action := 'keep_and_credit';
          end if;
        end if;
        v_window := coalesce(v_window, v_cash_window);
      elsif not v_late_team then
        v_cash_back := v_cash;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'share_id', v_share.id,
      'guarantee_id', null,
      'profile_id', v_share.profile_id,
      'is_booker', v_share.is_booker,
      'window', v_window,
      'action', v_action,
      'paid_cents', v_paid,
      'fee_cents', case when v_paid > 0 then coalesce(v_share.fee_cents, 0) else 0 end,
      'credit_used_cents', case when v_has_money then v_share.credit_cents else 0 end,
      'value_cents', v_value,
      'kept_cents', v_kept,
      'credit_cents', v_credit,
      'refund_cents', v_refund,
      'needs_capture', v_capture,
      'stripe_intent_id', v_share.stripe_payment_intent_id,
      'cash_cents', v_cash,
      'cash_back_cents', v_cash_back,
      'cash_credit_cents', v_cash_credit
    ));
  end loop;

  if p_scope <> 'my_spot' then
    select * into v_guarantee from public.booking_guarantees where booking_id = p_booking_id and status <> 'cancelled';
    if v_guarantee.id is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'share_id', null, 'guarantee_id', v_guarantee.id, 'profile_id', v_guarantee.profile_id, 'is_booker', true,
        'window', null, 'action', 'release', 'paid_cents', 0, 'fee_cents', 0, 'credit_used_cents', 0,
        'value_cents', 0, 'kept_cents', 0, 'credit_cents', 0, 'refund_cents', 0, 'needs_capture', false,
        'stripe_intent_id', v_guarantee.stripe_payment_intent_id,
        'cash_cents', 0, 'cash_back_cents', 0, 'cash_credit_cents', 0));
    end if;
  end if;

  if p_scope = 'whole_team' and v_booking.payment_mode <> 'pay_all' and not v_late_team then
    select count(*) into v_taken from public.booking_payment_shares
    where booking_id = p_booking_id and not is_booker and status = 'paid' and amount_cents > 0;
    if v_taken > 0 then
      v_fee := jsonb_build_object('profile_id', v_booking.created_by, 'players', v_taken, 'amount_cents', 100 * v_taken);
    end if;
  end if;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'scope', p_scope,
    'payment_mode', v_booking.payment_mode,
    'kickoff_at', v_kickoff,
    'refunds_stop_at', v_kickoff - interval '6 hours',
    'cancels_booking', p_scope <> 'my_spot',
    'lines', v_lines,
    'booker_fee', v_fee,
    'quote', md5(jsonb_build_object('booking_id', p_booking_id, 'scope', p_scope, 'lines', v_lines,
                                    'booker_fee', v_fee)::text)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancellation_issue_credit(p_line public.booking_cancellation_lines, p_scope text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kept_card integer := least(p_line.kept_cents, p_line.paid_cents);
  v_kept_credit integer := p_line.kept_cents - least(p_line.kept_cents, p_line.paid_cents);
  v_new integer;
  v_back integer;
begin
  if p_line."window" <> 'middle' then
    return;
  end if;
  -- With the credit from ticked cash (cancellation_plan's cash_credit_cents):
  -- one credit per share, as issue_venue_credit keeps one per share and source.
  v_new := p_line.paid_cents - v_kept_card + p_line.cash_credit_cents;
  v_back := p_line.credit_used_cents - v_kept_credit;
  if v_new > 0 then
    perform public.issue_venue_credit(p_line.profile_id, p_line.venue_id, v_new,
      case p_scope when 'my_spot' then 'player_cancelled' when 'whole_team' then 'booking_cancelled' else 'venue_cancelled' end,
      p_line.booking_id, p_line.share_id);
  end if;
  if v_back > 0 then
    perform public.return_share_credit_part(p_line.share_id, v_back, 'cancelled_credit_back');
  end if;
  perform public.record_money_transfer(p_line.booking_id, p_line.share_id, p_line.kept_cents - p_line.fee_cents,
    'cancel-kept-' || p_line.id, p_line.reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.bookings_needing_share_cancellation()
 RETURNS TABLE(booking_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.id
  from public.venue_bookings b
  where b.status = 'confirmed'
    -- An app booking from before P4a: never a walk-in or an owner block.
    and b.booking_type = 'user_booking'
    and b.payment_mode is null
    and b.amount_cents > 0
    and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' <= now() + interval '3 hours'
    and (
      select count(*) from public.booking_payment_shares s
      where s.booking_id = b.id and s.status in ('authorized', 'paid')
    ) < public.booking_total_shares_needed(b.id);
$function$;
