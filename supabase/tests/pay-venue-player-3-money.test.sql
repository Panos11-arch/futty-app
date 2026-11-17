-- A venue player moves no money (docs/specs/13-payments-bookings.md "Booking
-- modes": "A player the venue provides plays free. The team covers his spot
-- like an empty one."; "Short games": "a venue-provided player counts as an
-- empty spot"; "Venue-offered players", decided 17 November).
--   The team's top-up covers his spot and the venue never charges him: no
--   share, no ledger row. collection_amounts, the 6-hour warning and the
--   top-ups are exactly what they'd be without him.
--   Worked example: €60 5 v 5 with 8 app players and 1 accepted venue
--   player: €60 / 8 = €7.50 each, a €1.50 top-up (150) for each of the 8.
begin;

create or replace function tests.vp_game(p_owner uuid, p_label text, p_others integer,
                                         p_mode text default 'each_pays_own_spot')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_owner => p_owner, p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(tests.create_user(p_label || '-booker@futty.test'), v_venue, p_mode,
                                          p_others, tests.cyprus_today() + 3, '19:00', '20:00', p_label);
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_' || p_label || '_0');
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  return v_booking;
end;
$$;

-- What collection would charge, without the share ids (so two bookings compare).
create or replace function tests.vp_amounts(p_booking uuid)
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

do $$
declare
  v_owner uuid := tests.create_user('vp-money-owner@futty.test');
  v_with public.venue_bookings;
  v_without public.venue_bookings;
  v_offer jsonb;
  v_start jsonb;
  v_item public.booking_collection_items;
  v_note public.notifications;
  v_ledger_before integer;
  i integer;
begin
  v_with := tests.vp_game(v_owner, 'vp-money-with', 7);        -- 8 app players
  v_without := tests.vp_game(v_owner, 'vp-money-without', 7);  -- the same game, no venue player
  for i in 1 .. 7 loop
    perform tests.pay_ago((tests.player(v_with.id, i)).id, 'pi_vpm_with_' || i, interval '2 hours');
    perform tests.pay_ago((tests.player(v_without.id, i)).id, 'pi_vpm_without_' || i, interval '2 hours');
  end loop;
  v_ledger_before := (select count(*) from public.money_ledger where booking_id = v_with.id);

  perform tests.act_as(v_owner);
  v_offer := public.offer_venue_player(v_with.id, 'Andreas');
  perform tests.act_as_postgres();
  perform tests.act_as(v_with.created_by);
  perform public.answer_venue_player((v_offer ->> 'id')::uuid, true);
  perform tests.act_as_postgres();

  -- No share and no money movement for him.
  assert (select count(*) from public.booking_payment_shares where booking_id = v_with.id) = 8, '8 shares';
  assert (select count(*) from public.money_ledger where booking_id = v_with.id) = v_ledger_before,
    'offering and accepting move no money';

  -- collection_amounts: €7.50 each, the same as without him.
  assert (select count(*) from public.collection_amounts(v_with.id)) = 8, '8 joined: he counts as an empty spot';
  assert (select bool_and(a.due_pitch_cents = 750 and a.normal_pitch_cents = 600)
          from public.collection_amounts(v_with.id) a), format('750 due each, got %s', tests.vp_amounts(v_with.id));
  assert tests.vp_amounts(v_with.id) = tests.vp_amounts(v_without.id),
    format('identical amounts with and without him: %s vs %s', tests.vp_amounts(v_with.id), tests.vp_amounts(v_without.id));

  -- The 6-hour warning still says 8 of 10 and €1.50.
  perform tests.set_kickoff(v_with.id, now() + interval '5 hours 59 minutes');
  assert public.send_short_game_warnings() = 1, 'the short game is warned';
  select * into v_note from public.notifications
  where type = 'short_game_warning' and profile_id = (tests.player(v_with.id, 3)).profile_id;
  assert v_note.title = 'You''re 8 of 10'
         and v_note.body = 'If nobody else joins, each player pays €1.50 extra after the match.'
         and (v_note.data ->> 'extraCents')::integer = 150,
    format('8 of 10, €1.50; got %s / %s', v_note.title, v_note.body);

  -- Collection: a 150 top-up for each of the 8, and nothing for him.
  perform tests.end_match(v_with.id, interval '2 hours');
  v_start := public.start_collection(v_with.id);
  assert (v_start ->> 'joined_players')::integer = 8, format('8 joined, got %s', v_start);
  assert (select count(*) from public.booking_collection_items where booking_id = v_with.id) = 8, '8 items';
  for i in 0 .. 7 loop
    v_item := tests.item(v_with.id, (tests.player(v_with.id, i)).id);
    assert v_item.kind = 'top_up' and v_item.amount_cents = 150 and v_item.fee_cents = 0,
      format('player %s: a 150 top-up, got %s', i, row_to_json(v_item));
  end loop;
end $$;

rollback;
