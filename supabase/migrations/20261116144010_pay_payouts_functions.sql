-- P4d: venue payouts, the rules (tables in 20261116144007_pay_payouts_tables;
-- docs/specs/13-payments-bookings.md "Payouts", "Credit sits with the
-- venue", decisions of 16 November on P4d).
--
--   payout_ready_at        when a booking's money is final, or null
--   payout_rows            a venue's ledger rows that are ready and that no
--                          transfer has covered
--   prepare_payouts        (job) one transfer per booking whose money is
--                          ready, carrying a negative balance forward
--   payouts_due            (job) transfers to make or retry
--   payout_sent / payout_errored / payout_reversed / finish_payout_run
--   connect_*              the venue's Express account
--   reconcile_money        (daily) books that don't balance; money that was
--                          due before the last run and no transfer covered
--   venue_payouts_overview / venue_payout_bookings / venue_booking_money
--                          the dashboard's Payouts screen (venue owner)
--
-- Every number is the ledger's; the one rule used (when a pay-all booking's
-- money is final) is app_rules' collection delay.

-- ---- When a booking's money is final -------------------------------------------

-- Null while money on the booking can still move: a payment still held, a
-- refund or a card-or-credit choice outstanding, a collection or a Gipedo
-- Pano settlement not done. Then:
--   each pays       when its collection finished;
--   Gipedo Pano     when its last settlement finished;
--   pay-all (and    when its collection would run: the match's end plus
--   older bookings) app_rules' collection delay;
--   cancelled       when it was cancelled.
-- Counter (walk-in) bookings and blocks never transfer.
create or replace function public.payout_ready_at(p_booking public.venue_bookings)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if p_booking.id is null or p_booking.booking_type <> 'user_booking' then
    return null;
  end if;
  if exists (select 1 from public.booking_payment_shares s
             where s.booking_id = p_booking.id and s.status in ('authorized', 'refund_due'))
     or exists (select 1 from public.booking_cancellation_lines l
                where l.booking_id = p_booking.id and l.work = 'pending') then
    return null;
  end if;

  if p_booking.status = 'cancelled' then
    select max(c.cancelled_at) into v_at from public.booking_cancellations c where c.booking_id = p_booking.id;
    return coalesce(v_at, p_booking.created_at);
  end if;
  if p_booking.status <> 'confirmed' then
    return null;
  end if;

  if p_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') then
    select c.done_at into v_at from public.booking_collections c
    where c.booking_id = p_booking.id and c.status = 'done';
    return v_at;
  end if;

  if p_booking.payment_mode = 'gipedo_pano' then
    if not exists (select 1 from public.gipedo_settlements g where g.booking_id = p_booking.id)
       or exists (select 1 from public.gipedo_settlements g where g.booking_id = p_booking.id and g.status = 'due') then
      return null;
    end if;
    select max(g.done_at) into v_at from public.gipedo_settlements g where g.booking_id = p_booking.id;
    return greatest(v_at, public.booking_ends_at(p_booking.booking_day, p_booking.end_time));
  end if;

  v_at := public.booking_ends_at(p_booking.booking_day, p_booking.end_time) + public.rule_collection_delay();
  return case when now() >= v_at then v_at end;
end;
$$;

-- A venue's ledger rows that move its money, on bookings whose money is
-- final, that no transfer covers. Money the venue took in person is the
-- venue's already and never transfers (spec 13, decided 13 November); the
-- credit rows only record what the venue holds, so their venue_cents is 0
-- and they never appear.
create or replace function public.payout_rows(p_venue_id uuid)
returns table (ledger_id uuid, booking_id uuid, venue_cents integer, ready_at timestamptz, due_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with unpaid as (
    select l.id, l.booking_id, l.venue_cents, l.created_at
    from public.money_ledger l
    join public.venue_bookings b on b.id = l.booking_id
    where b.venue_id = p_venue_id
      and l.kind not in ('cash_received', 'counter_paid', 'debt_cash_received', 'payout', 'payout_reversed')
      and l.venue_cents <> 0
      and not exists (select 1 from public.venue_payout_items i where i.ledger_id = l.id and i.released_at is null)
  ),
  ready as (
    select b.id, public.payout_ready_at(b) as ready_at
    from public.venue_bookings b
    where b.id in (select u.booking_id from unpaid u)
  )
  select u.id, u.booking_id, u.venue_cents, r.ready_at, greatest(r.ready_at, u.created_at)
  from unpaid u
  join ready r on r.id = u.booking_id
  where r.ready_at is not null;
$$;

-- The venue is live on Futty (signed) and its Express account can receive
-- payouts (finished onboarding, not disconnected).
create or replace function public.venue_can_receive_payouts(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venues v
    join public.venue_stripe_accounts a on a.venue_id = v.id
    where v.id = p_venue_id and v.is_live and a.payouts_enabled and a.deauthorized_at is null
  );
$$;

-- ---- The job: what to transfer -----------------------------------------------------

-- One run: for every venue that can receive payouts, its ready money that
-- no transfer has covered. First whatever the venue owes (bookings whose
-- money comes to zero or less, e.g. Stripe's fee on its own cancellation),
-- then each booking with money for the venue, in the order it became
-- final. A booking that brings the venue's running total above zero gets a
-- transfer of that total: its own money less what the venue owes. A total
-- at or below zero transfers nothing and waits for the venue's next
-- booking: nothing is pulled back.
-- Returns the run's id, for finish_payout_run.
create or replace function public.prepare_payouts()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_account public.venue_stripe_accounts;
  v_booking record;
  v_total integer;
  v_rows uuid[];
  v_payout uuid;
begin
  insert into public.payout_runs default values returning id into v_run;

  for v_account in
    select a.* from public.venue_stripe_accounts a
    where public.venue_can_receive_payouts(a.venue_id)
    order by a.venue_id
    for update skip locked
  loop
    v_total := 0;
    v_rows := '{}';
    for v_booking in
      select r.booking_id, min(r.ready_at) as ready_at, sum(r.venue_cents)::integer as cents, array_agg(r.ledger_id) as ids
      from public.payout_rows(v_account.venue_id) r
      group by r.booking_id
      order by sum(r.venue_cents) > 0, min(r.ready_at), r.booking_id
    loop
      v_total := v_total + v_booking.cents;
      v_rows := v_rows || v_booking.ids;
      if v_booking.cents > 0 and v_total > 0 then
        insert into public.venue_payouts (venue_id, booking_id, amount_cents, stripe_account_id)
        values (v_account.venue_id, v_booking.booking_id, v_total, v_account.stripe_account_id)
        returning id into v_payout;
        insert into public.venue_payout_items (payout_id, ledger_id, booking_id, venue_cents)
        select v_payout, l.id, l.booking_id, l.venue_cents from public.money_ledger l where l.id = any (v_rows);
        v_total := 0;
        v_rows := '{}';
      end if;
    end loop;
  end loop;
  return v_run;
end;
$$;

-- Transfers to make now: new ones, and retries whose back-off has passed,
-- while the venue can still receive them.
create or replace function public.payouts_due()
returns table (payout_id uuid, venue_id uuid, booking_id uuid, amount_cents integer, stripe_account_id text, attempts integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.venue_id, p.booking_id, p.amount_cents, p.stripe_account_id, p.attempts
  from public.venue_payouts p
  where p.status = 'pending' and p.next_attempt_at <= now() and public.venue_can_receive_payouts(p.venue_id)
  order by p.created_at, p.id;
$$;

create or replace function public.finish_payout_run(p_run_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payout_runs set finished_at = coalesce(finished_at, now()) where id = p_run_id;
$$;

-- Stripe made the transfer (the API's answer, or the transfer.created
-- webhook when that answer was lost). Recorded once in the ledger; what the
-- venue owed Futty on the bookings it covered is settled. A transfer for the
-- wrong amount is refused, so the founders see it.
create or replace function public.payout_sent(p_payout_id uuid, p_transfer_id text, p_amount_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.venue_payouts;
begin
  select * into v_payout from public.venue_payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'payout_not_found';
  end if;
  if v_payout.status <> 'pending' and v_payout.stripe_transfer_id = p_transfer_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_payout.status <> 'pending' then
    raise exception 'payout_not_pending';
  end if;
  if p_amount_cents is distinct from v_payout.amount_cents then
    raise exception 'amount_mismatch';
  end if;

  update public.venue_payouts
  set status = 'sent', stripe_transfer_id = p_transfer_id, sent_at = now(), attempts = attempts + 1, last_error = null
  where id = p_payout_id;
  insert into public.money_ledger (booking_id, kind, amount_cents, stripe_id, ref, reason)
  values (v_payout.booking_id, 'payout', v_payout.amount_cents, p_transfer_id, 'payout-' || v_payout.id, 'venue_payout')
  on conflict do nothing;

  update public.venue_payables vp set settled_at = now()
  where vp.settled_at is null
    and exists (select 1 from public.venue_payout_items i
                join public.money_ledger l on l.id = i.ledger_id
                where i.payout_id = p_payout_id and i.released_at is null and l.kind = 'venue_payable'
                  and l.ref in ('venue-payable-' || vp.share_id, 'venue-payable-debt-' || vp.debt_id));
  return jsonb_build_object('result', 'sent');
end;
$$;

-- No answer from Stripe, or an error: tried again after a back-off with the
-- same idempotency key; the founders are alerted at the third failure.
create or replace function public.payout_errored(p_payout_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.venue_payouts;
begin
  update public.venue_payouts
  set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(attempts + 1)
  where id = p_payout_id and status = 'pending'
  returning * into v_payout;
  if v_payout.attempts = 3 then
    insert into public.admin_alerts (kind, booking_id, details)
    values ('payout_failing', v_payout.booking_id, jsonb_build_object(
      'payout_id', v_payout.id, 'venue_id', v_payout.venue_id, 'amount_cents', v_payout.amount_cents,
      'attempts', v_payout.attempts, 'last_error', p_error));
  end if;
end;
$$;

-- Webhook transfer.reversed: someone reversed a transfer in Stripe. Recorded
-- once; reversed in full, the money is the venue's again on the next run (its
-- rows are released, and what it owed Futty is unsettled). Always alerted:
-- Futty never reverses a transfer itself.
create or replace function public.payout_reversed(
  p_transfer_id text,
  p_reversal_id text,
  p_amount_cents integer,
  p_reversed_total_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.venue_payouts;
begin
  select * into v_payout from public.venue_payouts where stripe_transfer_id = p_transfer_id for update;
  if v_payout.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  insert into public.money_ledger (booking_id, kind, amount_cents, stripe_id, ref, reason)
  values (v_payout.booking_id, 'payout_reversed', p_amount_cents, p_reversal_id, 'payout-reversal-' || p_reversal_id,
          'venue_payout_reversed')
  on conflict do nothing;
  if not found then
    return jsonb_build_object('result', 'duplicate');
  end if;

  if p_reversed_total_cents >= v_payout.amount_cents and v_payout.status = 'sent' then
    update public.venue_payouts set status = 'reversed', reversed_at = now() where id = v_payout.id;
    update public.venue_payables vp set settled_at = null
    where exists (select 1 from public.venue_payout_items i
                  join public.money_ledger l on l.id = i.ledger_id
                  where i.payout_id = v_payout.id and i.released_at is null and l.kind = 'venue_payable'
                    and l.ref in ('venue-payable-' || vp.share_id, 'venue-payable-debt-' || vp.debt_id));
    update public.venue_payout_items set released_at = now() where payout_id = v_payout.id and released_at is null;
  end if;
  insert into public.admin_alerts (kind, booking_id, details)
  values ('payout_reversed', v_payout.booking_id, jsonb_build_object(
    'payout_id', v_payout.id, 'venue_id', v_payout.venue_id, 'transfer_id', p_transfer_id,
    'reversal_id', p_reversal_id, 'amount_cents', p_amount_cents, 'reversed_total_cents', p_reversed_total_cents));
  return jsonb_build_object('result', case when p_reversed_total_cents >= v_payout.amount_cents then 'reversed' else 'partial' end);
end;
$$;

-- ---- The venue's Express account -----------------------------------------------------

-- connect-onboarding, for the signed-in caller: their venue's account, if it
-- has one. Only the venue's owner.
create or replace function public.connect_account_for_venue(p_venue_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not public.is_venue_staff(p_venue_id, p_profile_id) then
    raise exception 'not_venue_staff';
  end if;
  return jsonb_build_object(
    'venue_id', v_venue.id,
    'venue_name', v_venue.name,
    'stripe_account_id', (select a.stripe_account_id from public.venue_stripe_accounts a where a.venue_id = p_venue_id),
    'payouts_enabled', coalesce((select a.payouts_enabled from public.venue_stripe_accounts a where a.venue_id = p_venue_id), false));
end;
$$;

-- The account Stripe created for the venue (keyed on the venue, so a retry
-- is the same account). Returns the venue's account.
create or replace function public.connect_account_created(p_venue_id uuid, p_account_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account text;
begin
  insert into public.venue_stripe_accounts (venue_id, stripe_account_id)
  values (p_venue_id, p_account_id)
  on conflict (venue_id) do nothing;
  select stripe_account_id into v_account from public.venue_stripe_accounts where venue_id = p_venue_id;
  return v_account;
end;
$$;

-- Webhook account.updated (Connect): what the account can do now.
create or replace function public.connect_account_updated(
  p_account_id text,
  p_details_submitted boolean,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_requirements_due integer,
  p_disabled_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.venue_stripe_accounts
  set details_submitted = coalesce(p_details_submitted, false),
      charges_enabled = coalesce(p_charges_enabled, false),
      payouts_enabled = coalesce(p_payouts_enabled, false) and deauthorized_at is null,
      requirements_due = greatest(coalesce(p_requirements_due, 0), 0),
      disabled_reason = p_disabled_reason,
      updated_at = now()
  where stripe_account_id = p_account_id;
  return jsonb_build_object('result', case when found then 'updated' else 'unknown' end);
end;
$$;

-- Webhook account.application.deauthorized: the venue disconnected Futty
-- from its Stripe account. No more transfers until it connects again; the
-- founders are told.
create or replace function public.connect_account_deauthorized(p_account_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.venue_stripe_accounts;
begin
  update public.venue_stripe_accounts
  set payouts_enabled = false, deauthorized_at = coalesce(deauthorized_at, now()), updated_at = now()
  where stripe_account_id = p_account_id
  returning * into v_account;
  if v_account.venue_id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  if not exists (select 1 from public.admin_alerts a where a.kind = 'connect_deauthorized' and a.resolved_at is null
                 and a.details ->> 'stripe_account_id' = p_account_id) then
    insert into public.admin_alerts (kind, details)
    values ('connect_deauthorized', jsonb_build_object('venue_id', v_account.venue_id, 'stripe_account_id', p_account_id));
  end if;
  return jsonb_build_object('result', 'deauthorized');
end;
$$;

-- ---- The daily check ------------------------------------------------------------------

-- For every booking: venue + Futty + Stripe fees + refunds = what was taken
-- (money_balance). And money that was ready before the last finished payout
-- run started, at a venue that can receive payouts, that no transfer
-- covered while the venue's total was above zero: a missing transfer. Each
-- is alerted once while it stays open. Returns how many of each.
create or replace function public.reconcile_money()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checked integer := 0;
  v_unbalanced integer := 0;
  v_missing integer := 0;
  v_booking uuid;
  v_balance record;
  v_last_run timestamptz;
  v_venue uuid;
begin
  for v_booking in select distinct l.booking_id from public.money_ledger l loop
    v_checked := v_checked + 1;
    select * into v_balance from public.money_balance(v_booking);
    if not v_balance.balanced then
      v_unbalanced := v_unbalanced + 1;
      if not exists (select 1 from public.admin_alerts a
                     where a.kind = 'books_unbalanced' and a.booking_id = v_booking and a.resolved_at is null) then
        insert into public.admin_alerts (kind, booking_id, details) values ('books_unbalanced', v_booking, to_jsonb(v_balance));
      end if;
    end if;
  end loop;

  select max(r.started_at) into v_last_run from public.payout_runs r where r.finished_at is not null;
  if v_last_run is not null then
    for v_venue in select a.venue_id from public.venue_stripe_accounts a where public.venue_can_receive_payouts(a.venue_id) loop
      if (select coalesce(sum(r.venue_cents), 0) from public.payout_rows(v_venue) r where r.due_at < v_last_run) > 0 then
        for v_booking in
          select r.booking_id from public.payout_rows(v_venue) r
          where r.due_at < v_last_run
          group by r.booking_id having sum(r.venue_cents) > 0
        loop
          v_missing := v_missing + 1;
          if not exists (select 1 from public.admin_alerts a
                         where a.kind = 'payout_missing' and a.booking_id = v_booking and a.resolved_at is null) then
            insert into public.admin_alerts (kind, booking_id, details)
            values ('payout_missing', v_booking, jsonb_build_object('venue_id', v_venue,
              'unpaid_cents', (select sum(r.venue_cents) from public.payout_rows(v_venue) r where r.booking_id = v_booking)));
          end if;
        end loop;
      end if;
    end loop;
  end if;

  return jsonb_build_object('checked', v_checked, 'unbalanced', v_unbalanced, 'missing_transfers', v_missing);
end;
$$;

-- ---- The dashboard's Payouts screen (the venue's owner) ------------------------------

-- What one booking paid, from the ledger: taken by card (or credit's card
-- part), given back, Futty's and Stripe's parts, what the venue owes Futty
-- for it, what it took in person (never transferred), its money in the
-- app, and what has been transferred of it.
create or replace function public.booking_money_breakdown(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'booking_id', b.id,
    'label', public.booking_label(b),
    'booking_day', b.booking_day,
    'start_time', b.start_time,
    'status', b.status,
    'ready', public.payout_ready_at(b) is not null,
    'taken_cents', coalesce(sum(l.amount_cents) filter (where l.kind = 'capture'), 0),
    'refunded_cents', coalesce(sum(l.amount_cents) filter (where l.kind = 'refund'), 0),
    'futty_cents', coalesce(sum(l.futty_cents) filter (where l.kind not in ('venue_payable', 'payout', 'payout_reversed')), 0),
    'stripe_fee_cents', coalesce(sum(l.stripe_fee_cents), 0),
    'owed_to_futty_cents', coalesce(sum(l.amount_cents) filter (where l.kind = 'venue_payable'), 0),
    'paid_at_venue_cents', coalesce(sum(l.venue_cents) filter (where l.kind in ('cash_received', 'counter_paid', 'debt_cash_received')), 0),
    'venue_cents', coalesce(sum(l.venue_cents) filter (where l.kind not in ('cash_received', 'counter_paid', 'debt_cash_received')), 0),
    'transferred_cents', (select coalesce(sum(i.venue_cents), 0) from public.venue_payout_items i
                          join public.venue_payouts p on p.id = i.payout_id
                          where i.booking_id = b.id and i.released_at is null and p.status = 'sent'),
    'credit_held_cents', coalesce(sum(l.credit_cents), 0))
  from public.venue_bookings b
  left join public.money_ledger l on l.booking_id = b.id
  where b.id = p_booking_id
  group by b.id;
$$;

-- The account's state, the money on its way, what the venue owes Futty, and
-- the latest payouts.
create or replace function public.venue_payouts_overview(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_account public.venue_stripe_accounts;
  v_ready integer;
  v_status text;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not public.is_venue_staff(p_venue_id, auth.uid()) then
    raise exception 'not_venue_staff';
  end if;
  select * into v_account from public.venue_stripe_accounts where venue_id = p_venue_id;
  v_status := case
    when v_account.venue_id is null then 'not_started'
    when v_account.deauthorized_at is not null then 'disconnected'
    when v_account.payouts_enabled then 'ready'
    when v_account.details_submitted and (v_account.requirements_due > 0 or v_account.disabled_reason is not null)
      then 'needs_information'
    else 'in_progress' end;
  select coalesce(sum(r.venue_cents), 0) into v_ready from public.payout_rows(p_venue_id) r;

  return jsonb_build_object(
    'account', jsonb_build_object('status', v_status, 'venue_live', v_venue.is_live,
                                  'requirements_due', coalesce(v_account.requirements_due, 0)),
    'can_receive', public.venue_can_receive_payouts(p_venue_id),
    -- Ready and not yet transferred: on its way on the next run (once the
    -- venue can receive payouts), or, below zero, what it owes Futty.
    'ready_cents', greatest(v_ready, 0),
    'owed_to_futty_cents', greatest(-v_ready, 0),
    'sending_cents', (select coalesce(sum(p.amount_cents), 0) from public.venue_payouts p
                      where p.venue_id = p_venue_id and p.status = 'pending'),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'booking_id', p.booking_id, 'label', public.booking_label(b),
               'amount_cents', p.amount_cents, 'status', p.status, 'created_at', p.created_at, 'sent_at', p.sent_at,
               'bookings', (select count(distinct i.booking_id) from public.venue_payout_items i where i.payout_id = p.id))
             order by p.created_at desc, p.id)
      from (select * from public.venue_payouts where venue_id = p_venue_id order by created_at desc, id limit 50) p
      join public.venue_bookings b on b.id = p.booking_id), '[]'::jsonb));
end;
$$;

-- One payout: each booking it covered, with what this payout sent for it and
-- what the booking paid.
create or replace function public.venue_payout_bookings(p_venue_id uuid, p_payout_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payout public.venue_payouts;
begin
  if not public.is_venue_staff(p_venue_id, auth.uid()) then
    raise exception 'not_venue_staff';
  end if;
  select * into v_payout from public.venue_payouts where id = p_payout_id and venue_id = p_venue_id;
  if v_payout.id is null then
    raise exception 'payout_not_found';
  end if;
  return jsonb_build_object(
    'id', v_payout.id, 'amount_cents', v_payout.amount_cents, 'status', v_payout.status,
    'created_at', v_payout.created_at, 'sent_at', v_payout.sent_at,
    'bookings', coalesce((
      select jsonb_agg(public.booking_money_breakdown(x.booking_id) || jsonb_build_object('this_payout_cents', x.cents)
                       order by x.first_row)
      from (select i.booking_id, sum(i.venue_cents)::integer as cents, min(i.id::text) as first_row
            from public.venue_payout_items i where i.payout_id = p_payout_id group by i.booking_id) x), '[]'::jsonb));
end;
$$;

-- What one of the venue's bookings paid.
create or replace function public.venue_booking_money(p_venue_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_venue_staff(p_venue_id, auth.uid()) then
    raise exception 'not_venue_staff';
  end if;
  if not exists (select 1 from public.venue_bookings where id = p_booking_id and venue_id = p_venue_id) then
    raise exception 'booking_not_found';
  end if;
  return public.booking_money_breakdown(p_booking_id);
end;
$$;

-- ---- Grants -----------------------------------------------------------------------------

revoke all on function public.payout_ready_at(public.venue_bookings) from public, anon, authenticated;
revoke all on function public.payout_rows(uuid) from public, anon, authenticated;
revoke all on function public.venue_can_receive_payouts(uuid) from public, anon, authenticated;
revoke all on function public.prepare_payouts() from public, anon, authenticated;
revoke all on function public.payouts_due() from public, anon, authenticated;
revoke all on function public.finish_payout_run(uuid) from public, anon, authenticated;
revoke all on function public.payout_sent(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.payout_errored(uuid, text) from public, anon, authenticated;
revoke all on function public.payout_reversed(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.connect_account_for_venue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.connect_account_created(uuid, text) from public, anon, authenticated;
revoke all on function public.connect_account_updated(text, boolean, boolean, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.connect_account_deauthorized(text) from public, anon, authenticated;
revoke all on function public.reconcile_money() from public, anon, authenticated;
revoke all on function public.booking_money_breakdown(uuid) from public, anon, authenticated;
revoke all on function public.venue_payouts_overview(uuid) from public, anon;
revoke all on function public.venue_payout_bookings(uuid, uuid) from public, anon;
revoke all on function public.venue_booking_money(uuid, uuid) from public, anon;

grant execute on function public.payout_ready_at(public.venue_bookings) to service_role;
grant execute on function public.payout_rows(uuid) to service_role;
grant execute on function public.venue_can_receive_payouts(uuid) to service_role;
grant execute on function public.prepare_payouts() to service_role;
grant execute on function public.payouts_due() to service_role;
grant execute on function public.finish_payout_run(uuid) to service_role;
grant execute on function public.payout_sent(uuid, text, integer) to service_role;
grant execute on function public.payout_errored(uuid, text) to service_role;
grant execute on function public.payout_reversed(text, text, integer, integer) to service_role;
grant execute on function public.connect_account_for_venue(uuid, uuid) to service_role;
grant execute on function public.connect_account_created(uuid, text) to service_role;
grant execute on function public.connect_account_updated(text, boolean, boolean, boolean, integer, text) to service_role;
grant execute on function public.connect_account_deauthorized(text) to service_role;
grant execute on function public.reconcile_money() to service_role;
grant execute on function public.booking_money_breakdown(uuid) to service_role;
grant execute on function public.venue_payouts_overview(uuid) to authenticated, service_role;
grant execute on function public.venue_payout_bookings(uuid, uuid) to authenticated, service_role;
grant execute on function public.venue_booking_money(uuid, uuid) to authenticated, service_role;
