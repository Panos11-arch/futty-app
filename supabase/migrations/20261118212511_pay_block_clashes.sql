-- Clashes when blocking (doc 28 prompt 1; docs/specs/13-payments-bookings.md
-- "Blocking pitches", decided 18 November, Dimitris; for Panos to confirm).
--
-- Before a block is saved, staff see every booking it clashes with on that
-- pitch (a booking on a combination that contains the pitch included): app
-- bookings with their booker, players and payment state, and walk-in or
-- phone bookings with their contact. Owner blocks (staff training slots) are
-- left out and never touched. A game that has already kicked off is listed as
-- started and stays on: nothing can be cancelled once a game has started.
--
--   venue_block_clashes  the list, each app booking's venue cancel quote and
--                        the free pitches it can move to, the total of
--                        Stripe's fees the venue would owe, and one quote
--                        hash over all of it;
--   venue_move_booking   staff move an app booking to a free pitch (or
--                        combination) of the same size that hosts its format,
--                        at the same time. Shares, payments and the match stay;
--                        everyone in it is told (booking_pitch_moved);
--   venue_add_block      saves the block. In the same transaction it cancels
--                        every app booking still clashing through the existing
--                        venue cancel (cancel_booking_internal, scope 'venue':
--                        whole share back, card or credit within 48 hours, the
--                        venue pays Stripe's fee; a Gipedo Pano booking's
--                        settlement is stood down and its holds released), and
--                        every walk-in or phone booking still clashing, and
--                        returns those contacts to call. If anything changed
--                        since staff saw the list, it refuses (clashes_changed).
--
-- No new money code: every money movement is the existing venue cancel's and
-- the existing walk-in cancel's. The Stripe work the venue cancel leaves
-- (holds released, refunds after the player's choice) is picked up by
-- run-payment-jobs (runCancellationWork), as for any cancel.
--
-- A cancel made by venue_add_block doesn't send a saved-search "slot freed"
-- alert: the slot is blocked in the same transaction, so the events its
-- cancels queue are removed again.
--
-- Re-created from their latest definitions (diffs in the PR for Panos):
--   notify_venue_block       (20261109122123_pay_venue_model_fixes.sql): a
--                            game that has kicked off isn't told;
--   cancel_counter_booking   (20261113220553_pay_dashboard_counter.sql): its
--                            body moves into cancel_counter_booking_internal,
--                            unchanged, so venue_add_block can share it.

insert into public.notification_types (type, always_sent) values ('booking_pitch_moved', true)
on conflict (type) do nothing;

-- Internal: the bookings a block on this pitch (null = the whole venue) and
-- time (both null = the whole day) clashes with: app, walk-in and phone
-- bookings not cancelled, through the pitches they hold, so a combination
-- containing the pitch counts.
create or replace function public.block_clash_booking_ids(
  p_venue_id uuid,
  p_pitch_id uuid,
  p_day date,
  p_start time,
  p_end time
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(b.id order by b.id), '{}')
  from public.venue_bookings b
  where b.venue_id = p_venue_id
    and b.booking_day = p_day
    and b.booking_type in ('user_booking', 'counter')
    and b.status <> 'cancelled'
    and (p_start is null or (b.start_time < p_end and b.end_time > p_start))
    and (p_pitch_id is null
         or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = p_pitch_id));
$$;

-- Internal: why an app booking can't move to these pitches, or null if it
-- can. The pitches must be the venue's, open, make a layout of the same size
-- as the booking's now that hosts its format (one pitch of that size, or a
-- combination for that format; 6 v 6 on a 5-a-side pitch stays on one
-- 5-a-side pitch), differ from where it is, not be blocked and be free.
create or replace function public.booking_move_refusal(p_booking public.venue_bookings, p_pitch_ids uuid[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current uuid[];
  v_size text;
  v_six boolean := p_booking.capacity = 12 and p_booking.format = '5-a-side';
begin
  select coalesce(array_agg(pitch_id), '{}') into v_current from public.booking_pitches where booking_id = p_booking.id;
  if p_pitch_ids is null or cardinality(p_pitch_ids) = 0
     or (select count(distinct x) from unnest(p_pitch_ids) as x) <> cardinality(p_pitch_ids)
     or (select count(*) from public.pitches where id = any (p_pitch_ids) and venue_id = p_booking.venue_id and is_open)
        <> cardinality(p_pitch_ids)
     or (p_pitch_ids @> v_current and p_pitch_ids <@ v_current) then
    return 'invalid_pitches';
  end if;

  -- The size it is played on now: its pitch's, or its combination's format.
  v_size := case when cardinality(v_current) = 1
                 then (select size from public.pitches where id = v_current[1])
                 else p_booking.format end;

  if not (
    (cardinality(p_pitch_ids) = 1 and exists (
       select 1 from public.pitches p
       where p.id = p_pitch_ids[1] and p.size = v_size and p_booking.format = any (p.formats)))
    or (not v_six and v_size = p_booking.format and exists (
       select 1 from public.pitch_combinations c
       where c.venue_id = p_booking.venue_id and c.format = p_booking.format
         and c.pitch_ids @> p_pitch_ids and c.pitch_ids <@ p_pitch_ids))
  ) then
    return 'invalid_pitches';
  end if;

  if public.slot_is_blocked(p_booking.venue_id, p_pitch_ids, p_booking.booking_day,
                            p_booking.start_time, p_booking.end_time) then
    return 'pitch_blocked';
  end if;
  if exists (
    select 1 from public.booking_pitches bp
    join public.venue_bookings o on o.id = bp.booking_id
    where bp.pitch_id = any (p_pitch_ids) and bp.booking_id <> p_booking.id and o.status <> 'cancelled'
      and bp.slot && public.booking_slot_range(p_booking.booking_day, p_booking.start_time, p_booking.end_time)
  ) then
    return 'slot_full';
  end if;
  return null;
end;
$$;

-- Internal: the clash list as the caller (venue staff) sees it, and its
-- quote. Each app booking's venue cancel quote is cancellation_quote's own,
-- so the fee shown is the fee the cancel records.
create or replace function public.block_clashes_internal(
  p_venue_id uuid,
  p_pitch_id uuid,
  p_day date,
  p_start time,
  p_end time
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_booking public.venue_bookings;
  v_started boolean;
  v_item jsonb;
  v_quote jsonb;
  v_items jsonb := '[]'::jsonb;
  v_fee integer := 0;
  v_hash text := concat_ws('|', p_venue_id, p_pitch_id, p_day, p_start, p_end);
  v_moves jsonb;
begin
  foreach v_id in array public.block_clash_booking_ids(p_venue_id, p_pitch_id, p_day, p_start, p_end) loop
    select * into v_booking from public.venue_bookings where id = v_id;
    v_started := now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
    v_item := jsonb_build_object(
      'id', v_booking.id,
      'kind', case v_booking.booking_type when 'user_booking' then 'app' else 'counter' end,
      'start_time', v_booking.start_time,
      'end_time', v_booking.end_time,
      'format', v_booking.format,
      'started', v_started,
      'pitch_ids', coalesce((select jsonb_agg(p.id order by p.sort_order, p.name)
                             from public.booking_pitches bp join public.pitches p on p.id = bp.pitch_id
                             where bp.booking_id = v_booking.id), '[]'::jsonb),
      'pitch_names', coalesce((select jsonb_agg(p.name order by p.sort_order, p.name)
                               from public.booking_pitches bp join public.pitches p on p.id = bp.pitch_id
                               where bp.booking_id = v_booking.id), '[]'::jsonb));

    if v_booking.booking_type = 'counter' then
      v_item := v_item || (
        select jsonb_build_object(
                 'source', c.source,
                 'contact_name', ct.name,
                 'phone', ct.phone,
                 'paid', c.paid_at is not null,
                 'refund_cents', case when c.paid_at is not null then c.charged_cents else 0 end)
        from public.venue_counter_bookings c
        join public.venue_contacts ct on ct.id = c.contact_id
        where c.booking_id = v_booking.id);
      v_hash := v_hash || '|counter:' || v_booking.id || ':' || v_started || ':'
                || coalesce((v_item ->> 'refund_cents'), '0') || ':' || (v_item ->> 'paid');
    else
      v_item := v_item || (
        select jsonb_build_object(
                 'booker_name', public.profile_display_name(v_booking.created_by),
                 'status', v_booking.status,
                 'payment_mode', v_booking.payment_mode,
                 'capacity', v_booking.capacity,
                 -- still in, as everywhere on the dashboard
                 'joined', count(*) filter (where s.status in ('pending', 'authorized', 'paid', 'covered')),
                 'unpaid', count(*) filter (where s.status = 'pending'),
                 'legacy', v_booking.payment_mode is null)
        from public.booking_payment_shares s where s.booking_id = v_booking.id);

      if v_started or v_booking.payment_mode is null then
        v_item := v_item || jsonb_build_object('quote', null, 'venue_stripe_fee_cents', 0);
      else
        v_quote := public.cancellation_quote(v_booking.id, 'venue');
        v_item := v_item || jsonb_build_object(
          'quote', v_quote ->> 'quote',
          'venue_stripe_fee_cents', coalesce((v_quote ->> 'venue_stripe_fee_cents')::integer, 0));
        v_fee := v_fee + coalesce((v_quote ->> 'venue_stripe_fee_cents')::integer, 0);
      end if;

      -- Where it could go: never onto the pitch being blocked (a whole-venue
      -- block leaves nowhere).
      if v_started or p_pitch_id is null then
        v_moves := '[]'::jsonb;
      else
        select coalesce(jsonb_agg(jsonb_build_object(
                 'pitch_ids', to_jsonb(t.pitch_ids),
                 'pitch_names', (select jsonb_agg(p.name order by p.sort_order, p.name)
                                 from public.pitches p where p.id = any (t.pitch_ids)))
               order by t.kind, t.ord), '[]'::jsonb)
        into v_moves
        from (
          select array[p.id] as pitch_ids, 0 as kind, p.sort_order as ord
          from public.pitches p where p.venue_id = p_venue_id
          union all
          select c.pitch_ids, 1,
                 (select min(p.sort_order) from public.pitches p where p.id = any (c.pitch_ids))
          from public.pitch_combinations c where c.venue_id = p_venue_id
        ) t
        where not (p_pitch_id = any (t.pitch_ids))
          and public.booking_move_refusal(v_booking, t.pitch_ids) is null;
      end if;
      v_item := v_item || jsonb_build_object('moves', v_moves);
      v_hash := v_hash || '|app:' || v_booking.id || ':' || v_started || ':' || coalesce(v_item ->> 'quote', '-');
    end if;

    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  return jsonb_build_object(
    'clashes', v_items,
    'venue_stripe_fee_cents', v_fee,
    'quote', md5(v_hash));
end;
$$;

-- Venue staff: what blocking this slot would clash with. Nothing changes.
create or replace function public.venue_block_clashes(
  p_venue_id uuid,
  p_pitch_id uuid,
  p_day date,
  p_start time,
  p_end time
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_pitch_id is not null
     and not exists (select 1 from public.pitches where id = p_pitch_id and venue_id = p_venue_id) then
    raise exception 'invalid_pitches';
  end if;
  if p_day is null or (p_start is null) <> (p_end is null) or p_end <= p_start then
    raise exception 'invalid_block_time';
  end if;
  return public.block_clashes_internal(p_venue_id, p_pitch_id, p_day, p_start, p_end);
end;
$$;

-- Venue staff move an app booking to a free pitch (or combination) of the
-- same size at the same time. Everything else about it stays; everyone in it
-- is told once per move.
create or replace function public.venue_move_booking(p_booking_id uuid, p_pitch_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_refusal text;
  v_venue_name text;
  v_names text;
  v_profile uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- Lock order: check the caller with a plain read first, then lock the
  -- venue (as book_slot does) and the booking.
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if not public.is_venue_staff(v_booking.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  select name into v_venue_name from public.venues where id = v_booking.venue_id for update;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;

  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.booking_type <> 'user_booking' then
    raise exception 'invalid_pitches';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'game_started';
  end if;
  v_refusal := public.booking_move_refusal(v_booking, p_pitch_ids);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  delete from public.booking_pitches where booking_id = p_booking_id;
  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select p_booking_id, unnest(p_pitch_ids),
           public.booking_slot_range(v_booking.booking_day, v_booking.start_time, v_booking.end_time);
  exception when exclusion_violation then
    raise exception 'slot_full';
  end;
  if v_booking.pitches <> cardinality(p_pitch_ids) then
    update public.venue_bookings set pitches = cardinality(p_pitch_ids) where id = p_booking_id;
  end if;

  select string_agg(name, ' + ' order by sort_order, name) into v_names
  from public.pitches where id = any (p_pitch_ids);
  for v_profile in
    select v_booking.created_by
    union
    select s.profile_id from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid', 'covered')
  loop
    continue when v_profile is null;
    perform public.send_notification(v_profile, 'booking_pitch_moved', jsonb_build_object(
      'title', 'Your game moved to ' || v_names,
      'body', format('Your game at %s on %s at %s is now on %s. Everything else stays the same.',
                     v_venue_name, to_char(v_booking.booking_day, 'FMDay DD Mon'),
                     to_char(v_booking.start_time, 'HH24:MI'), v_names),
      'bookingId', p_booking_id,
      'venueId', v_booking.venue_id,
      'pitchIds', to_jsonb(p_pitch_ids)));
  end loop;
end;
$$;

-- Internal: cancels a walk-in or phone booking (the body of
-- cancel_counter_booking, unchanged). The caller has checked who may.
create or replace function public.cancel_counter_booking_internal(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counter public.venue_counter_bookings;
  v_booking public.venue_bookings;
begin
  select * into v_counter from public.venue_counter_bookings where booking_id = p_booking_id for update;
  if v_counter.booking_id is null then
    raise exception 'booking_not_found';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_counter.cancelled_at is not null or v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  if v_booking.booking_day + v_booking.start_time <= (now() at time zone 'Asia/Nicosia') then
    raise exception 'game_started';
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  update public.venue_counter_bookings set cancelled_at = now() where booking_id = p_booking_id;

  if v_counter.paid_at is not null and v_counter.charged_cents > 0 then
    perform public.record_ledger_entry(p_booking_id, null, null, 'counter_paid', v_counter.charged_cents,
                                       'counter_cancel:' || p_booking_id, 'counter_booking_cancelled',
                                       -v_counter.charged_cents, 0, 0);
  end if;
end;
$$;

-- Re-created from 20261113220553_pay_dashboard_counter.sql: the same checks,
-- then the shared body. Same errors in the same order.
create or replace function public.cancel_counter_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counter public.venue_counter_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_counter from public.venue_counter_bookings where booking_id = p_booking_id;
  if v_counter.booking_id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_counter.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  perform public.cancel_counter_booking_internal(p_booking_id);
end;
$$;

-- Venue staff save a block, cancelling whatever still clashes with it.
-- p_expected_quote is venue_block_clashes' quote the staff member confirmed.
create or replace function public.venue_add_block(
  p_venue_id uuid,
  p_pitch_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_reason text,
  p_expected_quote text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_list jsonb;
  v_item jsonb;
  v_cancelled uuid[] := '{}';
  v_call jsonb := '[]'::jsonb;
  v_block_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_pitch_id is not null
     and not exists (select 1 from public.pitches where id = p_pitch_id and venue_id = p_venue_id) then
    raise exception 'invalid_pitches';
  end if;
  if p_day is null or (p_start is null) <> (p_end is null) or p_end <= p_start then
    raise exception 'invalid_block_time';
  end if;
  if p_expected_quote is null then
    raise exception 'quote_required';
  end if;

  -- Lock order: the venue (as book_slot does, so no booking lands in the
  -- slot meanwhile), then the clashing bookings by id.
  perform 1 from public.venues where id = p_venue_id for update;
  v_ids := public.block_clash_booking_ids(p_venue_id, p_pitch_id, p_day, p_start, p_end);
  perform 1 from public.venue_bookings where id = any (v_ids) order by id for update;

  v_list := public.block_clashes_internal(p_venue_id, p_pitch_id, p_day, p_start, p_end);
  if v_list ->> 'quote' is distinct from p_expected_quote then
    raise exception 'clashes_changed';
  end if;
  -- A booking from before P4a has no venue cancel; staff move it or cancel
  -- it from the booking first.
  if exists (select 1 from jsonb_array_elements(v_list -> 'clashes') c
             where c ->> 'kind' = 'app' and not (c ->> 'started')::boolean and (c ->> 'legacy')::boolean) then
    raise exception 'legacy_booking';
  end if;

  for v_item in select * from jsonb_array_elements(v_list -> 'clashes') loop
    continue when (v_item ->> 'started')::boolean;
    if v_item ->> 'kind' = 'app' then
      perform public.cancel_booking_internal((v_item ->> 'id')::uuid, 'venue', v_uid, v_item ->> 'quote');
    else
      perform public.cancel_counter_booking_internal((v_item ->> 'id')::uuid);
      v_call := v_call || jsonb_build_array(jsonb_build_object(
        'booking_id', v_item -> 'id',
        'source', v_item -> 'source',
        'contact_name', v_item -> 'contact_name',
        'phone', v_item -> 'phone',
        'start_time', v_item -> 'start_time',
        'refund_cents', v_item -> 'refund_cents'));
    end if;
    v_cancelled := v_cancelled || (v_item ->> 'id')::uuid;
  end loop;

  -- The slot is blocked, not freed: no saved-search alert for these cancels.
  delete from public.saved_search_events
  where kind = 'booking_cancelled' and booking_id = any (v_cancelled) and processed_at is null;

  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at, reason, created_by)
  values (p_venue_id, p_pitch_id, p_day, p_start, p_end, nullif(btrim(p_reason), ''), v_uid)
  returning id into v_block_id;

  return jsonb_build_object(
    'block_id', v_block_id,
    'cancelled', cardinality(v_cancelled),
    'call_them', v_call);
end;
$$;

-- Re-created from 20261109122123_pay_venue_model_fixes.sql. Only change: a
-- game that has kicked off isn't told (it stays on, and nothing about new
-- bookings concerns it). Moved games are no longer on the pitch and cancelled
-- ones were already left out, so nobody gets this as well as being moved or
-- cancelled.
create or replace function public.notify_venue_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_name text;
  v_row record;
begin
  select name into v_venue_name from public.venues where id = new.venue_id;

  for v_row in
    select distinct on (b.id, player.profile_id) b.id as booking_id, b.booking_day, b.start_time, player.profile_id
    from public.venue_bookings b
    cross join lateral (
      select b.created_by as profile_id
      union
      select s.profile_id from public.booking_payment_shares s where s.booking_id = b.id
    ) as player
    where b.venue_id = new.venue_id
      and b.booking_day = new.block_day
      and b.booking_type = 'user_booking'
      and b.status <> 'cancelled'
      and (new.starts_at is null or (b.start_time < new.ends_at and b.end_time > new.starts_at))
      and (new.pitch_id is null
           or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = new.pitch_id))
      -- Not a game that has kicked off.
      and public.booking_kickoff_at(b.booking_day, b.start_time) > now()
      and player.profile_id is not null
      -- Already told about this block for this game.
      and not exists (
        select 1 from public.notifications n
        where n.profile_id = player.profile_id
          and n.type = 'venue_closed_new_bookings'
          and n.data ->> 'blockId' = new.id::text
          and n.data ->> 'bookingId' = b.id::text
      )
  loop
    perform public.send_notification(
      v_row.profile_id,
      'venue_closed_new_bookings',
      jsonb_build_object(
        'title', coalesce(v_venue_name, 'The venue') || ' has closed new bookings',
        'body', 'Your game on ' || to_char(v_row.booking_day, 'FMDay FMDD FMMonth') || ' at '
                || to_char(v_row.start_time, 'HH24:MI') || ' is still on.',
        'bookingId', v_row.booking_id,
        'venueId', new.venue_id,
        'blockId', new.id
      )
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.notify_venue_block() from public, anon, authenticated;

revoke all on function public.block_clash_booking_ids(uuid, uuid, date, time, time) from public, anon, authenticated;
grant execute on function public.block_clash_booking_ids(uuid, uuid, date, time, time) to service_role;
revoke all on function public.booking_move_refusal(public.venue_bookings, uuid[]) from public, anon, authenticated;
grant execute on function public.booking_move_refusal(public.venue_bookings, uuid[]) to service_role;
revoke all on function public.block_clashes_internal(uuid, uuid, date, time, time) from public, anon, authenticated;
grant execute on function public.block_clashes_internal(uuid, uuid, date, time, time) to service_role;
revoke all on function public.cancel_counter_booking_internal(uuid) from public, anon, authenticated;
grant execute on function public.cancel_counter_booking_internal(uuid) to service_role;

revoke all on function public.venue_block_clashes(uuid, uuid, date, time, time) from public, anon;
grant execute on function public.venue_block_clashes(uuid, uuid, date, time, time) to authenticated, service_role;
revoke all on function public.venue_move_booking(uuid, uuid[]) from public, anon;
grant execute on function public.venue_move_booking(uuid, uuid[]) to authenticated, service_role;
revoke all on function public.venue_add_block(uuid, uuid, date, time, time, text, text) from public, anon;
grant execute on function public.venue_add_block(uuid, uuid, date, time, time, text, text) to authenticated, service_role;
