-- P4c: the decisions of 10 November on PR #36 (docs/specs/13-payments-bookings.md,
-- written into spec 13 in the same PR):
--   2. money taken from the booker's guarantee hold at collection: the
--      booker is told, with a new always-sent type, guarantee_charged:
--      "€X was taken from your hold for unpaid spots: [names]."
--   3. a venue marks settled a debt that includes Futty's fee: the debt is
--      fully cleared for the player, and Futty's part is owed by the venue
--      (venue_payables), so it comes off the venue's next payout;
--   4. booker responsible: an unticked cash player is told "Pay €6.00 by
--      card now, or [booker name] will be charged for your spot."; just my
--      spot keeps "remain in debt to [venue]";
--   5. a late-cancelled share whose card part was never taken still counts
--      toward the pitch price, and that card part is collected like any
--      unpaid amount: from the booker's hold (responsible) or as the
--      player's debt (just my spot).
-- (1, leftover cents on the first player to join when the booker gave up
-- their spot, was already so: collection_amounts.)

-- The new type (contract 4, match-record.md section 6.3): always sent.
insert into public.notification_types (type, always_sent) values ('guarantee_charged', true) on conflict (type) do nothing;

-- What a venue owes Futty now also includes Futty's part of a debt the
-- venue marked settled (the player paid the venue, fee included).
alter table public.venue_payables drop constraint venue_payables_reason_check;
alter table public.venue_payables add constraint venue_payables_reason_check
  check (reason in ('venue_cancelled_stripe_fee', 'venue_settled_debt_fee'));
alter table public.venue_payables add column debt_id uuid unique;

-- How a player is named to other players.
create or replace function public.profile_display_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.first_name), ''), nullif(trim(p.username), ''), 'A player')
  from (select 1) one
  left join public.profiles p on p.id = p_profile_id;
$$;

-- As in 20261110190001_pay_collection_collect, plus (decision 5): a late
-- cancellation whose card part was never taken (cancellation_line_not_taken)
-- owes that card part, as an unpaid share: the pitch part and its fee.
create or replace function public.start_collection(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_collection public.booking_collections;
  v_row record;
  v_pitch integer;
  v_joined integer := 0;
  v_due integer := 0;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  select * into v_collection from public.booking_collections where booking_id = p_booking_id;
  if v_collection.id is not null then
    return public.collection_summary(v_collection);
  end if;
  if v_booking.payment_mode is null or v_booking.payment_mode not in ('each_pays_responsible', 'each_pays_own_spot') then
    raise exception 'nothing_to_collect';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  if not public.collection_is_due(v_booking) then
    raise exception 'collection_not_due';
  end if;
  perform 1 from public.booking_payment_shares where booking_id = p_booking_id for update;

  insert into public.booking_collections (booking_id, venue_id, payment_mode, joined_players, pitch_due_cents, guarantee_id)
  values (p_booking_id, v_booking.venue_id, v_booking.payment_mode, 0, 0,
          (select g.id from public.booking_guarantees g where g.booking_id = p_booking_id))
  returning * into v_collection;

  for v_row in select * from public.collection_amounts(p_booking_id) loop
    v_joined := v_joined + 1;
    v_due := v_due + v_row.due_pitch_cents;
    if v_row.share_status = 'pending' then
      -- Never paid: the pitch part (unless the venue ticked it as paid in
      -- cash) and the service fee.
      v_pitch := case when v_row.payment_method = 'cash' and v_row.cash_received then 0 else v_row.due_pitch_cents end;
      if v_pitch + v_row.fee_cents > 0 then
        insert into public.booking_collection_items
          (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status)
        values (v_collection.id, p_booking_id, v_row.share_id, v_row.profile_id, 'unpaid_share',
                v_pitch + v_row.fee_cents, v_pitch, v_row.fee_cents, 'unpaid');
      end if;
    elsif v_row.payment_method = 'cash' then
      -- The fee was paid by card; the pitch part is paid at the venue.
      if not v_row.cash_received and v_row.due_pitch_cents > 0 then
        insert into public.booking_collection_items
          (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status)
        values (v_collection.id, p_booking_id, v_row.share_id, v_row.profile_id, 'unpaid_cash',
                v_row.due_pitch_cents, v_row.due_pitch_cents, 0, 'unpaid');
      end if;
    elsif v_row.due_pitch_cents > v_row.paid_pitch_cents then
      -- A short game: the difference, charged to their saved card, no fee.
      insert into public.booking_collection_items
        (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status, next_attempt_at)
      values (v_collection.id, p_booking_id, v_row.share_id, v_row.profile_id, 'top_up',
              v_row.due_pitch_cents - v_row.paid_pitch_cents, v_row.due_pitch_cents - v_row.paid_pitch_cents, 0,
              'pending', now());
    end if;
  end loop;

  -- Late cancellations whose card part never arrived: counted as kept
  -- toward the pitch price (collection_amounts), so collected here. Any
  -- credit that paid for the share was kept already; only the card part
  -- (its pitch money and fee) is owed.
  insert into public.booking_collection_items
    (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status)
  select v_collection.id, p_booking_id, s.id, s.profile_id, 'unpaid_share',
         s.amount_cents, s.amount_cents - least(coalesce(s.fee_cents, 0), s.amount_cents),
         least(coalesce(s.fee_cents, 0), s.amount_cents), 'unpaid'
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status = 'forfeited' and s.amount_cents > 0
    and exists (select 1 from public.booking_cancellation_lines l
                where l.share_id = s.id and l.action = 'keep' and l.outcome = 'not_taken');

  update public.booking_collections set joined_players = v_joined, pitch_due_cents = v_due
  where id = v_collection.id
  returning * into v_collection;
  return public.collection_summary(v_collection);
end;
$$;

-- As in 20261110190001_pay_collection_collect, plus (decision 2): when money
-- was taken from the hold, the booker is told how much and for whom.
create or replace function public.collection_guarantee_done(
  p_collection_id uuid,
  p_outcome text,
  p_amount_cents integer,
  p_stripe_fee_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.booking_collections;
  v_booking public.venue_bookings;
  v_names text;
begin
  select * into v_collection from public.booking_collections where id = p_collection_id for update;
  if v_collection.id is null then
    raise exception 'collection_not_found';
  end if;
  if v_collection.status = 'done' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_collection.status <> 'guarantee' then
    raise exception 'collection_not_settling';
  end if;
  if p_outcome not in ('captured', 'released', 'gone') then
    raise exception 'invalid_outcome';
  end if;
  select * into v_booking from public.venue_bookings where id = v_collection.booking_id;

  if p_outcome = 'captured' then
    if v_collection.guarantee_action <> 'capture' or p_amount_cents is distinct from v_collection.guarantee_capture_cents then
      raise exception 'amount_mismatch';
    end if;
    perform public.record_intent_capture(v_collection.booking_id, null, v_collection.guarantee_id,
      v_collection.guarantee_intent_id, p_amount_cents, v_collection.guarantee_futty_cents, p_stripe_fee_cents,
      'collection_guarantee');
    update public.booking_guarantees set status = 'collected', collected_cents = p_amount_cents
    where id = v_collection.guarantee_id;

    select string_agg(n.name, ', ' order by n.joined, n.share_id) into v_names
    from (
      select distinct on (i.share_id) i.share_id, s.created_at as joined, public.profile_display_name(i.profile_id) as name
      from public.booking_collection_items i
      join public.booking_payment_shares s on s.id = i.share_id
      where i.collection_id = p_collection_id and i.status = 'covered'
    ) n;
    perform public.send_notification(v_booking.created_by, 'guarantee_charged', jsonb_build_object(
      'title', 'Taken from your hold',
      'body', format('%s was taken from your hold for unpaid spots: %s.', public.money_format_euros(p_amount_cents),
                     coalesce(v_names, '')),
      'bookingId', v_booking.id,
      'amountCents', p_amount_cents
    ));
  elsif p_outcome = 'released' then
    update public.booking_guarantees set status = 'released', collected_cents = 0
    where id = v_collection.guarantee_id;
  else
    perform public.collection_booker_debt(v_collection, v_booking, v_collection.guarantee_capture_cents,
      v_collection.guarantee_capture_cents - v_collection.guarantee_futty_cents, 'covered');
    update public.booking_guarantees set status = 'released', collected_cents = 0
    where id = v_collection.guarantee_id;
  end if;

  update public.booking_collections
  set status = 'done', done_at = now(), next_attempt_at = null, last_error = null
  where id = p_collection_id;
  return jsonb_build_object('result', p_outcome);
end;
$$;

-- As in 20261110190001_pay_collection_collect, with the wording for each
-- mode (decision 4).
create or replace function public.send_cash_prompts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_amount integer;
  v_count integer := 0;
begin
  for v_row in
    select s.id as share_id, s.profile_id, b.id as booking_id, b.venue_id, b.payment_mode, b.created_by,
           v.name as venue_name
    from public.booking_payment_shares s
    join public.venue_bookings b on b.id = s.booking_id
    join public.venues v on v.id = b.venue_id
    where s.payment_method = 'cash'
      and s.status in ('authorized', 'paid')
      and s.cash_received_at is null
      and s.cash_prompted_at is null
      and b.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
      and b.status = 'confirmed'
      and b.booking_day <= (now() at time zone 'Asia/Nicosia')::date
      and now() >= public.booking_ends_at(b.booking_day, b.end_time)
      and not exists (select 1 from public.booking_collections c where c.booking_id = b.id)
    for update of s skip locked
  loop
    select a.due_pitch_cents into v_amount from public.collection_amounts(v_row.booking_id) a
    where a.share_id = v_row.share_id;
    update public.booking_payment_shares set cash_prompted_at = now() where id = v_row.share_id;
    if coalesce(v_amount, 0) <= 0 then
      continue;
    end if;
    perform public.send_notification(v_row.profile_id, 'cash_unpaid_prompt', jsonb_build_object(
      'title', 'Pay for your game',
      'body', case when v_row.payment_mode = 'each_pays_responsible'
                   then format('Pay %s by card now, or %s will be charged for your spot.',
                               public.money_format_euros(v_amount), public.profile_display_name(v_row.created_by))
                   else format('Pay %s by card now, or remain in debt to %s.',
                               public.money_format_euros(v_amount), v_row.venue_name) end,
      'bookingId', v_row.booking_id,
      'shareId', v_row.share_id,
      'venueId', v_row.venue_id,
      'amountCents', v_amount
    ));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- As in 20261110190002_pay_collection_debt, plus (decision 3): a venue
-- marking settled a debt that includes Futty's part (a service fee) means
-- the venue received that part; it owes it to Futty, off its next payout.
create or replace function public.settle_debt(p_debt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt public.venue_debts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_debt from public.venue_debts where id = p_debt_id for update;
  if v_debt.id is null then
    raise exception 'debt_not_found';
  end if;
  if v_debt.owed_to <> 'venue' or not public.is_venue_staff(v_debt.venue_id, auth.uid()) then
    raise exception 'not_venue_staff';
  end if;
  if v_debt.settled_at is not null then
    raise exception 'debt_settled';
  end if;
  perform public.debt_settled_now(v_debt, 'venue', auth.uid(), null);
  if v_debt.futty_cents > 0 then
    insert into public.venue_payables (venue_id, booking_id, share_id, debt_id, amount_cents, reason)
    values (v_debt.venue_id, v_debt.booking_id, null, v_debt.id, v_debt.futty_cents, 'venue_settled_debt_fee')
    on conflict (debt_id) do nothing;
    if found then
      perform public.record_ledger_entry(v_debt.booking_id, null, null, 'venue_payable', v_debt.futty_cents,
        'venue-payable-debt-' || v_debt.id, 'venue_settled_debt_fee', -v_debt.futty_cents, v_debt.futty_cents, 0);
    end if;
  end if;
end;
$$;

revoke all on function public.profile_display_name(uuid) from public, anon, authenticated;
grant execute on function public.profile_display_name(uuid) to service_role;
revoke all on function public.start_collection(uuid) from public, anon, authenticated;
grant execute on function public.start_collection(uuid) to service_role;
revoke all on function public.collection_guarantee_done(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.collection_guarantee_done(uuid, text, integer, integer) to service_role;
revoke all on function public.send_cash_prompts() from public, anon, authenticated;
grant execute on function public.send_cash_prompts() to service_role;
revoke all on function public.settle_debt(uuid) from public, anon;
grant execute on function public.settle_debt(uuid) to authenticated, service_role;
