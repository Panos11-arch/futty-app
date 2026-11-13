-- P8 follow-ups (PR #63 review). Gipedo Pano on a EUR 60 5 v 5 (each hold
-- 6550 = 6000 pitch + 550 fee):
--   1. booked at most 120 hours (5 days) ahead, so every hold is still
--      alive at settlement (decided by Dimitris 13 November, to be confirmed);
--   2. a capture Stripe made whose recording failed keeps its claim: a
--      cancel waits (payment_in_progress) however long it takes, and the next
--      run records the capture once in money_ledger;
--   3. exactly 6 hours before kickoff a pull-out pays 100 cents per player
--      (1000), not the forfeit;
--   4. the pull-out quote carries the fee per player (100), from the server.

begin;

create function tests.g5_team(p_captain uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_team uuid := tests.create_team(p_name);
begin
  perform tests.join_team(v_team, p_captain, 'captain');
  return v_team;
end;
$$;

create function tests.g5_post(p_booking uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.squad_posts where venue_booking_id = p_booking and type = 'opposition';
$$;

-- A Gipedo Pano game: the booking captain (home) holds; an opponent captain
-- (away) offered and holds unless p_away is false. The venue has an owner.
create function tests.g5_game(
  p_label text,
  p_away boolean default true,
  out booking uuid,
  out home uuid,
  out away uuid,
  out owner uuid
)
language plpgsql
as $$
declare
  v_venue uuid;
  v_booking public.venue_bookings;
  v_home_team uuid;
  v_away_team uuid;
begin
  owner := tests.create_user(format('g5-%s-owner@futty.test', p_label));
  v_venue := tests.create_venue(p_owner => owner, p_pitches => 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  home := tests.create_user(format('g5-%s-home@futty.test', p_label));
  v_home_team := tests.g5_team(home, p_label || ' Home');
  perform tests.act_as(home);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', v_home_team);
  perform tests.act_as_postgres();
  booking := v_booking.id;
  perform tests.hold_share((tests.share_of(booking, home)).id, 'pi_home_' || p_label);
  away := tests.create_user(format('g5-%s-away@futty.test', p_label));
  if p_away then
    v_away_team := tests.g5_team(away, p_label || ' Away');
    perform tests.act_as(away);
    perform public.offer_opposition(tests.g5_post(booking), v_away_team);
    perform tests.act_as_postgres();
    perform tests.hold_share((tests.share_of(booking, away)).id, 'pi_away_' || p_label);
  end if;
end;
$$;

create function tests.g5_row(p_booking uuid, p_profile uuid)
returns public.gipedo_settlements
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.gipedo_settlements where booking_id = p_booking and profile_id = p_profile;
$$;

-- 1. The window: 24 to 120 hours ahead, both ends included.
do $$
declare
  v_now timestamptz := now();
begin
  assert public.gipedo_window_error(v_now + interval '120 hours', v_now) is null, '120 hours (5 days) ahead is allowed';
  assert public.gipedo_window_error(v_now + interval '120 hours 1 minute', v_now) = 'gipedo_too_far_ahead',
    'more than 120 hours is too far';
  assert public.gipedo_window_error(v_now + interval '144 hours', v_now) = 'gipedo_too_far_ahead',
    'the old 6 days is now too far';
  assert public.gipedo_window_error(v_now + interval '24 hours', v_now) is null, '24 hours ahead is still allowed';
end $$;

-- 2. Stripe took the money, recording it failed, then a cancel arrives: it
-- waits, and the next run records the capture once.
do $$
declare
  g record;
  v_claimed record;
  v_again record;
  v_row public.gipedo_settlements;
begin
  select * into g from tests.g5_game('done-fails', p_away => false);
  perform tests.set_kickoff(g.booking, now() + interval '12 hours');
  perform public.gipedo_no_opponent_due();
  perform tests.act_as(g.home);
  perform public.gipedo_no_opponent_choice(g.booking, 'play_normal');
  perform tests.act_as_postgres();

  select * into v_claimed from public.gipedo_settlements_due() d where d.booking_id = g.booking;
  assert v_claimed.settlement_id is not null and v_claimed.capture_cents = 6550, 'the job claims the 6550 capture';

  -- Stripe captured; gipedo_settlement_done failed, so the job reports the
  -- failure keeping the claim.
  perform public.gipedo_settlement_failed(v_claimed.settlement_id, 'db_unavailable', p_keep_claim => true);
  v_row := tests.g5_row(g.booking, g.home);
  assert v_row.status = 'due' and v_row.claimed_at is not null and v_row.attempts = 1,
    format('still due and still claimed, got %s', row_to_json(v_row));

  assert tests.error_of(format('select tests.cancel(%L, %L, %L)', g.booking, 'whole_team', g.home)) = 'payment_in_progress',
    'the cancel waits';
  -- Long after the 2-minute claim: still waits, never stands it down.
  update public.gipedo_settlements set claimed_at = now() - interval '1 hour' where id = v_claimed.settlement_id;
  assert tests.error_of(format('select tests.cancel(%L, %L, %L)', g.booking, 'whole_team', g.home)) = 'payment_in_progress',
    'an old claim still makes the cancel wait';
  assert (tests.g5_row(g.booking, g.home)).status = 'due', 'never stood down';

  -- The next run picks it up again and records it.
  select * into v_again from public.gipedo_settlements_due() d where d.booking_id = g.booking;
  assert v_again.settlement_id = v_claimed.settlement_id, 'the next run retries it';
  assert public.gipedo_settlement_done(v_again.settlement_id, 'captured', 6550, tests.stripe_fee(6550)) ->> 'result' = 'captured',
    'recorded';
  assert public.gipedo_settlement_done(v_again.settlement_id, 'captured', 6550, tests.stripe_fee(6550)) ->> 'result' = 'duplicate',
    'a repeat changes nothing';
  assert (select count(*) from public.money_ledger where kind = 'capture' and stripe_id = 'pi_home_done-fails') = 1,
    'the capture is in money_ledger once';
  assert (select amount_cents from public.money_ledger where kind = 'capture' and stripe_id = 'pi_home_done-fails') = 6550,
    'for 6550';
  assert (tests.share_of(g.booking, g.home)).status = 'paid', 'the hold is paid';

  -- Now the cancel goes ahead, under the pay-for-everyone rules.
  perform tests.cancel(g.booking, 'whole_team', g.home);
  assert (select status from public.venue_bookings where id = g.booking) = 'cancelled', 'cancelled after the capture';
  assert (tests.g5_row(g.booking, g.home)).status = 'done', 'the settlement stays done';
end $$;

-- 2b. A Stripe call that moved nothing lets the claim go: a cancel can then
-- stand the settlement down.
do $$
declare
  g record;
  v_claimed record;
begin
  select * into g from tests.g5_game('stripe-fails', p_away => false);
  perform tests.set_kickoff(g.booking, now() + interval '12 hours');
  perform public.gipedo_no_opponent_due();
  perform tests.act_as(g.home);
  perform public.gipedo_no_opponent_choice(g.booking, 'play_normal');
  perform tests.act_as_postgres();
  select * into v_claimed from public.gipedo_settlements_due() d where d.booking_id = g.booking;
  perform public.gipedo_settlement_failed(v_claimed.settlement_id, 'api_error');
  assert (tests.g5_row(g.booking, g.home)).claimed_at is null, 'nothing moved: the claim is let go';
  perform tests.cancel(g.booking, 'whole_team', g.home);
  assert (tests.g5_row(g.booking, g.home)).status = 'cancelled', 'and the cancel stands it down';
end $$;

-- 3. Exactly 6 hours before kickoff: the fee, not the forfeit. 4. The quote
-- carries the fee per player.
do $$
declare
  g record;
  v_quote jsonb;
  v_detail jsonb;
begin
  select * into g from tests.g5_game('six');
  perform tests.set_kickoff(g.booking, now() + interval '6 hours');
  v_quote := public.gipedo_pull_out_quote(g.booking, g.away);
  assert v_quote ->> 'kind' = 'fee' and (v_quote ->> 'cents')::int = 1000,
    format('exactly 6 hours: the 1000 fee, got %s', v_quote);
  assert (v_quote ->> 'fee_per_player_cents')::int = 100, format('100 per player, got %s', v_quote);

  perform tests.act_as(g.away);
  v_detail := public.booking_detail(g.booking);
  assert (v_detail -> 'gipedo' -> 'pull_out' ->> 'fee_per_player_cents')::int = 100,
    format('the booking screen gets the fee per player, got %s', v_detail -> 'gipedo' -> 'pull_out');
  assert public.gipedo_pull_out(g.booking) ->> 'result' = 'pulled_out', 'a pull-out, not a forfeit';
  perform tests.act_as_postgres();
  assert (tests.g5_row(g.booking, g.away)).reason = 'pull_out_fee' and (tests.g5_row(g.booking, g.away)).capture_cents = 1000,
    'the opponent pays 1000';
  assert (tests.match_of(g.booking)).forfeit_side is null, 'no forfeit recorded';

  -- Just under 6 hours: a forfeit, with no fee per player.
  select * into g from tests.g5_game('under-six');
  perform tests.set_kickoff(g.booking, now() + interval '5 hours 59 minutes');
  v_quote := public.gipedo_pull_out_quote(g.booking, g.away);
  assert v_quote ->> 'kind' = 'forfeit' and (v_quote ->> 'cents')::int = 6550, format('a forfeit, got %s', v_quote);
  assert v_quote -> 'fee_per_player_cents' = 'null'::jsonb, 'no fee per player on a forfeit';
end $$;

-- Security.
do $$
begin
  assert not has_function_privilege('authenticated', 'public.gipedo_settlement_failed(uuid, text, boolean)', 'execute'),
    'gipedo_settlement_failed is internal';
  assert not has_function_privilege('anon', 'public.gipedo_settlement_failed(uuid, text, boolean)', 'execute'),
    'gipedo_settlement_failed is internal (anon)';
  assert has_function_privilege('service_role', 'public.gipedo_settlement_failed(uuid, text, boolean)', 'execute'),
    'the job calls it';
end $$;

select 'pay gipedo 5 (follow-ups) passed' as result;

rollback;
