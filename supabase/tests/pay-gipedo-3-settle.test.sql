-- P8: settling Gipedo Pano (docs/specs/13-payments-bookings.md, "Gipedo
-- Pano", decisions of 12 and 13 November). Worked examples with their exact
-- amounts, on a EUR 60 5 v 5 (each hold 6550 = 6000 pitch + 550 fee):
--   win / loss: the loser pays 6550 (6000 to the venue), the winner 0
--   draw, dispute, no result: each team pays 3275
--   a Premium booking captain's hold (6495) splits 3248; the opponent 3275
--   on a EUR 55.55 pitch the odd cent goes on the booking team: 3053 / 3052
--   one-sided result: it stands after 24 hours
--   no opponent at 24 hours: play as normal (6550, or 6495 Premium) or
--   cancel free; no choice by 6 hours before kickoff cancels free
--   pull-out at 7 hours: 1000 (100 x 10 players) to Futty; at 5 hours: the
--   team that pulls out pays 6550 as the loser
--   an expired hold: what it should have paid is owed (venue, or Futty for
--   a pull-out fee); a winner's expired hold owes nothing
--   settling twice changes nothing
begin;

create function tests.gp_team(p_captain uuid, p_name text)
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

-- A Gipedo Pano game: the booking team's captain (home) booked and holds,
-- and an opponent captain (away) offered and holds. p_away => false leaves
-- it with no opponent.
create function tests.gp_game(
  p_label text,
  p_price integer default 6000,
  p_home_premium boolean default false,
  p_away boolean default true,
  out booking uuid,
  out home uuid,
  out away uuid,
  out home_team uuid,
  out away_team uuid
)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  home := tests.create_user(format('gp3-%s-home@futty.test', p_label));
  home_team := tests.gp_team(home, p_label || ' Home');
  perform tests.set_price(v_venue, '5-a-side', p_price);
  if p_home_premium then
    perform tests.make_premium(home);
  end if;
  perform tests.act_as(home);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', home_team);
  perform tests.act_as_postgres();
  booking := v_booking.id;
  perform tests.hold_share((tests.share_of(booking, home)).id, 'pi_home_' || p_label);
  if p_away then
    away := tests.create_user(format('gp3-%s-away@futty.test', p_label));
    away_team := tests.gp_team(away, p_label || ' Away');
    perform tests.act_as(away);
    perform public.offer_opposition((select id from public.squad_posts where venue_booking_id = booking), away_team);
    perform tests.act_as_postgres();
    perform tests.hold_share((tests.share_of(booking, away)).id, 'pi_away_' || p_label);
  end if;
end;
$$;

-- The match has been played (kicked off 90 minutes ago, ended an hour ago).
create function tests.gp_played(p_booking uuid)
returns uuid
language plpgsql
as $$
begin
  perform tests.end_match(p_booking, '1 hour');
  return (tests.match_of(p_booking)).id;
end;
$$;

-- p_by enters a score (side a, side b); p_reply answers it (null: silence).
create function tests.gp_result(p_match uuid, p_by uuid, p_a integer, p_b integer, p_reply uuid, p_accept boolean)
returns void
language plpgsql
as $$
begin
  perform tests.act_as(p_by);
  perform public.submit_match_result(p_match, p_a, p_b);
  if p_reply is not null then
    perform tests.act_as(p_reply);
    perform public.respond_to_match_result(p_match, p_accept);
  end if;
  perform tests.act_as_postgres();
end;
$$;

-- The result deadline passes and the match job runs.
create function tests.gp_deadline(p_match uuid)
returns void
language plpgsql
as $$
begin
  update public.matches set result_deadline_at = now() - interval '1 minute' where id = p_match;
  perform tests.act_as_service_role();
  perform public.match_jobs_tick();
  perform tests.act_as_postgres();
end;
$$;

-- A captain's settlement row.
create function tests.gp_row(p_booking uuid, p_profile uuid)
returns public.gipedo_settlements
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.gipedo_settlements where booking_id = p_booking and profile_id = p_profile;
$$;

-- What run-payment-jobs does with every due settlement of a booking: takes
-- what's due (Stripe keeps its fee) or releases the hold.
create function tests.gp_carry_out(p_booking uuid)
returns void
language plpgsql
as $$
declare
  v_due record;
begin
  for v_due in select * from public.gipedo_settlements_due() d where d.booking_id = p_booking loop
    if v_due.capture_cents > 0 then
      perform public.gipedo_settlement_done(v_due.settlement_id, 'captured', v_due.capture_cents,
                                            tests.stripe_fee(v_due.capture_cents));
    else
      perform public.gipedo_settlement_done(v_due.settlement_id, 'released');
    end if;
  end loop;
end;
$$;

-- 1. A win, agreed: the loser pays 6550, the winner is released.
do $$
declare
  g record;
  v_match uuid;
  v_capture public.money_ledger;
begin
  select * into g from tests.gp_game('win');
  v_match := tests.gp_played(g.booking);
  perform tests.gp_result(v_match, g.home, 3, 1, g.away, true);

  assert public.gipedo_settle_from_results() = 2, 'both holds settle';
  assert (tests.gp_row(g.booking, g.home)).reason = 'won' and (tests.gp_row(g.booking, g.home)).capture_cents = 0,
    'the winner pays nothing';
  assert (tests.gp_row(g.booking, g.away)).reason = 'lost' and (tests.gp_row(g.booking, g.away)).capture_cents = 6550
         and (tests.gp_row(g.booking, g.away)).venue_cents = 6000 and (tests.gp_row(g.booking, g.away)).futty_cents = 550,
    'the loser pays 6550: 6000 to the venue, 550 fee';

  -- Settling twice changes nothing.
  assert public.gipedo_settle_from_results() = 0, 'nothing new to settle';

  perform tests.gp_carry_out(g.booking);
  assert (tests.share_of(g.booking, g.away)).status = 'paid', 'the loser''s hold is taken';
  assert (tests.share_of(g.booking, g.home)).status = 'cancelled', 'the winner''s hold released';
  select * into v_capture from public.money_ledger where kind = 'capture' and stripe_id = 'pi_away_win';
  assert v_capture.amount_cents = 6550 and v_capture.venue_cents = 6000 and v_capture.reason = 'gipedo_lost',
    format('the ledger has the capture, got %s', row_to_json(v_capture));
  assert v_capture.futty_cents + v_capture.stripe_fee_cents = 550, 'Futty''s fee less Stripe''s';
  assert exists (select 1 from public.money_ledger where kind = 'cancel' and stripe_id = 'pi_home_win' and reason = 'gipedo_won'),
    'and the release';
  assert tests.notified(g.away, 'gipedo_settled') = 1 and tests.notified(g.home, 'gipedo_settled') = 1, 'both told';

  assert (public.gipedo_settlement_done((tests.gp_row(g.booking, g.away)).id, 'captured', 6550, 123)) ->> 'result' = 'duplicate',
    'a repeated report changes nothing';
  assert (select count(*) from public.money_ledger where kind = 'capture' and stripe_id = 'pi_away_win') = 1, 'one capture';
end $$;

-- 2. A loss for the booking team (one-sided result standing after 24
-- hours), a draw, a dispute and no result.
do $$
declare
  g record;
  v_match uuid;
begin
  -- The booking team enters a 1-4 defeat; the opponent never answers.
  select * into g from tests.gp_game('silent');
  v_match := tests.gp_played(g.booking);
  perform tests.gp_result(v_match, g.home, 1, 4, null, null);
  assert public.gipedo_settle_from_results() = 0, 'nothing until the result stands';
  perform tests.gp_deadline(v_match);
  perform public.gipedo_settle_from_results();
  assert (tests.gp_row(g.booking, g.home)).capture_cents = 6550, 'after 24 hours the booking team pays 6550';
  assert (tests.gp_row(g.booking, g.away)).capture_cents = 0, 'the opponent nothing';

  select * into g from tests.gp_game('draw');
  v_match := tests.gp_played(g.booking);
  perform tests.gp_result(v_match, g.home, 2, 2, g.away, true);
  perform public.gipedo_settle_from_results();
  assert (tests.gp_row(g.booking, g.home)).capture_cents = 3275 and (tests.gp_row(g.booking, g.away)).capture_cents = 3275,
    'a draw: 3275 each';
  assert (tests.gp_row(g.booking, g.home)).venue_cents = 3000 and (tests.gp_row(g.booking, g.home)).futty_cents = 275,
    'half the pitch, half the fee';

  select * into g from tests.gp_game('dispute');
  v_match := tests.gp_played(g.booking);
  perform tests.gp_result(v_match, g.home, 5, 0, g.away, false);
  perform public.gipedo_settle_from_results();
  assert (tests.gp_row(g.booking, g.home)).capture_cents = 3275 and (tests.gp_row(g.booking, g.away)).capture_cents = 3275,
    'a dispute: 3275 each';
  assert (tests.gp_row(g.booking, g.home)).reason = 'split', 'split';

  select * into g from tests.gp_game('none');
  v_match := tests.gp_played(g.booking);
  perform tests.gp_deadline(v_match);
  perform public.gipedo_settle_from_results();
  assert (tests.gp_row(g.booking, g.home)).capture_cents = 3275 and (tests.gp_row(g.booking, g.away)).capture_cents = 3275,
    'no result: 3275 each';
end $$;

-- 3. Odd cents and a Premium captain.
do $$
declare
  g record;
  v_match uuid;
begin
  select * into g from tests.gp_game('odd', p_price => 5555);
  assert (tests.share_of(g.booking, g.home)).amount_cents = 6105, 'a 5555 pitch: hold 6105';
  v_match := tests.gp_played(g.booking);
  perform tests.gp_result(v_match, g.home, 1, 1, g.away, true);
  perform public.gipedo_settle_from_results();
  assert (tests.gp_row(g.booking, g.home)).capture_cents = 3053, 'the booking team takes the odd cent: 3053';
  assert (tests.gp_row(g.booking, g.away)).capture_cents = 3052, 'the opponent 3052';
  assert (tests.gp_row(g.booking, g.home)).venue_cents + (tests.gp_row(g.booking, g.away)).venue_cents = 5555,
    'the venue gets its whole pitch price';

  select * into g from tests.gp_game('premium', p_home_premium => true);
  assert (tests.share_of(g.booking, g.home)).amount_cents = 6495, 'a Premium captain''s hold is 6495';
  v_match := tests.gp_played(g.booking);
  perform tests.gp_result(v_match, g.home, 0, 0, g.away, true);
  perform public.gipedo_settle_from_results();
  assert (tests.gp_row(g.booking, g.home)).capture_cents = 3248, 'half of 6495 (3000 + 248)';
  assert (tests.gp_row(g.booking, g.away)).capture_cents = 3275, 'half of 6550';
end $$;

-- 4. Expired holds: the loser's becomes a debt to the venue, the winner's
-- owes nothing.
do $$
declare
  g record;
  v_match uuid;
  v_debt public.venue_debts;
  v_result jsonb;
begin
  select * into g from tests.gp_game('expired');
  v_match := tests.gp_played(g.booking);
  perform tests.gp_result(v_match, g.home, 0, 2, g.away, true);
  perform public.gipedo_settle_from_results();

  v_result := public.gipedo_settlement_done((tests.gp_row(g.booking, g.home)).id, 'gone');
  assert (tests.gp_row(g.booking, g.home)).status = 'debt', 'the loser''s expired hold';
  select * into v_debt from public.venue_debts where id = (v_result ->> 'debt_id')::uuid;
  assert v_debt.profile_id = g.home and v_debt.owed_to = 'venue' and v_debt.amount_cents = 6550
         and v_debt.venue_cents = 6000 and v_debt.futty_cents = 550 and v_debt.reason = 'gipedo_hold_expired',
    format('is owed to the venue: 6550, got %s', row_to_json(v_debt));
  assert public.profile_has_debt(g.home), 'and blocks booking';

  perform public.gipedo_settlement_done((tests.gp_row(g.booking, g.away)).id, 'gone');
  assert (tests.gp_row(g.booking, g.away)).status = 'done', 'the winner''s expired hold';
  assert not public.profile_has_debt(g.away), 'owes nothing';
end $$;

-- 5. No opponent 24 hours before kickoff.
do $$
declare
  g record;
  v_premium record;
  v_cancel record;
  v_auto record;
  v_result jsonb;
begin
  select * into g from tests.gp_game('alone', p_away => false);
  assert tests.error_as(g.home, format($q$ select public.gipedo_no_opponent_choice(%L, 'play_normal') $q$, g.booking))
    = 'choice_not_due', 'no choice before 24 hours';
  perform tests.set_kickoff(g.booking, now() + interval '23 hours');
  assert public.gipedo_no_opponent_due() >= 1, 'the captain is asked';
  assert (select gipedo_no_opponent_at from public.venue_bookings where id = g.booking) is not null, 'once';
  assert (select status from public.squad_posts where venue_booking_id = g.booking) = 'closed', 'the post closes';
  assert tests.notified(g.home, 'gipedo_no_opponent') = 1, 'told';
  assert public.gipedo_no_opponent_due() = 0, 'and not asked twice';

  perform tests.act_as(g.home);
  v_result := public.gipedo_no_opponent_choice(g.booking, 'play_normal');
  perform tests.act_as_postgres();
  assert (v_result ->> 'capture_cents')::int = 6550, 'play as normal: 6550 taken from the hold';
  assert (select payment_mode from public.venue_bookings where id = g.booking) = 'pay_all', 'now a pay-for-everyone booking';
  assert (tests.gp_row(g.booking, g.home)).reason = 'play_normal' and (tests.gp_row(g.booking, g.home)).capture_cents = 6550,
    'the whole hold is taken';
  assert tests.error_as(g.home, format($q$ select public.gipedo_no_opponent_choice(%L, 'cancel') $q$, g.booking))
    = 'not_gipedo', 'one choice only';
  perform tests.gp_carry_out(g.booking);
  assert (tests.share_of(g.booking, g.home)).status = 'paid', 'paid like a booker who paid for everyone';
  -- From now on it cancels as pay-for-everyone does (decided 13 November).
  assert public.cancellation_plan(g.booking, 'whole_team', g.home, now()) is not null, 'pay-for-everyone cancel rules';

  select * into v_premium from tests.gp_game('alone-premium', p_home_premium => true, p_away => false);
  perform tests.set_kickoff(v_premium.booking, now() + interval '20 hours');
  perform public.gipedo_no_opponent_due();
  perform tests.act_as(v_premium.home);
  assert (public.gipedo_no_opponent_choice(v_premium.booking, 'play_normal') ->> 'capture_cents')::int = 6495,
    'a Premium captain: 6495';
  perform tests.act_as_postgres();

  select * into v_cancel from tests.gp_game('alone-cancel', p_away => false);
  perform tests.set_kickoff(v_cancel.booking, now() + interval '20 hours');
  perform public.gipedo_no_opponent_due();
  perform tests.act_as(v_cancel.home);
  perform public.gipedo_no_opponent_choice(v_cancel.booking, 'cancel');
  perform tests.act_as_postgres();
  assert (select status from public.venue_bookings where id = v_cancel.booking) = 'cancelled', 'cancelled free';
  assert not exists (select 1 from public.gipedo_settlements where booking_id = v_cancel.booking), 'nothing taken';
  assert exists (select 1 from public.bookings_with_money_to_release() r where r.booking_id = v_cancel.booking),
    'the hold is released';
  assert not exists (select 1 from public.booking_pitches where booking_id = v_cancel.booking), 'the slot is freed';

  select * into v_auto from tests.gp_game('alone-auto', p_away => false);
  perform tests.set_kickoff(v_auto.booking, now() + interval '20 hours');
  perform public.gipedo_no_opponent_due();
  perform tests.set_kickoff(v_auto.booking, now() + interval '5 hours');
  assert tests.error_as(v_auto.home, format($q$ select public.gipedo_no_opponent_choice(%L, 'play_normal') $q$, v_auto.booking))
    = 'choice_closed', 'no choice less than 6 hours before kickoff';
  assert public.gipedo_auto_cancel_due() >= 1, 'no choice: cancelled';
  assert (select status from public.venue_bookings where id = v_auto.booking) = 'cancelled', 'free';
  assert (select gipedo_choice from public.venue_bookings where id = v_auto.booking) = 'auto_cancel', 'recorded as automatic';
end $$;

-- 6. Pulling out at 7 hours: 1000 to Futty. The opponent: the post closes
-- (inside 24 hours) and the booking team gets the no-opponent choice. The
-- booking team: the booking is cancelled and the opponent released.
do $$
declare
  g record;
  b record;
  v_quote jsonb;
begin
  select * into g from tests.gp_game('away-out');
  perform tests.set_kickoff(g.booking, now() + interval '7 hours');
  v_quote := public.gipedo_pull_out_quote(g.booking, g.away);
  assert v_quote ->> 'kind' = 'fee' and (v_quote ->> 'cents')::int = 1000, format('the quote: 1000, got %s', v_quote);
  perform tests.act_as(g.away);
  perform public.gipedo_pull_out(g.booking);
  perform tests.act_as_postgres();
  assert (tests.gp_row(g.booking, g.away)).reason = 'pull_out_fee' and (tests.gp_row(g.booking, g.away)).capture_cents = 1000
         and (tests.gp_row(g.booking, g.away)).futty_cents = 1000 and (tests.gp_row(g.booking, g.away)).venue_cents = 0,
    '100 x 10 players, all Futty''s';
  assert (select status from public.squad_posts where venue_booking_id = g.booking) = 'closed', 'inside 24 hours the post stays closed';
  assert (tests.match_of(g.booking)).status = 'scheduled' and (tests.match_of(g.booking)).kind = 'pickup',
    'the friendly is off; the booking''s match waits';
  assert tests.notified(g.home, 'gipedo_pulled_out') = 1, 'the booking team is told';
  perform tests.gp_carry_out(g.booking);
  assert (tests.share_of(g.booking, g.away)).status = 'forfeited', 'the opponent''s hold: 1000 taken, the rest released';
  assert exists (select 1 from public.money_ledger where kind = 'capture' and stripe_id = 'pi_away_away-out'
                 and amount_cents = 1000 and venue_cents = 0 and reason = 'gipedo_pull_out_fee'), 'in the ledger';
  assert public.gipedo_no_opponent_due() >= 1, 'the booking team now chooses: play as normal or cancel free';
  assert (select gipedo_no_opponent_at from public.venue_bookings where id = g.booking) is not null, 'asked';

  select * into b from tests.gp_game('home-out');
  perform tests.set_kickoff(b.booking, now() + interval '7 hours');
  perform tests.act_as(b.home);
  perform public.gipedo_pull_out(b.booking);
  perform tests.act_as_postgres();
  assert (tests.gp_row(b.booking, b.home)).capture_cents = 1000, 'the booking team pays 1000';
  assert (select status from public.venue_bookings where id = b.booking) = 'cancelled', 'the booking is cancelled';
  assert exists (select 1 from public.booking_money_to_release(b.booking) r where r.id = (tests.share_of(b.booking, b.away)).id),
    'the opponent''s hold is released';
  assert not exists (select 1 from public.booking_money_to_release(b.booking) r where r.id = (tests.share_of(b.booking, b.home)).id),
    'the booking team''s hold is left for its 1000';
  perform public.gipedo_settlement_done((tests.gp_row(b.booking, b.home)).id, 'gone');
  assert exists (select 1 from public.venue_debts where profile_id = b.home and owed_to = 'futty' and venue_id is null
                 and amount_cents = 1000 and reason = 'gipedo_hold_expired'), 'an expired hold: 1000 owed to Futty';
end $$;

-- 7. Pulling out at 5 hours: that team forfeits and pays 6550; with no
-- opponent the booking team leaves free; nobody else can pull out.
do $$
declare
  g record;
  v_alone record;
  v_stranger uuid := tests.create_user('gp3-stranger@futty.test');
begin
  select * into g from tests.gp_game('late-out');
  perform tests.set_kickoff(g.booking, now() + interval '5 hours');
  assert (public.gipedo_pull_out_quote(g.booking, g.away)) ->> 'kind' = 'forfeit', 'less than 6 hours: a forfeit';
  perform tests.act_as(g.away);
  perform public.gipedo_pull_out(g.booking);
  perform tests.act_as_postgres();
  assert (tests.match_of(g.booking)).forfeit_side = 'b' and (tests.match_of(g.booking)).forfeit_reason = 'pulled_out',
    'side b forfeits';
  perform public.gipedo_settle_from_results();
  assert (tests.gp_row(g.booking, g.away)).capture_cents = 6550, 'and pays 6550 as the loser';
  assert (tests.gp_row(g.booking, g.home)).capture_cents = 0, 'the booking team is released';

  select * into v_alone from tests.gp_game('alone-out', p_away => false);
  assert (public.gipedo_pull_out_quote(v_alone.booking, v_alone.home)) ->> 'kind' = 'free', 'no opponent: free';
  assert tests.error_as(v_stranger, format('select public.gipedo_pull_out(%L)', v_alone.booking)) = 'cannot_pull_out',
    'only a captain holding';
  perform tests.act_as(v_alone.home);
  perform public.gipedo_pull_out(v_alone.booking);
  perform tests.act_as_postgres();
  assert (select status from public.venue_bookings where id = v_alone.booking) = 'cancelled', 'cancelled';
  assert not exists (select 1 from public.gipedo_settlements where booking_id = v_alone.booking), 'nothing taken';
end $$;

-- 8. The booking screen and security.
do $$
declare
  g record;
  d jsonb;
  v_fn text;
begin
  select * into g from tests.gp_game('detail');
  perform tests.act_as(g.away);
  d := public.booking_detail(g.booking);
  perform tests.act_as_postgres();
  assert d -> 'gipedo' ->> 'my_side' = 'b', 'the opponent sees their side';
  assert d -> 'gipedo' -> 'opponent' ->> 'state' = 'held', 'both holds are in';
  assert d -> 'gipedo' -> 'pull_out' ->> 'kind' = 'fee' and (d -> 'gipedo' -> 'pull_out' ->> 'cents')::int = 1000,
    'pulling out now costs 1000';
  assert not (d -> 'can_cancel' ->> 'my_spot')::boolean and not (d -> 'can_cancel' ->> 'whole_team')::boolean,
    'no ordinary cancel for a captain';
  assert (select count(*) from jsonb_array_elements(d -> 'roster') e where e ->> 'state' = 'held') = 2,
    'both captains'' cards show as held, not paid';

  foreach v_fn in array array['public.gipedo_add_settlement(uuid, text)', 'public.gipedo_settle_from_results()',
                              'public.gipedo_settlements_due()', 'public.gipedo_settlement_done(uuid, text, integer, integer)',
                              'public.gipedo_settlement_failed(uuid, text)', 'public.gipedo_no_opponent_due()',
                              'public.gipedo_auto_cancel_due()', 'public.gipedo_cancel_booking(uuid, text)',
                              'public.gipedo_pull_out_quote(uuid, uuid)', 'public.booking_detail_modes(uuid)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('%s is internal', v_fn);
  end loop;
  assert has_function_privilege('authenticated', 'public.gipedo_pull_out(uuid)', 'execute'), 'captains pull out';
  assert has_function_privilege('authenticated', 'public.gipedo_no_opponent_choice(uuid, text)', 'execute'), 'and choose';
  assert not has_table_privilege('authenticated', 'public.gipedo_settlements', 'select'), 'settlements are internal';
end $$;

-- 9. A failed Stripe call is tried again after a back-off; the third
-- failure alerts the founders once.
do $$
declare
  g record;
  v_row public.gipedo_settlements;
begin
  select * into g from tests.gp_game('retry');
  perform tests.gp_played(g.booking);
  perform tests.gp_result((tests.match_of(g.booking)).id, g.home, 1, 0, g.away, true);
  perform public.gipedo_settle_from_results();
  v_row := tests.gp_row(g.booking, g.away);
  perform public.gipedo_settlement_failed(v_row.id, 'api_error');
  assert not exists (select 1 from public.gipedo_settlements_due() d where d.settlement_id = v_row.id), 'waits its back-off';
  perform public.gipedo_settlement_failed(v_row.id, 'api_error');
  perform public.gipedo_settlement_failed(v_row.id, 'api_error');
  assert exists (select 1 from public.admin_alerts where kind = 'capture_failing' and share_id = v_row.share_id), 'alerted';
end $$;

select 'pay gipedo 3 (settle) passed' as result;

rollback;
