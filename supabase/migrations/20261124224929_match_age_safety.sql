-- S12: age and safety (docs/specs/05-product.md section 16, A1-A7, decided
-- by Panos on 19 November and 24 November). Every age check runs here: the
-- app is never trusted for a player's age.
--
--   A1  date of birth on profiles, owner and server only, locked once set
--   A2  under 14 refuses sign-up and locks an existing account (too_young)
--   A3  minor = under 18 on today's date in Cyprus (Asia/Nicosia)
--   A4  age_pair_allowed(a, b) for friend requests and private chats, which
--       S20 and S20A call when they create them
--   A5  other players see a minor's first name only (no username) and
--       adults' player search leaves minors out; venue functions keep the
--       full name (decided 24 November)
--   A6  fixture chat free text refused if either captain is a minor
--   A7  a report involving a minor is flagged urgent and raises an admin
--       alert that notify-urgent-reports emails to the founders
--
-- Turning 18: everything follows today's Cyprus date, so the limits stop on
-- the 18th birthday with no job. A 29 February birthday completes a year on
-- 1 March in other years (Postgres age()).
--
-- Re-created functions keep their latest body (baseline.sql,
-- 20261112154127_match_page.sql, 20261118193120_pay_profile_avatar.sql)
-- with only the age changes; their return types don't change, so create or
-- replace keeps their grants.

-- ---- Ages -------------------------------------------------------------------

-- The Cyprus date at an instant.
create or replace function public.cyprus_date(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Nicosia')::date;
$$;

-- Whole years from p_dob to p_on.
create or replace function public.age_in_years(p_dob date, p_on date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select extract(year from pg_catalog.age(p_on::timestamp, p_dob::timestamp))::integer;
$$;

-- A3: under 18 on the Cyprus date at p_at. No date of birth is not a minor
-- (the app asks for it before anything else, A1).
create or replace function public.is_minor_dob(p_dob date, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_dob is not null and public.age_in_years(p_dob, public.cyprus_date(p_at)) < 18;
$$;

create or replace function public.is_minor(p_profile_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.is_minor_dob(p.date_of_birth, p_at) from public.profiles p where p.id = p_profile_id), false);
$$;

-- A4: false for an adult and a minor together.
create or replace function public.age_pair_allowed(p_a uuid, p_b uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_minor(p_a, p_at) = public.is_minor(p_b, p_at);
$$;

-- A1, A2: 'needs_dob', 'too_young' (under 14) or 'ok'.
create or replace function public.age_status(p_profile_id uuid, p_at timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.date_of_birth is null then 'needs_dob'
    when public.age_in_years(p.date_of_birth, public.cyprus_date(p_at)) < 14 then 'too_young'
    else 'ok'
  end
  from public.profiles p
  where p.id = p_profile_id;
$$;

-- A2: a locked account can't act.
create or replace function public.assert_age_ok()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.age_status(auth.uid()) = 'too_young' then
    raise exception 'too_young';
  end if;
end;
$$;

-- A5: what other players see of a minor's name: the first name only.
create or replace function public.minor_first_name(p_first_name text, p_full_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(trim(p_first_name), ''), nullif(split_part(trim(coalesce(p_full_name, '')), ' ', 1), ''), 'Player');
$$;

-- A5: whether the caller sees p_profile_id's name cut to the first name:
-- a minor, seen by anyone but themselves.
create or replace function public.name_hidden(p_profile_id uuid, p_dob date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_profile_id is distinct from auth.uid() and public.is_minor_dob(p_dob);
$$;

-- ---- A1, A2: the date of birth ---------------------------------------------

-- Signed out, before sign-up: whether this date of birth may sign up
-- (14 or older on today's Cyprus date, not in the future). Only a yes or no.
create or replace function public.date_of_birth_allowed(p_dob date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_dob is not null
     and p_dob <= public.cyprus_date(now())
     and public.age_in_years(p_dob, public.cyprus_date(now())) >= 14;
$$;

-- The caller's own age status; never the date or the age.
create or replace function public.my_age_status()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  return public.age_status(auth.uid());
end;
$$;

-- An existing player gives their date of birth, once. Under 14 is saved
-- too, so the account stays locked (A2). Returns the new age status.
create or replace function public.set_date_of_birth(p_dob date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current date;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select date_of_birth into v_current from public.profiles where id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if v_current is not null then
    raise exception 'date_of_birth_locked';
  end if;
  if p_dob is null or p_dob > public.cyprus_date(now()) or p_dob < date '1900-01-01' then
    raise exception 'invalid_date';
  end if;

  update public.profiles set date_of_birth = p_dob where id = v_uid;
  return public.age_status(v_uid);
end;
$$;

-- Guards every write of date_of_birth, whoever makes it:
--   - never in the future;
--   - a new account under 14 is refused (sign-up, A2);
--   - once set, players can't change or clear it (support can, and account
--     deletion clears it as service_role).
create or replace function public.profiles_date_of_birth_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > public.cyprus_date(now()) then
    raise exception 'invalid_date';
  end if;

  if tg_op = 'INSERT' then
    if new.date_of_birth is not null and public.age_in_years(new.date_of_birth, public.cyprus_date(now())) < 14 then
      raise exception 'too_young';
    end if;
  elsif old.date_of_birth is not null
        and new.date_of_birth is distinct from old.date_of_birth
        and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'date_of_birth_locked';
  end if;

  return new;
end;
$$;

create trigger profiles_date_of_birth_guard
  before insert or update of date_of_birth on public.profiles
  for each row execute function public.profiles_date_of_birth_guard();

-- handle_new_user (latest: baseline.sql): also copies date_of_birth from the
-- sign-up metadata. The guard above refuses under 14, which fails the
-- sign-up itself. A date that isn't a date is ignored (asked again, A1).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  meta_full_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  meta_dob date;
begin
  begin
    meta_dob := nullif(trim(new.raw_user_meta_data ->> 'date_of_birth'), '')::date;
  exception when others then
    meta_dob := null;
  end;

  begin
    insert into public.profiles (id, email, username, full_name, date_of_birth)
    values (new.id, new.email, meta_username, meta_full_name, meta_dob)
    on conflict (id) do nothing;
  exception when unique_violation then
    -- The username was claimed between the client's availability check and this
    -- insert. Losing a rare race is not a reason to fail account creation, so
    -- keep the account and leave username null for the user to set later.
    insert into public.profiles (id, email, username, full_name, date_of_birth)
    values (new.id, new.email, null, meta_full_name, meta_dob)
    on conflict (id) do nothing;
  end;

  return new;
end;
$$;

-- ---- A5: what other players see --------------------------------------------

-- get_public_profile (latest: 20261118193120_pay_profile_avatar.sql).
create or replace function public.get_public_profile(p_profile_id uuid)
returns table (
  id uuid, username text, full_name text, city text, "position" text, preferred_foot text,
  xp integer, played integer, won integer, drawn integer, lost integer, goals integer,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select id,
    case when public.name_hidden(id, date_of_birth) then null else username end,
    case when public.name_hidden(id, date_of_birth) then public.minor_first_name(first_name, full_name) else full_name end,
    city, "position", preferred_foot, xp, played, won, drawn, lost, goals,
    avatar_style, avatar_kit_colour, avatar_number
  from public.profiles
  where id = p_profile_id;
$$;

-- get_public_profiles (latest: 20261118193120_pay_profile_avatar.sql).
create or replace function public.get_public_profiles(p_profile_ids uuid[])
returns table (
  id uuid, username text, full_name text, xp integer,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select id,
    case when public.name_hidden(id, date_of_birth) then null else username end,
    case when public.name_hidden(id, date_of_birth) then public.minor_first_name(first_name, full_name) else full_name end,
    xp, avatar_style, avatar_kit_colour, avatar_number
  from public.profiles
  where id = any(p_profile_ids);
$$;

-- get_team_roster (latest: 20261118193120_pay_profile_avatar.sql).
create or replace function public.get_team_roster(p_team_id uuid)
returns table (
  profile_id uuid, username text, full_name text, role text, joined_at timestamp with time zone,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id,
    case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
    case when public.name_hidden(p.id, p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name) else p.full_name end,
    tm.role, tm.joined_at,
    p.avatar_style, p.avatar_kit_colour, p.avatar_number
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
  order by tm.joined_at;
$$;

-- list_players (latest: 20261118193120_pay_profile_avatar.sql): an adult
-- (or a player with no date of birth yet) doesn't see minors at all.
create or replace function public.list_players()
returns table (
  id uuid, username text, full_name text, phone text,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
    case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
    case when public.name_hidden(p.id, p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name) else p.full_name end,
    case when p.show_phone_publicly then p.phone else null end as phone,
    p.avatar_style, p.avatar_kit_colour, p.avatar_number
  from public.profiles p
  where p.username is not null
    and p.id <> auth.uid()
    and (public.is_minor(auth.uid()) or not public.is_minor_dob(p.date_of_birth))
  order by p.username
  limit 200;
$$;

-- find_profile_by_username (latest: baseline.sql): the same search rule.
create or replace function public.find_profile_by_username(p_username text)
returns table (id uuid, username text, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
    case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
    case when public.name_hidden(p.id, p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name) else p.full_name end
  from public.profiles p
  where lower(p.username) = lower(trim(p_username))
    and (p.id = auth.uid() or public.is_minor(auth.uid()) or not public.is_minor_dob(p.date_of_birth));
$$;

-- match_player_json (latest: 20261112154127_match_page.sql).
create or replace function public.match_player_json(p_player_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'playerId', mp.id,
    'profileId', mp.profile_id,
    'name', case
      when p.id is not null and public.name_hidden(p.id, p.date_of_birth)
        then public.minor_first_name(p.first_name, p.full_name)
      else coalesce(nullif(trim(p.full_name), ''), nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
                    p.username, mp.guest_name)
    end,
    'guestName', mp.guest_name)
  from public.match_players mp
  left join public.profiles p on p.id = mp.profile_id
  where mp.id = p_player_id;
$$;

-- ---- A6: fixture chat --------------------------------------------------------

-- Whether either captain of a fixture's two teams is a minor.
create or replace function public.fixture_has_minor_captain(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_fixtures f
    join public.team_members tm on tm.team_id in (f.home_team_id, f.away_team_id) and tm.role = 'captain'
    join public.profiles p on p.id = tm.profile_id
    where f.id = p_fixture_id and public.is_minor_dob(p.date_of_birth)
  );
$$;

-- send_fixture_message (latest: baseline.sql): free text is refused when a
-- captain is a minor. Date proposals and scores are other functions and
-- keep working.
create or replace function public.send_fixture_message(p_fixture_id uuid, p_message text)
returns public.fixture_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
  v_row public.fixture_messages;
begin
  perform public.assert_age_ok();

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if public.fixture_has_minor_captain(p_fixture_id) then
    raise exception 'minor_chat_blocked';
  end if;

  if nullif(trim(p_message), '') is null then
    raise exception 'message_required';
  end if;

  insert into public.fixture_messages (fixture_id, sender_team_id, message)
  values (p_fixture_id, v_my_team, trim(p_message))
  returning * into v_row;

  return v_row;
end;
$$;

-- ---- A7: reports -------------------------------------------------------------

-- Blocks and reports were only ever in supabase/legacy/moderation.sql, run
-- by hand; the app writes to both (lib/moderation.ts). Created here as they
-- are there (if not exists: production may already have them).
create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocked_users_not_self check (blocker_id <> blocked_id)
);
create unique index if not exists blocked_users_unique on public.blocked_users (blocker_id, blocked_id);
alter table public.blocked_users enable row level security;
drop policy if exists "Users manage their own blocks" on public.blocked_users;
create policy "Users manage their own blocks"
  on public.blocked_users for all
  to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());
revoke all on public.blocked_users from anon;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete set null,
  context text not null,
  context_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);
-- Set by the server only (reports_flag_urgent); whatever the app sends is
-- overwritten.
alter table public.reports add column if not exists urgent boolean not null default false;
alter table public.reports enable row level security;
drop policy if exists "Users can submit reports" on public.reports;
create policy "Users can submit reports"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());
revoke all on public.reports from anon;
create index if not exists reports_urgent_first_idx on public.reports (urgent desc, created_at desc);

-- A report involves a minor when the reporter, the reported player, a
-- captain of the reported fixture chat or a member of the reported team is
-- one.
create or replace function public.report_involves_minor(p_report public.reports)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_minor(p_report.reporter_id)
      or (p_report.reported_user_id is not null and public.is_minor(p_report.reported_user_id))
      or (p_report.context = 'fixture_chat' and p_report.context_id is not null
          and public.fixture_has_minor_captain(p_report.context_id))
      or (p_report.context = 'team' and p_report.context_id is not null and exists (
            select 1 from public.team_members tm
            where tm.team_id = p_report.context_id and public.is_minor(tm.profile_id)));
$$;

create or replace function public.reports_flag_urgent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.urgent := public.report_involves_minor(new);
  return new;
end;
$$;

drop trigger if exists reports_flag_urgent on public.reports;
create trigger reports_flag_urgent
  before insert on public.reports
  for each row execute function public.reports_flag_urgent();

-- The founders' alert, emailed by notify-urgent-reports.
alter table public.admin_alerts add column emailed_at timestamptz;
alter table public.admin_alerts drop constraint admin_alerts_kind_check;
alter table public.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('capture_failing', 'cancellation_failing', 'hold_cancelled', 'collection_failing', 'match_sync_failed',
                  'payout_failing', 'payout_reversed', 'payout_missing', 'books_unbalanced', 'connect_deauthorized',
                  'minor_report'));

create or replace function public.reports_alert_urgent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.urgent then
    insert into public.admin_alerts (kind, details)
    values ('minor_report', jsonb_build_object('report_id', new.id, 'context', new.context));
  end if;
  return new;
end;
$$;

drop trigger if exists reports_alert_urgent on public.reports;
create trigger reports_alert_urgent
  after insert on public.reports
  for each row execute function public.reports_alert_urgent();

-- The founders' reports list (Supabase dashboard), urgent first.
create or replace view public.admin_reports
with (security_invoker = true)
as
  select case when r.urgent then 'Urgent' else '' end as flag,
    r.id, r.created_at, r.context, r.context_id, r.reporter_id, r.reported_user_id, r.reason
  from public.reports r
  order by r.urgent desc, r.created_at desc;
revoke all on public.admin_reports from public, anon, authenticated;
grant select on public.admin_reports to service_role;
grant select on public.reports to service_role;

-- Job: urgent report alerts not emailed yet, oldest first.
create or replace function public.urgent_report_alerts_due()
returns table (alert_id uuid, report_id uuid, context text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, (a.details ->> 'report_id')::uuid, a.details ->> 'context', a.created_at
  from public.admin_alerts a
  where a.kind = 'minor_report' and a.emailed_at is null and a.resolved_at is null
  order by a.created_at
  limit 50;
$$;

create or replace function public.urgent_report_alert_emailed(p_alert_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.admin_alerts set emailed_at = now()
  where id = p_alert_id and kind = 'minor_report' and emailed_at is null;
$$;

-- ---- Grants ------------------------------------------------------------------

-- Signed out (the sign-up form) and signed in.
revoke all on function public.date_of_birth_allowed(date) from public;
grant execute on function public.date_of_birth_allowed(date) to anon, authenticated, service_role;

-- Signed in.
revoke all on function public.my_age_status() from public, anon;
grant execute on function public.my_age_status() to authenticated, service_role;
revoke all on function public.set_date_of_birth(date) from public, anon;
grant execute on function public.set_date_of_birth(date) to authenticated, service_role;

-- Internal: service_role only (other security definer functions call them).
revoke all on function public.cyprus_date(timestamptz) from public, anon, authenticated;
revoke all on function public.age_in_years(date, date) from public, anon, authenticated;
revoke all on function public.is_minor_dob(date, timestamptz) from public, anon, authenticated;
revoke all on function public.is_minor(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.age_pair_allowed(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.age_status(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.assert_age_ok() from public, anon, authenticated;
revoke all on function public.minor_first_name(text, text) from public, anon, authenticated;
revoke all on function public.name_hidden(uuid, date) from public, anon, authenticated;
revoke all on function public.profiles_date_of_birth_guard() from public, anon, authenticated;
revoke all on function public.fixture_has_minor_captain(uuid) from public, anon, authenticated;
revoke all on function public.report_involves_minor(public.reports) from public, anon, authenticated;
revoke all on function public.reports_flag_urgent() from public, anon, authenticated;
revoke all on function public.reports_alert_urgent() from public, anon, authenticated;
revoke all on function public.urgent_report_alerts_due() from public, anon, authenticated;
revoke all on function public.urgent_report_alert_emailed(uuid) from public, anon, authenticated;
grant execute on function public.cyprus_date(timestamptz) to service_role;
grant execute on function public.age_in_years(date, date) to service_role;
grant execute on function public.is_minor_dob(date, timestamptz) to service_role;
grant execute on function public.is_minor(uuid, timestamptz) to service_role;
grant execute on function public.age_pair_allowed(uuid, uuid, timestamptz) to service_role;
grant execute on function public.age_status(uuid, timestamptz) to service_role;
grant execute on function public.assert_age_ok() to service_role;
grant execute on function public.minor_first_name(text, text) to service_role;
grant execute on function public.name_hidden(uuid, date) to service_role;
grant execute on function public.fixture_has_minor_captain(uuid) to service_role;
grant execute on function public.report_involves_minor(public.reports) to service_role;
grant execute on function public.urgent_report_alerts_due() to service_role;
grant execute on function public.urgent_report_alert_emailed(uuid) to service_role;
