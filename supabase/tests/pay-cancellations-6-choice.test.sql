-- Card refund or credit (10 November decision): a player whose share is
-- given back after the booker or the venue cancelled has 48 hours to choose
-- credit; with no choice, the card refund goes out at 48 hours. Only the
-- player can choose, once, and only within the 48 hours.
begin;

do $$
declare
  v_booker uuid := tests.create_user('choice-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_silent public.booking_payment_shares;
  v_chooser public.booking_payment_shares;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
  v_due record;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'choice');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_ch_0', interval '2 hours');
  v_silent := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_ch_1', interval '2 hours');
  v_chooser := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_ch_2', interval '2 hours');
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);

  -- Before 48 hours nothing is due for the job.
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.cancellation_work(null) w where w.share_id = v_silent.id),
    'the refund waits for the choice';
  perform tests.act_as_postgres();

  -- Someone else can't choose for them; a choice must be card or credit.
  v_line := tests.line(v_done, v_silent.id);
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.choose_cancellation_refund(%L, %L, 'credit') $q$, v_line.id, v_booker))
         = 'not_your_refund', 'only the player chooses';
  assert tests.error_of(format($q$ select public.choose_cancellation_refund(%L, %L, 'cash') $q$, v_line.id,
                               v_silent.profile_id)) = 'invalid_choice', 'card or credit';
  perform tests.act_as_postgres();

  -- 48 hours later the silent player's refund is due, to their card.
  update public.booking_cancellation_lines
  set choose_by = now() - interval '1 second', next_attempt_at = now() - interval '1 second'
  where id = v_line.id;
  perform tests.act_as_service_role();
  select * into v_due from public.cancellation_work(null) w where w.line_id = v_line.id;
  assert v_due.kind = 'refund' and v_due.stripe_intent_id = 'pi_ch_1', format('a card refund is due, got %s', row_to_json(v_due));
  assert tests.error_of(format($q$ select public.choose_cancellation_refund(%L, %L, 'credit') $q$, v_line.id,
                               v_silent.profile_id)) = 'choice_closed', 'too late to choose credit';
  perform tests.act_as_postgres();

  -- The other player chooses credit in time: credit at once, nothing to refund.
  v_line := tests.line(v_done, v_chooser.id);
  perform tests.act_as_service_role();
  v_result := public.choose_cancellation_refund(v_line.id, v_chooser.profile_id, 'credit');
  assert v_result ->> 'result' = 'credited', format('credited, got %s', v_result);
  assert tests.error_of(format($q$ select public.choose_cancellation_refund(%L, %L, 'card') $q$, v_line.id,
                               v_chooser.profile_id)) = 'already_chosen', 'one choice';
  assert not exists (select 1 from public.cancellation_work(null) w where w.line_id = v_line.id), 'nothing left to do';
  perform tests.act_as_postgres();
  assert (select (amount_cents, source) from public.venue_credits where profile_id = v_chooser.profile_id)
         = (680, 'booking_cancelled'::text), 'their full 680 as credit';
  assert not exists (select 1 from public.venue_payables where booking_id = v_booking.id),
    'the venue owes nothing when the booker cancelled';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

rollback;
