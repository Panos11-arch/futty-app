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

-- Price per hour for a format, in cents: the venue's one price, plus an
-- optional peak and weekend price (null = the venue has none).
drop function if exists tests.set_price(uuid, text, integer, integer, integer);
create function tests.set_price(
  p_venue uuid,
  p_format text,
  p_price integer,
  p_peak integer default null,
  p_weekend integer default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.price_rules (venue_id, format, price_cents, peak_cents, weekend_cents)
  values (p_venue, p_format, p_price, p_peak, p_weekend)
  on conflict (venue_id, format) do update
    set price_cents = excluded.price_cents, peak_cents = excluded.peak_cents, weekend_cents = excluded.weekend_cents;
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
-- keeping when it was made. For timing tests.
create or replace function tests.set_kickoff(p_booking uuid, p_kickoff timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.venue_bookings
  set booking_day = (p_kickoff at time zone 'Asia/Nicosia')::date,
      start_time = (p_kickoff at time zone 'Asia/Nicosia')::time,
      end_time = case when (p_kickoff at time zone 'Asia/Nicosia')::time >= time '23:29' then time '23:59:59'
                      else (p_kickoff at time zone 'Asia/Nicosia')::time + interval '30 minutes' end
  where id = p_booking;
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
create or replace function tests.end_match(p_booking uuid, p_ago interval default '3 hours')
returns void
language sql
security definer
set search_path = ''
as $$
  select tests.set_kickoff(p_booking, now() - p_ago - interval '30 minutes');
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

revoke all on function tests.create_user(text, jsonb) from public;
revoke all on function tests.create_venue(uuid, numeric, integer, time, time) from public;
revoke all on function tests.create_pitch(uuid, text, text, text[], integer) from public;
revoke all on function tests.set_price(uuid, text, integer, integer, integer) from public;
grant execute on all functions in schema tests to anon, authenticated, service_role;
