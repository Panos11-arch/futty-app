-- Security hardening (code review, Nov 2026).
-- Run AFTER every other file in this folder. Run in the Supabase dashboard:
-- SQL Editor > New query > Run. Safe to re-run.
--
-- Why this exists: Postgres gives EXECUTE on every new function to PUBLIC
-- (= every role, including anon and authenticated) unless it's revoked from
-- PUBLIC specifically. Earlier files revoked from `authenticated` / `anon`
-- only, which does nothing while the PUBLIC grant is still there — so
-- internal helpers like apply_personal_match_stats, forfeit_team_premium_fixtures
-- and set_team_premium were callable by anyone holding the anon key.
--
-- Run the VERIFY query at the bottom afterwards — it should list only the
-- functions the app is meant to call.

-- ---------------------------------------------------------------------------
-- 1. Internal-only functions: callable from other security-definer functions,
--    triggers, and Edge Functions (service_role) — never from the app.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
  internal_names text[] := array[
    'add_booking_share_internal',
    'apply_fixture_forfeit_stats',
    'apply_friendly_forfeit_stats',
    'apply_friendly_match_result',
    'apply_personal_match_stats',
    'auto_add_booking_share_on_join',
    'booking_total_shares_needed',
    'bookings_needing_share_cancellation',
    'cancel_booking_for',
    'captain_team_for_fixture',
    'check_fixture_score_match',
    'check_friendly_score_match',
    'check_owner_block_capacity',
    'finalize_gipedo_pano_settlement',
    'fixtures_needing_resolution',
    'forfeit_team_premium_fixtures',
    'friendly_matches_needing_resolution',
    'gipedo_pano_pending_settlement_shares',
    'handle_new_user',
    'is_captain_in_league_tree',
    'mark_gipedo_pano_share_settled',
    'notify_booking_slot_freed',
    'notify_fixture_agreed',
    'notify_fixture_message',
    'notify_squad_post_created',
    'notify_squad_post_joiner',
    'notify_squad_post_matched',
    'record_gipedo_pano_settlement',
    'resolve_stale_fixture',
    'resolve_stale_fixtures',
    'resolve_stale_friendly_match',
    'resolve_stale_friendly_matches',
    'set_team_premium',
    'sync_league_fixtures'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (internal_names)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. App-callable functions: signed-in users only, never anon. The single
--    exception is is_username_available, which the sign-up form needs before
--    an account exists.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
  app_names text[] := array[
    'add_booking_player', 'add_house_player', 'apply_promotion_relegation', 'book_slot',
    'cancel_opposition_offer', 'cancel_pending_share', 'cancel_squad_post', 'create_squad_post',
    'create_team', 'end_season_to_divisions', 'find_profile_by_username', 'form_new_division',
    'get_public_profile', 'get_public_profiles', 'get_team_roster', 'join_squad_post',
    'leave_squad_post', 'list_booking_shares', 'list_my_transactions', 'list_players',
    'log_booking_result', 'match_contacts_by_phone', 'offer_opposition', 'propose_fixture_schedule',
    'register_team_for_league', 'resolve_unscheduled_fixture', 'send_fixture_message',
    'squad_post_notification_recipients', 'start_league_season', 'submit_fixture_score',
    'submit_friendly_score', 'venue_day_availability'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (app_names)
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end $$;

-- From now on, new functions in public are NOT executable by everyone by
-- default — every file in this repo already grants explicitly, so nothing
-- needs to change in how new SQL is written.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. cancel_booking: the cancel-booking Edge Function used to call this AS
--    the user, which only worked because of the PUBLIC grant above — the
--    "revoke from authenticated" in booking-payments.sql never took effect,
--    so the app could also call it directly and skip the refund/void step.
--    cancel_booking_for is the same logic with the caller passed in
--    explicitly, callable only by the Edge Function (service_role).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking_for(p_booking_id uuid, p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;

  if v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;

  if v_booking.status = 'confirmed'
     and now() >= ((v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia') - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;

  -- Returned so the Edge Function knows what it was before (no separate,
  -- racy pre-read needed).
  return v_booking.status;
end;
$$;

revoke execute on function public.cancel_booking_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_booking_for(uuid, uuid) to service_role;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cancel_booking'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. profiles: the "update your own row" policy allowed EVERY column, so a
--    player could set their own xp / played / won / goals / role. Only the
--    fields the Edit Profile and Privacy screens actually change are
--    writable now. Stats, XP, role, premium and Stripe IDs only ever change
--    through server-side functions.
-- ---------------------------------------------------------------------------
revoke insert, update on public.profiles from anon, authenticated;

do $$
declare
  editable text[] := array[
    'id', 'email', 'username', 'full_name', 'phone', 'gender', 'date_of_birth',
    'bio', 'city', 'position', 'preferred_foot', 'show_phone_publicly'
  ];
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = any (editable);
  execute format('grant update (%s) on public.profiles to authenticated', cols);

  -- lib/auth.tsx upserts these four right after sign-up.
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name = any (array['id', 'email', 'username', 'full_name']);
  execute format('grant insert (%s) on public.profiles to authenticated', cols);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Tables the app never writes to directly (every write goes through an
--    RPC). Removes any write path a dashboard-created policy might have
--    opened. team_members keeps INSERT (captains add players directly).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['teams', 'leagues', 'league_teams', 'league_fixtures',
                           'friendly_matches', 'squad_posts', 'venues', 'booking_payment_shares']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    end if;
  end loop;
  if to_regclass('public.team_members') is not null then
    execute 'revoke update on public.team_members from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. venue_bookings: every signed-in user can read every booking (needed for
--    availability), but no longer the Stripe PaymentIntent ID. Every other
--    column stays readable so no existing screen breaks.
-- ---------------------------------------------------------------------------
revoke select on public.venue_bookings from anon, authenticated;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'venue_bookings'
    and column_name not in ('stripe_payment_intent_id');
  execute format('grant select (%s) on public.venue_bookings to authenticated', cols);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Contact matching: cap how many numbers one call can check, so the
--    function can't be used to sweep huge ranges of phone numbers.
-- ---------------------------------------------------------------------------
create or replace function public.match_contacts_by_phone(p_phone_numbers text[])
returns table (phone_number text, profile_id uuid, username text)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(array_length(p_phone_numbers, 1), 0) > 2000 then
    raise exception 'too_many_numbers';
  end if;

  return query
  with contacts as (
    select
      raw,
      right(regexp_replace(raw, '\D', '', 'g'), 9) as digits
    from unnest(p_phone_numbers) as raw
  )
  select distinct on (contacts.raw)
    contacts.raw as phone_number,
    p.id as profile_id,
    p.username
  from contacts
  join public.profiles p
    on right(regexp_replace(p.phone, '\D', '', 'g'), 9) = contacts.digits
  where p.phone is not null
    and length(contacts.digits) = 9
    and p.id <> auth.uid()
  order by contacts.raw, p.username;
end;
$$;

revoke execute on function public.match_contacts_by_phone(text[]) from public, anon;
grant execute on function public.match_contacts_by_phone(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Stripe webhook de-duplication: Stripe retries events, sometimes
--    concurrently. stripe-webhook records each event ID here first and skips
--    any it has already seen.
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Futty AI usage log — backs the per-user rate limit in futty-ai-chat.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_chat_usage (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_usage_profile_time_idx on public.ai_chat_usage (profile_id, created_at desc);
alter table public.ai_chat_usage enable row level security;
revoke all on public.ai_chat_usage from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Once-only markers for the two client-triggered notification functions
--     (notify-squad-post-created, notify-opposition-matched), so they can't
--     be re-fired to spam everyone.
-- ---------------------------------------------------------------------------
alter table public.squad_posts add column if not exists push_notified_at timestamptz;
alter table public.squad_posts add column if not exists match_notified_team_id uuid;

-- ---------------------------------------------------------------------------
-- VERIFY (run separately after the above). Lists every public function a
-- signed-out (anon) or signed-in (authenticated) user can call. anon should
-- show only is_username_available; authenticated should show only the
-- app_names list in section 2.
-- ---------------------------------------------------------------------------
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as anon_can_call,
--        has_function_privilege('authenticated', p.oid, 'execute') as user_can_call
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and (has_function_privilege('anon', p.oid, 'execute')
--        or has_function_privilege('authenticated', p.oid, 'execute'))
-- order by 1;
