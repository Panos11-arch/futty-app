-- P8 review fixes (PR #63; docs/specs/13-payments-bookings.md, "Gipedo Pano").
--
--   1. Expired holds. A captain's hold Stripe cancels on its own (it expired
--      after about 7 days) is marked 'expired', not put back to unpaid, and
--      settles like any other hold: the job finds it gone, so what it should
--      have paid becomes that captain's debt (decision 3); a winner's owes
--      nothing. Before, the share went back to 'pending' and was never
--      settled, so a loser whose hold expired before the result paid nothing.
--   2. Offering again. Each offer is an attempt (offer_attempt) so its
--      Stripe key is new (create-share-payment), and the intents of earlier
--      attempts are kept (replaced_intent_ids). A lapsed or withdrawn
--      offer's open payment is released, so it can't be completed later. A
--      late hold on a cancelled share of a live booking is released on its
--      own ('share_cancelled'); 'booking_cancelled' made the webhook release
--      every hold on the booking.
--   4. Cancelling while a settlement waits. The booker cancelling the whole
--      team (after "play as normal") or the venue cancelling stands down a
--      waiting play_normal or pull-out settlement, and the normal
--      cancellation rules apply to the hold. The job claims each settlement
--      it carries out (claimed_at); while one is claimed the cancel is
--      refused with payment_in_progress, so the two never both take money.
--   7. A Premium opponent's odd cent goes on the booking team (decision 4);
--      play_normal_cents only for the booker; the opponent-left wording says
--      whether they withdrew or the offer lapsed; a pull-out less than 6
--      hours before kickoff makes the booking's match if it isn't there yet.

-- 0. Columns.
alter table public.booking_payment_shares drop constraint booking_payment_shares_status_check;
alter table public.booking_payment_shares add constraint booking_payment_shares_status_check
  check (status in ('pending', 'authorized', 'paid', 'refunded', 'cancelled', 'covered', 'credited', 'forfeited',
                    'refund_due', 'expired'));

alter table public.booking_payment_shares
  add column offer_attempt integer check (offer_attempt >= 1),
  add column replaced_intent_ids text[] not null default '{}',
  add column hold_expired_at timestamptz;
comment on column public.booking_payment_shares.offer_attempt is
  'Gipedo Pano opponent: which offer this is (1, 2, ...); keys its Stripe intent. Null otherwise.';
comment on column public.booking_payment_shares.replaced_intent_ids is
  'Intents of earlier attempts on this share (a Gipedo Pano opponent offering again).';
comment on column public.booking_payment_shares.hold_expired_at is
  'A Gipedo Pano captain''s hold Stripe cancelled on its own (status expired).';

update public.booking_payment_shares set offer_attempt = 1 where gipedo_side = 'b' and offer_attempt is null;

alter table public.gipedo_settlements drop constraint gipedo_settlements_status_check;
alter table public.gipedo_settlements add constraint gipedo_settlements_status_check
  check (status in ('due', 'done', 'debt', 'cancelled'));
alter table public.gipedo_settlements drop constraint gipedo_settlements_outcome_check;
alter table public.gipedo_settlements add constraint gipedo_settlements_outcome_check
  check (outcome in ('captured', 'released', 'gone', 'cancelled'));
alter table public.gipedo_settlements add column claimed_at timestamptz;

-- 1. A hold Stripe cancelled on its own. As in
-- 20261110165054_pay_cancellations_hold_cancelled for every other share.
alter function public.release_share_credit_reservation(uuid, text, boolean) rename to release_share_credit_reservation_modes;

create function public.release_share_credit_reservation(
  p_share_id uuid,
  p_intent_id text,
  p_hold_released boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
begin
  -- The same lock order as the function it wraps: booking, then share.
  select * into v_booking from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;

  if v_share.gipedo_side is not null and v_share.status = 'authorized' and coalesce(p_hold_released, false)
     and v_share.stripe_payment_intent_id = p_intent_id and v_booking.status <> 'cancelled'
     and v_share.release_job_intent_id is distinct from p_intent_id then
    update public.booking_payment_shares set status = 'expired', hold_expired_at = now() where id = v_share.id;
    perform public.record_intent_cancelled(v_share.booking_id, v_share.id, null, p_intent_id, 'gipedo_hold_expired');
    insert into public.admin_alerts (kind, booking_id, share_id, details)
    values ('hold_cancelled', v_share.booking_id, v_share.id, jsonb_build_object(
      'intent_id', p_intent_id, 'amount_cents', v_share.amount_cents, 'gipedo_side', v_share.gipedo_side,
      'booking_status', v_booking.status))
    on conflict do nothing;
    return true;
  end if;
  return public.release_share_credit_reservation_modes(p_share_id, p_intent_id, p_hold_released);
end;
$$;

-- Every match with a final result settles its holds, an expired one too
-- (gipedo_settlements_due reports it not live, so it is 'gone').
create or replace function public.gipedo_settle_from_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select s.id as share_id, s.gipedo_side, r.outcome
    from public.match_result_confirmed r
    join public.venue_bookings b on b.id = r.booking_id
    join public.booking_payment_shares s on s.booking_id = b.id
    where b.payment_mode = 'gipedo_pano'
      and b.status = 'confirmed'
      and s.gipedo_side is not null
      and s.status in ('authorized', 'expired')
      and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id)
  loop
    if public.gipedo_add_settlement(v_row.share_id, case
         when v_row.outcome = 'side_a_won' then case when v_row.gipedo_side = 'a' then 'won' else 'lost' end
         when v_row.outcome = 'side_b_won' then case when v_row.gipedo_side = 'b' then 'won' else 'lost' end
         else 'split'  -- a draw, a dispute or no result
       end) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- 2. A late hold on a cancelled share. As in
-- 20261110165054_pay_cancellations_hold_cancelled, except that the reason
-- is 'booking_cancelled' only when the booking is: stripe-webhook then
-- releases every hold on it. A share cancelled on a live booking (a lapsed
-- Gipedo Pano offer, a player's own spot) releases only its own intent.
alter function public.share_payment_held(uuid, text, integer, text, timestamptz) rename to share_payment_held_modes;

create function public.share_payment_held(
  p_share_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_payment_method_id text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- The booking first, as every hold webhook locks it (booking, then share).
  perform 1 from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  v_result := public.share_payment_held_modes(p_share_id, p_intent_id, p_amount_cents, p_payment_method_id, p_at);
  if v_result ->> 'reason' = 'booking_cancelled' and not exists (
       select 1 from public.venue_bookings b
       join public.booking_payment_shares s on s.booking_id = b.id
       where s.id = p_share_id and b.status = 'cancelled') then
    return v_result || jsonb_build_object('reason', 'share_cancelled');
  end if;
  return v_result;
end;
$$;

-- What create-share-payment plans with: plus the offer attempt. As in
-- 20261110190002_pay_collection_debt otherwise.
create or replace function public.plan_share_payment(
  p_share_id uuid,
  p_profile_id uuid,
  p_method text,
  p_accept_non_refundable boolean,
  p_use_credit boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.share_payment_plan(s, p_profile_id, p_method, p_accept_non_refundable, p_use_credit)
         || jsonb_build_object('stripe_setup_intent_id', s.stripe_setup_intent_id, 'offer_attempt', s.offer_attempt)
  from (select 1) one
  left join public.booking_payment_shares s on s.id = p_share_id;
$$;

-- As in 20261113115752_pay_gipedo_opposition, plus: each offer is an
-- attempt, and the intents of earlier attempts are kept.
create or replace function public.offer_opposition(p_post_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_hold record;
begin
  if not exists (select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain') then
    raise exception 'not_captain';
  end if;
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then raise exception 'post_not_found'; end if;
  if v_post.type <> 'opposition' then raise exception 'not_an_opposition_post'; end if;
  if v_post.status <> 'open' then raise exception 'post_closed'; end if;
  if v_post.team_id = p_team_id then raise exception 'cannot_offer_own_post'; end if;
  perform public.assert_venue_live(public.squad_post_venue_id(v_post));

  if v_post.venue_booking_id is not null then
    select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id for update;
  end if;

  if v_booking.payment_mode = 'gipedo_pano' then
    if v_booking.status <> 'confirmed'
       or now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '24 hours' then
      raise exception 'post_closed';
    end if;
    if exists (select 1 from public.booking_payment_shares s
               where s.booking_id = v_booking.id and s.profile_id = auth.uid()
                 and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) then
      raise exception 'already_in_booking';
    end if;
    -- A captain who pulled out can't come back (one spot per player per
    -- booking, as for a player who cancels).
    if exists (select 1 from public.booking_payment_shares s
               where s.booking_id = v_booking.id and s.profile_id = auth.uid() and s.gipedo_side is not null
                 and s.status <> 'cancelled') then
      raise exception 'cannot_rejoin';
    end if;
    select * into v_hold from public.money_share(v_booking.amount_cents, v_booking.capacity, 'gipedo_pano', true,
      exists (select 1 from public.profiles where id = auth.uid() and is_premium), 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, gipedo_side,
       offer_attempt)
    values
      (v_booking.id, auth.uid(), v_hold.card_cents, v_hold.pitch_cents, v_hold.fee_cents, 0, false, 'pending', 'b', 1)
    on conflict (booking_id, profile_id) do update
      set amount_cents = excluded.amount_cents, pitch_cents = excluded.pitch_cents, fee_cents = excluded.fee_cents,
          cash_cents = 0, status = 'pending', gipedo_side = 'b', created_at = now(),
          offer_attempt = coalesce(public.booking_payment_shares.offer_attempt, 1) + 1,
          replaced_intent_ids = case
            when public.booking_payment_shares.stripe_payment_intent_id is null then public.booking_payment_shares.replaced_intent_ids
            else array_append(public.booking_payment_shares.replaced_intent_ids,
                              public.booking_payment_shares.stripe_payment_intent_id) end,
          stripe_payment_intent_id = null, stripe_setup_intent_id = null, payment_method = 'card',
          credit_cents = 0, held_at = null, capture_due_at = null;
  end if;

  update public.squad_posts set status = 'matched', matched_team_id = p_team_id where id = p_post_id;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
  values (p_post_id, v_post.team_id, p_team_id, 'pending_score', 0);
end;
$$;

-- As in 20261113115752_pay_gipedo_opposition, plus: the offer's open
-- payment is released (so it can't be completed afterwards), and the
-- booking captain is told whether the opponent withdrew or didn't place
-- their hold in time, and whether the post is open again.
create or replace function public.gipedo_withdraw_offer(p_post_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_team text;
  v_reopened boolean;
  v_next text;
begin
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null or v_post.status <> 'matched' then
    return false;
  end if;
  select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id for update;
  select * into v_share from public.booking_payment_shares
  where booking_id = v_booking.id and gipedo_side = 'b' and status = 'pending' for update;
  if v_share.id is null then
    return false;
  end if;

  update public.booking_payment_shares set status = 'cancelled' where id = v_share.id;
  if v_share.stripe_payment_intent_id is not null then
    insert into public.money_releases (booking_id, share_id, stripe_intent_id, reason)
    values (v_booking.id, v_share.id, v_share.stripe_payment_intent_id, 'gipedo_offer_' || p_reason)
    on conflict (stripe_intent_id) where status = 'pending' do nothing;
  end if;
  update public.friendly_matches set status = 'cancelled'
  where squad_post_id = p_post_id and coalesce(status, '') <> 'cancelled';
  select name into v_team from public.teams where id = v_post.matched_team_id;
  v_reopened := now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '24 hours';
  update public.squad_posts
  set status = case when v_reopened then 'open' else 'closed' end,
      matched_team_id = null
  where id = p_post_id;
  perform public.booking_match_drop_friendly(v_booking.id);

  v_next := case when v_reopened then 'so your post is open again.'
                 else 'It''s less than 24 hours to kickoff, so the post stays closed and you''ll be asked how to play it.' end;
  perform public.send_notification(v_booking.created_by, 'gipedo_opponent_left', jsonb_build_object(
    'title', case when p_reason = 'withdrawn' then 'Your opponent withdrew' else 'Your opponent didn''t confirm' end,
    'body', case when p_reason = 'withdrawn'
                 then format('%s withdrew their offer for your Gipedo Pano game at %s, %s',
                             coalesce(v_team, 'The other team'), public.booking_label(v_booking), v_next)
                 else format('%s didn''t place their hold within 15 minutes for your Gipedo Pano game at %s, %s',
                             coalesce(v_team, 'The other team'), public.booking_label(v_booking), v_next) end,
    'bookingId', v_booking.id,
    'reason', p_reason
  ));
  return true;
end;
$$;

-- 4. Carrying out settlements: each is claimed for 2 minutes while the job
-- calls Stripe, so a cancellation can tell it's under way. A failure lets
-- it go at once. As in 20261113115755_pay_gipedo_settle otherwise.
create or replace function public.gipedo_settlements_due()
returns table (settlement_id uuid, booking_id uuid, share_id uuid, stripe_payment_intent_id text,
               capture_cents integer, hold_live boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with claimed as (
    update public.gipedo_settlements g
    set claimed_at = now()
    where g.id in (
      select g2.id from public.gipedo_settlements g2
      where g2.status = 'due' and (g2.next_attempt_at is null or g2.next_attempt_at <= now())
        and (g2.claimed_at is null or g2.claimed_at <= now() - interval '2 minutes')
      order by g2.created_at
      limit 50
      for update skip locked)
    returning g.*
  )
  select c.id, c.booking_id, c.share_id, s.stripe_payment_intent_id, c.capture_cents,
         s.status = 'authorized' and s.stripe_payment_intent_id is not null
  from claimed c
  join public.booking_payment_shares s on s.id = c.share_id
  order by c.created_at;
end;
$$;

create or replace function public.gipedo_settlement_failed(p_settlement_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gipedo_settlements;
begin
  update public.gipedo_settlements
  set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(attempts + 1),
      claimed_at = null
  where id = p_settlement_id and status = 'due'
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('result', 'ignored');
  end if;
  if v_row.attempts >= 3 then
    insert into public.admin_alerts (kind, booking_id, share_id, details)
    values ('capture_failing', v_row.booking_id, v_row.share_id, jsonb_build_object(
      'gipedo_settlement_id', v_row.id, 'attempts', v_row.attempts, 'last_error', p_error,
      'capture_cents', v_row.capture_cents))
    on conflict (kind, share_id) where resolved_at is null do nothing;
  end if;
  return jsonb_build_object('result', 'failed', 'attempts', v_row.attempts);
end;
$$;

-- Cancelling the whole team or as the venue: a waiting play_normal or
-- pull-out settlement is stood down first, so the normal cancellation rules
-- decide what the hold pays; one the job is carrying out makes the cancel
-- wait. As in 20261110124905_pay_cancellations_fixes otherwise.
alter function public.cancel_booking_internal(uuid, text, uuid, text) rename to cancel_booking_internal_modes;

create function public.cancel_booking_internal(
  p_booking_id uuid,
  p_scope text,
  p_profile_id uuid,
  p_expected_quote text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_scope in ('whole_team', 'venue') then
    perform 1 from public.venue_bookings where id = p_booking_id for update;
    perform 1 from public.gipedo_settlements where booking_id = p_booking_id and status = 'due' for update;
    if exists (select 1 from public.gipedo_settlements g
               where g.booking_id = p_booking_id and g.status = 'due'
                 and g.claimed_at > now() - interval '2 minutes') then
      raise exception 'payment_in_progress';
    end if;
    update public.gipedo_settlements
    set status = 'cancelled', outcome = 'cancelled', done_at = now()
    where booking_id = p_booking_id and status = 'due' and reason in ('play_normal', 'pull_out_fee');
  end if;
  return public.cancel_booking_internal_modes(p_booking_id, p_scope, p_profile_id, p_expected_quote);
end;
$$;

-- 7. A 50/50 split of the service fee: half of the two holds' fees together,
-- rounded up, the odd cent on the booking team (decision 4). The opponent
-- pays half its own fee, rounded down; the booking team the rest.
-- 550 + 550: 275 / 275. 495 (Premium booking captain) + 550: 248 / 275.
-- 550 + 495 (Premium opponent): 276 / 247.
create function public.money_gipedo_split_fee(
  p_fee_a_cents integer,
  p_fee_b_cents integer,
  out a_fee_cents integer,
  out b_fee_cents integer
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_fee_a_cents is null or p_fee_a_cents < 0 or p_fee_b_cents is null or p_fee_b_cents < 0 then
    raise exception 'invalid_money_input';
  end if;
  b_fee_cents := p_fee_b_cents / 2;
  a_fee_cents := (p_fee_a_cents + p_fee_b_cents + 1) / 2 - b_fee_cents;
end;
$$;

-- One hold's settlement. As in 20261113115755_pay_gipedo_settle, except a
-- split's fee half is shared across both holds (money_gipedo_split_fee).
create or replace function public.gipedo_add_settlement(p_share_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_other public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_half record;
  v_split record;
  v_pitch integer;
  v_fee integer;
  v_inserted integer;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id;
  if v_share.id is null or v_share.gipedo_side is null then
    raise exception 'not_a_gipedo_hold';
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;

  if p_reason in ('lost', 'play_normal') then
    v_pitch := v_share.pitch_cents;
    v_fee := v_share.fee_cents;
  elsif p_reason = 'won' then
    v_pitch := 0;
    v_fee := 0;
  elsif p_reason = 'split' then
    select * into v_half from public.money_gipedo_half(v_share.pitch_cents, v_share.fee_cents, v_share.gipedo_side = 'a');
    v_pitch := v_half.pitch_cents;
    v_fee := v_half.fee_cents;
    -- The other team's hold in this match (not one that pulled out).
    select * into v_other from public.booking_payment_shares o
    where o.booking_id = v_share.booking_id and o.gipedo_side is not null and o.gipedo_side <> v_share.gipedo_side
      and (o.status in ('authorized', 'expired')
           or exists (select 1 from public.gipedo_settlements g where g.share_id = o.id and g.reason = 'split'))
    order by o.created_at desc
    limit 1;
    if v_other.id is not null then
      select * into v_split from public.money_gipedo_split_fee(
        case when v_share.gipedo_side = 'a' then v_share.fee_cents else v_other.fee_cents end,
        case when v_share.gipedo_side = 'a' then v_other.fee_cents else v_share.fee_cents end);
      v_fee := case when v_share.gipedo_side = 'a' then v_split.a_fee_cents else v_split.b_fee_cents end;
    end if;
  elsif p_reason = 'pull_out_fee' then
    -- 100 cents per player in the booking, to Futty (decided 12 November).
    v_pitch := 0;
    v_fee := least(100 * v_booking.capacity, v_share.pitch_cents + v_share.fee_cents);
  else
    raise exception 'invalid_reason';
  end if;

  insert into public.gipedo_settlements
    (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
  values
    (v_share.booking_id, v_share.id, v_share.profile_id, v_share.gipedo_side, p_reason, v_pitch + v_fee, v_pitch, v_fee)
  on conflict (share_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

-- A pull-out. As in 20261113115755_pay_gipedo_settle, except a forfeit
-- makes the booking's match first if it doesn't exist yet (its creation
-- failed and is still being retried).
create or replace function public.gipedo_pull_out(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_quote jsonb;
  v_side text;
  v_match public.matches;
  v_post public.squad_posts;
  v_other uuid;
  v_team text;
  v_opponent_share public.booking_payment_shares;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_quote := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  if v_quote is null then
    raise exception 'cannot_pull_out';
  end if;
  v_side := v_quote ->> 'side';
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1 for update;
  select * into v_opponent_share from public.booking_payment_shares
  where booking_id = p_booking_id and gipedo_side = 'b' and status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = booking_payment_shares.id);

  if v_quote ->> 'kind' = 'free' then
    -- An offer not yet held goes with the booking.
    if v_opponent_share.id is not null then
      update public.booking_payment_shares set status = 'cancelled' where id = v_opponent_share.id;
    end if;
    perform public.gipedo_cancel_booking(p_booking_id, 'The booking team cancelled before anyone took it on; holds are released.');
    return jsonb_build_object('result', 'cancelled', 'cents', 0);
  end if;

  v_other := case when v_side = 'a' then v_opponent_share.profile_id else v_booking.created_by end;
  select name into v_team from public.teams
  where id = case when v_side = 'a' then v_booking.team_id else v_post.matched_team_id end;

  if v_quote ->> 'kind' = 'forfeit' then
    select * into v_match from public.matches where booking_id = p_booking_id;
    if v_match.id is null then
      perform public.create_match_for_booking(p_booking_id);
      select * into v_match from public.matches where booking_id = p_booking_id;
    end if;
    if v_match.id is null then
      raise exception 'match_not_ready';
    end if;
    perform public.record_match_forfeit(v_match.id, v_side, 'pulled_out');
    perform public.send_notification(v_other, 'gipedo_pulled_out', jsonb_build_object(
      'title', 'Your opponent pulled out',
      'body', format('%s pulled out of your Gipedo Pano game at %s less than 6 hours before kickoff, so they pay the '
                     || 'pitch and your hold is released.', coalesce(v_team, 'The other team'), public.booking_label(v_booking)),
      'bookingId', p_booking_id
    ));
    return jsonb_build_object('result', 'forfeit', 'cents', (v_quote ->> 'cents')::integer);
  end if;

  perform public.gipedo_add_settlement((v_quote ->> 'share_id')::uuid, 'pull_out_fee');
  if v_side = 'a' then
    perform public.gipedo_cancel_booking(p_booking_id,
      'The booking team pulled out, so the slot is freed and the other team''s hold is released.');
  else
    update public.friendly_matches set status = 'cancelled'
    where squad_post_id = v_post.id and coalesce(status, '') <> 'cancelled';
    update public.squad_posts
    set status = case when now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '24 hours'
                      then 'closed' else 'open' end,
        matched_team_id = null
    where id = v_post.id;
    perform public.booking_match_drop_friendly(p_booking_id);
    perform public.send_notification(v_other, 'gipedo_pulled_out', jsonb_build_object(
      'title', 'Your opponent pulled out',
      'body', format('%s pulled out of your Gipedo Pano game at %s. Your hold stays and your post is open again.',
                     coalesce(v_team, 'The other team'), public.booking_label(v_booking)),
      'bookingId', p_booking_id
    ));
  end if;
  return jsonb_build_object('result', 'pulled_out', 'cents', (v_quote ->> 'cents')::integer);
end;
$$;

-- The booking screen. As in 20261113115755_pay_gipedo_settle, except
-- play_normal_cents (the booking captain's hold) is only for the booker
-- (spec 13: only the booker sees everyone's amounts), and an expired hold
-- shows as unpaid.
create or replace function public.booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_detail jsonb := public.booking_detail_modes(p_booking_id);
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_mine public.booking_payment_shares;
  v_opponent public.booking_payment_shares;
  v_booker_hold public.booking_payment_shares;
  v_settlement public.gipedo_settlements;
  v_pull jsonb;
  v_roster jsonb;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.gipedo_side is not null) then
    return v_detail || jsonb_build_object('gipedo', null);
  end if;
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1;
  select * into v_mine from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid and gipedo_side is not null;
  select * into v_opponent from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.gipedo_side = 'b' and s.status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.reason = 'pull_out_fee');
  select * into v_booker_hold from public.booking_payment_shares
  where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
  select * into v_settlement from public.gipedo_settlements where share_id = v_mine.id;
  v_pull := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  -- A captain's card that is only held shows as held, not paid; one whose
  -- hold expired as unpaid.
  select coalesce(jsonb_agg(case when s.gipedo_side is not null and s.status = 'authorized'
                                 then r.e || jsonb_build_object('state', 'held')
                                 when s.gipedo_side is not null and s.status = 'expired'
                                 then r.e || jsonb_build_object('state', 'unpaid')
                                 else r.e end order by r.ord), '[]'::jsonb)
    into v_roster
  from jsonb_array_elements(v_detail -> 'roster') with ordinality as r(e, ord)
  left join public.booking_payment_shares s on s.id = (r.e ->> 'share_id')::uuid;

  return v_detail
    || jsonb_build_object('roster', v_roster)
    || jsonb_build_object('can_cancel', case when v_mine.id is not null and v_booking.payment_mode = 'gipedo_pano'
                                             then jsonb_build_object('my_spot', false, 'whole_team', false)
                                             else v_detail -> 'can_cancel' end)
    || jsonb_build_object('gipedo', jsonb_build_object(
      'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = v_booking.team_id),
      'opponent', jsonb_build_object(
        'state', case when v_opponent.status = 'authorized' then 'held' when v_opponent.id is not null then 'offered' else 'none' end,
        'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t
                 where t.id = v_post.matched_team_id and v_opponent.id is not null)),
      'my_side', v_mine.gipedo_side,
      'pull_out', v_pull - 'share_id' - 'side',
      'choice_due', v_booking.created_by = v_uid and v_booking.payment_mode = 'gipedo_pano'
                    and v_booking.status = 'confirmed' and v_booking.gipedo_no_opponent_at is not null
                    and v_booking.gipedo_choice is null
                    and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '6 hours',
      'choice', v_booking.gipedo_choice,
      'play_normal_cents', case when v_booking.created_by = v_uid then v_booker_hold.amount_cents end,
      'settlement', case when v_settlement.id is null then null else jsonb_build_object(
        'reason', v_settlement.reason, 'capture_cents', v_settlement.capture_cents, 'status', v_settlement.status) end));
end;
$$;

revoke all on function public.release_share_credit_reservation_modes(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.release_share_credit_reservation_modes(uuid, text, boolean) to service_role;
revoke all on function public.release_share_credit_reservation(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.release_share_credit_reservation(uuid, text, boolean) to service_role;
revoke all on function public.gipedo_settle_from_results() from public, anon, authenticated;
grant execute on function public.gipedo_settle_from_results() to service_role;
revoke all on function public.share_payment_held_modes(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.share_payment_held_modes(uuid, text, integer, text, timestamptz) to service_role;
revoke all on function public.share_payment_held(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.share_payment_held(uuid, text, integer, text, timestamptz) to service_role;
revoke all on function public.plan_share_payment(uuid, uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.plan_share_payment(uuid, uuid, text, boolean, boolean) to service_role;
revoke all on function public.offer_opposition(uuid, uuid) from public, anon;
grant execute on function public.offer_opposition(uuid, uuid) to authenticated, service_role;
revoke all on function public.gipedo_withdraw_offer(uuid, text) from public, anon, authenticated;
grant execute on function public.gipedo_withdraw_offer(uuid, text) to service_role;
revoke all on function public.gipedo_settlements_due() from public, anon, authenticated;
grant execute on function public.gipedo_settlements_due() to service_role;
revoke all on function public.gipedo_settlement_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.gipedo_settlement_failed(uuid, text) to service_role;
revoke all on function public.cancel_booking_internal_modes(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking_internal_modes(uuid, text, uuid, text) to service_role;
revoke all on function public.cancel_booking_internal(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking_internal(uuid, text, uuid, text) to service_role;
revoke all on function public.money_gipedo_split_fee(integer, integer) from public, anon, authenticated;
grant execute on function public.money_gipedo_split_fee(integer, integer) to service_role;
revoke all on function public.gipedo_add_settlement(uuid, text) from public, anon, authenticated;
grant execute on function public.gipedo_add_settlement(uuid, text) to service_role;
revoke all on function public.gipedo_pull_out(uuid) from public, anon;
grant execute on function public.gipedo_pull_out(uuid) to authenticated, service_role;
revoke all on function public.booking_detail(uuid) from public, anon;
grant execute on function public.booking_detail(uuid) to authenticated, service_role;
