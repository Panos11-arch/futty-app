-- P6d follow-up: the payouts CSV (docs/specs/13-payments-bookings.md "Venue
-- dashboard", The CSV, the payouts CSV), next to the revenue CSV, so a
-- venue's owner can match Futty's transfers against their Stripe Express
-- dashboard. Only the venue's owner.
--
-- Read from venue_payouts and venue_payout_items, never worked out again:
--   dated     by sent_at, as a Cyprus date and HH:MM, in the same day,
--             Monday-to-Sunday week or calendar month as the revenue CSV
--             (revenue_period). A reversed payout stays in the period it
--             was sent in.
--   which     sent and reversed payouts. Pending ones (not sent yet) are
--             left out; the Payouts screen shows them. A partially reversed
--             payout is still 'sent' (payout_reversed sets 'reversed' only
--             on a full reversal) and shows as sent, as on that screen.
--   rows      one per payout and booking: what that payout sent for the
--             booking (the sum of its items' venue_cents, released items of
--             a reversed payout included), the same figure as the Payouts
--             screen's this_payout_cents. Sent order, then kickoff.
--   payouts   each payout's total (venue_payouts.amount_cents) and status.
--   totals    the period's total sent (payouts still 'sent') and total
--             reversed (payouts 'reversed'), and the number of rows.
-- One statement, so the rows and totals are one snapshot; the app checks
-- the totals against the rows (lib/money/payouts-csv.ts).

create or replace function public.venue_payouts_export(p_venue_id uuid, p_period text, p_day date)
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
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  select r.from_day, r.to_day into v_from, v_to from public.revenue_period(p_period, p_day) r;
  -- Cyprus midnight at the start of the first day, and after the last.
  v_from_ts := v_from::timestamp at time zone 'Asia/Nicosia';
  v_to_ts := (v_to + 1)::timestamp at time zone 'Asia/Nicosia';

  return (
    with payouts as (
      select p.id, p.status, p.amount_cents, p.stripe_transfer_id, p.sent_at,
             row_number() over (order by p.sent_at, p.id) as ord
      from public.venue_payouts p
      where p.venue_id = p_venue_id
        and p.status in ('sent', 'reversed')
        and p.sent_at >= v_from_ts and p.sent_at < v_to_ts
    ),
    rows as (
      select p.id as payout_id,
             (p.sent_at at time zone 'Asia/Nicosia')::date as sent_on,
             to_char(p.sent_at at time zone 'Asia/Nicosia', 'HH24:MI') as sent_at,
             p.stripe_transfer_id,
             p.status,
             b.id as booking_id,
             b.booking_day,
             b.start_time,
             sum(i.venue_cents)::integer as venue_cents,
             row_number() over (order by p.ord, b.booking_day, b.start_time, b.id) as ord
      from payouts p
      join public.venue_payout_items i on i.payout_id = p.id
      join public.venue_bookings b on b.id = i.booking_id
      group by p.id, p.ord, p.sent_at, p.stripe_transfer_id, p.status, b.id, b.booking_day, b.start_time
    )
    select jsonb_build_object(
      'period', p_period,
      'from', v_from,
      'to', v_to,
      'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'ord' order by r.ord) from rows r), '[]'::jsonb),
      'payouts', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'payout_id', p.id,
                 'status', p.status,
                 'amount_cents', p.amount_cents,
                 'rows', (select count(*) from rows r where r.payout_id = p.id)::integer)
               order by p.ord)
        from payouts p), '[]'::jsonb),
      'totals', jsonb_build_object(
        'sent_cents', (select coalesce(sum(p.amount_cents) filter (where p.status = 'sent'), 0) from payouts p)::integer,
        'reversed_cents', (select coalesce(sum(p.amount_cents) filter (where p.status = 'reversed'), 0) from payouts p)::integer,
        'rows', (select count(*) from rows)::integer))
  );
end;
$$;

revoke all on function public.venue_payouts_export(uuid, text, date) from public, anon;
grant execute on function public.venue_payouts_export(uuid, text, date) to authenticated, service_role;
