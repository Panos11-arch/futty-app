-- P6b: revenue by source and its CSV export (docs/specs/13-payments-
-- bookings.md "Venue dashboard", Revenue (P6b); 14 P6, added 11 November).
-- Only the venue's own staff.
--
-- Read from money_ledger, never worked out again:
--   dated     by when the money moved (created_at), as a Cyprus date; a day,
--             a Monday-to-Sunday week, or a calendar month. The period is
--             turned into timestamptz bounds (Cyprus midnights), so the
--             ledger's created_at index can be used.
--   revenue   venue_cents, never amount_cents (a reversal has a positive
--             amount and a negative venue_cents)
--   fees      Futty's (futty_cents) and Stripe's (stripe_fee_cents) columns
--             as the ledger has them, shown separately
--   sources   (decided 13 November, Dimitris; for Panos to confirm)
--             app_card  every row that went through Stripe or moves money
--                       between Futty and the venue: capture, refund,
--                       transfer, venue_payable
--             app_cash  cash_received (ticked cash and its reversal),
--                       debt_cash_received (a debt settled at the venue) and
--                       Futty's part of that debt (venue_payable
--                       venue_settled_debt_fee), so a settled €6.80 debt
--                       nets to €6.00 here
--             walk_in, phone  counter_paid, by the walk-in's source. A
--                       counter_paid row needs a walk-in or phone booking
--                       (refused when written; a read that finds one without
--                       fails, never showing it under no source).
--   who       the player whose share, debt or guarantee it is, or the
--             walk-in's contact; null for venue-level money.
-- Rows that move no money (holds, credit and debt records) are left out.
-- The screen (venue_revenue) and the CSV (venue_revenue_export: the rows,
-- each source's totals and the totals, in one response) are built by the
-- same internal function in one statement, so they are always the same
-- rows with the same totals.
-- Overrides (walk-ins and phone bookings charged other than the venue's
-- price) are read from venue_counter_bookings, dated by when they were
-- marked paid, so a free one (no money, no ledger row) is shown too.

create index money_ledger_created_idx on public.money_ledger (created_at);

-- A counter_paid row belongs to a walk-in or phone booking. After the row
-- is written, so a row of the wrong shape still fails money_ledger_split_check
-- first.
create or replace function public.money_ledger_counter_paid_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.venue_counter_bookings c where c.booking_id = new.booking_id) then
    raise exception 'counter_paid_needs_counter_booking';
  end if;
  return new;
end;
$$;

revoke all on function public.money_ledger_counter_paid_check() from public, anon, authenticated;

create trigger money_ledger_counter_paid_check
  after insert or update on public.money_ledger
  for each row when (new.kind = 'counter_paid')
  execute function public.money_ledger_counter_paid_check();

-- Internal: the dates a period covers, both inclusive. Stable, not
-- immutable: date_trunc on a date goes through timestamptz, which depends
-- on the session's time zone.
create or replace function public.revenue_period(p_period text, p_day date, out from_day date, out to_day date)
language plpgsql
stable
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

-- Internal: every money row of the venue that moved in [p_from, p_to),
-- oldest first.
--   moved_on, moved_at  when the money moved, Cyprus date and HH:MM
--   who                 the player (their display name) or the walk-in's
--                       contact name; null for venue-level money
--   venue_price_cents, charged_cents  walk-in and phone rows only: the
--                       venue's price for the slot and what staff charged
create or replace function public.revenue_rows(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
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
begin
  if exists (select 1 from public.money_ledger l
             join public.venue_bookings b on b.id = l.booking_id
             where b.venue_id = p_venue_id and l.kind = 'counter_paid'
               and l.created_at >= p_from and l.created_at < p_to
               and not exists (select 1 from public.venue_counter_bookings c where c.booking_id = l.booking_id)) then
    raise exception 'counter_paid_without_source';
  end if;

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
           when coalesce(s.profile_id, d.profile_id, g.profile_id) is not null
             then public.profile_display_name(coalesce(s.profile_id, d.profile_id, g.profile_id))
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
    and l.created_at >= p_from and l.created_at < p_to
  order by l.created_at, l.id;
end;
$$;

revoke all on function public.revenue_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.revenue_rows(uuid, timestamptz, timestamptz) to service_role;

-- Internal: the period's revenue in one statement. Always: period, from,
-- to, each source's venue, Futty and Stripe cents and row count (all four
-- sources, in order) and the totals. With p_export, the rows (the CSV);
-- without, the overrides (the screen).
create or replace function public.revenue_report(p_venue_id uuid, p_period text, p_day date, p_export boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  select r.from_day, r.to_day into v_from, v_to from public.revenue_period(p_period, p_day) r;
  -- Cyprus midnight at the start of the first day, and after the last.
  v_from_ts := v_from::timestamp at time zone 'Asia/Nicosia';
  v_to_ts := (v_to + 1)::timestamp at time zone 'Asia/Nicosia';

  return (
    with rows as (
      select * from public.revenue_rows(p_venue_id, v_from_ts, v_to_ts) with ordinality
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
        from rows r))
    || case
         when p_export then jsonb_build_object('rows', coalesce((
           select jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality) from rows r), '[]'::jsonb))
         else jsonb_build_object('overrides', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'booking_id', c.booking_id,
                    'source', c.source,
                    'contact_name', ct.name,
                    'booking_day', b.booking_day,
                    'start_time', b.start_time,
                    'moved_on', (c.paid_at at time zone 'Asia/Nicosia')::date,
                    'venue_price_cents', c.venue_price_cents,
                    'charged_cents', c.charged_cents)
                  order by c.paid_at, c.booking_id)
           from public.venue_counter_bookings c
           join public.venue_bookings b on b.id = c.booking_id
           join public.venue_contacts ct on ct.id = c.contact_id
           where c.venue_id = p_venue_id
             and c.paid_at >= v_from_ts and c.paid_at < v_to_ts
             and c.charged_cents is distinct from c.venue_price_cents), '[]'::jsonb))
       end
  );
end;
$$;

revoke all on function public.revenue_report(uuid, text, date, boolean) from public, anon, authenticated;
grant execute on function public.revenue_report(uuid, text, date, boolean) to service_role;

-- Revenue by source for the screen: each source's totals, the totals, and
-- the walk-ins and phone bookings paid in the period at a price other than
-- the venue's (a free one included).
create or replace function public.venue_revenue(p_venue_id uuid, p_period text, p_day date)
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
  return public.revenue_report(p_venue_id, p_period, p_day, false);
end;
$$;

-- The CSV: every money row of the period, oldest first, with each source's
-- totals and the totals, from one snapshot (lib/money/revenue-csv.ts).
create or replace function public.venue_revenue_export(p_venue_id uuid, p_period text, p_day date)
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
  return public.revenue_report(p_venue_id, p_period, p_day, true);
end;
$$;

revoke all on function public.venue_revenue(uuid, text, date) from public, anon;
grant execute on function public.venue_revenue(uuid, text, date) to authenticated, service_role;
revoke all on function public.venue_revenue_export(uuid, text, date) from public, anon;
grant execute on function public.venue_revenue_export(uuid, text, date) to authenticated, service_role;
