-- P4a: all of the server's money maths and payment timing in one place
-- (docs/specs/13-payments-bookings.md, "Prices and fees", "Booking modes",
-- "When money is held and taken"). Integer cents only. The Edge Functions'
-- copy is supabase/functions/_shared/money.ts; both are tested against the
-- same worked examples.

-- One player's share of a booking:
--   pitch_cents  their part of the pitch price = price / players, with the
--                leftover cents on the booker's share;
--   fee_cents    Futty's service fee: 80 per player when each pays, 55 per
--                player when the booker pays for everyone, 0 for a Premium
--                player's own spot. When a Premium booker pays for everyone,
--                only their own spot is fee-free;
--   card_cents   what is charged to their card;
--   cash_cents   what they pay in cash at the venue.
-- Booker pays for everyone (pay_all): the booker's one payment is the whole
-- pitch plus a fee per player; everyone else's spot costs them nothing.
-- Cash is allowed only in the two each_pays modes; a cash player pays only
-- the fee by card (0 if Premium).
create or replace function public.money_share(
  p_pitch_cents integer,
  p_players integer,
  p_mode text,
  p_is_booker boolean,
  p_is_premium boolean,
  p_method text default 'card',
  out pitch_cents integer,
  out fee_cents integer,
  out card_cents integer,
  out cash_cents integer
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_pitch_cents is null or p_pitch_cents < 0 or p_players is null or p_players < 1
     or p_is_booker is null or p_is_premium is null then
    raise exception 'invalid_money_input';
  end if;
  if p_mode is null or p_mode not in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot') then
    raise exception 'invalid_payment_mode';
  end if;
  if p_method is null or p_method not in ('card', 'cash') then
    raise exception 'invalid_payment_method';
  end if;
  if p_mode = 'pay_all' and p_method = 'cash' then
    raise exception 'cash_not_allowed';
  end if;

  if p_mode = 'pay_all' then
    if p_is_booker then
      pitch_cents := p_pitch_cents;
      fee_cents := 55 * (p_players - case when p_is_premium then 1 else 0 end);
    else
      pitch_cents := 0;
      fee_cents := 0;
    end if;
  else
    pitch_cents := p_pitch_cents / p_players + case when p_is_booker then p_pitch_cents % p_players else 0 end;
    fee_cents := case when p_is_premium then 0 else 80 end;
  end if;

  if p_method = 'cash' then
    card_cents := fee_cents;
    cash_cents := pitch_cents;
  else
    card_cents := pitch_cents + fee_cents;
    cash_cents := 0;
  end if;
end;
$$;

-- The service fee per player a booking records (venue_bookings.
-- service_fee_cents_per_player), for display of the old kind.
create or replace function public.money_fee_per_player_cents(p_mode text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_mode when 'pay_all' then 55 when 'each_pays_responsible' then 80 when 'each_pays_own_spot' then 80 end;
$$;

-- A held share is taken when its free-cancellation hour ends: 60 minutes
-- after it was held or 6 hours before kickoff, whichever comes first
-- (decided 9 November). A share held less than 6 hours before kickoff is
-- therefore due at once.
create or replace function public.money_capture_due_at(p_held_at timestamptz, p_kickoff timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select least(p_held_at + interval '60 minutes', p_kickoff - interval '6 hours');
$$;

-- A share paid less than 6 hours before kickoff is non-refundable (decided
-- 9 November: per share, whenever the booking was made). p_paid_at is when
-- the player confirmed the payment. Exactly 6 hours before is not "less
-- than".
create or replace function public.money_is_non_refundable(p_paid_at timestamptz, p_kickoff timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_paid_at > p_kickoff - interval '6 hours';
$$;

-- The booker completes payment within 15 minutes of booking, or the
-- booking is cancelled and its pitches released (decided 9 November).
create or replace function public.money_payment_window_ends_at(p_booked_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_booked_at + interval '15 minutes';
$$;

-- The booker's guarantee is held 72 hours before kickoff, or at booking when
-- kickoff is closer.
create or replace function public.money_guarantee_hold_due_at(p_booked_at timestamptz, p_kickoff timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select greatest(p_kickoff - interval '72 hours', p_booked_at);
$$;

-- A failed guarantee hold is retried 6 hours later (until kickoff; see
-- guarantees_due_for_hold).
create or replace function public.money_guarantee_retry_at(p_failed_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_failed_at + interval '6 hours';
$$;

-- Kickoff of a booking as an instant: its day and start time are Cyprus
-- wall-clock time. Stable, not immutable: the answer depends on the time
-- zone database, which can change.
create or replace function public.booking_kickoff_at(p_day date, p_start time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_day + p_start) at time zone 'Asia/Nicosia';
$$;

revoke all on function public.money_share(integer, integer, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.money_share(integer, integer, text, boolean, boolean, text) to service_role;
revoke all on function public.money_fee_per_player_cents(text) from public, anon, authenticated;
grant execute on function public.money_fee_per_player_cents(text) to service_role;
revoke all on function public.money_capture_due_at(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.money_capture_due_at(timestamptz, timestamptz) to service_role;
revoke all on function public.money_is_non_refundable(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.money_is_non_refundable(timestamptz, timestamptz) to service_role;
revoke all on function public.money_payment_window_ends_at(timestamptz) from public, anon, authenticated;
grant execute on function public.money_payment_window_ends_at(timestamptz) to service_role;
revoke all on function public.money_guarantee_hold_due_at(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.money_guarantee_hold_due_at(timestamptz, timestamptz) to service_role;
revoke all on function public.money_guarantee_retry_at(timestamptz) from public, anon, authenticated;
grant execute on function public.money_guarantee_retry_at(timestamptz) to service_role;
revoke all on function public.booking_kickoff_at(date, time) from public, anon, authenticated;
grant execute on function public.booking_kickoff_at(date, time) to service_role;
