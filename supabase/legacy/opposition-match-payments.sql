-- Wires real payment into "Offer to play them" (app/squads.tsx's
-- OppositionPostCard). Before this, offer_opposition only flipped the post
-- to 'matched' — nobody on either roster ever owed anything, not even the
-- original booker's own teammates. Now, once a team offers:
--   - The venue's total cost is split across BOTH full rosters combined
--     (e.g. 10 payers for 5-a-side, not 5) — confirmed approach.
--   - Every member (captain/player, not substitutes) of BOTH teams gets a
--     pending booking_payment_shares row and must authorize it, same
--     authorize-then-capture/void-if-never-fills model as every other
--     payment in this app (cancel-unpaid-bookings already generalizes to
--     however many shares a booking has — no changes needed there).
--   - The offering captain pays their own share immediately, right from the
--     "Offer" action (app/squads.tsx) — same combined offer+pay UX as
--     join-squad-post.tsx's "Join & Pay My Share".
--
-- Run AFTER supabase/legacy/booking-payment-splits.sql, supabase/legacy/manual-capture-
-- payments.sql, supabase/legacy/squads.sql, supabase/legacy/scores.sql and supabase/legacy/
-- notifications.sql. Run in the Supabase dashboard: SQL Editor > New query >
-- Run. Safe to re-run.

-- How many total payment shares a booking now needs — doubled once it has a
-- matched opposition post (two full rosters), same as a plain "need players"
-- booking (one roster) otherwise. Shared by add_booking_share_internal below
-- and mirrored in supabase/functions/stripe-webhook (captureIfFull) and
-- app/squads.tsx (client-side estimate shown before offering).
create or replace function public.booking_total_shares_needed(p_booking_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select public.format_player_count(b.format) * (
    case when exists (
      select 1 from public.squad_posts sp
      where sp.venue_booking_id = p_booking_id and sp.type = 'opposition' and sp.status = 'matched'
    ) then 2 else 1 end
  )
  from public.venue_bookings b
  where b.id = p_booking_id;
$$;

-- Redefined from supabase/legacy/booking-payment-splits.sql: same shape, just reads
-- the (possibly doubled) total from booking_total_shares_needed instead of
-- the flat format_player_count.
create or replace function public.add_booking_share_internal(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
  v_current_count integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  v_total_needed := public.booking_total_shares_needed(p_booking_id);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id;

  if v_current_count >= v_total_needed then
    return; -- booking already has a share for every slot
  end if;

  v_share_cents := v_booking.amount_cents / v_total_needed;

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$$;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due'));

-- Redefined from supabase/legacy/squads.sql: now also brings in both rosters'
-- payment shares once a match happens, recomputing any already-existing
-- pending share (e.g. the booker's own, created back at book_slot time,
-- still against the single-roster split) to the new doubled-roster amount.
-- Deliberately only touches 'pending' shares — one already 'authorized' or
-- 'paid' is a real Stripe hold/charge at a fixed amount and can't be
-- silently rewritten; that one player keeps the pre-match amount, everyone
-- else gets the correct post-match one. No notifications are sent from
-- here — those only go out once the OFFERING captain's own payment actually
-- succeeds (app/squads.tsx / supabase/functions/notify-opposition-matched),
-- so nobody gets told "you're playing, pay up" for a match that then rolls
-- back because the very first payment failed.
create or replace function public.offer_opposition(p_post_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  if v_post.team_id = p_team_id then
    raise exception 'cannot_offer_own_post';
  end if;

  update public.squad_posts
  set status = 'matched', matched_team_id = p_team_id
  where id = p_post_id;

  if v_post.venue_booking_id is not null then
    select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id;

    if v_booking.id is not null and v_booking.amount_cents > 0 and v_booking.status <> 'cancelled' then
      v_total_needed := public.booking_total_shares_needed(v_post.venue_booking_id);
      v_share_cents := v_booking.amount_cents / v_total_needed;

      update public.booking_payment_shares
      set amount_cents = v_share_cents
      where booking_id = v_post.venue_booking_id
        and status = 'pending';

      perform public.add_booking_share_internal(v_post.venue_booking_id, tm.profile_id)
      from public.team_members tm
      where tm.team_id in (v_post.team_id, p_team_id)
        and tm.role in ('captain', 'player');
    end if;
  end if;
end;
$$;

grant execute on function public.offer_opposition(uuid, uuid) to authenticated;

-- Redefined from supabase/legacy/scores.sql: on top of reopening the post, this now
-- also undoes the payment side of a match — deletes the now-unmatched
-- team's still-'pending' shares outright (they're no longer part of this
-- game at all) and reverts the remaining side's still-'pending' shares back
-- to the single-roster amount. Reused for BOTH the deliberate
-- before-kickoff cancel this always supported, and the immediate rollback
-- app/squads.tsx triggers if the offering captain's own first payment
-- fails or is cancelled — same "never leave a real hold/charge behind for a
-- match that didn't happen" rule as cancel_pending_share (item 1).
create or replace function public.cancel_opposition_offer(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;

  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;

  if v_post.status <> 'matched' then
    raise exception 'not_matched';
  end if;

  if not exists (
    select 1 from public.team_members
    where profile_id = auth.uid()
      and role = 'captain'
      and team_id in (v_post.team_id, v_post.matched_team_id)
  ) then
    raise exception 'not_captain';
  end if;

  if v_post.scheduled_at is null or now() >= v_post.scheduled_at - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  delete from public.friendly_matches where squad_post_id = p_post_id;

  update public.squad_posts
  set status = 'open', matched_team_id = null
  where id = p_post_id;

  if v_post.venue_booking_id is not null then
    delete from public.booking_payment_shares
    where booking_id = v_post.venue_booking_id
      and status = 'pending'
      and profile_id in (
        select profile_id from public.team_members where team_id = v_post.matched_team_id
      );

    update public.booking_payment_shares s
    set amount_cents = coalesce(
      (select b.amount_cents / public.format_player_count(b.format)
       from public.venue_bookings b
       where b.id = v_post.venue_booking_id),
      s.amount_cents
    )
    where s.booking_id = v_post.venue_booking_id
      and s.status = 'pending';
  end if;
end;
$$;

grant execute on function public.cancel_opposition_offer(uuid) to authenticated;
