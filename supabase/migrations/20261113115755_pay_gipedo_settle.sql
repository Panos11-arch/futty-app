-- P8: settling Gipedo Pano bookings (payment_mode 'gipedo_pano';
-- docs/specs/13-payments-bookings.md, "Gipedo Pano", with the decisions of
-- 12 and 13 November).
--
-- Every outcome becomes one gipedo_settlements row per captain's hold: what
-- to take from it (0 = release it), split into the venue's pitch money and
-- Futty's part. run-payment-jobs carries each row out at Stripe once
-- (partial capture with amount_to_capture, or cancel) and reports back with
-- gipedo_settlement_done. A hold that is gone by then (expired) turns what
-- it should have paid into a debt: to the venue, or to Futty for a pull-out
-- fee; a hold that should pay nothing owes nothing.
--
--   lost          the losing team's hold, taken in full
--   won           the winning team's hold, released
--   split         a draw, a dispute or no result: half of each hold, the
--                 odd cent on the booking team
--   pull_out_fee  a team pulling out at least 6 hours before kickoff: 100
--                 cents per player in the booking, all Futty's
--   play_normal   no opponent, and the booking captain chose to play it as
--                 a normal booking: the hold taken in full, as the booker
--                 paying for everyone
--
-- Settling from results reads match_result_confirmed (matches confirmed,
-- disputed or no_result); a pull-out less than 6 hours before kickoff is
-- recorded there as that side's forfeit, so it pays as the loser.

-- 1. Tables.
create table public.gipedo_settlements (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.venue_bookings (id),
  share_id uuid not null unique references public.booking_payment_shares (id),
  profile_id uuid not null references public.profiles (id),
  side text not null check (side in ('a', 'b')),
  reason text not null check (reason in ('lost', 'won', 'split', 'pull_out_fee', 'play_normal')),
  capture_cents integer not null check (capture_cents >= 0),
  venue_cents integer not null check (venue_cents >= 0),
  futty_cents integer not null check (futty_cents >= 0),
  status text not null default 'due' check (status in ('due', 'done', 'debt')),
  outcome text check (outcome in ('captured', 'released', 'gone')),
  debt_id uuid references public.venue_debts (id),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint gipedo_settlements_adds_up check (venue_cents + futty_cents = capture_cents),
  constraint gipedo_settlements_done check ((status = 'due') = (outcome is null))
);
create index gipedo_settlements_due_idx on public.gipedo_settlements (next_attempt_at) where status = 'due';
create index gipedo_settlements_booking_idx on public.gipedo_settlements (booking_id);

alter table public.gipedo_settlements enable row level security;
revoke all on public.gipedo_settlements from public, anon, authenticated;
grant select, insert, update on public.gipedo_settlements to service_role;

-- No opponent 24 hours before kickoff (spec 13): when the captain was told,
-- and what they chose (decided 12 November: play as normal or cancel free;
-- no choice by 6 hours before kickoff cancels it free).
alter table public.venue_bookings
  add column gipedo_no_opponent_at timestamptz,
  add column gipedo_choice text check (gipedo_choice in ('play_normal', 'cancel', 'auto_cancel'));

alter table public.venue_debts drop constraint venue_debts_reason_check;
alter table public.venue_debts add constraint venue_debts_reason_check
  check (reason in ('unpaid_share', 'cash_unpaid', 'top_up_failed', 'guarantee_not_held', 'cancellation_fee',
                    'gipedo_hold_expired'));

-- 2. One hold's settlement (once per hold; a repeat changes nothing).
create or replace function public.gipedo_add_settlement(p_share_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_half record;
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

-- 3. Job: every Gipedo Pano match with a final result whose holds aren't
-- settled yet. Returns how many holds it settled.
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
      and s.status = 'authorized'
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

-- Is there an opponent in this Gipedo Pano game (offered, or held, and not
-- pulled out)?
create or replace function public.gipedo_has_opponent(p_booking_id uuid, p_held_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.booking_payment_shares s
    where s.booking_id = p_booking_id and s.gipedo_side = 'b'
      and s.status in ('authorized', case when p_held_only then 'authorized' else 'pending' end)
      and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id));
$$;

-- 4. A Gipedo Pano booking cancelled free: the slot is freed, the post
-- closed, everyone told; the booking captain's hold (and an opponent's) is
-- released by the release job, as for any cancelled booking.
create or replace function public.gipedo_cancel_booking(p_booking_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_player uuid;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.status = 'cancelled' then
    return;
  end if;
  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and status = 'covered';
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and status = 'pending' and stripe_payment_intent_id is null;
  update public.squad_posts set status = 'closed'
  where venue_booking_id = p_booking_id and type = 'opposition' and status in ('open', 'matched');
  update public.friendly_matches fm set status = 'cancelled'
  from public.squad_posts sp
  where sp.id = fm.squad_post_id and sp.venue_booking_id = p_booking_id and coalesce(fm.status, '') <> 'cancelled';

  for v_player in
    select distinct s.profile_id from public.booking_payment_shares s where s.booking_id = p_booking_id
  loop
    perform public.send_notification(v_player, 'booking_cancelled', jsonb_build_object(
      'title', 'Game cancelled',
      'body', format('Your Gipedo Pano game at %s is cancelled. %s', public.booking_label(v_booking), p_body),
      'bookingId', p_booking_id
    ));
  end loop;
end;
$$;

-- 5. No opponent 24 hours before kickoff. Job: the post closes and the
-- booking captain is asked to choose. An offer still within its 15 minutes
-- is waited for. Returns how many captains were asked.
create or replace function public.gipedo_no_opponent_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_count integer := 0;
  v_hold record;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.payment_mode = 'gipedo_pano' and b.status = 'confirmed' and b.gipedo_no_opponent_at is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - interval '24 hours'
      and not public.gipedo_has_opponent(b.id)
    for update of b
  loop
    update public.venue_bookings set gipedo_no_opponent_at = now() where id = v_booking.id;
    update public.squad_posts set status = 'closed'
    where venue_booking_id = v_booking.id and type = 'opposition' and status = 'open';
    select amount_cents into v_hold from public.booking_payment_shares
    where booking_id = v_booking.id and is_booker and gipedo_side = 'a';
    perform public.send_notification(v_booking.created_by, 'gipedo_no_opponent', jsonb_build_object(
      'title', 'No opponent yet',
      'body', format('Nobody has taken on your Gipedo Pano game at %s. Play it as a normal booking for %s, or cancel '
                     || 'free and your hold is released. If you don''t choose by 6 hours before kickoff, it''s cancelled free.',
                     public.booking_label(v_booking), public.money_format_euros(v_hold.amount_cents)),
      'bookingId', v_booking.id
    ));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The booking captain's choice: 'play_normal' (pay for everyone, taken from
-- the hold; afterwards it cancels as a pay-for-everyone booking, decided 13
-- November) or 'cancel' (free). Until 6 hours before kickoff.
create or replace function public.gipedo_no_opponent_choice(p_booking_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_hold public.booking_payment_shares;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.created_by is distinct from auth.uid() then
    raise exception 'booking_not_found';
  end if;
  if v_booking.payment_mode is distinct from 'gipedo_pano' or v_booking.status <> 'confirmed' then
    raise exception 'not_gipedo';
  end if;
  if v_booking.gipedo_no_opponent_at is null then
    raise exception 'choice_not_due';
  end if;
  if v_booking.gipedo_choice is not null then
    raise exception 'already_chosen';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '6 hours' then
    raise exception 'choice_closed';
  end if;
  if p_choice not in ('play_normal', 'cancel') then
    raise exception 'invalid_choice';
  end if;

  update public.venue_bookings set gipedo_choice = p_choice where id = p_booking_id;
  if p_choice = 'play_normal' then
    select * into v_hold from public.booking_payment_shares
    where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
    update public.venue_bookings set payment_mode = 'pay_all' where id = p_booking_id;
    perform public.gipedo_add_settlement(v_hold.id, 'play_normal');
    return jsonb_build_object('result', 'play_normal', 'capture_cents', v_hold.amount_cents);
  end if;
  perform public.gipedo_cancel_booking(p_booking_id, 'Nobody took it on, so it was cancelled free and the hold released.');
  return jsonb_build_object('result', 'cancelled');
end;
$$;

-- Job: no choice by 6 hours before kickoff, cancelled free.
create or replace function public.gipedo_auto_cancel_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_count integer := 0;
begin
  for v_booking in
    select b.id from public.venue_bookings b
    where b.payment_mode = 'gipedo_pano' and b.status = 'confirmed'
      and b.gipedo_no_opponent_at is not null and b.gipedo_choice is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - interval '6 hours'
  loop
    update public.venue_bookings set gipedo_choice = 'auto_cancel' where id = v_booking;
    perform public.gipedo_cancel_booking(v_booking,
      'Nobody took it on and no choice was made by 6 hours before kickoff, so it was cancelled free and the hold released.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 6. A captain pulls out, before kickoff (spec 13 and decisions 2 and 11):
--   - the booking team with no opponent holding: cancelled free;
--   - at least 6 hours before kickoff: 100 cents per player taken from the
--     team's hold (Futty's), the rest released. The booking team: booking
--     cancelled, slot freed, the opponent's hold released. The opponent:
--     the friendly cancelled, the post reopened (closed from 24 hours
--     before kickoff), the booking team keeps its hold and the same choice
--     at 24 hours;
--   - less than 6 hours before kickoff: the team forfeits the match and pays
--     in full as the loser when the match settles.
-- Exactly 6 hours before kickoff counts as "at least 6 hours", as for
-- cancellations.
create or replace function public.gipedo_pull_out_quote(p_booking_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_hold public.booking_payment_shares;
  v_kickoff timestamptz;
  v_kind text;
  v_cents integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.payment_mode is distinct from 'gipedo_pano' or v_booking.status <> 'confirmed' then
    return null;
  end if;
  select * into v_hold from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.profile_id = p_profile_id and s.gipedo_side is not null
    and s.status = 'authorized'
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id);
  if v_hold.id is null then
    return null;
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if now() >= v_kickoff then
    return null;
  end if;
  if v_hold.gipedo_side = 'a' and not public.gipedo_has_opponent(p_booking_id, true) then
    v_kind := 'free';
    v_cents := 0;
  elsif now() > v_kickoff - interval '6 hours' then
    v_kind := 'forfeit';
    v_cents := v_hold.amount_cents;
  else
    v_kind := 'fee';
    v_cents := least(100 * v_booking.capacity, v_hold.amount_cents);
  end if;
  return jsonb_build_object('kind', v_kind, 'cents', v_cents, 'side', v_hold.gipedo_side, 'share_id', v_hold.id);
end;
$$;

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

-- 7. Carrying out a settlement. Job: the rows due, with whether the hold is
-- still there to take from or release.
create or replace function public.gipedo_settlements_due()
returns table (settlement_id uuid, booking_id uuid, share_id uuid, stripe_payment_intent_id text,
               capture_cents integer, hold_live boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.booking_id, g.share_id, s.stripe_payment_intent_id, g.capture_cents,
         s.status = 'authorized' and s.stripe_payment_intent_id is not null
  from public.gipedo_settlements g
  join public.booking_payment_shares s on s.id = g.share_id
  where g.status = 'due' and (g.next_attempt_at is null or g.next_attempt_at <= now())
  order by g.created_at
  limit 50;
$$;

-- What happened at Stripe: 'captured' (p_amount_cents taken, Stripe kept
-- p_stripe_fee_cents), 'released' (nothing to take: the hold cancelled) or
-- 'gone' (the hold was already gone: what it should have paid is owed).
-- Recorded once; a repeat changes nothing.
create or replace function public.gipedo_settlement_done(
  p_settlement_id uuid,
  p_outcome text,
  p_amount_cents integer default null,
  p_stripe_fee_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gipedo_settlements;
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_debt uuid;
  v_owed_to text;
begin
  select * into v_row from public.gipedo_settlements where id = p_settlement_id for update;
  if v_row.id is null then
    raise exception 'settlement_not_found';
  end if;
  if v_row.status <> 'due' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if p_outcome not in ('captured', 'released', 'gone') then
    raise exception 'invalid_outcome';
  end if;
  select * into v_share from public.booking_payment_shares where id = v_row.share_id for update;
  select * into v_booking from public.venue_bookings where id = v_row.booking_id;

  if p_outcome = 'captured' then
    if v_row.capture_cents = 0 or p_amount_cents is distinct from v_row.capture_cents then
      raise exception 'amount_mismatch';
    end if;
    perform public.record_intent_capture(v_row.booking_id, v_row.share_id, null, v_share.stripe_payment_intent_id,
      p_amount_cents, v_row.futty_cents, coalesce(p_stripe_fee_cents, 0), 'gipedo_' || v_row.reason);
    update public.booking_payment_shares
    set status = case when v_row.reason = 'pull_out_fee' then 'forfeited' else 'paid' end, paid_at = now()
    where id = v_row.share_id;
    update public.gipedo_settlements set status = 'done', outcome = 'captured', done_at = now(), last_error = null
    where id = v_row.id;
  elsif p_outcome = 'released' then
    if v_row.capture_cents <> 0 then
      raise exception 'amount_mismatch';
    end if;
    perform public.record_intent_cancelled(v_row.booking_id, v_row.share_id, null, v_share.stripe_payment_intent_id,
                                           'gipedo_' || v_row.reason);
    update public.booking_payment_shares set status = 'cancelled' where id = v_row.share_id;
    update public.gipedo_settlements set status = 'done', outcome = 'released', done_at = now(), last_error = null
    where id = v_row.id;
  else
    if v_share.stripe_payment_intent_id is not null then
      perform public.record_intent_cancelled(v_row.booking_id, v_row.share_id, null, v_share.stripe_payment_intent_id,
                                             'gipedo_hold_expired');
    end if;
    update public.booking_payment_shares set status = 'cancelled' where id = v_row.share_id;
    if v_row.capture_cents > 0 then
      -- Decisions 3 and 8: the venue is owed what the hold should have
      -- paid, Futty a pull-out fee.
      v_owed_to := case when v_row.reason = 'pull_out_fee' then 'futty' else 'venue' end;
      v_debt := public.create_venue_debt(v_row.profile_id, v_owed_to,
        case when v_owed_to = 'venue' then v_booking.venue_id end, v_row.booking_id,
        v_row.capture_cents, v_row.venue_cents, v_row.futty_cents, 'gipedo_hold_expired', null, null);
    end if;
    update public.gipedo_settlements
    set status = case when v_debt is null then 'done' else 'debt' end, outcome = 'gone', debt_id = v_debt,
        done_at = now(), last_error = null
    where id = v_row.id;
  end if;

  if v_row.reason in ('lost', 'won', 'split') then
    perform public.send_notification(v_row.profile_id, 'gipedo_settled', jsonb_build_object(
      'title', case v_row.reason when 'won' then 'You won: hold released'
                                 when 'lost' then 'Gipedo Pano: you pay the pitch'
                                 else 'Gipedo Pano: split 50/50' end,
      'body', case when v_row.reason = 'won' then format('Your hold for %s is released.', public.booking_label(v_booking))
                   when p_outcome = 'gone' then format('Your hold for %s had expired, so you owe %s.',
                                                       public.booking_label(v_booking), public.money_format_euros(v_row.capture_cents))
                   else format('%s was taken from your hold for %s.', public.money_format_euros(v_row.capture_cents),
                               public.booking_label(v_booking)) end,
      'bookingId', v_row.booking_id,
      'amountCents', v_row.capture_cents
    ));
  end if;
  return jsonb_build_object('result', p_outcome, 'debt_id', v_debt);
end;
$$;

-- A Stripe call failed: tried again after the back-off; the third failure
-- raises one admin alert.
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
  set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(attempts + 1)
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

-- 8. A hold with a settlement still to carry out is the settlement's to
-- take or release, not the cancelled-booking release's. As in
-- 20261109131704_pay_modes_timing and 20261109164845_pay_modes_recovery
-- otherwise.
create or replace function public.booking_money_to_release(p_booking_id uuid)
returns table (kind text, id uuid, status text, stripe_payment_intent_id text, amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select 'share', s.id, s.status, s.stripe_payment_intent_id, s.amount_cents
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.status = 'due')
  union all
  select 'guarantee', g.id, g.status, g.stripe_payment_intent_id, g.amount_cents
  from public.booking_guarantees g
  where g.booking_id = p_booking_id and g.status <> 'cancelled'
  union all
  select 'booking', b.id, b.status, b.stripe_payment_intent_id, b.amount_cents
  from public.venue_bookings b
  where b.id = p_booking_id and b.stripe_payment_intent_id is not null and b.amount_cents > 0
    and not exists (select 1 from public.booking_payment_shares s where s.booking_id = b.id);
$$;

create or replace function public.bookings_with_money_to_release()
returns table (booking_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.venue_bookings b
  where b.status = 'cancelled'
    and b.payment_mode is not null
    and (
      exists (
        select 1 from public.booking_payment_shares s
        where s.booking_id = b.id
          and (s.status in ('authorized', 'paid') or (s.status = 'pending' and s.stripe_payment_intent_id is not null))
          and not exists (select 1 from public.money_releases r
                          where r.status = 'pending' and r.stripe_intent_id = s.stripe_payment_intent_id)
          and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.status = 'due')
      )
      or exists (
        select 1 from public.booking_guarantees g
        where g.booking_id = b.id
          and g.status <> 'cancelled'
          and (g.status = 'held' or g.stripe_payment_intent_id is not null)
          and not exists (select 1 from public.money_releases r
                          where r.status = 'pending' and r.stripe_intent_id = g.stripe_payment_intent_id)
      )
    )
  order by b.id
  limit 50;
$$;

-- 9. The booking screen: the Gipedo Pano part, and no "my spot" or "whole
-- team" cancel for a captain holding (they pull out instead). A captain's
-- held card shows on the roster as 'held'.
--   gipedo.team / opponent   {id, name}; opponent.state none, offered, held
--   gipedo.my_side           a, b or null (not a captain's hold)
--   gipedo.pull_out          {kind free|fee|forfeit, cents} or null
--   gipedo.choice_due        the booking captain must choose (no opponent)
--   gipedo.play_normal_cents what "play as normal" takes from the hold
--   gipedo.settlement        the caller's hold: {reason, capture_cents, status}
alter function public.booking_detail(uuid) rename to booking_detail_modes;

create function public.booking_detail(p_booking_id uuid)
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
  -- A captain's card that is only held shows as held, not paid.
  select coalesce(jsonb_agg(case when s.gipedo_side is not null and s.status = 'authorized'
                                 then r.e || jsonb_build_object('state', 'held') else r.e end order by r.ord), '[]'::jsonb)
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
      'play_normal_cents', v_booker_hold.amount_cents,
      'settlement', case when v_settlement.id is null then null else jsonb_build_object(
        'reason', v_settlement.reason, 'capture_cents', v_settlement.capture_cents, 'status', v_settlement.status) end));
end;
$$;

revoke all on function public.booking_detail_modes(uuid) from public, anon, authenticated;
grant execute on function public.booking_detail_modes(uuid) to service_role;
revoke all on function public.booking_detail(uuid) from public, anon;
grant execute on function public.booking_detail(uuid) to authenticated, service_role;

revoke all on function public.gipedo_add_settlement(uuid, text) from public, anon, authenticated;
grant execute on function public.gipedo_add_settlement(uuid, text) to service_role;
revoke all on function public.gipedo_settle_from_results() from public, anon, authenticated;
grant execute on function public.gipedo_settle_from_results() to service_role;
revoke all on function public.gipedo_has_opponent(uuid, boolean) from public, anon, authenticated;
grant execute on function public.gipedo_has_opponent(uuid, boolean) to service_role;
revoke all on function public.gipedo_cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.gipedo_cancel_booking(uuid, text) to service_role;
revoke all on function public.gipedo_no_opponent_due() from public, anon, authenticated;
grant execute on function public.gipedo_no_opponent_due() to service_role;
revoke all on function public.gipedo_no_opponent_choice(uuid, text) from public, anon;
grant execute on function public.gipedo_no_opponent_choice(uuid, text) to authenticated, service_role;
revoke all on function public.gipedo_auto_cancel_due() from public, anon, authenticated;
grant execute on function public.gipedo_auto_cancel_due() to service_role;
revoke all on function public.gipedo_pull_out_quote(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gipedo_pull_out_quote(uuid, uuid) to service_role;
revoke all on function public.gipedo_pull_out(uuid) from public, anon;
grant execute on function public.gipedo_pull_out(uuid) to authenticated, service_role;
revoke all on function public.gipedo_settlements_due() from public, anon, authenticated;
grant execute on function public.gipedo_settlements_due() to service_role;
revoke all on function public.gipedo_settlement_done(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.gipedo_settlement_done(uuid, text, integer, integer) to service_role;
revoke all on function public.gipedo_settlement_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.gipedo_settlement_failed(uuid, text) to service_role;
