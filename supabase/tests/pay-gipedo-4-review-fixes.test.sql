-- P8 review fixes (PR #63). Gipedo Pano on a EUR 60 5 v 5 (each hold 6550
-- = 6000 pitch + 550 fee; a Premium captain's 6495):
--   1. a hold Stripe cancels (expiry) before its settlement exists is marked
--      expired, and settlement treats it as gone: the loser owes 6550, a
--      draw or no result 3275, the winner nothing (decision 3);
--   2. an offer that lapses has its open payment released; offering again
--      is a new attempt (a new Stripe key), the old intent is kept, and a
--      late authorization of the old hold is released on its own, never
--      the rest of the booking;
--   4. cancelling (booker whole team after "play as normal", or the venue
--      while a pull-out fee waits) stands the waiting settlement down and
--      the normal cancellation rules apply; a settlement already being
--      carried out at Stripe makes the cancel wait (payment_in_progress);
--   7. a Premium opponent's odd cent goes on the booking team (3276 / 3247);
--      play_normal_cents only for the booker; the opponent-left wording
--      says whether they withdrew or the offer lapsed; a cancel is in the
--      ledger once per intent; a pull-out less than 6 hours before kickoff
--      works when the booking's match doesn't exist yet.
begin;

create function tests.g4_team(p_captain uuid, p_name text)
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

-- A Gipedo Pano game: the booking captain (home) holds; an opponent captain
-- (away) offered and holds unless p_away is false. The venue has an owner.
create function tests.g4_game(
  p_label text,
  p_away_premium boolean default false,
  p_away boolean default true,
  out booking uuid,
  out home uuid,
  out away uuid,
  out owner uuid,
  out home_team uuid,
  out away_team uuid
)
language plpgsql
as $$
declare
  v_venue uuid;
  v_booking public.venue_bookings;
begin
  owner := tests.create_user(format('g4-%s-owner@futty.test', p_label));
  v_venue := tests.create_venue(p_owner => owner, p_pitches => 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  home := tests.create_user(format('g4-%s-home@futty.test', p_label));
  home_team := tests.g4_team(home, p_label || ' Home');
  perform tests.act_as(home);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', home_team);
  perform tests.act_as_postgres();
  booking := v_booking.id;
  perform tests.hold_share((tests.share_of(booking, home)).id, 'pi_home_' || p_label);
  away := tests.create_user(format('g4-%s-away@futty.test', p_label));
  away_team := tests.g4_team(away, p_label || ' Away');
  if p_away_premium then
    perform tests.make_premium(away);
  end if;
  if p_away then
    perform tests.g4_offer(booking, away, away_team);
    perform tests.hold_share((tests.share_of(booking, away)).id, 'pi_away_' || p_label);
  end if;
end;
$$;

create function tests.g4_post(p_booking uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.squad_posts where venue_booking_id = p_booking and type = 'opposition';
$$;

create function tests.g4_offer(p_booking uuid, p_captain uuid, p_team uuid)
returns void
language plpgsql
as $$
begin
  perform tests.act_as(p_captain);
  perform public.offer_opposition(tests.g4_post(p_booking), p_team);
  perform tests.act_as_postgres();
end;
$$;

-- The match was played: kicked off 90 minutes ago, ended an hour ago.
create function tests.g4_played(p_booking uuid)
returns uuid
language plpgsql
as $$
begin
  perform tests.end_match(p_booking, '1 hour');
  return (tests.match_of(p_booking)).id;
end;
$$;

create function tests.g4_result(p_match uuid, p_by uuid, p_a integer, p_b integer, p_reply uuid)
returns void
language plpgsql
as $$
begin
  perform tests.act_as(p_by);
  perform public.submit_match_result(p_match, p_a, p_b);
  perform tests.act_as(p_reply);
  perform public.respond_to_match_result(p_match, true);
  perform tests.act_as_postgres();
end;
$$;

-- Stripe's payment_intent.canceled for a captain's hold that expired, as
-- stripe-webhook passes it on.
create function tests.g4_expire(p_booking uuid, p_profile uuid)
returns boolean
language plpgsql
as $$
declare
  v_share public.booking_payment_shares := tests.share_of(p_booking, p_profile);
begin
  return public.release_share_credit_reservation(v_share.id, v_share.stripe_payment_intent_id, true);
end;
$$;

create function tests.g4_row(p_booking uuid, p_profile uuid)
returns public.gipedo_settlements
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.gipedo_settlements where booking_id = p_booking and profile_id = p_profile;
$$;

-- What run-payment-jobs does with each due settlement: a hold that is gone
-- is reported gone; otherwise what's due is taken, or the hold released.
create function tests.g4_carry_out(p_booking uuid)
returns void
language plpgsql
as $$
declare
  v_due record;
begin
  for v_due in select * from public.gipedo_settlements_due() d where d.booking_id = p_booking loop
    if not v_due.hold_live then
      perform public.gipedo_settlement_done(v_due.settlement_id, 'gone');
    elsif v_due.capture_cents > 0 then
      perform public.gipedo_settlement_done(v_due.settlement_id, 'captured', v_due.capture_cents,
                                            tests.stripe_fee(v_due.capture_cents));
    else
      perform public.gipedo_settlement_done(v_due.settlement_id, 'released');
    end if;
  end loop;
end;
$$;

-- 1a. The loser's hold expires (webhook first), then the result: 6550 owed
-- to the venue.
do $$
declare
  g record;
  v_match uuid;
  v_debt public.venue_debts;
begin
  select * into g from tests.g4_game('lose');
  v_match := tests.g4_played(g.booking);
  assert tests.g4_expire(g.booking, g.home), 'the webhook handles it';
  assert (tests.share_of(g.booking, g.home)).status = 'expired',
    format('a Gipedo hold Stripe cancelled is expired, not unpaid again: %s', (tests.share_of(g.booking, g.home)).status);
  assert tests.notified(g.home, 'match_payment_due') = 0, 'the captain isn''t asked to pay again';
  perform tests.act_as(g.home);
  assert (select e ->> 'state' from jsonb_array_elements(public.booking_detail(g.booking) -> 'roster') e
          where (e ->> 'is_me')::boolean) = 'unpaid', 'the roster shows the expired hold as unpaid';
  perform tests.act_as_postgres();

  perform tests.g4_result(v_match, g.home, 0, 2, g.away);
  assert public.gipedo_settle_from_results() = 2, 'both holds settle, the expired one too';
  assert (tests.g4_row(g.booking, g.home)).reason = 'lost' and (tests.g4_row(g.booking, g.home)).capture_cents = 6550,
    'the booking team lost: 6550';
  perform tests.g4_carry_out(g.booking);
  assert (tests.g4_row(g.booking, g.home)).status = 'debt' and (tests.g4_row(g.booking, g.home)).outcome = 'gone',
    'the expired hold is gone: a debt';
  select * into v_debt from public.venue_debts where id = (tests.g4_row(g.booking, g.home)).debt_id;
  assert v_debt.owed_to = 'venue' and v_debt.amount_cents = 6550 and v_debt.venue_cents = 6000 and v_debt.futty_cents = 550,
    format('6550 owed to the venue, got %s', row_to_json(v_debt));
  assert (select count(*) from public.money_ledger where kind = 'cancel' and stripe_id = 'pi_home_lose') = 1,
    'the expired hold is in the ledger once';
  assert (tests.g4_row(g.booking, g.away)).status = 'done' and (tests.share_of(g.booking, g.away)).status = 'cancelled',
    'the winner is released';
end $$;

-- 1b. A draw with the opponent's hold expired first: they owe 3275.
do $$
declare
  g record;
  v_match uuid;
begin
  select * into g from tests.g4_game('draw');
  v_match := tests.g4_played(g.booking);
  perform tests.g4_expire(g.booking, g.away);
  perform tests.g4_result(v_match, g.home, 1, 1, g.away);
  assert public.gipedo_settle_from_results() = 2, 'both settle';
  perform tests.g4_carry_out(g.booking);
  assert (tests.g4_row(g.booking, g.away)).status = 'debt'
         and (select amount_cents from public.venue_debts where id = (tests.g4_row(g.booking, g.away)).debt_id) = 3275,
    'the expired half: 3275 owed';
  assert (tests.g4_row(g.booking, g.home)).outcome = 'captured' and (tests.g4_row(g.booking, g.home)).capture_cents = 3275,
    'the booking team pays its half';
end $$;

-- 1c. No result, the booking captain's hold expired first: 3275 owed.
do $$
declare
  g record;
  v_match uuid;
begin
  select * into g from tests.g4_game('none');
  v_match := tests.g4_played(g.booking);
  perform tests.g4_expire(g.booking, g.home);
  update public.matches set result_deadline_at = now() - interval '1 minute' where id = v_match;
  perform tests.act_as_service_role();
  perform public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert public.gipedo_settle_from_results() = 2, 'no result settles both';
  perform tests.g4_carry_out(g.booking);
  assert (tests.g4_row(g.booking, g.home)).reason = 'split' and (tests.g4_row(g.booking, g.home)).status = 'debt'
         and (select amount_cents from public.venue_debts where id = (tests.g4_row(g.booking, g.home)).debt_id) = 3275,
    'no result: 3275 owed for the expired hold';
end $$;

-- 1d. The winner's hold expired: nothing owed.
do $$
declare
  g record;
  v_match uuid;
begin
  select * into g from tests.g4_game('win');
  v_match := tests.g4_played(g.booking);
  perform tests.g4_expire(g.booking, g.home);
  perform tests.g4_result(v_match, g.home, 2, 0, g.away);
  assert public.gipedo_settle_from_results() = 2, 'both settle';
  perform tests.g4_carry_out(g.booking);
  assert (tests.g4_row(g.booking, g.home)).reason = 'won' and (tests.g4_row(g.booking, g.home)).status = 'done'
         and (tests.g4_row(g.booking, g.home)).debt_id is null, 'the winner owes nothing';
  assert not public.profile_has_debt(g.home), 'and has no debt';
  assert (tests.g4_row(g.booking, g.away)).capture_cents = 6550, 'the loser pays 6550';
end $$;

-- 2a. An offer lapses with its payment open: that payment is released.
-- Offering again is attempt 2, with the old intent kept, and a new hold is
-- placed. A late authorization of the old hold is released on its own.
do $$
declare
  g record;
  v_share public.booking_payment_shares;
  v_result jsonb;
begin
  select * into g from tests.g4_game('reoffer', p_away => false);
  perform tests.g4_offer(g.booking, g.away, g.away_team);
  v_share := tests.share_of(g.booking, g.away);
  assert v_share.offer_attempt = 1, 'the first offer is attempt 1';
  perform tests.pay_share(v_share.id, 'pi_old');
  update public.booking_payment_shares set created_at = now() - interval '16 minutes' where id = v_share.id;
  assert public.gipedo_lapse_offers() = 1, 'the offer lapses';
  assert exists (select 1 from public.money_releases where stripe_intent_id = 'pi_old' and status = 'pending'),
    'its open payment is released, so it can''t be completed later';

  perform tests.g4_offer(g.booking, g.away, g.away_team);
  v_share := tests.share_of(g.booking, g.away);
  assert v_share.status = 'pending' and v_share.offer_attempt = 2 and v_share.stripe_payment_intent_id is null
         and 'pi_old' = any (v_share.replaced_intent_ids),
    format('offering again is attempt 2, the old intent kept: %s', row_to_json(v_share));
  assert (public.plan_share_payment(v_share.id, g.away, 'card', false) ->> 'offer_attempt')::integer = 2,
    'create-share-payment gets the attempt for its Stripe key';
  perform tests.hold_share(v_share.id, 'pi_new');
  assert (tests.share_of(g.booking, g.away)).status = 'authorized'
         and (tests.share_of(g.booking, g.away)).stripe_payment_intent_id = 'pi_new', 'the new hold is placed';

  v_result := public.share_payment_held(v_share.id, 'pi_old', 6550, 'pm_test', now());
  assert v_result ->> 'result' = 'release' and v_result ->> 'reason' = 'replaced_intent',
    format('the old hold is released, got %s', v_result);
  assert exists (select 1 from public.money_ledger where kind = 'hold' and stripe_id = 'pi_old'), 'and in the ledger';
  assert (tests.share_of(g.booking, g.away)).status = 'authorized', 'the new hold stands';
end $$;

-- 2b. A late authorization after a lapse (no new offer): only that intent is
-- released; the booking is live, so its other money stays.
do $$
declare
  g record;
  v_share public.booking_payment_shares;
  v_result jsonb;
begin
  select * into g from tests.g4_game('late', p_away => false);
  perform tests.g4_offer(g.booking, g.away, g.away_team);
  v_share := tests.share_of(g.booking, g.away);
  perform tests.pay_share(v_share.id, 'pi_late');
  update public.booking_payment_shares set created_at = now() - interval '16 minutes' where id = v_share.id;
  perform public.gipedo_lapse_offers();
  v_result := public.share_payment_held(v_share.id, 'pi_late', 6550, 'pm_test', now());
  assert v_result ->> 'result' = 'release' and v_result ->> 'reason' = 'share_cancelled',
    format('released as a cancelled share, never as a cancelled booking (which releases everything): %s', v_result);
  assert exists (select 1 from public.money_ledger where kind = 'hold' and stripe_id = 'pi_late'), 'in the ledger';
  assert (tests.share_of(g.booking, g.home)).status = 'authorized', 'the booking captain''s hold is untouched';
end $$;

-- 4a. "Play as normal", then the booker cancels the whole team before the
-- settlement runs: it is stood down and the pay-for-everyone middle window
-- applies (EUR 1 x 10 kept, 5550 credit).
do $$
declare
  g record;
  v_cancel jsonb;
  v_line public.booking_cancellation_lines;
  v_claimed record;
begin
  select * into g from tests.g4_game('normal', p_away => false);
  perform tests.set_kickoff(g.booking, now() + interval '12 hours');
  update public.booking_payment_shares set held_at = now() - interval '2 days'
  where id = (tests.share_of(g.booking, g.home)).id;
  perform public.gipedo_no_opponent_due();
  perform tests.act_as(g.home);
  perform public.gipedo_no_opponent_choice(g.booking, 'play_normal');
  perform tests.act_as_postgres();
  assert (tests.g4_row(g.booking, g.home)).status = 'due', 'play as normal waits for the job';

  v_cancel := tests.cancel(g.booking, 'whole_team', g.home);
  assert (tests.g4_row(g.booking, g.home)).status = 'cancelled' and (tests.g4_row(g.booking, g.home)).outcome = 'cancelled',
    format('the waiting settlement is stood down: %s', row_to_json(tests.g4_row(g.booking, g.home)));
  assert not exists (select 1 from public.gipedo_settlements_due() d where d.booking_id = g.booking), 'nothing left to take';
  v_line := tests.line(v_cancel, (tests.share_of(g.booking, g.home)).id);
  assert v_line."window" = 'middle' and v_line.action = 'keep_and_credit' and v_line.kept_cents = 1000
         and v_line.credit_cents = 5550 and v_line.work = 'pending',
    format('the pay-for-everyone rules: 1000 kept, 5550 credit, got %s', row_to_json(v_line));

  -- A settlement the job is already carrying out: the cancel waits.
  select * into g from tests.g4_game('normal-busy', p_away => false);
  perform tests.set_kickoff(g.booking, now() + interval '12 hours');
  perform public.gipedo_no_opponent_due();
  perform tests.act_as(g.home);
  perform public.gipedo_no_opponent_choice(g.booking, 'play_normal');
  perform tests.act_as_postgres();
  select * into v_claimed from public.gipedo_settlements_due() d where d.booking_id = g.booking;
  assert v_claimed.settlement_id is not null, 'the job claims it';
  assert not exists (select 1 from public.gipedo_settlements_due() d where d.booking_id = g.booking),
    'a claimed settlement isn''t handed out twice';
  assert tests.error_of(format('select tests.cancel(%L, %L, %L)', g.booking, 'whole_team', g.home)) = 'payment_in_progress',
    'cancelling waits while the payment goes through';
end $$;

-- 4b. The opponent pulls out at 7 hours, then the venue cancels before the
-- fee is taken: the fee is stood down and every hold released.
do $$
declare
  g record;
  v_cancel jsonb;
  v_line public.booking_cancellation_lines;
begin
  select * into g from tests.g4_game('venue');
  perform tests.set_kickoff(g.booking, now() + interval '7 hours');
  perform tests.act_as(g.away);
  perform public.gipedo_pull_out(g.booking);
  perform tests.act_as_postgres();
  assert (tests.g4_row(g.booking, g.away)).reason = 'pull_out_fee' and (tests.g4_row(g.booking, g.away)).status = 'due',
    'the pull-out fee waits';

  v_cancel := tests.cancel(g.booking, 'venue', g.owner);
  assert (tests.g4_row(g.booking, g.away)).status = 'cancelled', 'the venue''s cancel stands the fee down';
  v_line := tests.line(v_cancel, (tests.share_of(g.booking, g.away)).id);
  assert v_line.action = 'release' and v_line.refund_cents = 6550,
    format('the opponent''s hold is released in full, got %s', row_to_json(v_line));
  v_line := tests.line(v_cancel, (tests.share_of(g.booking, g.home)).id);
  assert v_line.action = 'release' and v_line.refund_cents = 6550, 'and the booking team''s';
end $$;

-- 7a. A Premium opponent (6495) in a draw: the odd cent goes on the booking
-- team, 3276 / 3247.
do $$
declare
  g record;
  v_match uuid;
begin
  select * into g from tests.g4_game('premium', p_away_premium => true);
  assert (tests.share_of(g.booking, g.away)).amount_cents = 6495, 'a Premium opponent''s hold is 6495';
  v_match := tests.g4_played(g.booking);
  perform tests.g4_result(v_match, g.home, 2, 2, g.away);
  perform public.gipedo_settle_from_results();
  assert (tests.g4_row(g.booking, g.home)).capture_cents = 3276 and (tests.g4_row(g.booking, g.away)).capture_cents = 3247,
    format('3276 / 3247, got %s / %s', (tests.g4_row(g.booking, g.home)).capture_cents, (tests.g4_row(g.booking, g.away)).capture_cents);
  assert (tests.g4_row(g.booking, g.home)).venue_cents = 3000 and (tests.g4_row(g.booking, g.away)).venue_cents = 3000,
    'the venue gets 6000';
  assert (tests.g4_row(g.booking, g.home)).futty_cents + (tests.g4_row(g.booking, g.away)).futty_cents = 523,
    'half of the 1045 fee, rounded up: 523';
end $$;

-- 7b. play_normal_cents only for the booker.
do $$
declare
  g record;
begin
  select * into g from tests.g4_game('detail');
  perform tests.act_as(g.away);
  assert public.booking_detail(g.booking) -> 'gipedo' ->> 'play_normal_cents' is null, 'the opponent doesn''t see the booker''s hold';
  perform tests.act_as(g.home);
  assert (public.booking_detail(g.booking) -> 'gipedo' ->> 'play_normal_cents')::integer = 6550, 'the booker does';
  perform tests.act_as_postgres();
end $$;

-- 7c. The opponent-left wording: withdrew, or didn't hold within 15 minutes.
do $$
declare
  g record;
  v_share uuid;
begin
  select * into g from tests.g4_game('words', p_away => false);
  perform tests.g4_offer(g.booking, g.away, g.away_team);
  perform tests.act_as(g.away);
  perform public.cancel_opposition_offer(tests.g4_post(g.booking));
  perform tests.act_as_postgres();
  assert (tests.last_notification(g.home, 'gipedo_opponent_left')).body like '%withdrew%',
    format('a withdrawal says so: %s', (tests.last_notification(g.home, 'gipedo_opponent_left')).body);
  assert (tests.last_notification(g.home, 'gipedo_opponent_left')).title = 'Your opponent withdrew', 'its title';

  perform tests.g4_offer(g.booking, g.away, g.away_team);
  v_share := (tests.share_of(g.booking, g.away)).id;
  update public.booking_payment_shares set created_at = now() - interval '16 minutes' where id = v_share;
  perform public.gipedo_lapse_offers();
  -- Both notices are sent at the same now(), so each is found by its reason.
  assert (select body from public.notifications
          where profile_id = g.home and type = 'gipedo_opponent_left' and data ->> 'reason' = 'lapsed') like '%within 15 minutes%',
    'a lapse says so';
  assert (select title from public.notifications
          where profile_id = g.home and type = 'gipedo_opponent_left' and data ->> 'reason' = 'lapsed') = 'Your opponent didn''t confirm',
    'its title';
end $$;

-- 7d. A cancel is recorded once per intent, whatever the reason.
do $$
declare
  g record;
  v_share public.booking_payment_shares;
begin
  select * into g from tests.g4_game('once', p_away => false);
  v_share := tests.share_of(g.booking, g.home);
  perform public.record_intent_cancelled(g.booking, v_share.id, null, v_share.stripe_payment_intent_id, 'hold_cancelled');
  perform public.record_intent_cancelled(g.booking, v_share.id, null, v_share.stripe_payment_intent_id, 'gipedo_hold_expired');
  assert (select count(*) from public.money_ledger where kind = 'cancel' and stripe_id = v_share.stripe_payment_intent_id) = 1,
    'one cancel per intent';
end $$;

-- 7e. A pull-out at 5 hours when the booking's match doesn't exist yet: it
-- is made, and the forfeit recorded.
do $$
declare
  g record;
  v_result jsonb;
begin
  select * into g from tests.g4_game('nomatch');
  perform tests.set_kickoff(g.booking, now() + interval '5 hours');
  delete from public.match_sides where match_id = (tests.match_of(g.booking)).id;
  delete from public.matches where booking_id = g.booking;
  perform tests.act_as(g.away);
  v_result := public.gipedo_pull_out(g.booking);
  perform tests.act_as_postgres();
  assert v_result ->> 'result' = 'forfeit', format('a forfeit, got %s', v_result);
  assert (tests.match_of(g.booking)).forfeit_side = 'b', 'recorded on the new match';
end $$;

-- Security: the new internal functions are service_role only.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.money_gipedo_split_fee(integer, integer)',
                              'public.release_share_credit_reservation_modes(uuid, text, boolean)',
                              'public.share_payment_held_modes(uuid, text, integer, text, timestamptz)',
                              'public.cancel_booking_internal_modes(uuid, text, uuid, text)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('%s is internal', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s is internal (anon)', v_fn);
  end loop;
end $$;

select 'pay gipedo 4 (review fixes) passed' as result;

rollback;
