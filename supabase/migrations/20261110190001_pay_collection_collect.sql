-- P4c: collection 2 hours after the match (docs/specs/13-payments-bookings.md,
-- "When money is held and taken" step 9, "Short games, top-ups and 6 v 6",
-- "Cash at the venue"; 14, P4c items 1-3 and 5). The database decides
-- everything; run-collection only charges and releases what it's told to,
-- once, and reports back. All service_role only.
--
-- The order, for one booking:
--   1. start_collection writes what each joined player owes now
--      (booking_collection_items): a short game's top-up on a card share,
--      an unpaid share, or cash the venue never ticked;
--   2. run-collection charges every top-up off-session to the player's
--      saved card (collection_top_up_paid / _failed / _errored);
--   3. settle_collection, once every top-up has an answer: in responsible
--      mode whatever is still unpaid is taken from the booker's guarantee
--      hold and the rest released (collection_guarantee_done), or, if the
--      hold never succeeded, it's the booker's debt; in just-my-spot mode
--      each unpaid amount is that player's debt to the venue.
-- Running it twice changes nothing the second time.

-- When a booking's match ends (Cyprus wall-clock time, as an instant).
create or replace function public.booking_ends_at(p_day date, p_end time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_day + p_end) at time zone 'Asia/Nicosia';
$$;

-- Collection is due 2 hours after the match, or from the end of the match
-- when the venue's staff asked to run it earlier (decided 10 November: not
-- before the match has ended). Only each-pays bookings made since P4a: the
-- booker who paid for everyone already paid the full pitch price.
create or replace function public.collection_is_due(p_booking public.venue_bookings)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot'), false)
     and p_booking.status = 'confirmed'
     and p_booking.booking_type = 'user_booking'
     and now() >= public.booking_ends_at(p_booking.booking_day, p_booking.end_time)
                  + case when p_booking.collection_requested_at is null then interval '2 hours' else interval '0' end;
$$;

-- What each joined player owes for the pitch now (spec 13, "Short games"):
--   joined = every share holding a spot (pending, held or paid), not who
--   turned up; a venue-provided player has no share, so is an empty spot;
--   the pitch money still needed = the pitch price less what late
--   cancellations kept (decided 10 November: a forfeited share's pitch
--   part counts toward the pitch price), but never less than the joined
--   players' normal parts (a late-cancelled spot that was filled pays the
--   venue twice);
--   it's split between the joined players, the leftover cents on the
--   booker's share (or, if the booker gave up their own spot, on the
--   first player to join);
--   paid_pitch_cents is what their card payment (and venue credit) already
--   paid of their pitch part; a cash player pays theirs at the venue.
create or replace function public.collection_amounts(p_booking_id uuid)
returns table (
  share_id uuid,
  profile_id uuid,
  is_booker boolean,
  payment_method text,
  share_status text,
  due_pitch_cents integer,
  normal_pitch_cents integer,
  paid_pitch_cents integer,
  fee_cents integer,
  fee_paid boolean,
  cash_received boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booking public.venue_bookings;
  v_joined integer;
  v_booker_joined boolean;
  v_kept integer;
  v_per integer;
  v_normal integer;
  v_due integer;
  v_leftover_share uuid;
begin
  select * into v_booking from public.venue_bookings b where b.id = p_booking_id;
  if v_booking.id is null or v_booking.payment_mode is null
     or v_booking.payment_mode not in ('each_pays_responsible', 'each_pays_own_spot') then
    return;
  end if;

  select count(*), coalesce(bool_or(s.is_booker), false) into v_joined, v_booker_joined
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid');
  if v_joined = 0 then
    return;
  end if;

  -- The pitch part a late cancellation kept: a cash player's pitch part
  -- was never paid, so it keeps none.
  select coalesce(sum(coalesce(s.pitch_cents, 0) - s.cash_cents), 0)::integer into v_kept
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status = 'forfeited';

  v_per := v_booking.amount_cents / v_booking.capacity;
  v_normal := v_joined * v_per + case when v_booker_joined then v_booking.amount_cents % v_booking.capacity else 0 end;
  v_due := greatest(v_booking.amount_cents - v_kept, v_normal);
  if not v_booker_joined then
    select s.id into v_leftover_share from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
    order by s.created_at, s.id limit 1;
  end if;

  return query
  select s.id, s.profile_id, s.is_booker, s.payment_method, s.status,
         (case when v_due = v_normal
               then v_per + case when s.is_booker then v_booking.amount_cents % v_booking.capacity else 0 end
               else v_due / v_joined
                    + case when s.is_booker or s.id = v_leftover_share then v_due % v_joined else 0 end
          end)::integer,
         (v_per + case when s.is_booker then v_booking.amount_cents % v_booking.capacity else 0 end)::integer,
         (case when s.status in ('authorized', 'paid') then coalesce(s.pitch_cents, 0) - s.cash_cents else 0 end)::integer,
         coalesce(s.fee_cents, 0),
         s.status in ('authorized', 'paid'),
         s.cash_received_at is not null
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
  order by s.is_booker desc, s.created_at, s.id;
end;
$$;

-- Job: bookings whose collection is due and hasn't started (collection_id
-- null), and collections still unfinished whose next try is due.
create or replace function public.collections_due()
returns table (booking_id uuid, collection_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, null::uuid
  from public.venue_bookings b
  where b.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
    and b.status = 'confirmed'
    and b.booking_day <= (now() at time zone 'Asia/Nicosia')::date
    and public.collection_is_due(b)
    and not exists (select 1 from public.booking_collections c where c.booking_id = b.id)
  union all
  select c.booking_id, c.id
  from public.booking_collections c
  where c.status <> 'done' and coalesce(c.next_attempt_at, c.started_at) <= now();
$$;

-- Before collection starts, run-collection checks at Stripe every payment
-- still open on an unpaid share (its own payment or card saving) and on an
-- unticked cash part paid by card: one going through is left to its
-- webhook (collection waits), any other is cancelled so it can never be
-- paid as well. New payments are already refused (share_payment_plan,
-- plan_cash_payment: collection_started).
create or replace function public.collection_open_intents(p_booking_id uuid)
returns table (share_id uuid, kind text, intent_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, 'payment', s.stripe_payment_intent_id
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status = 'pending' and s.stripe_payment_intent_id is not null
  union all
  -- A card being saved for a share with nothing to charge. (A refused one
  -- puts an amount back on the share: nothing to wait for.)
  select s.id, 'setup', s.stripe_setup_intent_id
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status = 'pending' and s.stripe_setup_intent_id is not null
    and s.amount_cents = 0
  union all
  select s.id, 'cash', s.cash_intent_id
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('authorized', 'paid') and s.payment_method = 'cash'
    and s.cash_received_at is null and s.cash_intent_id is not null;
$$;

create or replace function public.collection_summary(p_collection public.booking_collections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'collection_id', p_collection.id,
    'booking_id', p_collection.booking_id,
    'status', p_collection.status,
    'joined_players', p_collection.joined_players,
    'pitch_due_cents', p_collection.pitch_due_cents,
    'items', (select count(*) from public.booking_collection_items i where i.collection_id = p_collection.id)
  );
$$;

-- Starts a booking's collection: what each joined player owes now, once.
-- A second call returns the same collection.
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

  update public.booking_collections set joined_players = v_joined, pitch_due_cents = v_due
  where id = v_collection.id
  returning * into v_collection;
  return public.collection_summary(v_collection);
end;
$$;

-- Job: top-ups to charge now, with the player's saved card.
-- previous_intent_id: an earlier try Stripe didn't answer (or that was
-- still processing), checked before trying again.
create or replace function public.collection_top_ups_due(p_collection_id uuid default null)
returns table (
  item_id uuid,
  collection_id uuid,
  booking_id uuid,
  share_id uuid,
  profile_id uuid,
  amount_cents integer,
  stripe_customer_id text,
  stripe_payment_method_id text,
  previous_intent_id text,
  attempts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.collection_id, i.booking_id, i.share_id, i.profile_id, i.amount_cents,
         p.stripe_customer_id, s.stripe_payment_method_id, i.stripe_payment_intent_id, i.attempts
  from public.booking_collection_items i
  join public.booking_payment_shares s on s.id = i.share_id
  join public.profiles p on p.id = i.profile_id
  where i.kind = 'top_up' and i.status = 'pending'
    and (p_collection_id is null or i.collection_id = p_collection_id)
    and coalesce(i.next_attempt_at, now()) <= now()
  order by i.created_at, i.id;
$$;

-- How a game is named in messages: "Venue on Friday 13 Nov at 20:00".
create or replace function public.booking_label(p_booking public.venue_bookings)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format('%s on %s at %s', (select v.name from public.venues v where v.id = p_booking.venue_id),
                to_char(p_booking.booking_day, 'FMDay DD Mon'), to_char(p_booking.start_time, 'HH24:MI'));
$$;

-- A top-up was taken. Futty absorbs Stripe's fee: all of it is the
-- venue's pitch money. A top-up taken twice, or for the wrong amount, is
-- recorded and given back ('refund').
create or replace function public.collection_top_up_paid(
  p_item_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_stripe_fee_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.booking_collection_items;
  v_booking public.venue_bookings;
  v_joined integer;
begin
  select * into v_item from public.booking_collection_items where id = p_item_id and kind = 'top_up' for update;
  if v_item.id is null then
    raise exception 'item_not_found';
  end if;
  if v_item.status = 'paid' and v_item.stripe_payment_intent_id = p_intent_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  perform public.record_intent_capture(v_item.booking_id, v_item.share_id, null, p_intent_id, p_amount_cents, 0,
                                       p_stripe_fee_cents, 'top_up');
  if v_item.status <> 'pending' or p_amount_cents is distinct from v_item.amount_cents then
    return jsonb_build_object('result', 'refund', 'booking_id', v_item.booking_id, 'share_id', v_item.share_id,
      'reason', case when v_item.status <> 'pending' then 'top_up_not_due' else 'amount_mismatch' end);
  end if;

  update public.booking_collection_items
  set status = 'paid', stripe_payment_intent_id = p_intent_id, attempts = attempts + 1, last_error = null,
      next_attempt_at = null, done_at = now()
  where id = p_item_id;

  select * into v_booking from public.venue_bookings where id = v_item.booking_id;
  select joined_players into v_joined from public.booking_collections where id = v_item.collection_id;
  perform public.send_notification(v_item.profile_id, 'top_up_charged', jsonb_build_object(
    'title', 'Extra charge for your game',
    'body', format('We charged %s for your game at %s: %s players joined, so the pitch price was shared between them.',
                   public.money_format_euros(v_item.amount_cents), public.booking_label(v_booking), v_joined),
    'bookingId', v_item.booking_id,
    'amountCents', v_item.amount_cents
  ));
  return jsonb_build_object('result', 'paid');
end;
$$;

-- The player's card said no (or the bank wanted them present): the top-up
-- is still owed. It isn't retried: settle_collection covers it from the
-- booker's hold or makes it the player's debt (spec 13, "A failed top-up").
create or replace function public.collection_top_up_failed(p_item_id uuid, p_intent_id text, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.booking_collection_items
  set status = 'unpaid', stripe_payment_intent_id = coalesce(p_intent_id, stripe_payment_intent_id),
      attempts = attempts + 1, last_error = p_error, next_attempt_at = null, done_at = now()
  where id = p_item_id and kind = 'top_up' and status = 'pending';
  get diagnostics v_updated = row_count;
  return jsonb_build_object('result', case when v_updated = 1 then 'unpaid' else 'ignored' end);
end;
$$;

-- No answer from Stripe (or still processing): tried again after a
-- back-off, with the same request; the founders are alerted at the third.
create or replace function public.collection_top_up_errored(p_item_id uuid, p_intent_id text, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.booking_collection_items;
begin
  update public.booking_collection_items
  set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(attempts + 1),
      stripe_payment_intent_id = coalesce(p_intent_id, stripe_payment_intent_id)
  where id = p_item_id and kind = 'top_up' and status = 'pending'
  returning * into v_item;
  if v_item.attempts = 3 then
    insert into public.admin_alerts (kind, booking_id, share_id, details)
    values ('collection_failing', v_item.booking_id, v_item.share_id, jsonb_build_object(
      'item_id', v_item.id, 'attempts', v_item.attempts, 'last_error', p_error,
      'stripe_payment_intent_id', v_item.stripe_payment_intent_id))
    on conflict do nothing;
  end if;
  return jsonb_build_object('result', 'retry', 'attempts', coalesce(v_item.attempts, 0));
end;
$$;

-- A new debt, written to the ledger, and the player told. Owed to a venue
-- (p_venue_id) or to Futty.
create or replace function public.create_venue_debt(
  p_profile_id uuid,
  p_owed_to text,
  p_venue_id uuid,
  p_booking_id uuid,
  p_amount_cents integer,
  p_venue_cents integer,
  p_futty_cents integer,
  p_reason text,
  p_collection_id uuid,
  p_cancellation_fee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt public.venue_debts;
  v_booking public.venue_bookings;
  v_to text;
begin
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents,
                                  reason, collection_id, cancellation_fee_id)
  values (p_profile_id, p_owed_to, p_venue_id, p_booking_id, p_amount_cents, p_venue_cents, p_futty_cents,
          p_reason, p_collection_id, p_cancellation_fee_id)
  returning * into v_debt;
  perform public.record_debt_entry(v_debt, 'debt_created', 'debt-created-' || v_debt.id, p_reason);

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_to := case when p_owed_to = 'futty' then 'Futty'
               else (select v.name from public.venues v where v.id = p_venue_id) end;
  perform public.send_notification(p_profile_id, 'debt_created', jsonb_build_object(
    'title', format('You owe %s', public.money_format_euros(p_amount_cents)),
    'body', format('You owe %s to %s %s. Until it''s paid you can''t book, join a game or pay cash. Pay it in the app.',
                   public.money_format_euros(p_amount_cents), v_to,
                   case when p_reason = 'cancellation_fee'
                        then format('for cancelling your team''s game at %s', public.booking_label(v_booking))
                        else format('for your game at %s', public.booking_label(v_booking)) end),
    'debtId', v_debt.id,
    'bookingId', p_booking_id,
    'venueId', p_venue_id,
    'amountCents', p_amount_cents
  ));
  return v_debt.id;
end;
$$;

-- What the guarantee step still has to do, as run-collection reads it.
create or replace function public.collection_guarantee_work(p_collection public.booking_collections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'result', 'guarantee',
    'collection_id', p_collection.id,
    'booking_id', p_collection.booking_id,
    'guarantee_id', p_collection.guarantee_id,
    'stripe_intent_id', p_collection.guarantee_intent_id,
    'action', p_collection.guarantee_action,
    'capture_cents', p_collection.guarantee_capture_cents,
    'futty_cents', p_collection.guarantee_futty_cents
  );
$$;

-- Once every top-up has an answer, decides who covers what is still
-- unpaid (spec 13, "Booking modes" and step 9):
--   just my spot: each unpaid amount is that player's debt to the venue;
--   responsible: all of it is taken from the booker's guarantee hold, up
--   to the hold (the pitch price), pitch money first, then service fees
--   (decided 10 November), and the rest released; if the hold never
--   succeeded, the same amount is the booker's debt to the venue.
-- Returns 'waiting' (top-ups still out), the guarantee work, or 'done'.
create or replace function public.settle_collection(p_collection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.booking_collections;
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_item public.booking_collection_items;
  v_debt_id uuid;
  v_pitch integer;
  v_fees integer;
  v_cap integer;
  v_covered integer;
  v_venue integer;
begin
  select * into v_collection from public.booking_collections where id = p_collection_id for update;
  if v_collection.id is null then
    raise exception 'collection_not_found';
  end if;
  if v_collection.status = 'done' then
    return jsonb_build_object('result', 'done', 'collection_id', v_collection.id);
  end if;
  if v_collection.status = 'guarantee' then
    return public.collection_guarantee_work(v_collection);
  end if;
  if exists (select 1 from public.booking_collection_items where collection_id = p_collection_id and status = 'pending') then
    return jsonb_build_object('result', 'waiting', 'collection_id', v_collection.id);
  end if;
  select * into v_booking from public.venue_bookings where id = v_collection.booking_id;

  if v_collection.payment_mode = 'each_pays_own_spot' then
    for v_item in select * from public.booking_collection_items
                  where collection_id = p_collection_id and status = 'unpaid' order by created_at, id for update loop
      v_debt_id := public.create_venue_debt(v_item.profile_id, 'venue', v_booking.venue_id, v_booking.id,
        v_item.amount_cents, v_item.pitch_cents, v_item.fee_cents,
        case v_item.kind when 'top_up' then 'top_up_failed' when 'unpaid_cash' then 'cash_unpaid' else 'unpaid_share' end,
        v_collection.id, null);
      update public.booking_collection_items set status = 'debt', debt_id = v_debt_id where id = v_item.id;
    end loop;
    update public.booking_collections set status = 'done', settled_at = now(), done_at = now(), next_attempt_at = null
    where id = p_collection_id;
    return jsonb_build_object('result', 'done', 'collection_id', v_collection.id);
  end if;

  -- Responsible: everything still unpaid, up to the hold.
  select coalesce(sum(pitch_cents), 0)::integer, coalesce(sum(fee_cents), 0)::integer into v_pitch, v_fees
  from public.booking_collection_items where collection_id = p_collection_id and status = 'unpaid';
  select * into v_guarantee from public.booking_guarantees where id = v_collection.guarantee_id for update;
  v_cap := coalesce(v_guarantee.amount_cents, v_booking.amount_cents);
  v_covered := least(v_pitch + v_fees, v_cap);
  v_venue := least(v_pitch, v_covered);

  if v_guarantee.status = 'held' and v_guarantee.stripe_payment_intent_id is not null then
    update public.booking_collection_items set status = 'covered', done_at = now()
    where collection_id = p_collection_id and status = 'unpaid';
    update public.booking_collections
    set status = 'guarantee', settled_at = now(), next_attempt_at = now(),
        guarantee_intent_id = v_guarantee.stripe_payment_intent_id,
        guarantee_action = case when v_covered > 0 then 'capture' else 'release' end,
        guarantee_capture_cents = v_covered, guarantee_futty_cents = v_covered - v_venue
    where id = p_collection_id
    returning * into v_collection;
    return public.collection_guarantee_work(v_collection);
  end if;

  -- The hold never succeeded: the booker owes what it would have covered.
  perform public.collection_booker_debt(v_collection, v_booking, v_covered, v_venue, 'unpaid');
  update public.booking_collections
  set status = 'done', settled_at = now(), done_at = now(), next_attempt_at = null, guarantee_action = 'none'
  where id = p_collection_id;
  return jsonb_build_object('result', 'done', 'collection_id', v_collection.id);
end;
$$;

-- The booker's debt for what their guarantee would have covered: the
-- items in p_from_status move onto it.
create or replace function public.collection_booker_debt(
  p_collection public.booking_collections,
  p_booking public.venue_bookings,
  p_amount_cents integer,
  p_venue_cents integer,
  p_from_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt_id uuid;
begin
  if p_amount_cents <= 0 then
    return null;
  end if;
  v_debt_id := public.create_venue_debt(p_booking.created_by, 'venue', p_booking.venue_id, p_booking.id, p_amount_cents,
    p_venue_cents, p_amount_cents - p_venue_cents, 'guarantee_not_held', p_collection.id, null);
  update public.booking_collection_items set status = 'debt', debt_id = v_debt_id, done_at = now()
  where collection_id = p_collection.id and status = p_from_status;
  return v_debt_id;
end;
$$;

-- run-collection did the guarantee step:
--   captured  the unpaid amount was taken (partial capture; Stripe released
--             the rest). Recorded: the pitch money is the venue's, the
--             fees covered Futty's, less Stripe's actual fee;
--   released  nothing was owed; the hold was cancelled (release.ts
--             recorded it);
--   gone      the hold wasn't there any more (expired or cancelled): the
--             booker owes what it would have covered.
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

  if p_outcome = 'captured' then
    if v_collection.guarantee_action <> 'capture' or p_amount_cents is distinct from v_collection.guarantee_capture_cents then
      raise exception 'amount_mismatch';
    end if;
    perform public.record_intent_capture(v_collection.booking_id, null, v_collection.guarantee_id,
      v_collection.guarantee_intent_id, p_amount_cents, v_collection.guarantee_futty_cents, p_stripe_fee_cents,
      'collection_guarantee');
    update public.booking_guarantees set status = 'collected', collected_cents = p_amount_cents
    where id = v_collection.guarantee_id;
  elsif p_outcome = 'released' then
    update public.booking_guarantees set status = 'released', collected_cents = 0
    where id = v_collection.guarantee_id;
  else
    select * into v_booking from public.venue_bookings where id = v_collection.booking_id;
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

-- A collection step Stripe didn't answer: tried again after a back-off;
-- the founders are alerted at the third failure.
create or replace function public.collection_failed(p_collection_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.booking_collections;
begin
  update public.booking_collections
  set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(attempts + 1)
  where id = p_collection_id and status <> 'done'
  returning * into v_collection;
  if v_collection.attempts = 3 then
    insert into public.admin_alerts (kind, booking_id, share_id, details)
    values ('collection_failing', v_collection.booking_id, null, jsonb_build_object(
      'collection_id', v_collection.id, 'status', v_collection.status, 'attempts', v_collection.attempts,
      'last_error', p_error));
  end if;
  return jsonb_build_object('result', 'retry', 'attempts', coalesce(v_collection.attempts, 0));
end;
$$;

-- Job: 6 hours before kickoff, a short game's players are told what
-- they'll each pay extra if nobody else joins (spec 13: "You're 8 of 10.
-- If nobody else joins, each player pays €1.50 extra after the match."),
-- with the buttons to request a player. Checked once per booking. Not for a
-- booking the booker paid for in full: nobody pays a top-up there.
-- Returns how many bookings were warned.
create or replace function public.send_short_game_warnings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_joined integer;
  v_extra integer;
  v_profile uuid;
  v_count integer := 0;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
      and b.status = 'confirmed'
      and b.booking_type = 'user_booking'
      and b.short_game_warned_at is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - interval '6 hours'
      and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
    for update skip locked
  loop
    update public.venue_bookings set short_game_warned_at = now() where id = v_booking.id;
    select count(*), coalesce(min(a.due_pitch_cents - a.normal_pitch_cents) filter (where not a.is_booker),
                              max(a.due_pitch_cents - a.normal_pitch_cents))
    into v_joined, v_extra
    from public.collection_amounts(v_booking.id) a;
    if v_joined = 0 or v_joined >= v_booking.capacity or v_extra <= 0 then
      continue;
    end if;
    for v_profile in select a.profile_id from public.collection_amounts(v_booking.id) a loop
      perform public.send_notification(v_profile, 'short_game_warning', jsonb_build_object(
        'title', format('You''re %s of %s', v_joined, v_booking.capacity),
        'body', format('If nobody else joins, each player pays %s extra after the match.',
                       public.money_format_euros(v_extra)),
        'bookingId', v_booking.id,
        'joined', v_joined,
        'players', v_booking.capacity,
        'extraCents', v_extra,
        'actions', jsonb_build_array('request_venue_player', 'post_public_request')
      ));
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Job: after the match, a cash player the venue hasn't ticked is asked
-- "Pay €6.00 by card now, or remain in debt to [venue]." (spec 13), once,
-- with their pitch part now (more in a short game). Until collection
-- starts. Returns how many were asked.
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
    select s.id as share_id, s.profile_id, b.id as booking_id, b.venue_id, v.name as venue_name
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
      'body', format('Pay %s by card now, or remain in debt to %s.', public.money_format_euros(v_amount), v_row.venue_name),
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

revoke all on function public.booking_ends_at(date, time) from public, anon, authenticated;
grant execute on function public.booking_ends_at(date, time) to service_role;
revoke all on function public.collection_is_due(public.venue_bookings) from public, anon, authenticated;
grant execute on function public.collection_is_due(public.venue_bookings) to service_role;
revoke all on function public.collection_amounts(uuid) from public, anon, authenticated;
grant execute on function public.collection_amounts(uuid) to service_role;
revoke all on function public.collections_due() from public, anon, authenticated;
grant execute on function public.collections_due() to service_role;
revoke all on function public.collection_open_intents(uuid) from public, anon, authenticated;
grant execute on function public.collection_open_intents(uuid) to service_role;
revoke all on function public.collection_summary(public.booking_collections) from public, anon, authenticated;
grant execute on function public.collection_summary(public.booking_collections) to service_role;
revoke all on function public.start_collection(uuid) from public, anon, authenticated;
grant execute on function public.start_collection(uuid) to service_role;
revoke all on function public.collection_top_ups_due(uuid) from public, anon, authenticated;
grant execute on function public.collection_top_ups_due(uuid) to service_role;
revoke all on function public.booking_label(public.venue_bookings) from public, anon, authenticated;
grant execute on function public.booking_label(public.venue_bookings) to service_role;
revoke all on function public.collection_top_up_paid(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.collection_top_up_paid(uuid, text, integer, integer) to service_role;
revoke all on function public.collection_top_up_failed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.collection_top_up_failed(uuid, text, text) to service_role;
revoke all on function public.collection_top_up_errored(uuid, text, text) from public, anon, authenticated;
grant execute on function public.collection_top_up_errored(uuid, text, text) to service_role;
revoke all on function public.create_venue_debt(uuid, text, uuid, uuid, integer, integer, integer, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_venue_debt(uuid, text, uuid, uuid, integer, integer, integer, text, uuid, uuid)
  to service_role;
revoke all on function public.collection_guarantee_work(public.booking_collections) from public, anon, authenticated;
grant execute on function public.collection_guarantee_work(public.booking_collections) to service_role;
revoke all on function public.settle_collection(uuid) from public, anon, authenticated;
grant execute on function public.settle_collection(uuid) to service_role;
revoke all on function public.collection_booker_debt(public.booking_collections, public.venue_bookings, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.collection_booker_debt(public.booking_collections, public.venue_bookings, integer, integer, text)
  to service_role;
revoke all on function public.collection_guarantee_done(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.collection_guarantee_done(uuid, text, integer, integer) to service_role;
revoke all on function public.collection_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.collection_failed(uuid, text) to service_role;
revoke all on function public.send_short_game_warnings() from public, anon, authenticated;
grant execute on function public.send_short_game_warnings() to service_role;
revoke all on function public.send_cash_prompts() from public, anon, authenticated;
grant execute on function public.send_cash_prompts() to service_role;
