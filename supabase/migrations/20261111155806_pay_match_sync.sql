-- Bookings and their match (docs/specs/match-record.md sections 1a and 6.1,
-- contract 1; decided 11 November, written into spec 13). The payment code
-- calls public.create_match_for_booking (A2):
--   - when a booking becomes confirmed;
--   - when a share starts or stops holding a spot (a player joins, cancels,
--     is refunded or credited) while the booking is confirmed;
--   - when a confirmed booking is moved (day, time or venue), so the
--     match's kickoff, end and result deadline follow it;
--   - when the booking is cancelled and has a match, which voids it.
--   - when a friendly is agreed for the booking (or moved to another
--     squad post), so a pickup match can become a named game.
-- A booking going back to pending_payment needs no call (decision 1a.2), nor
-- does a share moving between the states that hold a spot (pending, held,
-- paid, covered). Only bookings made since P4a (with a payment mode) get a
-- match: older ones keep the old match logic. Owner blocks never do.
--
-- Bookings change in many places (book_slot, the payment webhooks, the
-- 15-minute expiry, cancellations, the release jobs, joining), so the calls
-- are made by triggers on the two tables, after each change. The function
-- is idempotent, so calling it again is always safe.
--
-- A failure in the match code never blocks a payment or a cancellation: it
-- is caught, recorded in booking_match_syncs and retried by run-payment-jobs
-- after 1, 5, 15, then every 60 minutes, until it succeeds or the booking's
-- match is void; the founders get one admin alert, at the third failure
-- (spec 13, "Bookings and their match").

-- Syncs still owed after a failure.
create table public.booking_match_syncs (
  booking_id uuid primary key references public.venue_bookings (id) on delete cascade,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.booking_match_syncs enable row level security;
revoke all on public.booking_match_syncs from public, anon, authenticated;
grant all on public.booking_match_syncs to service_role;

alter table public.admin_alerts drop constraint admin_alerts_kind_check;
alter table public.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('capture_failing', 'cancellation_failing', 'hold_cancelled', 'collection_failing', 'match_sync_failed'));

-- Brings one booking's match in step, if it has one to have. Returns false
-- when the match code failed (recorded for a retry), true otherwise.
create or replace function public.sync_booking_match(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_attempts integer;
  v_error text;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  -- Nothing to do: gone, not a game, from before P4a, waiting for payment,
  -- or cancelled before it ever had a match.
  if v_booking.id is null
     or v_booking.booking_type <> 'user_booking'
     or v_booking.payment_mode is null
     or v_booking.status not in ('confirmed', 'cancelled')
     or (v_booking.status = 'cancelled'
         and not exists (select 1 from public.matches m where m.booking_id = p_booking_id))
     -- A void match never changes again: nothing left to sync or retry.
     or exists (select 1 from public.matches m where m.booking_id = p_booking_id and m.status = 'void') then
    delete from public.booking_match_syncs where booking_id = p_booking_id;
    return true;
  end if;

  begin
    perform public.create_match_for_booking(p_booking_id);
  exception when others then
    v_error := sqlerrm;
    insert into public.booking_match_syncs (booking_id, attempts, next_attempt_at, last_error)
    values (p_booking_id, 1, public.money_backoff_at(1), v_error)
    on conflict (booking_id) do update
      set attempts = public.booking_match_syncs.attempts + 1,
          next_attempt_at = public.money_backoff_at(public.booking_match_syncs.attempts + 1),
          last_error = excluded.last_error,
          updated_at = now()
    returning attempts into v_attempts;
    if v_attempts = 3 then
      insert into public.admin_alerts (kind, booking_id, details)
      values ('match_sync_failed', p_booking_id, jsonb_build_object('attempts', v_attempts, 'last_error', v_error));
    end if;
    return false;
  end;

  delete from public.booking_match_syncs where booking_id = p_booking_id;
  return true;
end;
$$;

-- Job: failed syncs whose next try is due.
create or replace function public.booking_match_syncs_due()
returns table (booking_id uuid, attempts integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.booking_id, s.attempts from public.booking_match_syncs s
  where s.next_attempt_at <= now()
  order by s.next_attempt_at;
$$;

-- A booking became confirmed, was moved while confirmed, or was cancelled.
create or replace function public.booking_match_on_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_type <> 'user_booking' or new.payment_mode is null then
    return null;
  end if;
  if new.status = 'confirmed'
     and (tg_op = 'INSERT'
          or old.status is distinct from 'confirmed'
          or new.booking_day is distinct from old.booking_day
          or new.start_time is distinct from old.start_time
          or new.end_time is distinct from old.end_time
          or new.venue_id is distinct from old.venue_id) then
    perform public.sync_booking_match(new.id);
  elsif new.status = 'cancelled' and tg_op = 'UPDATE' and old.status is distinct from 'cancelled' then
    perform public.sync_booking_match(new.id);
  end if;
  return null;
end;
$$;
create trigger booking_match_on_booking
  after insert or update of status, booking_day, start_time, end_time, venue_id on public.venue_bookings
  for each row execute function public.booking_match_on_booking();

-- A share started or stopped holding a spot on a confirmed booking.
create or replace function public.booking_match_on_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean := tg_op <> 'INSERT' and old.status in ('pending', 'authorized', 'paid', 'covered');
  v_is boolean := tg_op <> 'DELETE' and new.status in ('pending', 'authorized', 'paid', 'covered');
  v_booking_id uuid := case when tg_op = 'DELETE' then old.booking_id else new.booking_id end;
begin
  if v_was = v_is then
    return null;
  end if;
  if exists (select 1 from public.venue_bookings b
             where b.id = v_booking_id and b.status = 'confirmed' and b.booking_type = 'user_booking'
               and b.payment_mode is not null) then
    perform public.sync_booking_match(v_booking_id);
  end if;
  return null;
end;
$$;
create trigger booking_match_on_share
  after insert or update of status or delete on public.booking_payment_shares
  for each row execute function public.booking_match_on_share();

-- A friendly was agreed for a booking (or moved to another squad post): the
-- booking's match is re-synced so it can become a named game. The booking
-- is found through squad_posts.venue_booking_id; sync_booking_match applies
-- the payment-mode rule and queues a retry on failure, so creating the
-- friendly is never blocked. A friendly moved off a booking re-syncs that
-- booking too.
create or replace function public.booking_match_on_friendly()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  v_old uuid;
begin
  select sp.venue_booking_id into v_new from public.squad_posts sp where sp.id = new.squad_post_id;
  if tg_op = 'UPDATE' then
    select sp.venue_booking_id into v_old from public.squad_posts sp where sp.id = old.squad_post_id;
  end if;
  if v_new is not null then
    perform public.sync_booking_match(v_new);
  end if;
  if v_old is not null and v_old is distinct from v_new then
    perform public.sync_booking_match(v_old);
  end if;
  return null;
end;
$$;
create trigger booking_match_on_friendly
  after insert or update of squad_post_id on public.friendly_matches
  for each row execute function public.booking_match_on_friendly();

revoke all on function public.sync_booking_match(uuid) from public, anon, authenticated;
grant execute on function public.sync_booking_match(uuid) to service_role;
revoke all on function public.booking_match_syncs_due() from public, anon, authenticated;
grant execute on function public.booking_match_syncs_due() to service_role;
revoke all on function public.booking_match_on_booking() from public, anon, authenticated;
revoke all on function public.booking_match_on_share() from public, anon, authenticated;
revoke all on function public.booking_match_on_friendly() from public, anon, authenticated;
