-- One customer's page (docs/specs/13-payments-bookings.md "Venue dashboard",
-- Customers), as in 20261113235806_pay_dashboard_people, plus two states the
-- app shows and must not work out itself:
--   bookings[].cash_received  a cash player's cash part: true once the
--                             venue has it (ticked, or paid by card after
--                             the match, as the booking screens count it),
--                             false until then; null for a card player or a
--                             game without a share
--   credits[].expired         the credit's expiry has passed, so "Used up"
--                             (spent, not expired) and "Expired" differ

-- One customer of the venue (p_kind player or contact), with their
-- bookings here and, for a player, their debts (open and settled) and
-- credits here. Anyone else: customer_not_found.
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
               'cash_received', case when s.payment_method = 'cash' then s.cash_received_at is not null end)
             order by b.booking_day desc, b.start_time desc, b.id)
      from public.venue_bookings b
      -- Their share in it, or none: a game they booked with no share (free).
      left join public.booking_payment_shares s on s.booking_id = b.id and s.profile_id = p_id
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

revoke all on function public.venue_customer(uuid, text, uuid) from public, anon;
grant execute on function public.venue_customer(uuid, text, uuid) to authenticated, service_role;
