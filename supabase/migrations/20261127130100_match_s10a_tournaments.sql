-- S10A, part 1 of 4: tournaments, their tables and the admins who run them
-- (match-record.md decision 1o; prompt S10A, decided by Panos 21 November,
-- changed 22 and 24 November; Anghelo's answers of 27 November).
--
-- 1. Admins. Founders run tournaments from an admin screen. There was no
--    admin role, so app_admins lists them: only service_role adds or
--    removes a row (Panos, in the dashboard); an admin can't make another
--    admin. is_app_admin() reads the caller, and every admin function checks
--    it on the server, never the app.
-- 2. A tournament has a name, a venue (or none), an area, a country, start
--    and end dates (optional: without them the app shows "Coming soon"),
--    the team format, max teams (16: the only structure built, 4 groups of
--    4 then fixed quarter-finals), the squad (the format's starters plus up
--    to 2 subs), the entry fee per player in cents (stored and shown only,
--    paid to the organiser outside the app: no payment, ledger or payout),
--    a registration deadline, the match length (set by the admin, not in
--    code) and a status: coming_soon (before sign-up opens), registration,
--    groups, knockout, finished.
-- 3. Teams register with a kit colour (the badge is the colour with the
--    team's initials; the same colour tokens as player kits) and a squad of
--    5 to 7 for 5-a-side. A player is in one squad per tournament. Every
--    squad change is logged (who, when, by the captain or an admin).
-- 4. Fixtures: 24 group fixtures (A-1 … D-6), then QF1–QF4, SF1, SF2 and
--    the final (F), with the scores and, for a drawn knockout game, the
--    penalty shootout. No booking: Futty books the pitches by phone.
-- 5. A tournament fixture with a kick-off time gets one match
--    (matches.tournament_fixture_id). Matches and score entries gain the
--    shootout (side_a_pens, side_b_pens); a result the organiser decides is
--    confirmed via 'organiser'.
--
-- RLS: signed-in players read tournaments, their teams and fixtures. Squads
-- and their log are read through the page's functions (a player sees his
-- own team's squad only). Nobody writes directly: every write goes through
-- the functions in the next migrations.

-- ---- 1. Admins -------------------------------------------------------------------------

create table public.app_admins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);

comment on table public.app_admins is
  'S10A: the founders who run tournaments in the app. Only service_role (the dashboard) adds or removes rows.';

alter table public.app_admins enable row level security;
revoke all on public.app_admins from public, anon, authenticated;
grant all on public.app_admins to service_role;

-- True when the caller is an admin.
create function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
         and exists (select 1 from public.app_admins a where a.profile_id = auth.uid());
$$;

-- The caller, or not_admin.
create function public.require_app_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'not_admin';
  end if;
  return auth.uid();
end;
$$;

-- ---- 2. Tournaments -------------------------------------------------------------------

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint tournaments_name_check check (btrim(name) <> ''),
  venue_id uuid references public.venues (id) on delete set null,
  area text not null constraint tournaments_area_check check (btrim(area) <> ''),
  country text not null default 'CY' constraint tournaments_country_check check (country ~ '^[A-Z]{2}$'),
  format text not null constraint tournaments_format_check
    check (format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  start_date date,
  end_date date,
  registration_deadline timestamptz,
  max_teams integer not null constraint tournaments_max_teams_check check (max_teams = 16),
  squad_subs integer not null default 2 constraint tournaments_squad_subs_check check (squad_subs between 0 and 2),
  entry_fee_cents integer not null constraint tournaments_entry_fee_cents_check check (entry_fee_cents >= 0),
  match_minutes integer not null constraint tournaments_match_minutes_check check (match_minutes between 15 and 300),
  status text not null default 'coming_soon' constraint tournaments_status_check
    check (status in ('coming_soon', 'registration', 'groups', 'knockout', 'finished')),
  champion_team_id uuid references public.teams (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournaments_dates_check check (start_date is null or end_date is null or end_date >= start_date)
);

comment on table public.tournaments is
  'S10A: tournaments run by admins (match-record.md decision 1o). entry_fee_cents is shown only, paid to the organiser outside the app.';

create table public.tournament_teams (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  kit_colour text not null constraint tournament_teams_kit_colour_check
    check (kit_colour in ('kitRed', 'kitBlue', 'kitSky', 'kitGreen', 'kitYellow', 'kitOrange', 'kitBlack', 'kitWhite')),
  group_letter text constraint tournament_teams_group_letter_check check (group_letter in ('A', 'B', 'C', 'D')),
  group_pos smallint constraint tournament_teams_group_pos_check check (group_pos between 1 and 4),
  draw_rank smallint constraint tournament_teams_draw_rank_check check (draw_rank between 1 and 4),
  registered_by uuid references public.profiles (id) on delete set null,
  registered_at timestamptz not null default now(),
  primary key (tournament_id, team_id),
  constraint tournament_teams_group_check check ((group_letter is null) = (group_pos is null))
);

create unique index tournament_teams_group_pos_key on public.tournament_teams (tournament_id, group_letter, group_pos)
  where group_letter is not null;

comment on column public.tournament_teams.draw_rank is
  'S10A: the organiser''s draw, the last group tiebreak (1 = placed highest among the teams still level).';

create table public.tournament_squads (
  tournament_id uuid not null,
  team_id uuid not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (tournament_id, profile_id),
  foreign key (tournament_id, team_id) references public.tournament_teams (tournament_id, team_id) on delete cascade
);

create index tournament_squads_team_idx on public.tournament_squads (tournament_id, team_id);

create table public.tournament_squad_changes (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team_id uuid not null,
  profile_id uuid not null,
  change text not null constraint tournament_squad_changes_change_check check (change in ('added', 'removed')),
  changed_by uuid,
  by_admin boolean not null,
  changed_at timestamptz not null default now()
);

create index tournament_squad_changes_team_idx on public.tournament_squad_changes (tournament_id, team_id);

comment on table public.tournament_squad_changes is
  'S10A: every squad change: by the captain until the registration deadline, then by an admin only.';

create table public.tournament_fixtures (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  stage text not null constraint tournament_fixtures_stage_check check (stage in ('group', 'qf', 'sf', 'final')),
  group_letter text constraint tournament_fixtures_group_letter_check check (group_letter in ('A', 'B', 'C', 'D')),
  slot text not null,
  home_team_id uuid references public.teams (id),
  away_team_id uuid references public.teams (id),
  kickoff_at timestamptz,
  status text not null default 'scheduled' constraint tournament_fixtures_status_check
    check (status in ('scheduled', 'completed')),
  home_score integer constraint tournament_fixtures_home_score_check check (home_score >= 0),
  away_score integer constraint tournament_fixtures_away_score_check check (away_score >= 0),
  home_pens integer constraint tournament_fixtures_home_pens_check check (home_pens >= 0),
  away_pens integer constraint tournament_fixtures_away_pens_check check (away_pens >= 0),
  decided_by text constraint tournament_fixtures_decided_by_check check (decided_by in ('match', 'organiser')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, slot),
  constraint tournament_fixtures_group_check check ((stage = 'group') = (group_letter is not null)),
  constraint tournament_fixtures_teams_check check (home_team_id is distinct from away_team_id or home_team_id is null),
  constraint tournament_fixtures_pens_pair_check check ((home_pens is null) = (away_pens is null)),
  constraint tournament_fixtures_pens_check
    check (home_pens is null or (stage <> 'group' and home_score = away_score and home_pens <> away_pens)),
  constraint tournament_fixtures_completed_check
    check (status <> 'completed'
           or (home_team_id is not null and away_team_id is not null and home_score is not null
               and away_score is not null and decided_by is not null
               and (stage = 'group' or home_score <> away_score or home_pens is not null)))
);

create index tournament_fixtures_tournament_idx on public.tournament_fixtures (tournament_id, stage);

comment on table public.tournament_fixtures is
  'S10A: group fixtures (A-1 … D-6) and the fixed knockout (QF1–QF4, SF1, SF2, F). A drawn knockout game has its shootout in *_pens ("AP").';

-- ---- 3. Matches -----------------------------------------------------------------------

alter table public.matches
  add column tournament_fixture_id uuid references public.tournament_fixtures (id) on delete set null,
  add column side_a_pens integer constraint matches_side_a_pens_check check (side_a_pens >= 0),
  add column side_b_pens integer constraint matches_side_b_pens_check check (side_b_pens >= 0),
  add constraint matches_pens_pair_check check ((side_a_pens is null) = (side_b_pens is null));

create unique index matches_tournament_fixture_key on public.matches (tournament_fixture_id)
  where tournament_fixture_id is not null;

alter table public.matches drop constraint matches_confirmed_via_check;
alter table public.matches add constraint matches_confirmed_via_check
  check (confirmed_via in ('agreed', 'deadline', 'forfeit', 'organiser'));

alter table public.match_score_entries
  add column side_a_pens integer constraint match_score_entries_side_a_pens_check check (side_a_pens >= 0),
  add column side_b_pens integer constraint match_score_entries_side_b_pens_check check (side_b_pens >= 0);

comment on column public.matches.side_a_pens is
  'S10A: side a''s penalties in a drawn tournament knockout match (null otherwise).';

-- ---- 4. RLS ---------------------------------------------------------------------------

alter table public.tournaments enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.tournament_squads enable row level security;
alter table public.tournament_squad_changes enable row level security;
alter table public.tournament_fixtures enable row level security;

create policy "Signed-in players read tournaments" on public.tournaments
  for select to authenticated using (true);
create policy "Signed-in players read tournament teams" on public.tournament_teams
  for select to authenticated using (true);
create policy "Signed-in players read tournament fixtures" on public.tournament_fixtures
  for select to authenticated using (true);
-- tournament_squads and tournament_squad_changes: no policies (read through
-- get_tournament, own team only).

revoke all on public.tournaments, public.tournament_teams, public.tournament_squads,
              public.tournament_squad_changes, public.tournament_fixtures from public, anon, authenticated;
grant select on public.tournaments, public.tournament_teams, public.tournament_fixtures to authenticated;
grant all on public.tournaments, public.tournament_teams, public.tournament_squads,
             public.tournament_squad_changes, public.tournament_fixtures to service_role;

-- ---- 5. Grants ------------------------------------------------------------------------

revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated, service_role;
revoke all on function public.require_app_admin() from public, anon, authenticated;
grant execute on function public.require_app_admin() to service_role;
