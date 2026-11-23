-- B1c, part 2d (Booking v2, spec 13, decided 20 and 23 November).
--   * Collection per side: each captain is the booker of his own half, so a
--     half pitch is collected side by side 2 hours after the match. Only a
--     side paying for myself has a collection, from its own players and
--     against its own captain's guarantee (his side's half, the cap).
--     booking_collections gets a side; start_collection takes it;
--     collections_due lists each side; run-collection passes it on.
--   * The odd cent: each side pays its half rounded down, the venue still
--     gets the full pitch price, and Futty absorbs the cent. Once the match
--     is over, booking_odd_cent_due (run-payment-jobs) records it as one
--     ledger transfer from Futty to the venue ('odd_cent_absorbed'); the
--     venue's payout waits for it.
-- Re-created with only these changes: start_collection
-- (20261123180000_pay_b1c_opposition.sql; dropped and re-created with
-- p_side), collections_due (20261110190001_pay_collection_collect.sql; a
-- side column, so dropped and re-created) and payout_ready_at
-- (20261116144010_pay_payouts_functions.sql).

alter table public.booking_collections add column side text check (side in ('a', 'b'));
alter table public.booking_collections drop constraint booking_collections_booking_id_key;
create unique index booking_collections_booking_side_idx on public.booking_collections (booking_id, coalesce(side, ''));

-- collection_is_due for one side of a half pitch (its own way to pay), or
-- for the booking when p_side is null.
create or replace function public.collection_side_is_due(p_booking public.venue_bookings, p_side text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_side is null then public.collection_is_due(p_booking)
    else coalesce((select s.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
                   from public.booking_sides s
                   where s.booking_id = p_booking.id and s.side = p_side and s.left_at is null), false)
         and p_booking.status = 'confirmed'
         and p_booking.booking_type = 'user_booking'
         and now() >= public.booking_ends_at(p_booking.booking_day, p_booking.end_time)
                      + case when p_booking.collection_requested_at is null then public.rule_collection_delay() else interval '0' end
  end;
$$;

-- run-payment-jobs: the odd cent of every half pitch that's been played.
create or replace function public.booking_odd_cent_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_count integer := 0;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.booking_kind = 'half' and b.status = 'confirmed' and b.amount_cents % 2 = 1
      and now() >= public.booking_ends_at(b.booking_day, b.end_time)
      and not exists (select 1 from public.money_ledger l
                      where l.booking_id = b.id and l.kind = 'transfer' and l.reason = 'odd_cent_absorbed')
    for update of b
  loop
    if public.record_money_transfer(v_booking.id, null, -1, 'odd-cent-' || v_booking.id, 'odd_cent_absorbed') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

drop function public.start_collection(uuid);
drop function public.collections_due();

-- As in 20261123180000_pay_b1c_opposition.sql, plus p_side (B1c).
create or replace function public.start_collection(p_booking_id uuid, p_side text default null)
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
  v_side public.booking_sides;  -- B1c: on a half pitch, the side being collected
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  -- B1c: a half pitch is collected side by side, each side on its own way
  -- to pay and against its own captain's guarantee.
  if v_booking.booking_kind = 'half' then
    if p_side is null then
      raise exception 'side_required';
    end if;
    select * into v_side from public.booking_sides where booking_id = p_booking_id and side = p_side and left_at is null;
    if v_side.booking_id is null then
      raise exception 'side_not_found';
    end if;
  elsif p_side is not null then
    raise exception 'not_half_pitch';
  end if;
  select * into v_collection from public.booking_collections
  where booking_id = p_booking_id and side is not distinct from p_side;
  if v_collection.id is not null then
    return public.collection_summary(v_collection);
  end if;
  if coalesce(v_side.payment_mode, v_booking.payment_mode) is null
     or coalesce(v_side.payment_mode, v_booking.payment_mode) not in ('each_pays_responsible', 'each_pays_own_spot') then
    raise exception 'nothing_to_collect';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  if not public.collection_side_is_due(v_booking, p_side) then
    raise exception 'collection_not_due';
  end if;
  perform 1 from public.booking_payment_shares where booking_id = p_booking_id for update;

  insert into public.booking_collections (booking_id, venue_id, payment_mode, joined_players, pitch_due_cents, guarantee_id, side)
  values (p_booking_id, v_booking.venue_id, coalesce(v_side.payment_mode, v_booking.payment_mode), 0, 0,
          (select g.id from public.booking_guarantees g
           where g.booking_id = p_booking_id and g.profile_id = coalesce(v_side.captain_id, v_booking.created_by)),
          p_side)
  returning * into v_collection;

  for v_row in select * from public.collection_amounts(p_booking_id) a
               where p_side is null
                  or exists (select 1 from public.booking_payment_shares sh where sh.id = a.share_id and sh.side = p_side) loop
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
    and (p_side is null or s.side = p_side)
    and exists (select 1 from public.booking_cancellation_lines l
                where l.share_id = s.id and l.action = 'keep' and l.outcome = 'not_taken');

  update public.booking_collections set joined_players = v_joined, pitch_due_cents = v_due
  where id = v_collection.id
  returning * into v_collection;
  return public.collection_summary(v_collection);
end;
$$;

-- As in 20261110190001_pay_collection_collect.sql, plus the side (B1c).
create or replace function public.collections_due()
returns table (booking_id uuid, collection_id uuid, side text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, null::uuid, null::text
  from public.venue_bookings b
  where b.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
    and b.booking_kind is distinct from 'half'
    and b.status = 'confirmed'
    and b.booking_day <= (now() at time zone 'Asia/Nicosia')::date
    and public.collection_is_due(b)
    and not exists (select 1 from public.booking_collections c where c.booking_id = b.id)
  union all
  -- B1c: a half pitch, side by side.
  select b.id, null::uuid, s.side
  from public.venue_bookings b
  join public.booking_sides s on s.booking_id = b.id and s.left_at is null
  where b.booking_kind = 'half' and b.status = 'confirmed'
    and s.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
    and public.collection_side_is_due(b, s.side)
    and not exists (select 1 from public.booking_collections c where c.booking_id = b.id and c.side = s.side)
  union all
  select c.booking_id, c.id, c.side
  from public.booking_collections c
  where c.status <> 'done' and coalesce(c.next_attempt_at, c.started_at) <= now();
$$;

-- As in 20261116144010_pay_payouts_functions.sql, plus half pitches (B1c).
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

  -- B1c: a half pitch is ready once the match's collection time has passed,
  -- every side paying for myself is collected, and any odd cent is recorded.
  if p_booking.booking_kind = 'half' then
    v_at := public.booking_ends_at(p_booking.booking_day, p_booking.end_time) + public.rule_collection_delay();
    if now() < v_at
       or exists (select 1 from public.booking_sides s
                  where s.booking_id = p_booking.id and s.left_at is null
                    and s.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
                    and not exists (select 1 from public.booking_collections c
                                    where c.booking_id = p_booking.id and c.side = s.side and c.status = 'done'))
       or (p_booking.amount_cents % 2 = 1
           and not exists (select 1 from public.money_ledger l
                           where l.booking_id = p_booking.id and l.kind = 'transfer' and l.reason = 'odd_cent_absorbed')) then
      return null;
    end if;
    return greatest(v_at, (select max(c.done_at) from public.booking_collections c where c.booking_id = p_booking.id));
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

revoke all on function public.start_collection(uuid, text) from public, anon, authenticated;
grant execute on function public.start_collection(uuid, text) to service_role;
revoke all on function public.collections_due() from public, anon, authenticated;
grant execute on function public.collections_due() to service_role;
revoke all on function public.collection_side_is_due(public.venue_bookings, text) from public, anon, authenticated;
grant execute on function public.collection_side_is_due(public.venue_bookings, text) to service_role;
revoke all on function public.booking_odd_cent_due() from public, anon, authenticated;
grant execute on function public.booking_odd_cent_due() to service_role;
