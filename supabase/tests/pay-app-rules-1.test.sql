-- P10: public.app_rules, the one source for every number in
-- docs/specs/13-payments-bookings.md. The defaults are spec 13's numbers;
-- only service_role changes them; every change is kept; and changing a
-- value changes what the server does, with no code change (book_slot, the
-- quote, cancellations, timings and the words players are sent).
begin;

-- The defaults are spec 13's numbers.
do $$
declare
  r public.app_rules;
begin
  select * into r from public.app_rules;
  assert (select count(*) from public.app_rules) = 1, 'one row';
  assert (r.fee_each_pays_cents, r.fee_pay_all_cents, r.fee_premium_cents, r.gipedo_fee_cents) = (80, 55, 0, 55), 'fees';
  assert (r.window_standard_days, r.window_premium_days) = (7, 14), 'booking windows';
  assert (r.free_cancel_minutes, r.cancel_fee_cents, r.refund_cutoff_hours, r.refund_choice_hours) = (60, 100, 6, 48),
    'cancellations';
  assert (r.capture_delay_minutes, r.payment_window_minutes, r.guarantee_hold_lead_hours, r.guarantee_retry_hours,
          r.collection_delay_hours) = (60, 15, 72, 6, 2), 'when money is held and taken';
  assert r.credit_expiry_months = 12, 'credit expiry';
  assert (r.gipedo_max_days, r.gipedo_opponent_hours) = (5, 24), 'Gipedo Pano (decision 5: 5 days)';
  assert r.premium_price_label = '€4.99', 'Premium (decided 22 November)';
  assert (r.weather_rain_chance_pct, r.weather_heavy_rain, r.weather_wind_kmh, r.weather_thunderstorms, r.weather_heat_c)
         = (60, true, 40, true, 38), 'weather thresholds';
  assert public.cancellation_terms() = jsonb_build_object('fee_cents', 100, 'free_minutes', 60, 'refund_cutoff_hours', 6),
    'cancellation_terms reads the rules';
  assert (public.rule_duration_words(interval '6 hours'), public.rule_duration_words(interval '1 hour'),
          public.rule_duration_words(interval '15 minutes'), public.rule_duration_words(interval '90 minutes'))
         = ('6 hours', '1 hour', '15 minutes', '90 minutes'), 'durations in words';
end $$;

-- The booker cancels the whole team, and one other player's payment was
-- taken: that player gets a card refund or credit, their choice. Returns how
-- long they have to choose (choose_by), when the card refund goes out with no
-- choice (next_attempt_at), and the words they're sent. Test-only.
create function tests.refund_choice_after_team_cancel(p_label text,
  out choose_in interval, out refund_in interval, out body text)
language plpgsql
as $$
declare
  v_booker uuid := tests.create_user(p_label || '-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player public.booking_payment_shares;
  v_line public.booking_cancellation_lines;
  v_done jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 2,
                                          p_label => p_label);
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_' || p_label || '_booker', interval '2 hours');
  v_player := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_' || p_label || '_p1', interval '2 hours');
  assert v_player.status = 'paid', format('%s: the player''s payment was taken', p_label);
  -- Two statements: tests.line is stable, so it must run after the cancel
  -- has written its lines, not in the same statement.
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);
  v_line := tests.line(v_done, v_player.id);
  assert v_line.action = 'refund_choice', format('%s: the player chooses card or credit, got %s', p_label, v_line.action);
  choose_in := v_line.choose_by - now();
  refund_in := v_line.next_attempt_at - now();
  select n.body into body from public.notifications n
  where n.profile_id = v_player.profile_id and n.body like '%Choose venue credit%';
end;
$$;

-- With the defaults: 48 hours, in the timing and in the words.
do $$
declare
  r record;
begin
  select * into r from tests.refund_choice_after_team_cancel('rules-choice-48');
  assert r.choose_in = interval '48 hours', format('48 hours to choose, got %s', r.choose_in);
  assert r.refund_in = interval '48 hours', format('the card refund goes out at 48 hours, got %s', r.refund_in);
  assert r.body like '%Choose venue credit within 48 hours, or it goes back to your card.',
    format('the notification says 48 hours, got %s', r.body);
end $$;

-- Everyone reads them; only service_role writes; every change is kept.
do $$
declare
  v_user uuid := tests.create_user('rules-reader@futty.test');
  -- Migrations that change a rule (e.g. the €4.99 Premium price) are kept too.
  v_before bigint := (select count(*) from public.app_rules_history);
begin
  perform tests.act_as_anon();
  assert (select fee_each_pays_cents from public.app_rules) = 80, 'anon reads the rules';
  perform tests.act_as(v_user);
  assert (select window_standard_days from public.app_rules) = 7, 'a player reads the rules';
  assert tests.error_of($q$ update public.app_rules set fee_each_pays_cents = 1 $q$) like 'permission denied%',
    'a player cannot change them';
  assert tests.error_of($q$ insert into public.app_rules (id) values (true) $q$) like 'permission denied%',
    'or add a row';
  assert tests.error_of($q$ select * from public.app_rules_history $q$) like 'permission denied%',
    'or read the history';
  assert tests.error_of($q$ select public.rule_refund_cutoff() $q$) like 'permission denied%',
    'the SQL helpers are internal';
  perform tests.act_as_anon();
  assert tests.error_of($q$ update public.app_rules set fee_each_pays_cents = 1 $q$) like 'permission denied%',
    'anon cannot change them';

  perform tests.act_as_service_role();
  update public.app_rules set cancel_fee_cents = 150;
  assert tests.error_of($q$ delete from public.app_rules $q$) = 'app_rules_cannot_be_deleted', 'the row stays';
  assert tests.error_of($q$ update public.app_rules set free_cancel_minutes = 30 $q$) like '%app_rules_free_hour_is_capture%',
    'the free hour is the capture delay (spec 13)';
  assert tests.error_of($q$ update public.app_rules set fee_each_pays_cents = -1 $q$) like '%check constraint%',
    'nonsense is refused';
  perform tests.act_as_postgres();

  assert (select count(*) from public.app_rules_history) = v_before + 1, 'the change is kept';
  assert (select (old_rules ->> 'cancel_fee_cents', new_rules ->> 'cancel_fee_cents', changed_by)
          from public.app_rules_history where changed_by = 'service_role') = ('100'::text, '150'::text, 'service_role'::text),
    'with what it was before and who changed it';
  assert exists (select 1 from public.app_rules_history
                 where old_rules ->> 'premium_price_label' = '€3.99' and new_rules ->> 'premium_price_label' = '€4.99'),
    'the Premium price change (22 November) is kept';
end $$;

-- Changing a value changes what the server does. Everything below runs with
-- these rules (this transaction only).
update public.app_rules set
  fee_each_pays_cents = 90, fee_pay_all_cents = 60, fee_premium_cents = 10, gipedo_fee_cents = 70,
  window_standard_days = 3, window_premium_days = 5,
  free_cancel_minutes = 30, capture_delay_minutes = 30, cancel_fee_cents = 150, refund_cutoff_hours = 4,
  refund_choice_hours = 24,
  payment_window_minutes = 30, guarantee_hold_lead_hours = 48, guarantee_retry_hours = 3,
  collection_delay_hours = 3, credit_expiry_months = 6, gipedo_max_days = 3, gipedo_opponent_hours = 12;

-- Fees and windows: book_slot, the quote and the venue list follow.
do $$
declare
  v_booker uuid := tests.create_user('rules-fee@futty.test');
  v_premium uuid := tests.create_user('rules-premium@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 3);
  v_booking public.venue_bookings;
  q jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_premium);

  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_booker)).amount_cents = 690, 'each pays: 600 + the new 90';
  assert v_booking.service_fee_cents_per_player = 90, 'the booking stores the fee in force';

  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '14:00', '15:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_booker)).amount_cents = 6600, 'pay for everyone: 6000 + 10 x 60';

  perform tests.act_as(v_booker);
  q := public.booking_quote(v_venue, tests.cyprus_today() + 2, '16:00', '17:00', '5-a-side', 5);
  assert (q -> 'each_pays' ->> 'player_cents')::int = 690 and (q -> 'pay_all' ->> 'card_cents')::int = 6600,
    format('the quote follows, got %s', q);
  assert q -> 'cancellation' = jsonb_build_object('fee_cents', 150, 'free_minutes', 30, 'refund_cutoff_hours', 4),
    'and so do the cancellation terms';
  assert (select f.player_cents from public.venues_free_at(tests.cyprus_today() + 2, '16:00', 60, '5-a-side', 5) f
          where f.venue_id = v_venue) = 690, 'the venue list shows the new price per player';
  assert (public.booking_search_options() ->> 'window_days')::int = 3, 'the window is now 3 days';
  assert tests.error_of(format($q$ select public.book_slot(%L, %L, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all') $q$,
                               v_venue, tests.cyprus_today() + 4)) = 'beyond_booking_window', 'day 4 is refused';

  perform tests.act_as(v_premium);
  q := public.booking_quote(v_venue, tests.cyprus_today() + 5, '12:00', '13:00', '5-a-side', 5);
  assert (q -> 'each_pays' -> 'mine' ->> 'card_cents')::int = 610, 'a Premium share: 600 + the new 10';
  assert (q -> 'pay_all' ->> 'card_cents')::int = 6550, 'a Premium booker for everyone: 6000 + 9 x 60 + 10';
  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '5-a-side', 5) $q$,
                               v_venue, tests.cyprus_today() + 6)) = 'beyond_booking_window', 'Premium: 5 days';
  perform tests.act_as_postgres();

  assert (select m.fee_cents from public.money_share(6000, 10, 'gipedo_pano', true, false, 'card') m) = 700,
    'Gipedo Pano: 10 x the new 70';
end $$;

-- Timings: the free hour, the refund cutoff, the payment window, the hold,
-- collection and credit all follow.
do $$
declare
  v_kickoff timestamptz := now() + interval '5 hours';
  v_booking_row public.venue_bookings;
begin
  assert public.money_capture_due_at(now(), now() + interval '3 days') = now() + interval '30 minutes',
    'taken after the new 30 minutes';
  assert public.money_capture_due_at(now(), now() + interval '4 hours 10 minutes') = now() + interval '10 minutes',
    'or at the new 4-hour cutoff, whichever is first';
  assert not public.money_is_non_refundable(now(), v_kickoff), '5 hours ahead is refundable with a 4-hour cutoff';
  assert public.money_is_non_refundable(now(), now() + interval '3 hours 59 minutes'), 'under 4 hours is not';
  assert public.money_payment_window_ends_at(now()) = now() + interval '30 minutes', 'the new payment window';
  assert public.money_guarantee_hold_due_at(now(), now() + interval '3 days') = now() + interval '1 day',
    'the hold is placed 48 hours before kickoff';
  assert public.money_guarantee_retry_at(now()) = now() + interval '3 hours', 'a failed hold is retried after 3 hours';
  assert public.gipedo_window_error(now() + interval '4 days', now()) = 'gipedo_too_far_ahead', 'Gipedo Pano: at most 3 days';
  assert public.gipedo_window_error(now() + interval '13 hours', now()) is null, 'and at least 12 hours ahead';
  assert public.gipedo_window_error(now() + interval '11 hours', now()) = 'gipedo_too_soon', 'not closer';

  select * into v_booking_row from public.venue_bookings limit 0;
  v_booking_row.payment_mode := 'each_pays_own_spot';
  v_booking_row.status := 'confirmed';
  v_booking_row.booking_type := 'user_booking';
  v_booking_row.booking_day := ((now() - interval '2 hours 30 minutes') at time zone 'Asia/Nicosia')::date;
  v_booking_row.end_time := ((now() - interval '2 hours 30 minutes') at time zone 'Asia/Nicosia')::time;
  assert not public.collection_is_due(v_booking_row), 'collection waits the new 3 hours after the match';
  v_booking_row.booking_day := ((now() - interval '3 hours 1 minute') at time zone 'Asia/Nicosia')::date;
  v_booking_row.end_time := ((now() - interval '3 hours 1 minute') at time zone 'Asia/Nicosia')::time;
  assert public.collection_is_due(v_booking_row), 'and is due after it';
end $$;

-- Cancelling in the middle window keeps the new 150; credit expires after the new 6 months.
do $$
declare
  v_booker uuid := tests.create_user('rules-cancel-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_quote jsonb;
  v_credit public.venue_credits;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 2,
                                          p_label => 'rules-cancel');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_rules_booker');
  -- Held 40 minutes ago: past the new 30-minute free hour, so taken.
  v_share := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_rules_p1', interval '40 minutes');
  assert v_share.status = 'paid', format('taken after 30 minutes, got %s', v_share.status);
  assert v_share.amount_cents = 690, 'the share carried the new fee';

  perform tests.act_as(v_share.profile_id);
  v_quote := public.cancellation_quote(v_booking.id, 'my_spot');
  perform tests.act_as_postgres();
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object('window', 'middle', 'kept_cents', 150, 'credit_cents', 540),
    format('the new 150 is kept, 540 becomes credit, got %s', v_quote -> 'lines');
  assert (v_quote ->> 'refunds_stop_at')::timestamptz = tests.kickoff_of(v_booking.id) - interval '4 hours',
    'refunds stop 4 hours before kickoff';

  perform tests.act_as_service_role();
  perform public.cancel_booking_internal(v_booking.id, 'my_spot', v_share.profile_id, v_quote ->> 'quote');
  perform tests.act_as_postgres();
  select * into v_credit from public.venue_credits where profile_id = v_share.profile_id;
  assert v_credit.amount_cents = 540 and v_credit.expires_at = v_credit.issued_at + interval '6 months',
    format('credit expires after the new 6 months, got %s', row(v_credit.*));
end $$;

-- The card-or-credit choice: the new 24 hours, in the timing and in the words.
do $$
declare
  r record;
begin
  select * into r from tests.refund_choice_after_team_cancel('rules-choice-24');
  assert r.choose_in = interval '24 hours', format('24 hours to choose, got %s', r.choose_in);
  assert r.refund_in = interval '24 hours', format('the card refund goes out at 24 hours, got %s', r.refund_in);
  assert r.body like '%Choose venue credit within 24 hours, or it goes back to your card.',
    format('the notification says 24 hours, got %s', r.body);
end $$;

-- The words players are sent follow too.
do $$
declare
  v_booker uuid := tests.create_user('rules-words@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  update public.venue_bookings set created_at = now() - interval '31 minutes' where id = v_booking.id;
  assert public.expire_unpaid_booking(v_booking.id), 'unpaid after the new 30 minutes: cancelled';
  assert (select body from public.notifications where profile_id = v_booker and type = 'booking_cancelled')
         = 'Payment wasn''t completed within 30 minutes, so the booking was cancelled and the pitch released.',
    'the notification says 30 minutes';
end $$;

rollback;
