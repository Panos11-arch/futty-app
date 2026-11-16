-- P4d review fixes (PR #81; docs/specs/13-payments-bookings.md "Payouts",
-- decided 16 November):
--
-- 1. Stripe's available balance. Transfers have no source_transaction, so
--    they draw on Futty's available balance, and card money is pending in
--    Stripe for days first. A shortage is waiting, not failure: run-payouts
--    sends pending payouts oldest first while they fit in the available EUR
--    balance; one that doesn't fit, or whose transfer fails with
--    balance_insufficient, is marked waiting (payout_waiting): no attempt
--    counted, no alert, tried on the next run. The daily check reports the
--    total waiting and the oldest waiting payout.
--
-- 2. Test data at the switch to live keys.
--    - venue_stripe_accounts.livemode, from accounts.create and
--      account.updated. An account from the other mode is ignored: no
--      payout is prepared or sent to it, and onboarding in the current mode
--      replaces it (its unsent payouts are dropped, so their rows go to the
--      new account).
--    - venues.payouts_from, null by default and set only by service_role
--      (Panos, when the venue goes live on live keys). No payouts at a venue
--      while it is null; the ledger rows of bookings created before it never
--      transfer (and are never "missing"); the Payouts screen shows those
--      bookings as before Futty payouts.
--    run-payouts passes the mode of its Stripe key (sk_live_: live) to the
--    database; each run records it, and the Payouts screen judges the
--    venue's account against the mode of the latest run.

-- ---- Columns ------------------------------------------------------------------------

alter table public.venue_stripe_accounts add column livemode boolean not null default false;
comment on column public.venue_stripe_accounts.livemode is
  'The Stripe mode the account was created in (accounts.create, account.updated). An account from the other mode is never paid.';

alter table public.venues add column payouts_from timestamptz;
comment on column public.venues.payouts_from is
  'P4d: when Futty payouts start at this venue (set by service_role when it goes live on live keys). Null: no payouts. Bookings created before it never transfer.';

-- Only service_role (or the database itself) may set it: a change made
-- with a signed-in or anonymous session is refused, whatever function
-- makes it.
create or replace function public.venues_payouts_from_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.payouts_from is not null)
     or (tg_op = 'UPDATE' and new.payouts_from is distinct from old.payouts_from) then
    if coalesce(auth.role(), '') in ('authenticated', 'anon') then
      raise exception 'payouts_from_service_role_only';
    end if;
  end if;
  return new;
end;
$$;
create trigger venues_payouts_from_guard
  before insert or update of payouts_from on public.venues
  for each row execute function public.venues_payouts_from_guard();
revoke all on function public.venues_payouts_from_guard() from public, anon, authenticated;

alter table public.venue_payouts add column waiting_since timestamptz;
comment on column public.venue_payouts.waiting_since is
  'Since when this payout has been waiting for Futty''s available Stripe balance (card money clearing). Null when not waiting.';

alter table public.payout_runs add column livemode boolean;
-- The moment each run really started (not its transaction's), so the latest
-- run is always the latest.
alter table public.payout_runs alter column started_at set default clock_timestamp();

-- ---- Who can receive payouts ----------------------------------------------------------

-- The venue is live on Futty (signed), payouts have started there
-- (payouts_from), and its Express account is from this Stripe mode and can
-- receive payouts (finished onboarding, not disconnected).
create or replace function public.venue_can_receive_payouts(p_venue_id uuid, p_livemode boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venues v
    join public.venue_stripe_accounts a on a.venue_id = v.id
    where v.id = p_venue_id and v.is_live and v.payouts_from is not null
      and a.payouts_enabled and a.deauthorized_at is null and a.livemode = p_livemode
  );
$$;

-- The mode of the latest payout run (null before any run): what the
-- Payouts screen judges a venue's account against.
create or replace function public.payouts_livemode()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select r.livemode from public.payout_runs r where r.livemode is not null order by r.started_at desc, r.id limit 1;
$$;

-- As in 20261116144010, plus: only bookings created at or after the
-- venue's payouts_from (none while it is null).
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
    join public.venues v on v.id = b.venue_id
    where b.venue_id = p_venue_id
      and v.payouts_from is not null and b.created_at >= v.payouts_from
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

-- ---- The job ---------------------------------------------------------------------------

-- As in 20261116144010, for the mode of run-payouts' Stripe key: only
-- venues whose account is from that mode. The run records the mode.
drop function public.prepare_payouts();
create or replace function public.prepare_payouts(p_livemode boolean)
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
  insert into public.payout_runs (livemode) values (p_livemode) returning id into v_run;

  for v_account in
    select a.* from public.venue_stripe_accounts a
    where public.venue_can_receive_payouts(a.venue_id, p_livemode)
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

-- Transfers to make now, oldest first (run-payouts sends them while they
-- fit in the available balance): new ones, retries whose back-off has
-- passed, and those waiting for the balance, to accounts of this mode that
-- can still receive them.
drop function public.payouts_due();
create or replace function public.payouts_due(p_livemode boolean)
returns table (payout_id uuid, venue_id uuid, booking_id uuid, amount_cents integer, stripe_account_id text, attempts integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.venue_id, p.booking_id, p.amount_cents, p.stripe_account_id, p.attempts
  from public.venue_payouts p
  join public.venue_stripe_accounts a on a.venue_id = p.venue_id and a.stripe_account_id = p.stripe_account_id
  where p.status = 'pending' and p.next_attempt_at <= now()
    and public.venue_can_receive_payouts(p.venue_id, p_livemode)
  order by p.created_at, p.id;
$$;

-- Futty's available balance can't cover it yet (card money still pending
-- in Stripe): waiting, tried on the next run. No attempt counted, no alert.
create or replace function public.payout_waiting(p_payout_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.venue_payouts set waiting_since = coalesce(waiting_since, now())
  where id = p_payout_id and status = 'pending';
$$;

-- As in 20261116144010, plus: no longer waiting.
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
  set status = 'sent', stripe_transfer_id = p_transfer_id, sent_at = now(), attempts = attempts + 1, last_error = null,
      waiting_since = null
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

-- As in 20261116144010, plus: a real failure is no longer waiting.
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
  set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(attempts + 1),
      waiting_since = null
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

-- ---- The venue's Express account ------------------------------------------------------

-- As in 20261116144010, plus the account's mode.
create or replace function public.connect_account_for_venue(p_venue_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_account public.venue_stripe_accounts;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not public.is_venue_staff(p_venue_id, p_profile_id) then
    raise exception 'not_venue_staff';
  end if;
  select * into v_account from public.venue_stripe_accounts where venue_id = p_venue_id;
  return jsonb_build_object(
    'venue_id', v_venue.id,
    'venue_name', v_venue.name,
    'stripe_account_id', v_account.stripe_account_id,
    'livemode', v_account.livemode,
    'payouts_enabled', coalesce(v_account.payouts_enabled, false));
end;
$$;

-- The account Stripe created for the venue, in p_livemode. Keeps an
-- account of the same mode the venue already has (a retry is the same
-- account). An account from the other mode is replaced: its payouts that
-- were never sent are dropped, so their ledger rows go to the new account.
-- Returns the venue's account.
drop function public.connect_account_created(uuid, text);
create or replace function public.connect_account_created(p_venue_id uuid, p_account_id text, p_livemode boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.venue_stripe_accounts;
begin
  select * into v_existing from public.venue_stripe_accounts where venue_id = p_venue_id for update;
  if v_existing.venue_id is not null and v_existing.livemode = p_livemode then
    return v_existing.stripe_account_id;
  end if;
  if v_existing.venue_id is not null then
    delete from public.venue_payouts where venue_id = p_venue_id and status = 'pending';
    update public.venue_stripe_accounts
    set stripe_account_id = p_account_id, livemode = p_livemode, details_submitted = false, charges_enabled = false,
        payouts_enabled = false, requirements_due = 0, disabled_reason = null, deauthorized_at = null, updated_at = now()
    where venue_id = p_venue_id;
  else
    insert into public.venue_stripe_accounts (venue_id, stripe_account_id, livemode)
    values (p_venue_id, p_account_id, p_livemode);
  end if;
  return p_account_id;
end;
$$;

-- Webhook account.updated (Connect), with the account's mode.
drop function public.connect_account_updated(text, boolean, boolean, boolean, integer, text);
create or replace function public.connect_account_updated(
  p_account_id text,
  p_details_submitted boolean,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_requirements_due integer,
  p_disabled_reason text,
  p_livemode boolean
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
      livemode = coalesce(p_livemode, livemode),
      updated_at = now()
  where stripe_account_id = p_account_id;
  return jsonb_build_object('result', case when found then 'updated' else 'unknown' end);
end;
$$;

-- ---- The daily check -------------------------------------------------------------------

-- As in 20261116144010, judged in the mode of the last payout run, plus
-- what is waiting for Stripe's balance: the total, and the oldest payout.
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
  v_last_run public.payout_runs;
  v_venue uuid;
  v_oldest public.venue_payouts;
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

  select * into v_last_run from public.payout_runs r where r.finished_at is not null
  order by r.started_at desc, r.id limit 1;
  if v_last_run.id is not null then
    for v_venue in
      select a.venue_id from public.venue_stripe_accounts a
      where public.venue_can_receive_payouts(a.venue_id, coalesce(v_last_run.livemode, a.livemode))
    loop
      if (select coalesce(sum(r.venue_cents), 0) from public.payout_rows(v_venue) r where r.due_at < v_last_run.started_at) > 0 then
        for v_booking in
          select r.booking_id from public.payout_rows(v_venue) r
          where r.due_at < v_last_run.started_at
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

  select * into v_oldest from public.venue_payouts p
  where p.status = 'pending' and p.waiting_since is not null
  order by p.created_at, p.id limit 1;

  return jsonb_build_object(
    'checked', v_checked,
    'unbalanced', v_unbalanced,
    'missing_transfers', v_missing,
    'waiting_for_balance_cents', (select coalesce(sum(p.amount_cents), 0) from public.venue_payouts p
                                  where p.status = 'pending' and p.waiting_since is not null),
    'oldest_waiting', case when v_oldest.id is null then null else jsonb_build_object(
      'payout_id', v_oldest.id, 'venue_id', v_oldest.venue_id, 'booking_id', v_oldest.booking_id,
      'amount_cents', v_oldest.amount_cents, 'created_at', v_oldest.created_at, 'waiting_since', v_oldest.waiting_since) end);
end;
$$;

-- ---- The Payouts screen ----------------------------------------------------------------

-- As in 20261116144010, plus whether the booking is from before the venue's
-- Futty payouts (it never transfers).
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
    'before_payouts', v.payouts_from is null or b.created_at < v.payouts_from,
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
  join public.venues v on v.id = b.venue_id
  left join public.money_ledger l on l.booking_id = b.id
  where b.id = p_booking_id
  group by b.id, v.payouts_from;
$$;

-- As in 20261116144010, judged in the mode of the latest payout run (an
-- account from the other mode counts as not started: the venue sets up
-- again), plus: when payouts start at the venue, what is waiting for
-- Stripe's balance, and the latest bookings from before Futty payouts.
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
  v_mode boolean;
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
  v_mode := coalesce(public.payouts_livemode(), v_account.livemode);
  v_status := case
    when v_account.venue_id is null or v_account.livemode is distinct from v_mode then 'not_started'
    when v_account.deauthorized_at is not null then 'disconnected'
    when v_account.payouts_enabled then 'ready'
    when v_account.details_submitted and (v_account.requirements_due > 0 or v_account.disabled_reason is not null)
      then 'needs_information'
    else 'in_progress' end;
  select coalesce(sum(r.venue_cents), 0) into v_ready from public.payout_rows(p_venue_id) r;

  return jsonb_build_object(
    'account', jsonb_build_object('status', v_status, 'venue_live', v_venue.is_live,
                                  'requirements_due', coalesce(v_account.requirements_due, 0)),
    'payouts_from', v_venue.payouts_from,
    'can_receive', coalesce(public.venue_can_receive_payouts(p_venue_id, v_mode), false),
    'ready_cents', greatest(v_ready, 0),
    'owed_to_futty_cents', greatest(-v_ready, 0),
    'sending_cents', (select coalesce(sum(p.amount_cents), 0) from public.venue_payouts p
                      where p.venue_id = p_venue_id and p.status = 'pending'),
    'waiting_for_balance_cents', (select coalesce(sum(p.amount_cents), 0) from public.venue_payouts p
                                  where p.venue_id = p_venue_id and p.status = 'pending' and p.waiting_since is not null),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'booking_id', p.booking_id, 'label', public.booking_label(b),
               'amount_cents', p.amount_cents, 'status', p.status, 'created_at', p.created_at, 'sent_at', p.sent_at,
               'waiting', p.waiting_since is not null,
               'bookings', (select count(distinct i.booking_id) from public.venue_payout_items i where i.payout_id = p.id))
             order by p.created_at desc, p.id)
      from (select * from public.venue_payouts where venue_id = p_venue_id order by created_at desc, id limit 50) p
      join public.venue_bookings b on b.id = p.booking_id), '[]'::jsonb),
    -- Bookings with money in the app from before Futty payouts started here
    -- (all of them while payouts haven't started): never transferred.
    'before_payouts', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', x.id, 'label', x.label, 'venue_cents', x.cents)
                       order by x.created_at desc, x.id)
      from (select b.id, b.created_at, public.booking_label(b) as label, (select coalesce(sum(l.venue_cents), 0)::integer from public.money_ledger l
                         where l.booking_id = b.id
                           and l.kind not in ('cash_received', 'counter_paid', 'debt_cash_received', 'payout', 'payout_reversed')) as cents
            from public.venue_bookings b
            where b.venue_id = p_venue_id and (v_venue.payouts_from is null or b.created_at < v_venue.payouts_from)
              and exists (select 1 from public.money_ledger l where l.booking_id = b.id and l.venue_cents <> 0
                          and l.kind not in ('cash_received', 'counter_paid', 'debt_cash_received', 'payout', 'payout_reversed'))
            order by b.created_at desc, b.id limit 20) x), '[]'::jsonb));
end;
$$;

-- ---- Grants ---------------------------------------------------------------------------

drop function public.venue_can_receive_payouts(uuid);

revoke all on function public.venue_can_receive_payouts(uuid, boolean) from public, anon, authenticated;
revoke all on function public.payouts_livemode() from public, anon, authenticated;
revoke all on function public.payout_rows(uuid) from public, anon, authenticated;
revoke all on function public.prepare_payouts(boolean) from public, anon, authenticated;
revoke all on function public.payouts_due(boolean) from public, anon, authenticated;
revoke all on function public.payout_waiting(uuid) from public, anon, authenticated;
revoke all on function public.payout_sent(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.payout_errored(uuid, text) from public, anon, authenticated;
revoke all on function public.connect_account_for_venue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.connect_account_created(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.connect_account_updated(text, boolean, boolean, boolean, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.reconcile_money() from public, anon, authenticated;
revoke all on function public.booking_money_breakdown(uuid) from public, anon, authenticated;
revoke all on function public.venue_payouts_overview(uuid) from public, anon;

grant execute on function public.venue_can_receive_payouts(uuid, boolean) to service_role;
grant execute on function public.payouts_livemode() to service_role;
grant execute on function public.payout_rows(uuid) to service_role;
grant execute on function public.prepare_payouts(boolean) to service_role;
grant execute on function public.payouts_due(boolean) to service_role;
grant execute on function public.payout_waiting(uuid) to service_role;
grant execute on function public.payout_sent(uuid, text, integer) to service_role;
grant execute on function public.payout_errored(uuid, text) to service_role;
grant execute on function public.connect_account_for_venue(uuid, uuid) to service_role;
grant execute on function public.connect_account_created(uuid, text, boolean) to service_role;
grant execute on function public.connect_account_updated(text, boolean, boolean, boolean, integer, text, boolean) to service_role;
grant execute on function public.reconcile_money() to service_role;
grant execute on function public.booking_money_breakdown(uuid) to service_role;
grant execute on function public.venue_payouts_overview(uuid) to authenticated, service_role;
