-- cancellation_quote's guarantee_hold_placed (P5b review): true only once the
-- booker's guarantee hold has actually been placed (spec 13, "When money is
-- held and taken" step 3), so the booking screen says "your guarantee hold is
-- released" only then. The lines and the quote hash are unchanged.
begin;

do $$
declare
  v_booker uuid := tests.create_user('held-flag-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_before jsonb;
  v_after jsonb;
  v_plan jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  -- 5 days ahead: the hold isn't due yet, so the guarantee is only a saved card.
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 1, tests.cyprus_today() + 5,
                                          p_label => 'held-flag');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hf_0', interval '2 hours');
  select * into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;
  assert v_guarantee.status <> 'held', format('not held yet, got %s', v_guarantee.status);

  perform tests.act_as(v_booker);
  v_before := public.cancellation_quote(v_booking.id, 'whole_team');
  perform tests.act_as_postgres();
  assert v_before -> 'guarantee_hold_placed' = 'false'::jsonb, format('no hold placed yet, got %s', v_before);
  assert exists (select 1 from jsonb_array_elements(v_before -> 'lines') l where l ->> 'guarantee_id' = v_guarantee.id::text),
    'the guarantee line is still there (the saved card is let go)';

  -- The quote hash is the plan's: cancel-booking still accepts it.
  v_plan := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert v_before ->> 'quote' = v_plan ->> 'quote' and v_before -> 'lines' = v_plan -> 'lines', 'lines and hash unchanged';

  perform public.guarantee_hold_placed(v_guarantee.id, 'pi_hf_guarantee', 6000);
  perform tests.act_as(v_booker);
  v_after := public.cancellation_quote(v_booking.id, 'whole_team');
  perform tests.act_as_postgres();
  assert v_after -> 'guarantee_hold_placed' = 'true'::jsonb, format('the hold is placed, got %s', v_after);

  -- Cancelling only the booker's spot leaves the guarantee alone.
  perform tests.act_as(v_booker);
  v_after := public.cancellation_quote(v_booking.id, 'my_spot');
  perform tests.act_as_postgres();
  assert v_after -> 'guarantee_hold_placed' = 'false'::jsonb, 'my spot: the guarantee is unchanged';
end $$;

-- Pay for everyone has no guarantee.
do $$
declare
  v_booker uuid := tests.create_user('held-flag-payall@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_quote jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 2,
                                          p_label => 'held-flag-payall');
  perform tests.act_as(v_booker);
  v_quote := public.cancellation_quote(v_booking.id, 'whole_team');
  perform tests.act_as_postgres();
  assert v_quote -> 'guarantee_hold_placed' = 'false'::jsonb, format('no guarantee, got %s', v_quote);
end $$;

rollback;
