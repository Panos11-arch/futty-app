-- P8 follow-ups from the review of PR #63 (docs/specs/13-payments-bookings.md,
-- "Gipedo Pano").
--
--   1. Gipedo Pano is booked at most 120 hours (5 days) ahead, not 144
--      (decided by Dimitris 13 November, to be confirmed by Panos and
--      Anghelo): 120 hours + the match + the 24-hour result window stays
--      inside Stripe's ~7-day hold, so every hold is still alive at
--      settlement. An expired hold still becomes a debt, as the fallback.
--   2. A settlement Stripe may already have carried out keeps its claim.
--      When the job's Stripe call went through (or may have) but recording
--      it failed, it reports the failure with p_keep_claim: the claim stays,
--      the next run does it again under the same idempotency key and records
--      it once. A claimed settlement is never stood down by a cancel, however
--      old the claim: the cancel waits (payment_in_progress). The claim is let
--      go only when the job knows no money moved.
--   3. The pull-out quote carries the fee per player (100 cents), so the app
--      shows it from the server.

-- 1. The window.
create or replace function public.gipedo_window_error(p_kickoff timestamptz, p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kickoff > p_at + interval '120 hours' then 'gipedo_too_far_ahead'
    when p_kickoff < p_at + interval '24 hours' then 'gipedo_too_soon'
  end;
$$;

-- 2. A failure the job reports. p_keep_claim: Stripe moved (or may have
-- moved) the money and only recording it failed, so the claim stays and the
-- next run retries straight away (after the 2-minute claim), not after a
-- back-off. Otherwise as in 20261113130016_pay_gipedo_review_fixes.
drop function public.gipedo_settlement_failed(uuid, text);

create function public.gipedo_settlement_failed(p_settlement_id uuid, p_error text, p_keep_claim boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gipedo_settlements;
begin
  update public.gipedo_settlements
  set attempts = attempts + 1, last_error = p_error,
      next_attempt_at = case when coalesce(p_keep_claim, false) then null else public.money_backoff_at(attempts + 1) end,
      claimed_at = case when coalesce(p_keep_claim, false) then claimed_at else null end
  where id = p_settlement_id and status = 'due'
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('result', 'ignored');
  end if;
  if v_row.attempts >= 3 then
    insert into public.admin_alerts (kind, booking_id, share_id, details)
    values ('capture_failing', v_row.booking_id, v_row.share_id, jsonb_build_object(
      'gipedo_settlement_id', v_row.id, 'attempts', v_row.attempts, 'last_error', p_error,
      'capture_cents', v_row.capture_cents, 'claim_kept', coalesce(p_keep_claim, false)))
    on conflict (kind, share_id) where resolved_at is null do nothing;
  end if;
  return jsonb_build_object('result', 'failed', 'attempts', v_row.attempts);
end;
$$;

-- Cancelling the whole team or as the venue: any claimed settlement makes
-- the cancel wait, whatever the claim's age. As in
-- 20261113130016_pay_gipedo_review_fixes otherwise.
create or replace function public.cancel_booking_internal(
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
               where g.booking_id = p_booking_id and g.status = 'due' and g.claimed_at is not null) then
      raise exception 'payment_in_progress';
    end if;
    update public.gipedo_settlements
    set status = 'cancelled', outcome = 'cancelled', done_at = now()
    where booking_id = p_booking_id and status = 'due' and reason in ('play_normal', 'pull_out_fee');
  end if;
  return public.cancel_booking_internal_modes(p_booking_id, p_scope, p_profile_id, p_expected_quote);
end;
$$;

-- 3. The pull-out quote, plus fee_per_player_cents (100 for a fee, null
-- otherwise). As in 20261113115755_pay_gipedo_settle otherwise.
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
  v_per_player integer;
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
    -- 100 cents per player in the booking, capped at the hold (decisions 2
    -- and 15), as gipedo_add_settlement takes it.
    v_kind := 'fee';
    v_per_player := 100;
    v_cents := least(v_per_player * v_booking.capacity, v_hold.amount_cents);
  end if;
  return jsonb_build_object('kind', v_kind, 'cents', v_cents, 'fee_per_player_cents', v_per_player,
                            'side', v_hold.gipedo_side, 'share_id', v_hold.id);
end;
$$;

revoke all on function public.gipedo_window_error(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.gipedo_window_error(timestamptz, timestamptz) to service_role;
revoke all on function public.gipedo_settlement_failed(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.gipedo_settlement_failed(uuid, text, boolean) to service_role;
revoke all on function public.cancel_booking_internal(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking_internal(uuid, text, uuid, text) to service_role;
revoke all on function public.gipedo_pull_out_quote(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gipedo_pull_out_quote(uuid, uuid) to service_role;
