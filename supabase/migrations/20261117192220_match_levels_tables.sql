-- A5a: skill levels and ratings, tables (docs/specs/match-record.md decision
-- 1f, section 4.8; 05 Product section 4; 12 Playtomic section 2 rows 2-3).
--
-- Competitive or casual: matches.competitive is null until a captain chooses
-- (set_match_competitive). is_competitive = coalesce(competitive, kind =
-- 'named'): named games count for levels, pickups don't, and a pickup that
-- becomes a named game (decision 1b.1) counts unless a captain chose.
-- levels_applied_at: when apply_match_levels handled the match, so it never
-- runs twice.
--
-- No app role writes any of these tables: every write goes through the
-- functions in match_levels_functions. Levels and their history are read by
-- everyone signed in; the sign-up answers and the ratings only by their
-- owner (individual ratings are never shown, 05 section 3).

alter table public.matches
  add column competitive boolean,
  add column is_competitive boolean generated always as (coalesce(competitive, kind = 'named')) stored,
  add column levels_applied_at timestamptz;

-- Matches already settled before A5 never move levels: the update is for
-- matches confirmed from now on.
update public.matches set levels_applied_at = now() where status in ('confirmed', 'disputed', 'no_result', 'void');

-- One level per player, 1.00-7.00 (shown with one decimal; two kept so
-- small moves aren't rounded away). source: questionnaire (the five sign-up
-- questions) or default (3.0, made when a player who never answered first
-- counts in a competitive match).
create table public.player_levels (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  level numeric(4,2) not null check (level between 1 and 7),
  provisional boolean not null default true,
  reliability_pct integer not null default 0 check (reliability_pct between 0 and 100),
  competitive_matches integer not null default 0 check (competitive_matches >= 0),
  source text not null check (source in ('questionnaire', 'default')),
  updated_at timestamptz not null default now()
);

-- Every change: start (the questions, no match), result (the Elo move) and
-- ratings (the nudge, at most 0.1) per match.
create table public.player_level_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  match_id uuid references public.matches (id) on delete cascade,
  reason text not null check (reason in ('start', 'result', 'ratings')),
  level_before numeric(4,2),
  level_after numeric(4,2) not null,
  created_at timestamptz not null default now(),
  unique (profile_id, match_id, reason),
  check ((reason = 'start') = (match_id is null))
);
create index player_level_history_profile on public.player_level_history (profile_id, created_at);
create index player_level_history_match on public.player_level_history (match_id);

-- The five sign-up answers (personal: own row only).
create table public.player_level_answers (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  years_played text not null check (years_played in ('under_1', '1_3', '3_10', 'over_10')),
  highest_level text not null check (highest_level in ('kickabout', 'amateur', 'semi_pro', 'professional')),
  play_frequency text not null check (play_frequency in ('rarely', 'monthly', 'weekly', 'several_weekly')),
  position text not null check (position in ('gk', 'def', 'mid', 'fwd')),
  self_rating integer not null check (self_rating between 1 and 10),
  created_at timestamptz not null default now()
);

-- One rating per rater per player per match.
create table public.match_ratings (
  match_id uuid not null references public.matches (id) on delete cascade,
  rater_profile_id uuid not null references public.profiles (id) on delete cascade,
  rated_player_id uuid not null references public.match_players (id) on delete cascade,
  score integer not null check (score between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (match_id, rater_profile_id, rated_player_id)
);
create index match_ratings_rated on public.match_ratings (rated_player_id);

alter table public.player_levels enable row level security;
alter table public.player_level_history enable row level security;
alter table public.player_level_answers enable row level security;
alter table public.match_ratings enable row level security;

create policy "Everyone signed in reads levels" on public.player_levels
  for select to authenticated using (true);
create policy "Everyone signed in reads level history" on public.player_level_history
  for select to authenticated using (true);
create policy "Players read their own answers" on public.player_level_answers
  for select to authenticated using (profile_id = auth.uid());
create policy "Raters read their own ratings" on public.match_ratings
  for select to authenticated using (rater_profile_id = auth.uid());

revoke all on public.player_levels, public.player_level_history, public.player_level_answers, public.match_ratings
  from public, anon, authenticated;
grant select on public.player_levels, public.player_level_history, public.player_level_answers, public.match_ratings
  to authenticated;
grant all on public.player_levels, public.player_level_history, public.player_level_answers, public.match_ratings
  to service_role;
