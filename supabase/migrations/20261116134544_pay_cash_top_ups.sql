-- A cash player ticked as paid is topped up by card like everyone else
-- (docs/specs/13-payments-bookings.md, "Short games, top-ups and 6 v 6",
-- decided 16 November). They saved a card when joining, so after a 6 v 6 ->
-- 5 v 5 switch, or in any short game, the difference between their pitch
-- part and the cash they paid is charged to it with the other top-ups. A
-- failed top-up takes the normal path: the booker's hold in responsible
-- mode, the player's debt in just my spot.
--
-- Re-created from their latest definitions:
--   collection_amounts (20261116124400_pay_switching) a ticked cash share's
--                      paid_pitch_cents is the cash it paid (cash_cents when
--                      staff ticked it, the card payment when the player
--                      paid it by card after the match), less its switch
--                      credit; it was 0. And a ticked cash share forfeited
--                      by a late cancellation counts the cash the venue
--                      kept toward the pitch price, as a card share does
--                      (decided 10 November), so the others don't pay it
--                      again
--   start_collection   (20261111090000_pay_collection_decisions) only an
--                      unticked cash share is left to the cash path; a
--                      ticked one gets a top-up when it paid less than due

-- collection_amounts, from 20261116124400_pay_switching.sql
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

  -- The pitch part a late cancellation kept: an unticked cash player's
  -- pitch part was never paid, so it keeps none; ticked cash the venue
  -- keeps counts like a card payment (decided 10 November, "A late
  -- cancellation's kept money"): what was ticked, less any of it handed
  -- back. P12: less the switch credit the share was given before it was
  -- cancelled.
  select coalesce(sum(coalesce(s.pitch_cents, 0) - s.cash_cents
                      + case when s.payment_method = 'cash' and s.cash_received_at is not null
                             then coalesce((select sum(m.venue_cents) from public.money_ledger m
                                            where m.share_id = s.id and m.kind = 'cash_received'), 0)
                             else 0 end
                      - case when s.switch_credit_issued_at is not null
                                  and (s.payment_method = 'card' or s.cash_received_at is not null)
                             then s.switch_credit_cents else 0 end), 0)::integer into v_kept
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
         -- P12: less the credit a switch to more players gives it.
         (case when s.payment_method = 'cash' and s.cash_received_at is not null
               -- Decided 16 November: ticked cash counts as paid, so a
               -- ticked cash player is topped up like everyone else. Staff
               -- ticked the share's cash part; a player who paid it by card
               -- after the match paid what was due then.
               then (case when s.cash_received_by is null and s.cash_intent_id is not null
                          then coalesce((select m.amount_cents from public.money_ledger m
                                         where m.kind = 'capture' and m.stripe_id = s.cash_intent_id
                                           and m.share_id = s.id),
                                        s.cash_cents)
                          else s.cash_cents end)
                    - s.switch_credit_cents
               when s.status in ('authorized', 'paid')
               then coalesce(s.pitch_cents, 0) - s.cash_cents
                    - case when s.payment_method = 'card' then s.switch_credit_cents else 0 end
               else 0 end)::integer,
         coalesce(s.fee_cents, 0),
         s.status in ('authorized', 'paid'),
         s.cash_received_at is not null
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
  order by s.is_booker desc, s.created_at, s.id;
end;
$$;

-- start_collection, from 20261111090000_pay_collection_decisions.sql
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
    elsif v_row.payment_method = 'cash' and not v_row.cash_received then
      -- The fee was paid by card; the pitch part is paid at the venue.
      if v_row.due_pitch_cents > 0 then
        insert into public.booking_collection_items
          (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status)
        values (v_collection.id, p_booking_id, v_row.share_id, v_row.profile_id, 'unpaid_cash',
                v_row.due_pitch_cents, v_row.due_pitch_cents, 0, 'unpaid');
      end if;
    elsif v_row.due_pitch_cents > v_row.paid_pitch_cents then
      -- A short game, or a switch to fewer players: the difference, charged
      -- to their saved card, no fee. Decided 16 November: a ticked cash
      -- player too, against the cash they paid.
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

revoke all on function public.collection_amounts(uuid) from public, anon, authenticated;
grant execute on function public.collection_amounts(uuid) to service_role;
revoke all on function public.start_collection(uuid) from public, anon, authenticated;
grant execute on function public.start_collection(uuid) to service_role;
