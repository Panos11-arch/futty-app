-- P6e audit fix 3: staff-facing counts include accepted venue players
-- (decided 18 November, Dimitris; docs/specs/13-payments-bookings.md "Venue
-- notifications"). The daily summary counts them as joined and says how many
-- ("10 of 10 players in (1 venue player)"); a game is short only when app
-- players and accepted venue players together are fewer than it's for; the
-- staff short-game notice isn't sent when venue players fill the gap.
-- Player-facing amounts, the players' 6-hour warning and collection_amounts
-- are unchanged: for money a venue player is an empty spot.
begin;

create or replace function tests.audit_game(p_owner uuid, p_venue uuid, p_label text, p_others integer, p_day date)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
  i integer;
begin
  v_booking := tests.booking_with_players(tests.create_user(p_label || '-booker@futty.test'), p_venue,
                                          'each_pays_own_spot', p_others, p_day, '12:00', '13:00', p_label);
  for i in 0 .. p_others loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_' || p_label || '_' || i, interval '2 hours');
  end loop;
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  return v_booking;
end;
$$;

create or replace function tests.audit_accept(p_owner uuid, p_booking public.venue_bookings, p_name text)
returns void
language plpgsql
as $$
declare
  v_offer jsonb;
begin
  perform tests.act_as(p_owner);
  v_offer := public.offer_venue_player(p_booking.id, p_name);
  perform tests.act_as(p_booking.created_by);
  perform public.answer_venue_player((v_offer ->> 'id')::uuid, true);
  perform tests.act_as_postgres();
end;
$$;

-- What collection would charge, without the share ids (so two bookings compare).
create or replace function tests.audit_amounts(p_booking uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_array(a.is_booker, a.due_pitch_cents, a.normal_pitch_cents, a.paid_pitch_cents,
                                     a.fee_cents) order by a.is_booker desc, a.due_pitch_cents)
  from public.collection_amounts(p_booking) a;
$$;

-- 1. The daily summary: 9 app players and 1 venue player are 10 of 10, not
-- short; 8 and 1 are 9 of 10, short.
do $$
declare
  v_owner uuid := tests.create_user('audit-sum-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 1;
  v_full public.venue_bookings;
  v_short public.venue_bookings;
  v_content jsonb;
  v_game jsonb;
  v_n public.notifications;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_full := tests.audit_game(v_owner, v_venue, 'audit-sum-full', 8, v_day);
  perform tests.audit_accept(v_owner, v_full, 'Andreas');

  v_content := public.venue_daily_summary_content(v_venue, v_day);
  select g into v_game from jsonb_array_elements(v_content -> 'pitches') p, jsonb_array_elements(p -> 'games') g
  where g ->> 'bookingId' = v_full.id::text limit 1;
  assert (v_game ->> 'joined')::integer = 10 and (v_game ->> 'venuePlayers')::integer = 1
         and (v_game ->> 'players')::integer = 10 and not (v_game ->> 'short')::boolean,
    format('9 app + 1 venue player: 10 of 10, not short; got %s', v_game);
  assert (v_content ->> 'appJoined')::integer = 10 and (v_content ->> 'appVenuePlayers')::integer = 1
         and (v_content ->> 'appPlayers')::integer = 10,
    format('totals, got %s', v_content);
  assert public.venue_daily_summary_body(v_content)
         = format('%s: 1 game, 10 of 10 players in (1 venue player).', to_char(v_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', public.venue_daily_summary_body(v_content));

  -- A second game, 8 app + 1 venue player: 9 of 10, short.
  v_short := tests.booking_with_players(tests.create_user('audit-sum-short-booker@futty.test'), v_venue,
                                        'each_pays_own_spot', 7, v_day, '19:00', '20:00', 'audit-sum-short');
  perform tests.pay_ago((tests.player(v_short.id, 0)).id, 'pi_audit_sum_short_0', interval '2 hours');
  select * into v_short from public.venue_bookings where id = v_short.id;
  perform tests.audit_accept(v_owner, v_short, 'Marios');
  v_content := public.venue_daily_summary_content(v_venue, v_day);
  select g into v_game from jsonb_array_elements(v_content -> 'pitches') p, jsonb_array_elements(p -> 'games') g
  where g ->> 'bookingId' = v_short.id::text limit 1;
  assert (v_game ->> 'joined')::integer = 9 and (v_game ->> 'venuePlayers')::integer = 1 and (v_game ->> 'short')::boolean,
    format('8 app + 1 venue player: 9 of 10, short; got %s', v_game);
  assert (v_content ->> 'appJoined')::integer = 19 and (v_content ->> 'appVenuePlayers')::integer = 2,
    format('totals, got %s', v_content);

  perform public.venue_notifications_tick((tests.cyprus_today() + time '20:00') at time zone 'Asia/Nicosia');
  select * into v_n from public.notifications where profile_id = v_owner and type = 'venue_daily_summary';
  assert v_n.body = format('%s: 2 games, 19 of 20 players in (2 venue players).', to_char(v_day, 'FMDay FMDD FMMonth')),
    format('sent body, got %s', v_n.body);
end $$;

-- 2. A game with no venue player reads as before.
do $$
declare
  v_owner uuid := tests.create_user('audit-sum-plain-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 1;
  v_content jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.audit_game(v_owner, v_venue, 'audit-sum-plain', 8, v_day);
  v_content := public.venue_daily_summary_content(v_venue, v_day);
  assert public.venue_daily_summary_body(v_content)
         = format('%s: 1 game, 9 of 10 players in.', to_char(v_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', public.venue_daily_summary_body(v_content));
end $$;

-- 3. The 6-hour check: 9 app players and 1 accepted venue player. Staff get no
-- short-game notice; the players' warning and amounts are exactly those of the
-- same game without him. 7 app + 1 venue player still tells staff, counted
-- with him.
do $$
declare
  v_owner uuid := tests.create_user('audit-short-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3, p_open => '00:00', p_close => '24:00');
  v_with public.venue_bookings;
  v_without public.venue_bookings;
  v_gap public.venue_bookings;
  v_note_with public.notifications;
  v_note_without public.notifications;
  v_n public.notifications;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_with := tests.audit_game(v_owner, v_venue, 'audit-short-with', 8, tests.cyprus_today() + 2);
  v_without := tests.audit_game(v_owner, v_venue, 'audit-short-without', 8, tests.cyprus_today() + 2);
  v_gap := tests.audit_game(v_owner, v_venue, 'audit-short-gap', 6, tests.cyprus_today() + 2);
  perform tests.audit_accept(v_owner, v_with, 'Andreas');
  perform tests.audit_accept(v_owner, v_gap, 'Marios');

  perform tests.set_kickoff(v_with.id, now() + interval '5 hours');
  perform tests.set_kickoff(v_without.id, now() + interval '5 hours');
  perform tests.set_kickoff(v_gap.id, now() + interval '5 hours');
  perform public.send_short_game_warnings();
  perform public.venue_notifications_tick(now());

  -- Staff: the gap is filled, so no notice; the game still short is told,
  -- counted with its venue player.
  assert (select count(*) from public.notifications where profile_id = v_owner and type = 'venue_short_game'
          and data ->> 'bookingId' = v_with.id::text) = 0, 'filled by a venue player: staff not told';
  assert (select count(*) from public.notifications where profile_id = v_owner and type = 'venue_short_game'
          and data ->> 'bookingId' = v_without.id::text) = 1, 'the same game without him: staff told';
  select * into v_n from public.notifications where profile_id = v_owner and type = 'venue_short_game'
    and data ->> 'bookingId' = v_gap.id::text;
  assert v_n.title = 'Short game: 8 of 10 (1 venue player)' and (v_n.data ->> 'joined')::integer = 8
         and (v_n.data ->> 'venuePlayers')::integer = 1 and (v_n.data ->> 'players')::integer = 10,
    format('7 app + 1 venue player: 8 of 10, got %s / %s', v_n.title, v_n.data);

  -- Players: warned exactly as without him (9 of 10, the same top-up).
  select * into v_note_with from public.notifications
  where type = 'short_game_warning' and profile_id = (tests.player(v_with.id, 3)).profile_id;
  select * into v_note_without from public.notifications
  where type = 'short_game_warning' and profile_id = (tests.player(v_without.id, 3)).profile_id;
  assert v_note_with.title = 'You''re 9 of 10' and v_note_with.title = v_note_without.title
         and v_note_with.body = v_note_without.body
         and v_note_with.data ->> 'extraCents' = v_note_without.data ->> 'extraCents',
    format('the players'' warning is unchanged: %s / %s vs %s / %s',
           v_note_with.title, v_note_with.body, v_note_without.title, v_note_without.body);
  assert tests.audit_amounts(v_with.id) = tests.audit_amounts(v_without.id),
    format('collection_amounts unchanged: %s vs %s', tests.audit_amounts(v_with.id), tests.audit_amounts(v_without.id));
  assert (select count(*) from public.collection_amounts(v_with.id)) = 9, 'he is no share: 9 joined for money';
end $$;

rollback;
