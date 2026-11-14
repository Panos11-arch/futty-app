-- P6b: the venue's bookings, customers, debt and credit (docs/specs/14 P6,
-- added 11 November; docs/specs/13-payments-bookings.md "Cash, debt and
-- venue credit", "Venue dashboard"). Only the venue's own staff.
--
-- Customers (decided 13 and 14 November, Dimitris; for Panos to confirm):
--   players   anyone with a share, debt or credit at this venue, or who
--             booked a game here (a free game has no shares), shown by name
--             only (profile_display_name), never email or phone, with their
--             bookings, debt and credit at this venue
--   contacts  the venue's walk-in and phone customers (venue_contacts), with
--             the name and phone staff entered
-- A customer's booking count and last booking day are the bookings still
-- on: for a player, a game they're still in (a pending, authorized, paid or
-- covered share, as the cancellation rules count it) or, with no share,
-- a game they booked that isn't cancelled; for a contact, a walk-in or
-- phone booking that isn't cancelled.
-- Debt at a venue is what's owed to that venue (owed_to 'venue'); a debt
-- owed to Futty isn't the venue's. Credit available is what my_credit
-- counts: not expired, something left.

-- Internal: is this player a customer of this venue?
create or replace function public.venue_has_customer(p_venue_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.booking_payment_shares s
                 join public.venue_bookings b on b.id = s.booking_id
                 where s.profile_id = p_profile_id and b.venue_id = p_venue_id)
      or exists (select 1 from public.venue_debts d
                 where d.profile_id = p_profile_id and d.owed_to = 'venue' and d.venue_id = p_venue_id)
      or exists (select 1 from public.venue_credits c
                 where c.profile_id = p_profile_id and c.venue_id = p_venue_id)
      or exists (select 1 from public.venue_bookings b
                 where b.created_by = p_profile_id and b.venue_id = p_venue_id and b.booking_type = 'user_booking');
$$;

revoke all on function public.venue_has_customer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.venue_has_customer(uuid, uuid) to service_role;

-- Internal: the player's bookings still on at this venue (see above).
create or replace function public.venue_player_bookings_on(p_venue_id uuid, p_profile_id uuid)
returns table (booking_id uuid, booking_day date)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.booking_day
  from public.venue_bookings b
  where b.venue_id = p_venue_id and b.booking_type = 'user_booking' and b.status <> 'cancelled'
    and (exists (select 1 from public.booking_payment_shares s
                 where s.booking_id = b.id and s.profile_id = p_profile_id
                   and s.status in ('pending', 'authorized', 'paid', 'covered'))
         or (b.created_by = p_profile_id
             and not exists (select 1 from public.booking_payment_shares s
                             where s.booking_id = b.id and s.profile_id = p_profile_id)));
$$;

revoke all on function public.venue_player_bookings_on(uuid, uuid) from public, anon, authenticated;
grant execute on function public.venue_player_bookings_on(uuid, uuid) to service_role;

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

-- Everyone who's a customer of the venue: players (name, bookings, last
-- booking day, open debt and available credit here) and contacts (name,
-- phone, bookings, last booking day). By name.
create or replace function public.venue_customers(p_venue_id uuid)
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

  return coalesce((
    select jsonb_agg(t.item order by lower(t.item ->> 'name'), t.item ->> 'kind', t.id)
    from (
      select p.profile_id as id,
             jsonb_build_object(
               'kind', 'player',
               'profile_id', p.profile_id,
               'name', public.profile_display_name(p.profile_id),
               'bookings', on_.n,
               'last_booking_day', on_.last_day,
               'debt_cents', (select coalesce(sum(d.amount_cents), 0) from public.venue_debts d
                              where d.profile_id = p.profile_id and d.owed_to = 'venue' and d.venue_id = p_venue_id
                                and d.settled_at is null),
               'credit_cents', (select coalesce(sum(c.remaining_cents), 0) from public.venue_credits c
                                where c.profile_id = p.profile_id and c.venue_id = p_venue_id
                                  and c.expires_at > now() and c.remaining_cents > 0)) as item
      from (
        select s.profile_id from public.booking_payment_shares s
        join public.venue_bookings b on b.id = s.booking_id
        where b.venue_id = p_venue_id
        union
        select d.profile_id from public.venue_debts d where d.owed_to = 'venue' and d.venue_id = p_venue_id
        union
        select c.profile_id from public.venue_credits c where c.venue_id = p_venue_id
        union
        select b.created_by from public.venue_bookings b
        where b.venue_id = p_venue_id and b.booking_type = 'user_booking' and b.created_by is not null
      ) p
      cross join lateral (select count(*)::integer as n, max(o.booking_day) as last_day
                          from public.venue_player_bookings_on(p_venue_id, p.profile_id) o) on_
      union all
      select ct.id,
             jsonb_build_object(
               'kind', 'contact',
               'contact_id', ct.id,
               'name', ct.name,
               'phone', ct.phone,
               'bookings', (select count(*) from public.venue_counter_bookings c
                            join public.venue_bookings b on b.id = c.booking_id
                            where c.contact_id = ct.id and b.status <> 'cancelled'),
               'last_booking_day', (select max(b.booking_day) from public.venue_counter_bookings c
                                    join public.venue_bookings b on b.id = c.booking_id
                                    where c.contact_id = ct.id and b.status <> 'cancelled'))
      from public.venue_contacts ct
      where ct.venue_id = p_venue_id
    ) t), '[]'::jsonb);
end;
$$;

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
               'cash_cents', s.cash_cents)
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
               'available', c.expires_at > now() and c.remaining_cents > 0)
             order by c.expires_at desc, c.id)
      from public.venue_credits c
      where c.profile_id = p_id and c.venue_id = p_venue_id), '[]'::jsonb));
end;
$$;

-- Debts owed to the venue, oldest first: open ones, and settled ones too
-- when p_include_settled.
create or replace function public.venue_debt_list(p_venue_id uuid, p_include_settled boolean default false)
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'debt_id', d.id,
             'profile_id', d.profile_id,
             'name', public.profile_display_name(d.profile_id),
             'booking_id', d.booking_id,
             'booking_day', b.booking_day,
             'start_time', b.start_time,
             'amount_cents', d.amount_cents,
             'venue_cents', d.venue_cents,
             'futty_cents', d.futty_cents,
             'reason', d.reason,
             'created_at', d.created_at,
             'settled_at', d.settled_at,
             'settled_by', d.settled_by)
           order by d.created_at, d.id)
    from public.venue_debts d
    left join public.venue_bookings b on b.id = d.booking_id
    where d.owed_to = 'venue' and d.venue_id = p_venue_id
      and (coalesce(p_include_settled, false) or d.settled_at is null)), '[]'::jsonb);
end;
$$;

-- Each player's credit still available at the venue, with each credit's
-- expiry (soonest first), by name.
create or replace function public.venue_credit_list(p_venue_id uuid)
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', t.profile_id,
             'name', t.name,
             'available_cents', t.available_cents,
             'credits', t.credits)
           order by lower(t.name), t.profile_id)
    from (
      select c.profile_id, public.profile_display_name(c.profile_id) as name,
             sum(c.remaining_cents)::integer as available_cents,
             jsonb_agg(jsonb_build_object('credit_id', c.id, 'remaining_cents', c.remaining_cents,
                                          'expires_at', c.expires_at)
                       order by c.expires_at, c.id) as credits
      from public.venue_credits c
      where c.venue_id = p_venue_id and c.expires_at > now() and c.remaining_cents > 0
      group by c.profile_id
    ) t), '[]'::jsonb);
end;
$$;

revoke all on function public.venue_bookings_list(uuid, date, date, text, text) from public, anon;
grant execute on function public.venue_bookings_list(uuid, date, date, text, text) to authenticated, service_role;
revoke all on function public.venue_customers(uuid) from public, anon;
grant execute on function public.venue_customers(uuid) to authenticated, service_role;
revoke all on function public.venue_customer(uuid, text, uuid) from public, anon;
grant execute on function public.venue_customer(uuid, text, uuid) to authenticated, service_role;
revoke all on function public.venue_debt_list(uuid, boolean) from public, anon;
grant execute on function public.venue_debt_list(uuid, boolean) to authenticated, service_role;
revoke all on function public.venue_credit_list(uuid) from public, anon;
grant execute on function public.venue_credit_list(uuid) to authenticated, service_role;
