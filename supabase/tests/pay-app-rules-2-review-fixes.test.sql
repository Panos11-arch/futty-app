-- P10 review fixes (PR #77): the rules can't be emptied; the legacy flat fee
-- is gone; Gipedo Pano's limit is whole hours whatever the time zone; and the
-- functions P8 renamed (*_modes) and the texts the first pass missed read the
-- rules too: the quote's refunds_stop_at, the whole-team fee message, the
-- non-refundable and pay-again notices, and the Gipedo Pano withdrawal text.
begin;

-- The rules can't be emptied: TRUNCATE is refused (with no row, every rule
-- would read as NULL and checks such as the booking window would fail open).
do $$
begin
  perform tests.act_as_service_role();
  assert tests.error_of($q$ truncate public.app_rules $q$) like 'permission denied%',
    'service_role cannot truncate the rules';
  perform tests.act_as_postgres();
  assert tests.error_of($q$ truncate public.app_rules $q$) = 'app_rules_cannot_be_deleted',
    'even the owner is refused by the trigger';
  assert (select count(*) from public.app_rules) = 1, 'the row is still there';
end $$;

-- The legacy flat service fee (a second copy of the 80) is gone.
do $$
begin
  assert to_regprocedure('public.service_fee_cents()') is null, 'service_fee_cents() is dropped';
end $$;

-- Gipedo Pano: at most 5 days = 120 hours ahead, as before, even when the
-- session runs in Cyprus time across the clocks going forward (28 March 2027).
do $$
declare
  v_at timestamptz := '2027-03-26 12:00:00+02';
begin
  perform set_config('timezone', 'Asia/Nicosia', true);
  assert public.gipedo_window_error(v_at + interval '120 hours', v_at) is null, '120 hours ahead is allowed';
  assert public.gipedo_window_error(v_at + interval '120 hours 1 minute', v_at) = 'gipedo_too_far_ahead',
    'a minute more is too far';
  perform set_config('timezone', 'UTC', true);
end $$;

-- Test-only helpers for a Gipedo Pano game (as in pay-gipedo-2-opposition).
create function tests.rf_team(p_captain uuid, p_name text)
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

create function tests.rf_post(p_booking uuid)
returns public.squad_posts
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.squad_posts where venue_booking_id = p_booking and type = 'opposition';
$$;

-- From here on, changed rules (this transaction only).
update public.app_rules set
  refund_cutoff_hours = 4, cancel_fee_cents = 150, payment_window_minutes = 30, gipedo_opponent_hours = 12;

-- The quote's refunds_stop_at follows the cutoff (booking_quote_modes).
do $$
declare
  v_player uuid := tests.create_user('rf-quote@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  q jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_player);
  q := public.booking_quote(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', '5-a-side', 5);
  perform tests.act_as_postgres();
  assert (q ->> 'refunds_stop_at')::timestamptz = (q ->> 'kickoff_at')::timestamptz - interval '4 hours',
    format('refunds stop 4 hours before kickoff, got %s and %s', q ->> 'refunds_stop_at', q ->> 'kickoff_at');
end $$;

-- The whole-team fee message: the fee as charged, per player (cancellation_fee_attempted).
do $$
declare
  v_booker uuid := tests.create_user('rf-fee-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_done jsonb;
  v_fee public.booking_cancellation_fees;
  v_body text;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'rf-fee');
  for i in 0 .. 3 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_rf_fee_' || i, interval '2 hours');
  end loop;
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);
  select * into v_fee from public.booking_cancellation_fees where id = (v_done ->> 'fee_id')::uuid;
  assert (v_fee.amount_cents, v_fee.players) = (450, 3), format('3 players x the new 150, got %s', row(v_fee.*));

  perform tests.act_as_service_role();
  perform public.cancellation_fee_attempted(v_fee.id, 'pi_rf_fee_charge', 'failed', 'card_declined');
  perform tests.act_as_postgres();
  select body into v_body from public.notifications where profile_id = v_booker and type = 'cancellation_fee_failed';
  assert v_body like 'We couldn''t take the €4.50 for cancelling your team''s game (3 players x €1.50).%',
    format('the message matches the charge, got %s', v_body);
end $$;

-- Paid under the new 4-hour cutoff without accepting the notice (share_payment_held_modes).
do $$
declare
  v_booker uuid := tests.create_user('rf-late-booker@futty.test');
  v_player uuid := tests.create_user('rf-late-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed', created_at = now() - interval '2 days' where id = v_booking.id;
  perform tests.set_kickoff(v_booking.id, now() + interval '4 hours 5 minutes');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.pay_share(v_share.id, 'pi_rf_late');
  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours 58 minutes');
  perform tests.act_as_service_role();
  v_result := public.share_payment_held(v_share.id, 'pi_rf_late', 680, 'pm_rf_late', now());
  perform tests.act_as_postgres();
  assert v_result ->> 'reason' = 'non_refundable_not_accepted', format('refused under 4 hours, got %s', v_result);
  assert exists (select 1 from public.notifications where profile_id = v_player and type = 'match_payment_due'
                 and body like 'Your game starts in less than 4 hours, so it''s non-refundable.%'),
    'the notice says 4 hours';
end $$;

-- The payment undone by the release job: pay again within the new 30 minutes
-- (release_share_credit_reservation_modes).
do $$
declare
  v_booker uuid := tests.create_user('rf-undo-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_booker, v_venue, 2000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'rf-undo');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_rf_undo', interval '0', 'card', true);
  update public.venue_bookings set created_at = now() - interval '45 minutes' where id = v_booking.id;
  perform tests.act_as_service_role();
  perform public.credit_release_started(v_share.id, 'pi_rf_undo');
  assert public.release_share_credit_reservation(v_share.id, 'pi_rf_undo', true), 'undone';
  perform tests.act_as_postgres();
  assert exists (select 1 from public.notifications where profile_id = v_booker and type = 'match_payment_due'
                 and body like '%Pay again within 30 minutes to keep your booking%'), 'the notice says 30 minutes';
end $$;

-- Gipedo Pano: an offer withdrawn less than the new 12 hours before kickoff
-- leaves the post closed, and the words say 12 hours (gipedo_withdraw_offer).
do $$
declare
  v_home uuid := tests.create_user('rf-gp-home@futty.test');
  v_away uuid := tests.create_user('rf-gp-away@futty.test');
  v_home_team uuid := tests.rf_team(v_home, 'RF Home');
  v_away_team uuid := tests.rf_team(v_away, 'RF Away');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_booking public.venue_bookings;
  v_body text;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_home);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', v_home_team);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_home)).id, 'pi_rf_gp_home');
  perform tests.act_as(v_away);
  perform public.offer_opposition((tests.rf_post(v_booking.id)).id, v_away_team);
  perform tests.act_as_postgres();

  perform tests.set_kickoff(v_booking.id, now() + interval '10 hours');
  perform tests.act_as(v_away);
  perform public.cancel_opposition_offer((tests.rf_post(v_booking.id)).id);
  perform tests.act_as_postgres();
  assert (tests.rf_post(v_booking.id)).status = 'closed', 'inside the new 12 hours the post stays closed';
  select body into v_body from public.notifications where profile_id = v_home and type = 'gipedo_opponent_left'
  order by created_at desc limit 1;
  assert v_body like '%It''s less than 12 hours to kickoff, so the post stays closed%',
    format('the words say 12 hours, got %s', v_body);
end $$;

rollback;
