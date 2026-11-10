-- A2: the match record (docs/specs/match-record.md section 4, decisions in
-- sections 1 and 1a). Tables, RLS and grants; the functions that write
-- them come in the next match_record_* migrations.
--
-- Every table has RLS. No app role (anon, authenticated) writes a match
-- table directly: every write goes through a security definer function
-- that checks the caller. The two settings tables are the exception: a
-- player manages their own rows.

-- Notification types (decision 1a.7): one row per type in contract 4
-- (section 6.3). always_sent = payment and cancellation types, which can't
-- be turned off (decision 4). From now on a new type is a row here, not an
-- edit of a check constraint.
create table public.notification_types (
  type text primary key,
  always_sent boolean not null
);

insert into public.notification_types (type, always_sent) values
  ('fixture_message', false),
  ('squad_post', false),
  ('booking_slot', false),
  ('booking_cancelled', true),
  ('fixture_agreed', false),
  ('match_payment_due', true),
  ('team_invite', false),
  ('booking_invite', false),
  ('venue_closed_new_bookings', true),
  ('guarantee_hold_failed', true),
  ('booking_spot_released', true),
  ('cancellation_fee_failed', true),
  ('short_game_warning', true),
  ('top_up_charged', true),
  ('debt_created', true),
  ('debt_settled', true),
  ('cash_unpaid_prompt', true),
  ('booking_cancelled_by_venue', true),
  ('venue_condition_warning', true),
  ('gipedo_result_needed', true),
  ('match_result_submitted', false),
  ('match_result_confirmed', false),
  ('match_result_disputed', false),
  ('match_reminder_24h', false),
  ('match_reminder_2h', false),
  ('match_after_game', false),
  ('motm_vote_open', false),
  ('followed_team_match', false),
  ('followed_team_result', false),
  ('followed_team_opponent_wanted', false);

-- The check constraint on notifications.type (last set by P4c,
-- 20261110190000) becomes a foreign key to the table above.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_fkey foreign key (type) references public.notification_types (type);

-- 4.1 One match per booking (null only for a league fixture played
-- without a Futty booking). Times are instants; see section 2.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.venue_bookings (id) on delete set null,
  venue_id uuid references public.venues (id),
  friendly_match_id uuid references public.friendly_matches (id),
  league_fixture_id uuid references public.league_fixtures (id),
  kind text not null check (kind in ('pickup', 'named')),
  format text not null,
  players_per_side integer not null check (players_per_side > 0),
  kickoff_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'played', 'confirmed', 'disputed', 'no_result', 'void')),
  result_deadline_at timestamptz not null,
  side_a_score integer check (side_a_score >= 0),
  side_b_score integer check (side_b_score >= 0),
  forfeit_side text check (forfeit_side in ('a', 'b')),
  forfeit_reason text check (forfeit_reason in ('pulled_out', 'no_show')),
  confirmed_at timestamptz,
  confirmed_via text check (confirmed_via in ('agreed', 'deadline', 'forfeit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > kickoff_at),
  check ((forfeit_side is null) = (forfeit_reason is null)),
  check (status <> 'confirmed' or (confirmed_at is not null and confirmed_via is not null)),
  check ((confirmed_via = 'forfeit') = (forfeit_side is not null))
);
create index matches_status_idx on public.matches (status) where status in ('scheduled', 'played');
create index matches_venue_idx on public.matches (venue_id);

-- 4.2 The two sides. The booker's side is always a.
create table public.match_sides (
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  team_id uuid references public.teams (id),
  label text not null,
  captain_profile_id uuid references public.profiles (id),
  primary key (match_id, side)
);

-- 4.3 Who plays. A player who left (left_at) isn't in the match.
create table public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  guest_name text,
  side text check (side in ('a', 'b')),
  position text,
  share_id uuid references public.booking_payment_shares (id) on delete set null,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  check ((profile_id is null) <> (guest_name is null))
);
create unique index match_players_profile_idx on public.match_players (match_id, profile_id) where profile_id is not null;
create index match_players_by_profile_idx on public.match_players (profile_id);

-- 4.4 Check-ins: by the venue's QR code or ticked by a captain.
create table public.match_attendance (
  match_id uuid not null references public.matches (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  method text not null check (method in ('qr', 'captain')),
  checked_in_by uuid not null,
  primary key (match_id, profile_id)
);

-- 4.5 At most one submission per match; the other side answers it.
create table public.match_result_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  side_a_score integer not null check (side_a_score >= 0),
  side_b_score integer not null check (side_b_score >= 0),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  response text check (response in ('accepted', 'rejected')),
  responded_by uuid,
  responded_at timestamptz,
  check ((response is null) = (responded_at is null))
);

-- 4.9a The per-match check-in code (decision 1a.1). No app role can read
-- it: get_match_check_in_code returns it to the venue's staff.
create table public.match_check_in_codes (
  match_id uuid primary key references public.matches (id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);

-- 4.10 Per-type opt-outs and quiet hours (Cyprus time). No row: on, and no
-- quiet hours.
create table public.notification_settings (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null references public.notification_types (type),
  enabled boolean not null,
  primary key (profile_id, type)
);

create table public.notification_quiet_hours (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  starts_local time not null,
  ends_local time not null,
  check (starts_local <> ends_local)
);

-- 4.11 One row per push. queued → sending (claimed by notify-send-pushes)
-- → sent / failed; held_quiet_hours until send_after, then sent like a
-- queued one, or dropped (a match reminder whose game has started).
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  push_token_id uuid not null references public.push_tokens (id) on delete cascade,
  channel text not null default 'push' check (channel in ('push', 'whatsapp')),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'held_quiet_hours', 'dropped')),
  send_after timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  check ((status = 'held_quiet_hours') <= (send_after is not null))
);
create index notification_deliveries_due_idx on public.notification_deliveries (status, send_after)
  where status in ('queued', 'held_quiet_hours');
create index notification_deliveries_notification_idx on public.notification_deliveries (notification_id);

-- updated_at on matches.
create or replace function public.matches_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger matches_touch before update on public.matches
  for each row execute function public.matches_touch();

-- A setting can't turn off an always-sent type (decision 4).
create or replace function public.notification_settings_check_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.notification_types t where t.type = new.type and t.always_sent) then
    raise exception 'always_sent_type';
  end if;
  return new;
end;
$$;
create trigger notification_settings_check_type before insert or update on public.notification_settings
  for each row execute function public.notification_settings_check_type();

-- Venue staff: the venue's owner today (section 10, question 8: staff
-- accounts come later and must be added here).
create or replace function public.is_venue_staff(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_profile_id = auth.uid());
$$;

-- Who can see a match: its players (not those who left), the booker,
-- captains of either named team, and the venue's staff.
create or replace function public.can_view_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (
        exists (select 1 from public.match_players mp
                where mp.match_id = m.id and mp.profile_id = auth.uid() and mp.left_at is null)
        or exists (select 1 from public.venue_bookings b where b.id = m.booking_id and b.created_by = auth.uid())
        or exists (select 1 from public.match_sides s join public.team_members tm on tm.team_id = s.team_id
                   where s.match_id = m.id and tm.profile_id = auth.uid() and tm.role = 'captain')
        or public.is_venue_staff(m.venue_id)
      )
  );
$$;

alter table public.notification_types enable row level security;
alter table public.matches enable row level security;
alter table public.match_sides enable row level security;
alter table public.match_players enable row level security;
alter table public.match_attendance enable row level security;
alter table public.match_result_submissions enable row level security;
alter table public.match_check_in_codes enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notification_quiet_hours enable row level security;
alter table public.notification_deliveries enable row level security;

create policy "Everyone signed in reads the notification types" on public.notification_types
  for select to authenticated using (true);
create policy "People in a match read it" on public.matches
  for select to authenticated using (public.can_view_match(id));
create policy "People in a match read its sides" on public.match_sides
  for select to authenticated using (public.can_view_match(match_id));
create policy "People in a match read its players" on public.match_players
  for select to authenticated using (public.can_view_match(match_id));
create policy "People in a match and the venue read its check-ins" on public.match_attendance
  for select to authenticated using (public.can_view_match(match_id));
create policy "People in a match read its result" on public.match_result_submissions
  for select to authenticated using (public.can_view_match(match_id));
create policy "Players manage their own notification settings" on public.notification_settings
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "Players manage their own quiet hours" on public.notification_quiet_hours
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
-- match_check_in_codes and notification_deliveries: no policies (service_role only).

revoke all on public.notification_types, public.matches, public.match_sides, public.match_players,
  public.match_attendance, public.match_result_submissions, public.match_check_in_codes,
  public.notification_settings, public.notification_quiet_hours, public.notification_deliveries
  from public, anon, authenticated;
grant select on public.notification_types, public.matches, public.match_sides, public.match_players,
  public.match_attendance, public.match_result_submissions to authenticated;
grant select, insert, update, delete on public.notification_settings, public.notification_quiet_hours to authenticated;
grant all on public.notification_types, public.matches, public.match_sides, public.match_players,
  public.match_attendance, public.match_result_submissions, public.match_check_in_codes,
  public.notification_settings, public.notification_quiet_hours, public.notification_deliveries
  to service_role;

revoke all on function public.matches_touch() from public, anon, authenticated;
revoke all on function public.notification_settings_check_type() from public, anon, authenticated;
revoke all on function public.is_venue_staff(uuid) from public, anon;
revoke all on function public.can_view_match(uuid) from public, anon;
grant execute on function public.is_venue_staff(uuid) to authenticated, service_role;
grant execute on function public.can_view_match(uuid) to authenticated, service_role;
