-- Helpers for the SQL tests. run.sh loads this before the tests; it is not a
-- migration and lives in its own `tests` schema, so it never reaches
-- production.
--
-- Role switches are transaction-scoped, so wrap each test in begin ... rollback:
--
--   begin;
--   do $$
--   declare v_user uuid := tests.create_user('someone@futty.test');
--   begin
--     perform tests.act_as(v_user);           -- signed in: auth.uid() = v_user, role authenticated
--     ...                                     -- RLS and grants apply as in the app
--     perform tests.act_as_service_role();    -- Edge Function with the service role key
--     perform tests.act_as_anon();            -- signed out
--     perform tests.act_as_postgres();        -- back to the superuser
--   end $$;
--   rollback;
--
-- An exception block rolls back role switches made inside it, so switch
-- roles outside `begin ... exception ... end` blocks.

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- A new auth user (the on_auth_user_created trigger also creates the
-- profile). Security definer so it works whatever role is active.
create or replace function tests.create_user(p_email text, p_metadata jsonb default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
          '{"provider":"email","providers":["email"]}', p_metadata, now(), now());
  return v_id;
end;
$$;

-- A venue with sensible defaults; override what a test cares about. Built
-- the way the P3 migration converts existing venues
-- (init_venue_model_from_legacy): p_pitches 5-a-side pitches, neighbours
-- combining for 7s / 9s / 11s, the same hours every day and p_price per
-- pitch per hour in every price band. p_pitches => 0 gives a venue with
-- hours only, for tests that add their own pitches and prices.
create or replace function tests.create_venue(
  p_owner uuid default null,
  p_price numeric default 60,
  p_pitches integer default 2,
  p_open time default '08:00',
  p_close time default '23:00'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.venues (name, base_pitches, open_time, close_time, price_per_pitch_hour, owner_profile_id)
  values ('Test venue ' || gen_random_uuid(), p_pitches, p_open, p_close, p_price, p_owner)
  returning id into v_id;
  perform public.init_venue_model_from_legacy(v_id);
  return v_id;
end;
$$;

-- A named pitch. p_formats defaults to the pitch's own size.
create or replace function tests.create_pitch(
  p_venue uuid,
  p_name text,
  p_size text default '5-a-side',
  p_formats text[] default null,
  p_sort integer default 0
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.pitches (venue_id, name, size, formats, sort_order)
  values (p_venue, p_name, p_size, coalesce(p_formats, array[p_size]), p_sort)
  returning id;
$$;

-- Price per hour for a format, in cents: the venue's one price, the same on
-- every day and at every hour (spec 13 "Pitch prices", 19 November).
drop function if exists tests.set_price(uuid, text, integer, integer, integer);
drop function if exists tests.set_price(uuid, text, integer);
create function tests.set_price(
  p_venue uuid,
  p_format text,
  p_price integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.price_rules (venue_id, format, price_cents)
  values (p_venue, p_format, p_price)
  on conflict (venue_id, format) do update
    set price_cents = excluded.price_cents;
$$;


-- Today's date in Cyprus, the day book_slot's windows count from.
create or replace function tests.cyprus_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Nicosia')::date $$;

-- The first day from tomorrow on with this ISO weekday (1 = Monday ... 7 =
-- Sunday), so always inside the 7-day booking window.
create or replace function tests.next_weekday(p_isodow integer)
returns date
language sql
stable
as $$
  select d::date
  from generate_series(tests.cyprus_today() + 1, tests.cyprus_today() + 7, interval '1 day') as d
  where extract(isodow from d) = p_isodow
  limit 1;
$$;

-- Runs `p_sql` and returns the exception message it raised, or null if it
-- succeeded. Lets a test assert on the error code without its own
-- exception block (which would roll back any role switch inside it).
create or replace function tests.error_of(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- Sets the request's JWT claims the way PostgREST does, then the role.
create or replace function tests.set_claims(p_role text, p_sub uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_sub, 'role', p_role))::text, true);
  perform set_config('role', p_role, true);
end;
$$;

create or replace function tests.act_as(p_user_id uuid)
returns void language sql as $$ select tests.set_claims('authenticated', p_user_id) $$;

create or replace function tests.act_as_anon()
returns void language sql as $$ select tests.set_claims('anon', null) $$;

create or replace function tests.act_as_service_role()
returns void language sql as $$ select tests.set_claims('service_role', null) $$;

-- Back to the connection's own user (postgres), with no JWT.
create or replace function tests.act_as_postgres()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- What a player pays, checked in full: their share is p_pays, the booking's
-- service fee is 80, and the pitch part of the share (share - fee) is
-- p_pitch_share. Reads as postgres, so RLS doesn't hide the rows.
create or replace function tests.assert_share(
  p_booking uuid,
  p_profile uuid,
  p_pitch_share integer,
  p_pays integer,
  p_label text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share integer;
  v_fee integer;
begin
  select amount_cents into v_share from public.booking_payment_shares where booking_id = p_booking and profile_id = p_profile;
  select service_fee_cents_per_player into v_fee from public.venue_bookings where id = p_booking;
  assert v_share is not null, format('%s: the player has no share', p_label);
  assert v_fee = 80, format('%s: service fee should be 80, got %s', p_label, v_fee);
  assert v_share - v_fee = p_pitch_share,
    format('%s: pitch share should be %s, got %s', p_label, p_pitch_share, v_share - v_fee);
  assert v_share = p_pays, format('%s: player pays should be %s, got %s', p_label, p_pays, v_share);
end;
$$;

-- Books the slot as the current user and checks every amount: the pitch
-- price (slot_price_cents and the booking), the booker's pitch share and
-- what they pay (pitch share + 80). The booking is then undone, so many
-- cases can be checked on the same pitch and day. A failed check still
-- fails the test: only the undo is caught.
create or replace function tests.check_player_price(
  p_venue uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_players_per_side integer,
  p_pitch_price integer,
  p_pitch_share integer,
  p_pays integer,
  p_label text
)
returns void
language plpgsql
as $$
declare
  v_price integer;
  v_booking public.venue_bookings;
begin
  begin
    v_price := public.slot_price_cents(p_venue, p_day, p_start, p_end, p_format);
    assert v_price = p_pitch_price, format('%s: pitch price should be %s, got %s', p_label, p_pitch_price, v_price);
    v_booking := public.book_slot(p_venue, p_day, p_start, p_end, 1, p_format, p_players_per_side, 'each_pays_own_spot');
    assert v_booking.amount_cents = p_pitch_price,
      format('%s: booking pitch price should be %s, got %s', p_label, p_pitch_price, v_booking.amount_cents);
    perform tests.assert_share(v_booking.id, auth.uid(), p_pitch_share, p_pays, p_label);
    raise exception 'undo check_player_price booking' using errcode = 'P0099';
  exception when sqlstate 'P0099' then
    null;
  end;
end;
$$;

-- A 30-minute slot on the half-hour grid that starts at least p_ahead from
-- now, in Cyprus time. For timing tests that need a kickoff a few hours
-- away; use a venue open 00:00-24:00.
create or replace function tests.slot_starting_in(p_ahead interval, out day date, out start_time time, out end_time time)
language plpgsql
stable
as $$
declare
  v_at timestamp := (now() at time zone 'Asia/Nicosia') + p_ahead;
begin
  v_at := date_trunc('hour', v_at)
          + interval '30 minutes' * ceil(extract(epoch from v_at - date_trunc('hour', v_at)) / 1800);
  day := v_at::date;
  start_time := v_at::time;
  end_time := case when start_time = time '23:30' then time '24:00' else start_time + interval '30 minutes' end;
end;
$$;

-- Kickoff of a booking as an instant (its Cyprus day and start time).
create or replace function tests.kickoff_of(p_booking uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (booking_day + start_time) at time zone 'Asia/Nicosia' from public.venue_bookings where id = p_booking;
$$;

create or replace function tests.make_premium(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set is_premium = true where id = p_user;
$$;

-- A share as postgres sees it (RLS off).
create or replace function tests.share_of(p_booking uuid, p_profile uuid)
returns public.booking_payment_shares
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.booking_payment_shares where booking_id = p_booking and profile_id = p_profile;
$$;

-- Adds a player to a booking the way accepting an invite or joining a post
-- does.
create or replace function tests.join_booking(p_booking uuid, p_profile uuid)
returns public.booking_payment_shares
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.add_booking_share_internal(p_booking, p_profile);
  return tests.share_of(p_booking, p_profile);
end;
$$;

-- What create-share-payment does for a share: plans it as its owner, then
-- puts p_intent on it (attach_share_intent) for exactly the planned amount
-- and timing. Returns the plan.
create or replace function tests.pay_share(
  p_share uuid,
  p_intent text,
  p_method text default 'card',
  p_accept boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_plan jsonb;
begin
  select * into v_share from public.booking_payment_shares where id = p_share;
  v_plan := public.plan_share_payment(p_share, v_share.profile_id, p_method, p_accept);
  return public.attach_share_intent(p_share, v_share.profile_id, p_method, p_accept, p_intent,
    (v_plan ->> 'amount_cents')::integer, v_plan ->> 'capture_method', v_share.stripe_payment_intent_id);
end;
$$;

-- pay_share, then Stripe's webhook says the card is held (now).
create or replace function tests.hold_share(
  p_share uuid,
  p_intent text,
  p_pm text default 'pm_test',
  p_method text default 'card',
  p_accept boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb := tests.pay_share(p_share, p_intent, p_method, p_accept);
begin
  return public.share_payment_held(p_share, p_intent, (v_plan ->> 'amount_cents')::integer, p_pm, now());
end;
$$;

-- Moves a booking so it kicks off at p_kickoff (any minute; tests only),
-- keeping when it was made. For timing tests. The game is 30 minutes long
-- and stored on one Cyprus day, so it never crosses midnight, whatever the
-- time the tests run:
--   - normally, exactly p_kickoff to p_kickoff + 30 minutes;
--   - across midnight and midnight already past at p_now: from midnight to
--     the exact end (a game that's over stays over, and ended when asked);
--   - across midnight and midnight still ahead: from the exact kickoff to
--     midnight (a game to come or under way stays so).
-- Kickoff and end are on the same side of p_now as asked, and the end is
-- always after the kickoff. p_now is now() except in helpers-clock.test.sql,
-- which runs the edge times (00:15 and 20:59:59 Cyprus time).
drop function if exists tests.set_kickoff(uuid, timestamptz);
create or replace function tests.set_kickoff(p_booking uuid, p_kickoff timestamptz, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamp := p_kickoff at time zone 'Asia/Nicosia';
  v_end timestamp := (p_kickoff + interval '30 minutes') at time zone 'Asia/Nicosia';
  v_midnight timestamp := date_trunc('day', v_start) + interval '1 day';
begin
  if v_end <= v_midnight then
    -- One day (ending at midnight exactly is 24:00 that day).
    update public.venue_bookings
    set booking_day = v_start::date, start_time = v_start::time,
        end_time = case when v_end = v_midnight then time '24:00' else v_end::time end
    where id = p_booking;
  elsif (v_midnight at time zone 'Asia/Nicosia') <= p_now then
    -- Across midnight, which has passed: midnight to the exact end.
    update public.venue_bookings
    set booking_day = v_end::date, start_time = time '00:00', end_time = v_end::time
    where id = p_booking;
  else
    -- Across midnight, still ahead: the exact kickoff to midnight.
    update public.venue_bookings
    set booking_day = v_start::date, start_time = v_start::time, end_time = time '24:00'
    where id = p_booking;
  end if;
end;
$$;

-- P4b: cancellations and venue credit.

-- Stripe's fee on a standard European card: 1.5% + 25 cents, rounded half
-- up (35 on 6.80, 123 on 65.50, 34 on 6.00).
create or replace function tests.stripe_fee(p_amount integer)
returns integer language sql immutable as $$ select (p_amount * 15 + 500) / 1000 + 25 $$;

-- Pays a share as its owner and Stripe holds it p_ago ago; if its free hour
-- is over by now, the job takes it too (with Stripe's fee). Returns the share.
create or replace function tests.pay_ago(
  p_share uuid,
  p_intent text,
  p_ago interval default '0',
  p_method text default 'card',
  p_use_credit boolean default false
)
returns public.booking_payment_shares
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_plan jsonb;
begin
  select * into v_share from public.booking_payment_shares where id = p_share;
  v_plan := public.plan_share_payment(p_share, v_share.profile_id, p_method, false, p_use_credit);
  v_plan := public.attach_share_intent(p_share, v_share.profile_id, p_method, false, p_intent,
    (v_plan ->> 'amount_cents')::integer, v_plan ->> 'capture_method', v_share.stripe_payment_intent_id, p_use_credit);
  perform public.share_payment_held(p_share, p_intent, (v_plan ->> 'amount_cents')::integer, 'pm_' || p_intent, now() - p_ago);
  select * into v_share from public.booking_payment_shares where id = p_share;
  if v_share.status = 'authorized' and v_share.capture_due_at <= now() then
    perform public.share_captured(p_share, v_share.amount_cents, tests.stripe_fee(v_share.amount_cents));
  end if;
  select * into v_share from public.booking_payment_shares where id = p_share;
  return v_share;
end;
$$;

-- Books p_day p_start-p_end as p_booker in p_mode, then p_others players
-- join (emails p_label-1@futty.test ...). Shares in join order:
-- tests.player(booking, n) is the n-th joiner (0 = the booker).
create or replace function tests.booking_with_players(
  p_booker uuid,
  p_venue uuid,
  p_mode text,
  p_others integer,
  p_day date,
  p_start time default '12:00',
  p_end time default '13:00',
  p_label text default 'player'
)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
  v_player uuid;
  i integer;
begin
  perform tests.act_as(p_booker);
  v_booking := public.book_slot(p_venue, p_day, p_start, p_end, 1, '5-a-side', 5, p_mode);
  perform tests.act_as_postgres();
  for i in 1 .. p_others loop
    v_player := tests.create_user(format('%s-%s-%s@futty.test', p_label, i, left(gen_random_uuid()::text, 8)));
    perform public.add_booking_share_internal(v_booking.id, v_player);
    -- Distinct join times, so tests.player's order is the join order.
    update public.booking_payment_shares set created_at = created_at + make_interval(secs => i)
    where booking_id = v_booking.id and profile_id = v_player;
  end loop;
  return v_booking;
end;
$$;

-- The n-th player to join (0 = the booker), as postgres sees the share.
create or replace function tests.player(p_booking uuid, p_n integer)
returns public.booking_payment_shares
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.booking_payment_shares
  where booking_id = p_booking
  order by is_booker desc, created_at, id
  offset p_n limit 1;
$$;

-- What cancelling would do, as p_profile (the quote the screen shows).
create or replace function tests.plan(p_booking uuid, p_scope text, p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.cancellation_plan(p_booking, p_scope, p_profile, now());
$$;

-- Cancels as p_profile, confirming the quote they were shown, the way
-- cancel-booking does. Returns what the database decided.
create or replace function tests.cancel(p_booking uuid, p_scope text, p_profile uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.cancel_booking_internal(p_booking, p_scope, p_profile, tests.plan(p_booking, p_scope, p_profile) ->> 'quote');
$$;

-- The line of a cancellation for one share.
create or replace function tests.line(p_cancellation jsonb, p_share uuid)
returns public.booking_cancellation_lines
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.booking_cancellation_lines
  where cancellation_id = (p_cancellation ->> 'cancellation_id')::uuid and share_id = p_share;
$$;

-- The quote's line for one share.
create or replace function tests.quote_line(p_plan jsonb, p_share uuid)
returns jsonb
language sql
immutable
as $$
  select l from jsonb_array_elements(p_plan -> 'lines') l where l ->> 'share_id' = p_share::text;
$$;

-- Credit at a venue, issued p_ago ago (no source booking: a test fixture).
create or replace function tests.give_credit(p_profile uuid, p_venue uuid, p_amount integer, p_ago interval default '0')
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.venue_credits (profile_id, venue_id, amount_cents, remaining_cents, source, source_booking_id,
                                    issued_at, expires_at)
  values (p_profile, p_venue, p_amount, p_amount, 'player_cancelled', gen_random_uuid(),
          now() - p_ago, now() - p_ago + interval '12 months')
  returning id;
$$;

-- The ledger for one share, summed.
create or replace function tests.share_books(p_share uuid,
  out venue integer, out futty integer, out stripe integer, out refunded integer, out credit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(venue_cents), 0)::integer, coalesce(sum(futty_cents), 0)::integer,
         coalesce(sum(stripe_fee_cents), 0)::integer,
         coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::integer,
         coalesce(sum(credit_cents), 0)::integer
  from public.money_ledger where share_id = p_share;
$$;

-- P4c: collection, top-ups and debt.

-- Moves a booking so its match (30 minutes, see set_kickoff) ended p_ago
-- ago. Collection is due 2 hours after the end.
drop function if exists tests.end_match(uuid, interval);
create or replace function tests.end_match(p_booking uuid, p_ago interval default '3 hours', p_now timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  select tests.set_kickoff(p_booking, p_now - p_ago - interval '30 minutes', p_now);
$$;

-- The booker's guarantee is held for its full amount (as placeGuaranteeHold
-- records it), on intent p_intent.
create or replace function tests.hold_guarantee(p_booking uuid, p_intent text default null)
returns public.booking_guarantees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
begin
  select * into v_guarantee from public.booking_guarantees where booking_id = p_booking;
  perform public.guarantee_hold_placed(v_guarantee.id, coalesce(p_intent, 'pi_guarantee_' || left(p_booking::text, 8)),
                                       v_guarantee.amount_cents);
  select * into v_guarantee from public.booking_guarantees where booking_id = p_booking;
  return v_guarantee;
end;
$$;

-- The collection's item for one share.
create or replace function tests.item(p_booking uuid, p_share uuid)
returns public.booking_collection_items
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.booking_collection_items where booking_id = p_booking and share_id = p_share;
$$;

-- What Stripe would do for every top-up of a collection: each one is taken
-- (with Stripe's fee), except the shares in p_fail, whose card is declined.
create or replace function tests.charge_top_ups(p_collection uuid, p_fail uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  for v_item in select * from public.collection_top_ups_due(p_collection) loop
    if v_item.share_id = any (p_fail) then
      perform public.collection_top_up_failed(v_item.item_id, 'pi_topup_' || left(v_item.item_id::text, 8), 'card_declined');
    else
      perform public.collection_top_up_paid(v_item.item_id, 'pi_topup_' || left(v_item.item_id::text, 8),
                                            v_item.amount_cents, tests.stripe_fee(v_item.amount_cents));
    end if;
  end loop;
end;
$$;

-- Everything a player still owes (unsettled debts), in cents.
create or replace function tests.owed(p_profile uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::integer from public.venue_debts where profile_id = p_profile and settled_at is null;
$$;

-- Bookings and their match.

-- The match for a booking.
create or replace function tests.match_of(p_booking uuid)
returns public.matches
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.matches where booking_id = p_booking;
$$;

-- A player's row in a booking's match.
create or replace function tests.in_match(p_booking uuid, p_profile uuid)
returns public.match_players
language sql
stable
security definer
set search_path = ''
as $$
  select mp.* from public.match_players mp join public.matches m on m.id = mp.match_id
  where m.booking_id = p_booking and mp.profile_id = p_profile;
$$;

-- A3b: form, reminders, followed teams.

-- A team called p_name.
create or replace function tests.create_team(p_name text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.teams (name) values (p_name) returning id;
$$;

-- Some booking share, for match_players.share_id ("holds a spot"): only
-- the foreign key matters to the form views, so one share serves them all.
create or replace function tests.any_share()
returns uuid
language plpgsql
as $$
declare
  v_share uuid;
begin
  select id into v_share from public.booking_payment_shares order by created_at desc limit 1;
  if v_share is null then
    perform tests.booking_with_players(tests.create_user(format('spot-%s@futty.test', left(gen_random_uuid()::text, 8))),
                                       tests.create_venue(), 'each_pays_own_spot', 0, tests.next_weekday(3));
    perform tests.act_as_postgres();
    select id into v_share from public.booking_payment_shares order by created_at desc limit 1;
  end if;
  return v_share;
end;
$$;

-- A match written straight into the tables (no booking), one hour long,
-- in p_status. Named when both teams are given (sides labelled with the
-- team names), otherwise a pickup (Bibs v Non-bibs). A forfeit has no
-- score.
create or replace function tests.form_match(
  p_kickoff timestamptz,
  p_status text,
  p_a integer default null,
  p_b integer default null,
  p_team_a uuid default null,
  p_team_b uuid default null,
  p_forfeit_side text default null,
  p_forfeit_reason text default null,
  p_venue uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_named boolean := p_team_a is not null and p_team_b is not null;
begin
  insert into public.matches (kind, format, players_per_side, kickoff_at, ends_at, status, result_deadline_at,
                              side_a_score, side_b_score, forfeit_side, forfeit_reason, confirmed_at, confirmed_via,
                              venue_id)
  values (case when v_named then 'named' else 'pickup' end, '5-a-side', 5, p_kickoff, p_kickoff + interval '1 hour',
          p_status, p_kickoff + interval '25 hours',
          case when p_forfeit_side is null then p_a end, case when p_forfeit_side is null then p_b end,
          p_forfeit_side, p_forfeit_reason,
          case when p_status = 'confirmed' then p_kickoff + interval '2 hours' end,
          case when p_status = 'confirmed' then case when p_forfeit_side is null then 'agreed' else 'forfeit' end end,
          p_venue)
  returning id into v_id;
  insert into public.match_sides (match_id, side, team_id, label) values
    (v_id, 'a', p_team_a, coalesce((select name from public.teams where id = p_team_a), 'Bibs')),
    (v_id, 'b', p_team_b, coalesce((select name from public.teams where id = p_team_b), 'Non-bibs'));
  return v_id;
end;
$$;

-- A player in a form_match: on p_side, holding a spot or not, checked in
-- or not, and left before kickoff or not.
create or replace function tests.form_player(
  p_match uuid,
  p_profile uuid,
  p_side text,
  p_spot boolean,
  p_checked_in boolean,
  p_left boolean default false
)
returns void
language plpgsql
as $$
declare
  v_kickoff timestamptz := (select kickoff_at from public.matches where id = p_match);
begin
  insert into public.match_players (match_id, profile_id, side, share_id, left_at)
  values (p_match, p_profile, p_side, case when p_spot then tests.any_share() end,
          case when p_left then v_kickoff - interval '1 day' end);
  if p_checked_in then
    insert into public.match_attendance (match_id, profile_id, checked_in_at, method, checked_in_by)
    values (p_match, p_profile, v_kickoff, 'qr', p_profile);
  end if;
end;
$$;

-- p_follower follows team p_team (user_follows, as the app writes it).
create or replace function tests.follow_team(p_follower uuid, p_team uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_follows (follower_id, target_type, target_id) values (p_follower, 'team', p_team);
$$;

-- How many notifications of p_type p_profile has (for p_match, if given).
create or replace function tests.notified(p_profile uuid, p_type text, p_match uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.notifications n
  where n.profile_id = p_profile and n.type = p_type
    and (p_match is null or n.data ->> 'matchId' = p_match::text);
$$;

-- The latest notification of p_type for p_profile.
create or replace function tests.last_notification(p_profile uuid, p_type text)
returns public.notifications
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.notifications n
  where n.profile_id = p_profile and n.type = p_type
  order by n.created_at desc, n.id desc limit 1;
$$;

-- Runs match_reminders_tick at p_now, as the scheduled job does.
create or replace function tests.reminders_at(p_now timestamptz)
returns jsonb
language plpgsql
as $$
declare
  v_counts jsonb;
begin
  perform tests.act_as_service_role();
  v_counts := public.match_reminders_tick(p_now);
  perform tests.act_as_postgres();
  return v_counts;
end;
$$;

-- A4: goals, man of the match, lineups.

-- The error p_sql raises when p_user runs it (null if it succeeds); back to
-- postgres afterwards.
create or replace function tests.error_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  perform tests.act_as(p_user);
  v_error := tests.error_of(p_sql);
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

-- p_profile's match_players id in p_match.
create or replace function tests.player_id(p_match uuid, p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.match_players where match_id = p_match and profile_id = p_profile;
$$;

-- A guest called p_name on p_side of p_match; returns their match_players id.
create or replace function tests.guest_player(p_match uuid, p_side text, p_name text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.match_players (match_id, guest_name, side) values (p_match, p_name, p_side) returning id;
$$;

-- p_profile joins team p_team as p_role (captain, player or substitute).
create or replace function tests.join_team(p_team uuid, p_profile uuid, p_role text default 'player')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.team_members (team_id, profile_id, role) values (p_team, p_profile, p_role);
$$;

-- The match page as p_user reads it.
create or replace function tests.page_as(p_user uuid, p_match uuid)
returns jsonb
language plpgsql
as $$
declare
  v_page jsonb;
begin
  perform tests.act_as(p_user);
  v_page := public.get_match_page(p_match);
  perform tests.act_as_postgres();
  return v_page;
end;
$$;

-- P12: switching 5 v 5 / 6 v 6.

-- tests.booking_with_players, booked 6 v 6 on a 5-a-side pitch (the venue is
-- set to allow it).
create or replace function tests.booking_6v6_with_players(
  p_booker uuid,
  p_venue uuid,
  p_mode text,
  p_others integer,
  p_day date,
  p_label text default 'player'
)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
  v_player uuid;
  i integer;
begin
  update public.venues set allows_6v6_on_5s = true where id = p_venue;
  perform tests.act_as(p_booker);
  v_booking := public.book_slot(p_venue, p_day, '12:00', '13:00', 1, '5-a-side', 6, p_mode);
  perform tests.act_as_postgres();
  for i in 1 .. p_others loop
    v_player := tests.create_user(format('%s-%s-%s@futty.test', p_label, i, left(gen_random_uuid()::text, 8)));
    perform public.add_booking_share_internal(v_booking.id, v_player);
    update public.booking_payment_shares set created_at = created_at + make_interval(secs => i)
    where booking_id = v_booking.id and profile_id = v_player;
  end loop;
  return v_booking;
end;
$$;

-- The booker switches p_booking to p_side a side, as the app does.
create or replace function tests.switch(p_booking uuid, p_side integer)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  perform tests.act_as((select created_by from public.venue_bookings where id = p_booking));
  v_result := public.switch_players_per_side(p_booking, p_side);
  perform tests.act_as_postgres();
  return v_result;
end;
$$;

-- P4d: payouts.

-- Gives a venue a test-mode Stripe Express account that has finished
-- onboarding (or not, with p_enabled false), and starts Futty payouts there
-- (payouts_from a day ago, so every booking a test makes counts).
create or replace function tests.connect_venue(p_venue uuid, p_enabled boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account text := 'acct_' || replace(p_venue::text, '-', '');
begin
  insert into public.venue_stripe_accounts (venue_id, stripe_account_id, details_submitted, charges_enabled, payouts_enabled)
  values (p_venue, v_account, p_enabled, p_enabled, p_enabled)
  on conflict (venue_id) do update set details_submitted = p_enabled, charges_enabled = p_enabled, payouts_enabled = p_enabled;
  update public.venues set payouts_from = coalesce(payouts_from, now() - interval '1 day') where id = p_venue;
  return v_account;
end;
$$;

drop function if exists tests.run_payouts();

-- One run of run-payouts on test keys, with Stripe answering every
-- transfer: returns how many transfers were made.
create or replace function tests.run_payouts(p_livemode boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_due record;
  v_count integer := 0;
begin
  v_run := public.prepare_payouts(p_livemode);
  for v_due in select * from public.payouts_due(p_livemode) loop
    perform public.payout_sent(v_due.payout_id, 'tr_' || replace(v_due.payout_id::text, '-', ''), v_due.amount_cents);
    v_count := v_count + 1;
  end loop;
  perform public.finish_payout_run(v_run);
  return v_count;
end;
$$;

-- What the venue has been sent for one booking (by transfers that went out).
create or replace function tests.transferred(p_booking uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.venue_cents), 0)::integer
  from public.venue_payout_items i join public.venue_payouts p on p.id = i.payout_id
  where i.booking_id = p_booking and i.released_at is null and p.status = 'sent';
$$;

-- What the ledger says the venue earned on one booking, in the app (money
-- it took in person left out).
create or replace function tests.venue_earned(p_booking uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(venue_cents), 0)::integer from public.money_ledger
  where booking_id = p_booking and kind not in ('cash_received', 'counter_paid', 'debt_cash_received');
$$;

-- A venue's transfers that went out, smallest first (inside one test's
-- transaction they all have the same created_at).
create or replace function tests.payout_amounts(p_venue uuid)
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(amount_cents order by amount_cents, id), '{}') from public.venue_payouts
  where venue_id = p_venue and status = 'sent';
$$;

-- A5a: levels and ratings.

-- p_profile's level row, as if they had answered the questions and played
-- p_matches competitive matches (reliability and provisional to match).
create or replace function tests.set_level(p_profile uuid, p_level numeric, p_matches integer default 0)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source)
  values (p_profile, p_level, p_matches < 5, least(100, 5 * p_matches), p_matches, 'questionnaire')
  on conflict (profile_id) do update
  set level = excluded.level, provisional = excluded.provisional, reliability_pct = excluded.reliability_pct,
      competitive_matches = excluded.competitive_matches, source = excluded.source;
$$;

-- p_profile's level (null if they have none).
create or replace function tests.level_of(p_profile uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select level from public.player_levels where profile_id = p_profile;
$$;

-- p_rater rates p_rated (a profile) in p_match; the error, or null.
create or replace function tests.rate(p_rater uuid, p_match uuid, p_rated uuid, p_score integer)
returns text
language sql
as $$
  select tests.error_as(p_rater, format('select public.rate_match_player(%L, %L, %s)',
                                        p_match, tests.player_id(p_match, p_rated), p_score));
$$;

-- Moves every time of p_match back by p_by, as if it was played earlier.
create or replace function tests.age_match(p_match uuid, p_by interval)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.matches
  set kickoff_at = kickoff_at - p_by, ends_at = ends_at - p_by, result_deadline_at = result_deadline_at - p_by,
      confirmed_at = confirmed_at - p_by, score_check_since = score_check_since - p_by
  where id = p_match;
$$;

-- Runs apply_match_levels for p_match as the job does.
create or replace function tests.apply_levels(p_match uuid)
returns text
language plpgsql
as $$
declare
  v_outcome text;
begin
  perform tests.act_as_service_role();
  v_outcome := public.apply_match_levels(p_match);
  perform tests.act_as_postgres();
  return v_outcome;
end;
$$;

-- match_rating_for as service_role: {rating, count}.
create or replace function tests.rating_of(p_match uuid, p_profile uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as_service_role();
  v := public.match_rating_for(p_match, tests.player_id(p_match, p_profile));
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- S13B: logging after the game and ratings.

-- A match that kicked off 2 hours ago and waits for its result (played),
-- with p_a players on side a and p_b on side b, all checked in. Side a's
-- first player captains it; a named game (not p_pickup) has side b's first
-- player as its captain too. a and b list the profiles, captains first.
create or replace function tests.s13b_match(p_a integer, p_b integer, p_pickup boolean default true,
                                            out match uuid, out cap_a uuid, out cap_b uuid, out a uuid[], out b uuid[])
language plpgsql
as $$
declare
  v uuid;
  i integer;
begin
  insert into public.matches (kind, format, players_per_side, kickoff_at, ends_at, status, result_deadline_at)
  values (case when p_pickup then 'pickup' else 'named' end, '5-a-side', 5, now() - interval '2 hours',
          now() - interval '1 hour', 'played', now() + interval '23 hours')
  returning id into match;
  a := '{}';
  b := '{}';
  for i in 1 .. p_a loop
    v := tests.create_user(format('s13b-a%s-%s@futty.test', i, gen_random_uuid()));
    perform tests.form_player(match, v, 'a', true, true);
    a := a || v;
  end loop;
  for i in 1 .. p_b loop
    v := tests.create_user(format('s13b-b%s-%s@futty.test', i, gen_random_uuid()));
    perform tests.form_player(match, v, 'b', true, true);
    b := b || v;
  end loop;
  cap_a := a[1];
  cap_b := case when p_pickup then null else b[1] end;
  insert into public.match_sides (match_id, side, label, captain_profile_id) values
    (match, 'a', 'Bibs', cap_a),
    (match, 'b', 'Non-bibs', cap_b);
end;
$$;

-- One side's stats for log_match_result: p_profiles with p_goals (and
-- p_assists) each, plus p_own own goals.
create or replace function tests.s13b_side(p_match uuid, p_profiles uuid[], p_goals integer[],
                                           p_assists integer[] default null, p_own integer default 0)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'players', coalesce(jsonb_agg(jsonb_build_object(
                 'playerId', tests.player_id(p_match, x.profile),
                 'goals', x.goals,
                 'assists', coalesce(p_assists[x.n], 0)) order by x.n), '[]'),
    'ownGoals', p_own)
  from unnest(p_profiles, p_goals) with ordinality x(profile, goals, n);
$$;

-- p_user logs p_a:p_b with p_stats; returns log_match_result's answer.
create or replace function tests.s13b_log(p_user uuid, p_match uuid, p_a integer, p_b integer, p_stats jsonb)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  v := public.log_match_result(p_match, p_a, p_b, p_stats);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- The error log_match_result raises for p_user, or null.
create or replace function tests.s13b_log_error(p_user uuid, p_match uuid, p_a integer, p_b integer, p_stats jsonb)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.log_match_result(%L, %s, %s, %L)', p_match, p_a, p_b, p_stats));
$$;

-- p_by logs p_a:p_b through log_match_result, for tests about what follows
-- a result: the goals of every side he writes are logged without scorers.
create or replace function tests.log_result(p_by uuid, p_match uuid, p_a integer, p_b integer)
returns jsonb
language plpgsql
as $$
declare
  v_stats jsonb := '{}';
  v_side text;
  v jsonb;
begin
  foreach v_side in array coalesce(public.match_side_writer(p_match, p_by), '{}') loop
    v_stats := v_stats || jsonb_build_object(v_side, jsonb_build_object(
      'players', '[]'::jsonb, 'ownGoals', case v_side when 'a' then p_a else p_b end));
  end loop;
  perform tests.act_as(p_by);
  v := public.log_match_result(p_match, p_a, p_b, v_stats);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- Two captains disagree until the match is disputed: p_a logs 1:0 once, and
-- p_b answers with scores that never match.
create or replace function tests.dispute_result(p_a uuid, p_b uuid, p_match uuid)
returns void
language plpgsql
as $$
declare
  i integer := 0;
begin
  perform tests.log_result(p_a, p_match, 1, 0);
  while (select status from public.matches where id = p_match) <> 'disputed' loop
    i := i + 1;
    perform tests.log_result(p_b, p_match, 0, i);
  end loop;
end;
$$;

-- p_profile's stored match rating in p_match.
create or replace function tests.s13b_rating(p_match uuid, p_profile uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select rating from public.match_player_ratings
  where match_id = p_match and player_id = tests.player_id(p_match, p_profile);
$$;

revoke all on function tests.create_user(text, jsonb) from public;
revoke all on function tests.create_venue(uuid, numeric, integer, time, time) from public;
revoke all on function tests.create_pitch(uuid, text, text, text[], integer) from public;
revoke all on function tests.set_price(uuid, text, integer) from public;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- S14 (Team of the Week, match-record.md decision 1k).

-- A confirmed 1-0 match in p_format at p_venue (null: none), competitive or
-- Friendly, in league p_league (null: not a league game).
create or replace function tests.totw_match(
  p_kickoff timestamptz,
  p_format text default '5-a-side',
  p_venue uuid default null,
  p_competitive boolean default true,
  p_league uuid default null,
  p_status text default 'confirmed'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := tests.form_match(p_kickoff, p_status, 1, 0, null, null, null, null, p_venue);
  v_fixture uuid;
begin
  if p_league is not null then
    insert into public.league_fixtures (league_id, venue_id, scheduled_day) values (p_league, p_venue, p_kickoff::date)
    returning id into v_fixture;
  end if;
  update public.matches
  set format = p_format, players_per_side = split_part(p_format, '-', 1)::integer, competitive = p_competitive,
      league_fixture_id = v_fixture
  where id = v_id;
  return v_id;
end;
$$;

-- p_profile played p_match (checked in) with p_goals goals, p_assists
-- assists and the match rating p_rating, written straight in.
create or replace function tests.totw_play(p_match uuid, p_profile uuid, p_rating numeric, p_goals integer default 0,
                                           p_assists integer default 0, p_side text default 'a')
returns void
language plpgsql
as $$
declare
  v_player uuid;
begin
  perform tests.form_player(p_match, p_profile, p_side, true, true);
  v_player := tests.player_id(p_match, p_profile);
  for i in 1 .. p_goals loop
    insert into public.match_goals (match_id, side, sort, scorer_player_id, entered_by)
    values (p_match, p_side, (select count(*) + 1 from public.match_goals g where g.match_id = p_match), v_player, p_profile);
  end loop;
  if p_assists > 0 then
    insert into public.match_assists (match_id, side, player_id, assists, entered_by)
    values (p_match, p_side, v_player, p_assists, p_profile);
  end if;
  insert into public.match_player_ratings (match_id, player_id, profile_id, rating)
  values (p_match, v_player, p_profile, p_rating);
end;
$$;

-- A user who signed up at p_signed_up, Premium or not.
create or replace function tests.totw_user(p_email text, p_premium boolean default true,
                                           p_signed_up timestamptz default '2026-01-01 00:00+00')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.create_user(p_email);
begin
  update public.profiles set is_premium = p_premium, created_at = p_signed_up where id = v_id;
  return v_id;
end;
$$;

-- Runs team_of_the_week_tick at p_now as the scheduled job does.
create or replace function tests.totw_tick(p_now timestamptz)
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  perform tests.act_as_service_role();
  v := public.team_of_the_week_tick(p_now);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- The team of the week p_week, p_kind, p_area, p_area_key ('' for All
-- Cyprus), p_format.
create or replace function tests.totw_team(p_week date, p_kind text, p_area text, p_area_key text, p_format text)
returns public.team_of_the_week
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.team_of_the_week t
  where t.week_start = p_week and t.kind = p_kind and t.area = p_area and t.area_key = p_area_key
    and t.format = p_format;
$$;

-- That team's players as 'slot:profile' in sort order.
create or replace function tests.totw_lineup(p_team uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.slot || ':' || p.profile_id order by p.sort), '{}')
  from public.team_of_the_week_players p where p.team_of_the_week_id = p_team;
$$;

-- S14b: power ranking.

-- A confirmed, competitive match between teams p_a_team and p_b_team,
-- p_a–p_b, kicking off at p_kickoff in p_format. form_match confirms it two
-- hours after kickoff with the deadline at kickoff + 25 hours, so it is
-- final (as levels) from kickoff + 26 hours.
create or replace function tests.pr_match(
  p_a_team uuid,
  p_b_team uuid,
  p_a integer,
  p_b integer,
  p_kickoff timestamptz,
  p_format text default '5-a-side'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := tests.form_match(p_kickoff, 'confirmed', p_a, p_b, p_a_team, p_b_team);
begin
  update public.matches set format = p_format where id = v_id;
  return v_id;
end;
$$;

-- A league in p_format (a fresh scope each time, as (format, scope) is
-- unique).
create or replace function tests.pr_league(p_format text default '5-a-side')
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.leagues (name, format, scope, stage, capacity)
  values ('PR league', p_format, 'pr-' || gen_random_uuid(), 'season', 8)
  returning id;
$$;

-- A completed league fixture p_home–p_away on p_day at p_time (Cyprus
-- time; either may be null).
create or replace function tests.pr_fixture(
  p_league uuid,
  p_home_team uuid,
  p_away_team uuid,
  p_home integer,
  p_away integer,
  p_day date,
  p_time time default '20:00',
  p_forfeit text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.league_fixtures (league_id, home_team_id, away_team_id, scheduled_day, scheduled_time, status,
                                      home_score, away_score, forfeit_result, score_locked)
  values (p_league, p_home_team, p_away_team, p_day, p_time, 'completed', p_home, p_away, p_forfeit, true)
  returning id;
$$;

-- Runs the power ranking job at p_now as the cron does.
create or replace function tests.pr_tick(p_now timestamptz default now())
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  perform tests.act_as_service_role();
  v := public.power_ranking_tick(p_now);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- p_team's points in p_format (the start value before any counted game).
create or replace function tests.pr_points(p_team uuid, p_format text default '5-a-side')
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select h.points_after from public.power_ranking_history h
                   where h.team_id = p_team and h.format = p_format
                   order by h.kickoff_at desc, h.seq desc limit 1),
                  (public.app_rules_now()).power_ranking_start);
$$;

-- How many history rows game p_game has (2 when it counted).
create or replace function tests.pr_rows(p_game uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.power_ranking_history where game_id = p_game;
$$;

-- p_team's history row for p_game.
create or replace function tests.pr_row(p_game uuid, p_team uuid)
returns public.power_ranking_history
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.power_ranking_history where game_id = p_game and team_id = p_team;
$$;

-- S10 (the competition page, match-record.md decision 1n).

-- A team called p_name captained by p_captain, with p_players as players
-- (a roster of 1 is enough to register).
create or replace function tests.s10_team(p_name text, p_captain uuid, p_players uuid[] default '{}')
returns uuid
language plpgsql
as $$
declare
  v_team uuid := tests.create_team(p_name);
  v_player uuid;
begin
  update public.teams set roster_size = 1 where id = v_team;
  perform tests.join_team(v_team, p_captain, 'captain');
  foreach v_player in array p_players loop
    perform tests.join_team(v_team, v_player, 'player');
  end loop;
  return v_team;
end;
$$;

-- An open city league in sign-up (a fresh scope each time).
create or replace function tests.s10_league(p_format text default '5-a-side', p_capacity integer default 8)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.leagues (name, format, scope, stage, capacity)
  values ('S10 League', p_format, 's10-' || gen_random_uuid(), 'signup', p_capacity)
  returning id;
$$;

-- p_teams sign up for p_hub and its next season starts; returns the
-- season's id.
create or replace function tests.s10_season(p_hub uuid, p_teams uuid[])
returns uuid
language plpgsql
as $$
declare
  v_team uuid;
  v_season uuid;
begin
  foreach v_team in array p_teams loop
    insert into public.league_teams (league_id, team_id) values (p_hub, v_team);
  end loop;
  perform tests.act_as_service_role();
  v_season := public.league_start_season(p_hub);
  perform tests.act_as_postgres();
  return v_season;
end;
$$;

-- The fixture between p_a and p_b in league row p_league, either way round.
create or replace function tests.s10_fixture(p_league uuid, p_a uuid, p_b uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.league_fixtures
  where league_id = p_league
    and ((home_team_id = p_a and away_team_id = p_b) or (home_team_id = p_b and away_team_id = p_a));
$$;

-- p_fixture's match.
create or replace function tests.s10_match(p_fixture uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.matches where league_fixture_id = p_fixture;
$$;

-- Agrees p_fixture for p_kickoff (its Cyprus day and time), as two
-- matching proposals do; returns its match.
create or replace function tests.s10_schedule(p_fixture uuid, p_kickoff timestamptz)
returns uuid
language plpgsql
as $$
begin
  update public.league_fixtures
  set scheduled_day = (p_kickoff at time zone 'Asia/Nicosia')::date,
      scheduled_time = (p_kickoff at time zone 'Asia/Nicosia')::time,
      status = 'agreed'
  where id = p_fixture;
  return tests.s10_match(p_fixture);
end;
$$;

-- A confirmed p_home:p_away result on p_fixture's match (side a = home),
-- every player checked in, written straight in.
create or replace function tests.s10_result(p_fixture uuid, p_home integer, p_away integer)
returns uuid
language plpgsql
as $$
declare
  v_match uuid := tests.s10_match(p_fixture);
begin
  update public.matches
  set status = 'confirmed', side_a_score = p_home, side_b_score = p_away,
      confirmed_at = kickoff_at + interval '2 hours', confirmed_via = 'agreed'
  where id = v_match;
  insert into public.match_attendance (match_id, profile_id, checked_in_at, method, checked_in_by)
  select mp.match_id, mp.profile_id, m.kickoff_at, 'qr', mp.profile_id
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where mp.match_id = v_match and mp.left_at is null and mp.profile_id is not null
  on conflict do nothing;
  return v_match;
end;
$$;

-- The moment p_match is final (its result windows have passed).
create or replace function tests.s10_final_at(p_match uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(confirmed_at + interval '24 hours', result_deadline_at) + interval '1 minute'
  from public.matches where id = p_match;
$$;

-- Runs apply_match_levels for p_match at its final moment, as the job does.
create or replace function tests.s10_final(p_match uuid)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  v := public.apply_match_levels(p_match, tests.s10_final_at(p_match));
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- p_profile's stats in a confirmed league match: checked in, p_goals goals,
-- p_assists assists and the match rating p_rating, written straight in.
create or replace function tests.s10_play(p_match uuid, p_profile uuid, p_rating numeric, p_goals integer default 0,
                                          p_assists integer default 0)
returns void
language plpgsql
as $$
declare
  v_player uuid := tests.player_id(p_match, p_profile);
  v_side text := (select side from public.match_players where id = v_player);
begin
  insert into public.match_attendance (match_id, profile_id, checked_in_at, method, checked_in_by)
  values (p_match, p_profile, (select kickoff_at from public.matches where id = p_match), 'qr', p_profile)
  on conflict do nothing;
  for i in 1 .. p_goals loop
    insert into public.match_goals (match_id, side, sort, scorer_player_id, entered_by)
    values (p_match, v_side, (select count(*) + 1 from public.match_goals g where g.match_id = p_match), v_player,
            p_profile);
  end loop;
  if p_assists > 0 then
    insert into public.match_assists (match_id, side, player_id, assists, entered_by)
    values (p_match, v_side, v_player, p_assists, p_profile);
  end if;
  insert into public.match_player_ratings (match_id, player_id, profile_id, rating)
  values (p_match, v_player, p_profile, p_rating)
  on conflict (match_id, player_id) do update set rating = excluded.rating;
end;
$$;

-- p_fixture completed p_home:p_away straight away (no match), on p_day.
create or replace function tests.s10_score(p_fixture uuid, p_home integer, p_away integer, p_day date default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.league_fixtures
  set status = 'completed', home_score = p_home, away_score = p_away, score_locked = true,
      scheduled_day = coalesce(p_day, scheduled_day)
  where id = p_fixture;
$$;

-- p_sql's jsonb result as p_user.
create or replace function tests.s10_json(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  execute p_sql into v;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- A standings row (as jsonb) for p_team in league row p_league.
create or replace function tests.s10_row(p_league uuid, p_team uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(s) from public.league_standings(p_league) s where s.team_id = p_team;
$$;

-- The team ids of league row p_league in standings order.
create or replace function tests.s10_order(p_league uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_agg(s.team_id order by s.pos) from public.league_standings(p_league) s;
$$;

-- S10A (tournaments, match-record.md decision 1o).

-- A new user who is an admin (app_admins, written as postgres: only
-- service_role and the dashboard add admins).
create or replace function tests.s10a_admin(p_email text)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.create_user(p_email);
begin
  insert into public.app_admins (profile_id) values (v);
  return v;
end;
$$;

-- A 16-team 5-a-side tournament created by p_admin (50-minute matches, €5
-- entry per player), with registration open unless p_open is false.
create or replace function tests.s10a_tournament(p_admin uuid, p_open boolean default true,
                                                 p_deadline timestamptz default null)
returns uuid
language plpgsql
as $$
declare
  v uuid;
begin
  perform tests.act_as(p_admin);
  v := public.admin_create_tournament(jsonb_build_object(
    'name', 'S10A Cup', 'area', 'Limassol', 'format', '5-a-side', 'maxTeams', 16,
    'entryFeeCents', 500, 'matchMinutes', 50, 'registrationDeadline', p_deadline));
  if p_open and p_deadline is not null then
    perform public.admin_open_registration(v);
  end if;
  perform tests.act_as_postgres();
  -- S10B: a fee needs a deadline to open sign-up. S10A's tests that play
  -- groups and knockouts need neither, so without a deadline sign-up is
  -- opened directly, as it stood before S10B.
  if p_open and p_deadline is null then
    update public.tournaments set status = 'registration' where id = v;
  end if;
  return v;
end;
$$;

-- A team called p_name with p_size members, each a new user; the first is
-- its captain.
create or replace function tests.s10a_team(p_name text, p_size integer default 5)
returns uuid
language plpgsql
as $$
declare
  v_cap uuid := tests.create_user(format('s10a-cap-%s@futty.test', gen_random_uuid()));
  v_players uuid[] := '{}';
begin
  for i in 2 .. p_size loop
    v_players := v_players || tests.create_user(format('s10a-p%s-%s@futty.test', i, gen_random_uuid()));
  end loop;
  return tests.s10_team(p_name, v_cap, v_players);
end;
$$;

-- p_team's members, captain first.
create or replace function tests.s10a_members(p_team uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_agg(profile_id order by (role <> 'captain'), joined_at, id) from public.team_members where team_id = p_team;
$$;

-- p_team's captain.
create or replace function tests.s10a_captain(p_team uuid)
returns uuid
language sql
stable
as $$
  select (tests.s10a_members(p_team))[1];
$$;

-- p_team's captain registers it for p_tournament with p_squad (its first
-- five members by default); returns the error, or null.
create or replace function tests.s10a_register(p_tournament uuid, p_team uuid, p_squad uuid[] default null,
                                               p_kit text default 'kitRed')
returns text
language sql
as $$
  select tests.error_as(tests.s10a_captain(p_team),
    format('select public.register_team_for_tournament(%L, %L, %L, %L)', p_tournament, p_team, p_kit,
           coalesce(p_squad, (tests.s10a_members(p_team))[1:5])));
$$;

-- Registers new teams of five until p_tournament has 16; returns every
-- registered team in registration order.
create or replace function tests.s10a_fill(p_tournament uuid)
returns uuid[]
language plpgsql
as $$
declare
  v_team uuid;
  v_error text;
begin
  while (select count(*) from public.tournament_teams where tournament_id = p_tournament) < 16 loop
    v_team := tests.s10a_team(format('S10A T%s',
      lpad(((select count(*) from public.tournament_teams where tournament_id = p_tournament) + 1)::text, 2, '0')));
    v_error := tests.s10a_register(p_tournament, v_team);
    assert v_error is null, 'registered, got ' || coalesce(v_error, '');
  end loop;
  return (select array_agg(team_id order by registered_at, team_id) from public.tournament_teams
          where tournament_id = p_tournament);
end;
$$;

-- p_teams (16) placed in order: 1–4 in group A (positions 1–4), 5–8 in B,
-- 9–12 in C and 13–16 in D, by p_admin.
create or replace function tests.s10a_set_groups(p_admin uuid, p_tournament uuid, p_teams uuid[])
returns text
language sql
as $$
  select tests.error_as(p_admin, format('select public.admin_set_groups(%L, %L)', p_tournament,
    jsonb_build_object('A', to_jsonb(p_teams[1:4]), 'B', to_jsonb(p_teams[5:8]),
                       'C', to_jsonb(p_teams[9:12]), 'D', to_jsonb(p_teams[13:16]))));
$$;

-- A tournament with 16 teams in groups set in registration order (see
-- s10a_set_groups); returns the teams in that order.
create or replace function tests.s10a_groups(p_admin uuid, p_tournament uuid)
returns uuid[]
language plpgsql
as $$
declare
  v_teams uuid[] := tests.s10a_fill(p_tournament);
  v_error text := tests.s10a_set_groups(p_admin, p_tournament, v_teams);
begin
  assert v_error is null, 'groups set, got ' || coalesce(v_error, '');
  return v_teams;
end;
$$;

-- The fixture in slot p_slot ('A-1' … 'D-6', 'QF1' … 'QF4', 'SF1', 'SF2', 'F').
create or replace function tests.s10a_slot(p_tournament uuid, p_slot text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.tournament_fixtures where tournament_id = p_tournament and slot = p_slot;
$$;

-- The group fixture between p_a and p_b, either way round.
create or replace function tests.s10a_fixture(p_tournament uuid, p_a uuid, p_b uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.tournament_fixtures
  where tournament_id = p_tournament
    and ((home_team_id = p_a and away_team_id = p_b) or (home_team_id = p_b and away_team_id = p_a));
$$;

-- p_admin enters p_home:p_away (and pens) on p_fixture; returns the error,
-- or null.
create or replace function tests.s10a_result(p_admin uuid, p_fixture uuid, p_home integer, p_away integer,
                                             p_home_pens integer default null, p_away_pens integer default null)
returns text
language sql
as $$
  select tests.error_as(p_admin, format('select public.admin_set_result(%L, %s, %s, %s, %s)', p_fixture, p_home,
                                        p_away, coalesce(p_home_pens::text, 'null'), coalesce(p_away_pens::text, 'null')));
$$;

-- p_fixture completed p_home:p_away straight away (no match), for the
-- standings tests.
create or replace function tests.s10a_score(p_fixture uuid, p_home integer, p_away integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tournament_fixtures
  set status = 'completed', home_score = p_home, away_score = p_away, decided_by = 'organiser'
  where id = p_fixture;
$$;

-- Every group fixture through p_admin: the team placed higher in the group
-- wins 1–0, so each group finishes in its placing order.
create or replace function tests.s10a_play_groups(p_admin uuid, p_tournament uuid)
returns void
language plpgsql
as $$
declare
  f record;
  v_error text;
begin
  for f in
    select tf.id, th.group_pos as home_pos, ta.group_pos as away_pos
    from public.tournament_fixtures tf
    join public.tournament_teams th on th.tournament_id = tf.tournament_id and th.team_id = tf.home_team_id
    join public.tournament_teams ta on ta.tournament_id = tf.tournament_id and ta.team_id = tf.away_team_id
    where tf.tournament_id = p_tournament and tf.stage = 'group' and tf.status <> 'completed'
    order by tf.slot
  loop
    v_error := tests.s10a_result(p_admin, f.id, case when f.home_pos < f.away_pos then 1 else 0 end,
                                 case when f.home_pos < f.away_pos then 0 else 1 end);
    assert v_error is null, 'group result entered, got ' || coalesce(v_error, '');
  end loop;
end;
$$;

-- The team at p_pos (1–4) of group p_group in the placing (group_pos).
create or replace function tests.s10a_placed(p_tournament uuid, p_group text, p_pos integer)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select team_id from public.tournament_teams
  where tournament_id = p_tournament and group_letter = p_group and group_pos = p_pos;
$$;

-- p_admin sets p_fixture's kickoff; returns its match.
create or replace function tests.s10a_time(p_admin uuid, p_fixture uuid, p_kickoff timestamptz)
returns uuid
language plpgsql
as $$
declare
  v_error text := tests.error_as(p_admin, format('select public.admin_set_fixture_time(%L, %L)', p_fixture, p_kickoff));
begin
  assert v_error is null, 'time set, got ' || coalesce(v_error, '');
  return (select id from public.matches where tournament_fixture_id = p_fixture);
end;
$$;

-- p_user logs p_a:p_b (and pens) on p_match with his sides' goals as own
-- goals, as tests.log_result does; returns log_match_result's answer.
create or replace function tests.s10a_log(p_user uuid, p_match uuid, p_a integer, p_b integer,
                                          p_pa integer default null, p_pb integer default null)
returns jsonb
language plpgsql
as $$
declare
  v_stats jsonb := '{}';
  v_side text;
  v jsonb;
begin
  foreach v_side in array coalesce(public.match_side_writer(p_match, p_user), '{}') loop
    v_stats := v_stats || jsonb_build_object(v_side, jsonb_build_object(
      'players', '[]'::jsonb, 'ownGoals', case v_side when 'a' then p_a else p_b end));
  end loop;
  perform tests.act_as(p_user);
  v := public.log_match_result(p_match, p_a, p_b, v_stats, p_pa, p_pb);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- The error tests.s10a_log raises, or null.
create or replace function tests.s10a_log_error(p_user uuid, p_match uuid, p_a integer, p_b integer,
                                                p_pa integer default null, p_pb integer default null)
returns text
language plpgsql
as $$
begin
  perform tests.s10a_log(p_user, p_match, p_a, p_b, p_pa, p_pb);
  return null;
exception when others then
  perform tests.act_as_postgres();
  return sqlerrm;
end;
$$;

-- p_x scored p_gx and p_y scored p_gy in their group fixture, written
-- straight in whichever way round it is.
create or replace function tests.s10a_pair(p_tournament uuid, p_x uuid, p_y uuid, p_gx integer, p_gy integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tournament_fixtures
  set status = 'completed', decided_by = 'organiser',
      home_score = case when home_team_id = p_x then p_gx else p_gy end,
      away_score = case when home_team_id = p_x then p_gy else p_gx end
  where tournament_id = p_tournament
    and ((home_team_id = p_x and away_team_id = p_y) or (home_team_id = p_y and away_team_id = p_x));
$$;

-- Group p_group's team ids in standings order.
create or replace function tests.s10a_order(p_tournament uuid, p_group text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_agg(s.team_id order by s.pos) from public.tournament_group_standings(p_tournament, p_group) s;
$$;

-- ---- S10B: tournament entry (spec 13 "Tournament entry (S10B)") --------------------------

-- A tournament at p_fee per player (€12.00 by default, the worked
-- examples), sign-up open with a deadline 2 days ahead.
create or replace function tests.s10b_tournament(p_admin uuid, p_fee integer default 1200,
                                                 p_deadline timestamptz default now() + interval '2 days',
                                                 p_open boolean default true)
returns uuid
language plpgsql
as $$
declare
  v uuid;
begin
  perform tests.act_as(p_admin);
  v := public.admin_create_tournament(jsonb_build_object(
    'name', 'S10B Cup', 'area', 'Limassol', 'format', '5-a-side', 'maxTeams', 16,
    'entryFeeCents', p_fee, 'matchMinutes', 50, 'registrationDeadline', p_deadline));
  if p_open then
    perform public.admin_open_registration(v);
  end if;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- A new team of p_starters + p_subs, registered for p_tournament by its
-- captain: the first p_starters members are starters, the rest subs.
create or replace function tests.s10b_team(p_tournament uuid, p_name text, p_subs integer default 0)
returns uuid
language plpgsql
as $$
declare
  v_team uuid := tests.s10a_team(p_name, 5 + p_subs);
  v_m uuid[] := tests.s10a_members(v_team);
  v_error text;
begin
  v_error := tests.error_as(v_m[1], format('select public.register_team_for_tournament(%L, %L, %L, %L, %L)',
    p_tournament, v_team, 'kitRed', v_m[1:5 + p_subs], coalesce(v_m[6:5 + p_subs], '{}'::uuid[])));
  assert v_error is null, 'registered, got ' || coalesce(v_error, '');
  return v_team;
end;
$$;

-- p_profile starts paying p_tournament's entry, as create-tournament-payment
-- does for its verified caller; returns the error, or null.
create or replace function tests.s10b_start_error(p_profile uuid, p_tournament uuid)
returns text
language plpgsql
as $$
begin
  perform public.plan_tournament_entry(p_tournament, p_profile);
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- p_profile pays p_tournament's entry: started as him, then the intent and
-- Stripe's webhook as the server would (Stripe keeps p_stripe_fee). Returns
-- the payment's id.
create or replace function tests.s10b_pay(p_profile uuid, p_tournament uuid, p_stripe_fee integer default 43)
returns uuid
language plpgsql
as $$
declare
  v_plan jsonb;
  v_id uuid;
  v_intent text;
begin
  v_plan := public.plan_tournament_entry(p_tournament, p_profile);
  v_id := (v_plan ->> 'payment_id')::uuid;
  v_intent := 'pi_s10b_' || replace(v_id::text, '-', '');
  perform public.attach_tournament_entry_intent(v_id, p_profile, v_intent);
  perform public.tournament_entry_paid(v_intent, (v_plan ->> 'amount_cents')::integer, p_stripe_fee);
  return v_id;
end;
$$;

-- The deadline passes and run-payment-jobs' deadline step runs.
create or replace function tests.s10b_deadline(p_tournament uuid)
returns void
language plpgsql
as $$
begin
  update public.tournaments set registration_deadline = now() - interval '1 second' where id = p_tournament;
  perform public.tournament_deadline_tick();
end;
$$;

-- Every refund that is due, made as run-payment-jobs would (re_<payment>).
create or replace function tests.s10b_refund_all()
returns integer
language plpgsql
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select * from public.tournament_entry_refunds_due() loop
    perform public.tournament_entry_refunded(r.payment_id, 're_s10b_' || replace(r.payment_id::text, '-', ''));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Money refunded to p_tournament's players (ledger, cents).
-- (plpgsql, so helpers.sql loads before the S10B tables exist.)
create or replace function tests.s10b_refunded(p_tournament uuid)
returns integer
language plpgsql
stable
as $$
begin
  return (select coalesce(sum(l.amount_cents), 0)::integer from public.money_ledger l
          join public.tournament_entry_payments p on p.id = l.tournament_payment_id
          where p.tournament_id = p_tournament and l.kind = 'refund' and l.reason = 'tournament_entry_refund');
end;
$$;

-- Money taken from p_tournament's players (ledger, cents).
create or replace function tests.s10b_taken(p_tournament uuid)
returns integer
language plpgsql
stable
as $$
begin
  return (select coalesce(sum(l.amount_cents), 0)::integer from public.money_ledger l
          join public.tournament_entry_payments p on p.id = l.tournament_payment_id
          where p.tournament_id = p_tournament and l.kind = 'capture' and l.reason = 'tournament_entry');
end;
$$;
