-- P6a: the 6 v 6 setting and what the dashboard's Today screen reads
-- (docs/specs/05-product.md section 12, launch items 1 and 11a;
-- docs/specs/13-payments-bookings.md "Cash at the venue", "6 v 6 on a
-- 5-a-side pitch"). Only the venue's own staff.

-- "Allow 6 v 6 on 5-a-side pitches". Games already booked keep their
-- format: the setting is checked only when booking (booking_slot_checked).
create or replace function public.set_venue_allows_6v6(p_venue_id uuid, p_allowed boolean)
returns void
language plpgsql
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
  if p_allowed is null then
    raise exception 'invalid_setting';
  end if;
  update public.venues set allows_6v6_on_5s = p_allowed where id = p_venue_id;
end;
$$;

-- One day at the venue, per pitch: every game, walk-in and owner block
-- (not cancelled) with the pitches it holds, the venue's blocks, and the
-- condition flags still up.
create or replace function public.venue_day_board(p_venue_id uuid, p_day date)
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

  return jsonb_build_object(
    'venue_id', p_venue_id,
    'day', p_day,
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'size', p.size, 'formats', p.formats,
                                          'is_open', p.is_open) order by p.sort_order, p.name)
      from public.pitches p where p.venue_id = p_venue_id), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', b.id,
                 'kind', case b.booking_type when 'user_booking' then 'app' else b.booking_type end,
                 'status', b.status,
                 'start_time', b.start_time,
                 'end_time', b.end_time,
                 'format', b.format,
                 'capacity', b.capacity,
                 'note', b.note,
                 'pitch_ids', coalesce((select jsonb_agg(bp.pitch_id) from public.booking_pitches bp
                                        where bp.booking_id = b.id), '[]'::jsonb))
               || case
                    when b.booking_type = 'user_booking' then (
                      select jsonb_build_object(
                               'booker_name', public.profile_display_name(b.created_by),
                               'payment_mode', b.payment_mode,
                               -- still in, as cancellation_plan counts them
                               'joined', count(*) filter (where s.status in ('pending', 'authorized', 'paid', 'covered')),
                               'unpaid', count(*) filter (where s.status = 'pending'),
                               'cash_to_tick', count(*) filter (where s.payment_method = 'cash'
                                                                and s.cash_received_at is null
                                                                -- the statuses mark_cash_received accepts
                                                                and s.status in ('pending', 'authorized', 'paid')))
                      from public.booking_payment_shares s where s.booking_id = b.id)
                    when b.booking_type = 'counter' then (
                      select jsonb_build_object(
                               'source', c.source,
                               'contact_name', ct.name,
                               'venue_price_cents', c.venue_price_cents,
                               'charged_cents', c.charged_cents,
                               'paid_method', c.paid_method)
                      from public.venue_counter_bookings c
                      join public.venue_contacts ct on ct.id = c.contact_id
                      where c.booking_id = b.id)
                    else '{}'::jsonb
                  end
               order by b.start_time, b.id)
      from public.venue_bookings b
      where b.venue_id = p_venue_id and b.booking_day = p_day and b.status <> 'cancelled'), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', vb.id, 'pitch_id', vb.pitch_id, 'starts_at', vb.starts_at,
                                          'ends_at', vb.ends_at, 'reason', vb.reason)
                       order by vb.starts_at nulls first, vb.created_at)
      from public.venue_blocks vb where vb.venue_id = p_venue_id and vb.block_day = p_day), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'pitch_id', f.pitch_id, 'starts_at', f.starts_at,
                                          'ends_at', f.ends_at, 'note', f.note)
                       order by f.starts_at nulls first, f.created_at)
      from public.venue_condition_flags f
      where f.venue_id = p_venue_id and f.flag_day = p_day and f.cleared_at is null), '[]'::jsonb)
  );
end;
$$;

-- One booking's roster for its venue's staff. An app game: every player
-- still in it, their payment choice and state (the same states as
-- booking_detail: in_app, cash, cash_paid, unpaid, covered), their amounts
-- and whether they've checked in, and whether collection can be run early
-- (decided 10 November: once the match has ended). A walk-in or phone
-- booking: its customer and payment.
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

revoke all on function public.set_venue_allows_6v6(uuid, boolean) from public, anon;
grant execute on function public.set_venue_allows_6v6(uuid, boolean) to authenticated, service_role;
revoke all on function public.venue_day_board(uuid, date) from public, anon;
grant execute on function public.venue_day_board(uuid, date) to authenticated, service_role;
revoke all on function public.venue_booking_roster(uuid) from public, anon;
grant execute on function public.venue_booking_roster(uuid) to authenticated, service_role;
