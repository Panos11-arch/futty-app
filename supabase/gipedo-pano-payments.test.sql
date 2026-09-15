-- Manual verification for supabase/gipedo-pano-payments.sql's settlement
-- decision logic: a win/loss case and a draw case, each asserting the
-- resulting payment_settlement and the exact capture/void action computed
-- for every share.
--
-- This repo has no automated test harness (no supabase/config.toml, no
-- local DB, no test runner in package.json — every supabase/*.sql file is
-- meant to be pasted into the dashboard's SQL Editor by hand, per this
-- repo's own convention). So this is the same kind of manual script, not a
-- CI test: run it against a DISPOSABLE/DEV Supabase project only, never
-- production — it inserts real rows into auth.users/profiles/teams/venues/etc.
--
-- It deliberately bypasses the RLS-guarded RPC entry points
-- (create_squad_post/offer_opposition/submit_friendly_score all require
-- auth.uid(), which a raw SQL Editor session doesn't have) and instead
-- drives the actual DECISION functions directly — check_friendly_score_match,
-- record_gipedo_pano_settlement, gipedo_pano_pending_settlement_shares —
-- which is the logic this feature actually adds. stripe_payment_intent_id
-- values below are fake strings, not real PaymentIntents: this only proves
-- the SQL correctly decides WHO to capture/void, not that
-- supabase/functions/settle-gipedo-pano's actual Stripe calls succeed —
-- that half needs Stripe test-mode credentials this script has no access
-- to, and should be verified separately (or by hand) before relying on it
-- in production.
--
-- Wrapped in BEGIN/ROLLBACK so it leaves no trace either way — read the
-- RAISE NOTICE output; nothing is actually kept.

begin;

do $$
declare
  -- Win/loss scenario
  v_home_captain uuid := gen_random_uuid();
  v_away_captain uuid := gen_random_uuid();
  v_venue_id uuid;
  v_booking_id uuid;
  v_home_team uuid;
  v_away_team uuid;
  v_post_id uuid;
  v_match_id uuid;
  v_home_share uuid;
  v_away_share uuid;
  v_settlement text;
  v_home_action text;
  v_away_action text;

  -- Draw scenario
  v2_home_captain uuid := gen_random_uuid();
  v2_away_captain uuid := gen_random_uuid();
  v2_booking_id uuid;
  v2_home_team uuid;
  v2_away_team uuid;
  v2_post_id uuid;
  v2_match_id uuid;
  v2_home_share uuid;
  v2_away_share uuid;
  v2_settlement text;
  v2_home_action text;
  v2_away_action text;
begin
  -------------------------------------------------------------------------
  -- Shared fixtures: one venue, two throwaway profiles + teams for each
  -- scenario.
  -------------------------------------------------------------------------
  insert into public.venues (name, city, base_pitches, open_time, close_time, price_per_pitch_hour)
  values ('Gipedo Pano Test Venue', 'Nicosia', 4, time '08:00', time '23:00', 30)
  returning id into v_venue_id;

  -- profiles.id is a hard FK to auth.users(id) (see schema.sql), so each
  -- throwaway captain needs a real auth.users row before it can be
  -- referenced as a profile. schema.sql's on_auth_user_created trigger
  -- inserts the matching public.profiles row itself (username pulled from
  -- raw_user_meta_data), so the explicit profiles insert below just needs
  -- to be conflict-safe rather than redundant.
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_home_captain, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gp_test_home_' || substr(v_home_captain::text, 1, 8) || '@example.com', '', now(),
     '{}', jsonb_build_object('username', 'gp_test_home_' || substr(v_home_captain::text, 1, 8)), now(), now()),
    (v_away_captain, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gp_test_away_' || substr(v_away_captain::text, 1, 8) || '@example.com', '', now(),
     '{}', jsonb_build_object('username', 'gp_test_away_' || substr(v_away_captain::text, 1, 8)), now(), now()),
    (v2_home_captain, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gp_test_home2_' || substr(v2_home_captain::text, 1, 8) || '@example.com', '', now(),
     '{}', jsonb_build_object('username', 'gp_test_home2_' || substr(v2_home_captain::text, 1, 8)), now(), now()),
    (v2_away_captain, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'gp_test_away2_' || substr(v2_away_captain::text, 1, 8) || '@example.com', '', now(),
     '{}', jsonb_build_object('username', 'gp_test_away2_' || substr(v2_away_captain::text, 1, 8)), now(), now());

  insert into public.profiles (id, username) values
    (v_home_captain, 'gp_test_home_' || substr(v_home_captain::text, 1, 8)),
    (v_away_captain, 'gp_test_away_' || substr(v_away_captain::text, 1, 8)),
    (v2_home_captain, 'gp_test_home2_' || substr(v2_home_captain::text, 1, 8)),
    (v2_away_captain, 'gp_test_away2_' || substr(v2_away_captain::text, 1, 8))
  on conflict (id) do nothing;

  insert into public.teams (name) values ('GP Test Home') returning id into v_home_team;
  insert into public.teams (name) values ('GP Test Away') returning id into v_away_team;
  insert into public.teams (name) values ('GP Test Home 2') returning id into v2_home_team;
  insert into public.teams (name) values ('GP Test Away 2') returning id into v2_away_team;

  insert into public.team_members (team_id, profile_id, role) values
    (v_home_team, v_home_captain, 'captain'),
    (v_away_team, v_away_captain, 'captain'),
    (v2_home_team, v2_home_captain, 'captain'),
    (v2_away_team, v2_away_captain, 'captain');

  -------------------------------------------------------------------------
  -- SCENARIO 1: win/loss — home wins 3-1, so away (loser) should be
  -- captured and home (winner) should be voided.
  -------------------------------------------------------------------------
  insert into public.venue_bookings
    (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, amount_cents)
  values
    (v_venue_id, current_date + 7, '18:00', '19:00', 1, 10, '5-a-side', 'confirmed', v_home_captain, 1000)
  returning id into v_booking_id;

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, team_id, posted_by, status, venue_booking_id, matched_team_id, payment_mode)
  values
    (v_venue_id, now() - interval '3 hours', '5-a-side', 'opposition', v_home_team, v_home_captain, 'matched',
     v_booking_id, v_away_team, 'gipedo_pano')
  returning id into v_post_id;

  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
  values (v_post_id, v_home_team, v_away_team, 'pending_score', 0)
  returning id into v_match_id;

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status, stripe_payment_intent_id)
  values (v_booking_id, v_home_captain, 500, true, 'authorized', 'pi_test_home_1')
  returning id into v_home_share;

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status, stripe_payment_intent_id)
  values (v_booking_id, v_away_captain, 500, false, 'authorized', 'pi_test_away_1')
  returning id into v_away_share;

  -- Both captains submit the same score (3-1) — mirrors what
  -- submit_friendly_score does after inserting each row, minus the
  -- auth.uid()-gated bits submit_friendly_score itself handles.
  insert into public.friendly_match_scores (friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score)
  values (v_match_id, v_home_team, v_home_captain, 3, 1);
  insert into public.friendly_match_scores (friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score)
  values (v_match_id, v_away_team, v_away_captain, 3, 1);
  update public.friendly_matches set score_attempts = 2 where id = v_match_id;

  perform public.check_friendly_score_match(v_match_id);

  select payment_settlement into v_settlement from public.friendly_matches where id = v_match_id;
  if v_settlement is distinct from 'home_wins' then
    raise exception 'FAIL win/loss: expected payment_settlement = home_wins, got %', v_settlement;
  end if;
  raise notice 'PASS win/loss: payment_settlement = % (home won 3-1)', v_settlement;

  select action into v_home_action from public.gipedo_pano_pending_settlement_shares() where share_id = v_home_share;
  select action into v_away_action from public.gipedo_pano_pending_settlement_shares() where share_id = v_away_share;

  if v_home_action is distinct from 'void' then
    raise exception 'FAIL win/loss: expected winning (home) share action = void, got %', v_home_action;
  end if;
  raise notice 'PASS win/loss: winning team (home) share action = %', v_home_action;

  if v_away_action is distinct from 'capture' then
    raise exception 'FAIL win/loss: expected losing (away) share action = capture, got %', v_away_action;
  end if;
  raise notice 'PASS win/loss: losing team (away) share action = %', v_away_action;

  -------------------------------------------------------------------------
  -- SCENARIO 2: draw — 2-2, falls back to normal split: everyone's own
  -- share gets captured, nobody voided.
  -------------------------------------------------------------------------
  insert into public.venue_bookings
    (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, amount_cents)
  values
    (v_venue_id, current_date + 7, '20:00', '21:00', 1, 10, '5-a-side', 'confirmed', v2_home_captain, 1000)
  returning id into v2_booking_id;

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, team_id, posted_by, status, venue_booking_id, matched_team_id, payment_mode)
  values
    (v_venue_id, now() - interval '3 hours', '5-a-side', 'opposition', v2_home_team, v2_home_captain, 'matched',
     v2_booking_id, v2_away_team, 'gipedo_pano')
  returning id into v2_post_id;

  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
  values (v2_post_id, v2_home_team, v2_away_team, 'pending_score', 0)
  returning id into v2_match_id;

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status, stripe_payment_intent_id)
  values (v2_booking_id, v2_home_captain, 500, true, 'authorized', 'pi_test_home_2')
  returning id into v2_home_share;

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status, stripe_payment_intent_id)
  values (v2_booking_id, v2_away_captain, 500, false, 'authorized', 'pi_test_away_2')
  returning id into v2_away_share;

  insert into public.friendly_match_scores (friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score)
  values (v2_match_id, v2_home_team, v2_home_captain, 2, 2);
  insert into public.friendly_match_scores (friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score)
  values (v2_match_id, v2_away_team, v2_away_captain, 2, 2);
  update public.friendly_matches set score_attempts = 2 where id = v2_match_id;

  perform public.check_friendly_score_match(v2_match_id);

  select payment_settlement into v2_settlement from public.friendly_matches where id = v2_match_id;
  if v2_settlement is distinct from 'draw' then
    raise exception 'FAIL draw: expected payment_settlement = draw, got %', v2_settlement;
  end if;
  raise notice 'PASS draw: payment_settlement = % (2-2)', v2_settlement;

  select action into v2_home_action from public.gipedo_pano_pending_settlement_shares() where share_id = v2_home_share;
  select action into v2_away_action from public.gipedo_pano_pending_settlement_shares() where share_id = v2_away_share;

  if v2_home_action is distinct from 'capture' or v2_away_action is distinct from 'capture' then
    raise exception 'FAIL draw: expected both shares captured, got home=%, away=%', v2_home_action, v2_away_action;
  end if;
  raise notice 'PASS draw: both shares captured (home=%, away=%) — normal split fallback', v2_home_action, v2_away_action;

  raise notice 'ALL ASSERTIONS PASSED';
end $$;

rollback;
