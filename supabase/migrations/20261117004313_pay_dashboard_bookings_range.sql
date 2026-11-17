-- The bookings list's longest range (docs/specs/13-payments-bookings.md
-- "Venue dashboard", Bookings list; decided 14 November, Dimitris): at most
-- 31 days, both ends counted. A query limit for the dashboard list, not a
-- booking rule, so it isn't in app_rules. The app refuses a longer range
-- before asking (lib/venue-money.ts MAX_RANGE_DAYS); the server refuses it
-- too, with range_too_long. Otherwise as in 20261113235806_pay_dashboard_people.

-- The venue's app, walk-in and phone bookings from p_from to p_to (booking
-- days, inclusive), never an owner's training block. p_source: app,
-- walk_in or phone; p_status: pending_payment, confirmed or cancelled.
create or replace function public.venue_bookings_list(
  p_venue_id uuid,
  p_from date,
  p_to date,
  p_source text default null,
  p_status text default null
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
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid_range';
  end if;
  -- At most 31 days, both ends counted.
  if p_to - p_from + 1 > 31 then
    raise exception 'range_too_long';
  end if;
  if p_source is not null and p_source not in ('app', 'walk_in', 'phone') then
    raise exception 'invalid_source';
  end if;
  if p_status is not null and p_status not in ('pending_payment', 'confirmed', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  return coalesce((
    select jsonb_agg(t.item order by t.booking_day, t.start_time, t.id)
    from (
      select b.id, b.booking_day, b.start_time,
             jsonb_build_object(
               'id', b.id,
               'source', coalesce(c.source, 'app'),
               'status', b.status,
               'booking_day', b.booking_day,
               'start_time', b.start_time,
               'end_time', b.end_time,
               'format', b.format,
               'capacity', b.capacity,
               'pitch_ids', coalesce((select jsonb_agg(bp.pitch_id) from public.booking_pitches bp
                                      where bp.booking_id = b.id), '[]'::jsonb))
             || case
                  when b.booking_type = 'counter' then jsonb_build_object(
                    'name', ct.name,
                    'phone', ct.phone,
                    'contact_id', ct.id,
                    'venue_price_cents', c.venue_price_cents,
                    'charged_cents', c.charged_cents,
                    'paid_method', c.paid_method,
                    'paid_at', c.paid_at)
                  else jsonb_build_object(
                    'name', public.profile_display_name(b.created_by),
                    'payment_mode', b.payment_mode,
                    -- still in, as cancellation_plan counts them
                    'joined', (select count(*) from public.booking_payment_shares s
                               where s.booking_id = b.id and s.status in ('pending', 'authorized', 'paid', 'covered')))
                end as item
      from public.venue_bookings b
      left join public.venue_counter_bookings c on c.booking_id = b.id
      left join public.venue_contacts ct on ct.id = c.contact_id
      where b.venue_id = p_venue_id
        and b.booking_type in ('user_booking', 'counter')
        and b.booking_day between p_from and p_to
        and (p_source is null or coalesce(c.source, 'app') = p_source)
        and (p_status is null or b.status = p_status)
    ) t), '[]'::jsonb);
end;
$$;

revoke all on function public.venue_bookings_list(uuid, date, date, text, text) from public, anon;
grant execute on function public.venue_bookings_list(uuid, date, date, text, text) to authenticated, service_role;
