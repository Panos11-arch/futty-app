-- P6b: revenue by source and its CSV rows (docs/specs/13-payments-
-- bookings.md "Venue dashboard", Revenue (P6b); 14 P6, added 11 November).
-- Only the venue's own staff.
--
-- Read from money_ledger, never worked out again:
--   dated     by when the money moved (created_at), as a Cyprus date; a day,
--             a Monday-to-Sunday week, or a calendar month
--   revenue   venue_cents, never amount_cents (a reversal has a positive
--             amount and a negative venue_cents)
--   fees      Futty's (futty_cents) and Stripe's (stripe_fee_cents) as the
--             ledger has them, shown separately
--   sources   (decided 13 November, Dimitris; for Panos to confirm)
--             app_card  every row that went through Stripe or moves money
--                       between Futty and the venue: capture, refund,
--                       transfer, venue_payable
--             app_cash  cash_received (ticked cash and its reversal),
--                       debt_cash_received (a debt settled at the venue) and
--                       Futty's part of that debt (venue_payable
--                       venue_settled_debt_fee), so a settled €6.80 debt
--                       nets to €6.00 here
--             walk_in, phone  counter_paid, by the walk-in's source
-- Rows that move no money (holds, credit and debt records) are left out.
-- venue_revenue totals venue_revenue_rows, so the screen and the CSV are
-- always the same rows with the same totals.

-- Internal: the dates a period covers, both inclusive.
create or replace function public.revenue_period(p_period text, p_day date, out from_day date, out to_day date)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_period is null or p_period not in ('day', 'week', 'month') then
    raise exception 'invalid_period';
  end if;
  if p_day is null then
    raise exception 'invalid_day';
  end if;
  -- date_trunc('week') starts weeks on Monday.
  from_day := date_trunc(p_period, p_day)::date;
  to_day := (date_trunc(p_period, p_day) + ('1 ' || p_period)::interval)::date - 1;
end;
$$;

revoke all on function public.revenue_period(text, date) from public, anon, authenticated;
grant execute on function public.revenue_period(text, date) to service_role;

-- Every money row of the venue in the period, oldest first: the CSV.
--   moved_on, moved_at  when the money moved, Cyprus date and HH:MM
--   who                 the player (their display name) or the walk-in's
--                       contact name
--   venue_price_cents, charged_cents  walk-in and phone rows only: the
--                       venue's price for the slot and what staff charged
create or replace function public.venue_revenue_rows(p_venue_id uuid, p_period text, p_day date)
returns table (
  ledger_id uuid,
  moved_on date,
  moved_at text,
  source text,
  kind text,
  reason text,
  booking_id uuid,
  booking_day date,
  start_time time,
  who text,
  venue_cents integer,
  futty_cents integer,
  stripe_fee_cents integer,
  venue_price_cents integer,
  charged_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  select r.from_day, r.to_day into v_from, v_to from public.revenue_period(p_period, p_day) r;

  return query
  select l.id,
         (l.created_at at time zone 'Asia/Nicosia')::date,
         to_char(l.created_at at time zone 'Asia/Nicosia', 'HH24:MI'),
         case
           when l.kind = 'counter_paid' then c.source
           when l.kind in ('cash_received', 'debt_cash_received') then 'app_cash'
           when l.kind = 'venue_payable' and l.reason = 'venue_settled_debt_fee' then 'app_cash'
           else 'app_card'
         end,
         l.kind,
         l.reason,
         l.booking_id,
         b.booking_day,
         b.start_time,
         case
           when l.kind = 'counter_paid' then ct.name
           else public.profile_display_name(coalesce(s.profile_id, d.profile_id, g.profile_id, b.created_by))
         end,
         l.venue_cents,
         l.futty_cents,
         l.stripe_fee_cents,
         case when l.kind = 'counter_paid' then c.venue_price_cents end,
         case when l.kind = 'counter_paid' then c.charged_cents end
  from public.money_ledger l
  join public.venue_bookings b on b.id = l.booking_id
  left join public.venue_counter_bookings c on c.booking_id = l.booking_id
  left join public.venue_contacts ct on ct.id = c.contact_id
  left join public.booking_payment_shares s on s.id = l.share_id
  left join public.venue_debts d on d.id = l.debt_id
  left join public.booking_guarantees g on g.id = l.guarantee_id
  where b.venue_id = p_venue_id
    and l.kind in ('capture', 'refund', 'transfer', 'venue_payable', 'cash_received', 'counter_paid',
                   'debt_cash_received')
    and (l.created_at at time zone 'Asia/Nicosia')::date between v_from and v_to
  order by l.created_at, l.id;
end;
$$;

-- Revenue by source for the screen: each source's venue, Futty and Stripe
-- cents and row count (all four sources, in order), the totals, and the
-- walk-ins paid in the period at a price other than the venue's.
create or replace function public.venue_revenue(p_venue_id uuid, p_period text, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  select r.from_day, r.to_day into v_from, v_to from public.revenue_period(p_period, p_day) r;

  return (
    with rows as (
      select * from public.venue_revenue_rows(p_venue_id, p_period, p_day)
    )
    select jsonb_build_object(
      'period', p_period,
      'from', v_from,
      'to', v_to,
      'sources', (
        select jsonb_agg(t.item order by t.ord)
        from (
          select src.ord, jsonb_build_object(
                   'source', src.source,
                   'venue_cents', coalesce(sum(r.venue_cents), 0)::integer,
                   'futty_cents', coalesce(sum(r.futty_cents), 0)::integer,
                   'stripe_fee_cents', coalesce(sum(r.stripe_fee_cents), 0)::integer,
                   'rows', count(r.ledger_id)::integer) as item
          from unnest(array['app_card', 'app_cash', 'walk_in', 'phone']) with ordinality as src (source, ord)
          left join rows r on r.source = src.source
          group by src.source, src.ord
        ) t),
      'totals', (
        select jsonb_build_object(
                 'venue_cents', coalesce(sum(r.venue_cents), 0)::integer,
                 'futty_cents', coalesce(sum(r.futty_cents), 0)::integer,
                 'stripe_fee_cents', coalesce(sum(r.stripe_fee_cents), 0)::integer,
                 'rows', count(*)::integer)
        from rows r),
      'overrides', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'booking_id', r.booking_id,
                 'source', r.source,
                 'contact_name', r.who,
                 'booking_day', r.booking_day,
                 'start_time', r.start_time,
                 'moved_on', r.moved_on,
                 'venue_price_cents', r.venue_price_cents,
                 'charged_cents', r.charged_cents)
               order by r.moved_on, r.moved_at, r.ledger_id)
        from rows r
        where r.kind = 'counter_paid' and r.venue_cents > 0
          and r.charged_cents is distinct from r.venue_price_cents), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.venue_revenue_rows(uuid, text, date) from public, anon;
grant execute on function public.venue_revenue_rows(uuid, text, date) to authenticated, service_role;
revoke all on function public.venue_revenue(uuid, text, date) from public, anon;
grant execute on function public.venue_revenue(uuid, text, date) to authenticated, service_role;
