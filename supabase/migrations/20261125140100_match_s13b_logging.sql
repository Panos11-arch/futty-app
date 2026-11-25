-- S13B, part 2: logging after the game and match ratings from stats, without
-- positions (decided by Panos, 21 and 22 November).
--
-- Logging. Only a captain logs (the booker of a pickup; each side's captain
-- in a named game), from kickoff until result_deadline_at, in one call:
-- log_match_result(score, stats). The stats are per player: goals, assists
-- (optional: a goal can have none) and each side's own goals.
--   * Which sides he writes: match_side_writer, as before. A pickup's booker
--     (Bibs v Non-bibs, or the same captain on both halves) writes both
--     sides; in a named game each captain writes only his own side. The
--     server refuses goals or assists for any player outside the sides he
--     writes (not_your_player).
--   * A side's goals plus own goals equal its score (score_mismatch); its
--     assists are never more than its score (too_many_assists).
--   * One captain (a pickup): his Confirm makes the result final.
--   * Two captains (a named game): each enters both scores. The first
--     matching pair confirms the match. A pair that differs is a failed try:
--     both captains are told (match_score_mismatch) and may change their
--     score; after match_score_tries (3) failed tries the match is disputed.
--     A captain who changes his own side's score sends his side's stats
--     again (stats_required); changing only the other side's keeps them.
--   * At result_deadline_at (match_jobs_tick): two different scores →
--     disputed; one captain's score → confirmed (deadline), as before; none
--     → no_result.
--   * Corrections: set_match_stats, by the same captains, for 24 hours after
--     confirmation, as before. Two captains' agreed score is final; a lone
--     captain (both sides his) can correct the score too in that window
--     (decided by Anghelo 25 November), except for a Losers pay match,
--     whose money settles from it.
--   * Levels like Playtomic (decided by Panos 25 November, decision 1l
--     item 11): in a Competitive game, a lone captain's score is checked by
--     the players who played on the side he isn't on (everyone who played
--     but him, if he didn't): "Check the score" (match_score_check), Accept
--     or Reject (respond_to_match_score). The first answer settles it; no
--     answer within 24 hours counts as accepted; an accepted score is
--     locked (score_locked). A Reject tells him (match_score_rejected); a
--     score correction sends the card again and restarts the 24 hours.
--     Still rejected when his correction window ends: no level moves
--     (apply_match_levels). No card when the game is Friendly or a side has
--     no Futty player who played (no level could move).
--   * match_result_submissions keeps one row per match for every function
--     that already reads it (sides lock, reminders, post-match offers, the
--     settlement view): the first score logged, answered "accepted" on
--     confirmation and "rejected" on a dispute.
--
-- Ratings. Every player who checked in (decision 1b.2) gets a rating for a
-- confirmed match that isn't a forfeit, the same formula for everyone (no
-- positions), with every weight in app_rules:
--   6.5; win +0.6, draw +0.2, loss −0.3; each goal +0.8; each assist +0.5;
--   clean sheet +0.5; each goal conceded −0.1, at most −1.0; Man of the
--   Match +0.3 (once voting has closed; ties share it); limited to
--   3.0–10.0, one decimal.
-- It is computed on confirmation, after every correction and once voting
-- closes (match_jobs_tick), and replaces the 1–10 vote ratings everywhere
-- they were read (match_rating_shown: season averages, Team of the Week,
-- the match page). The vote ratings stay in match_ratings, unused.
-- Clean sheets and goals conceded come from the score.
--
-- Removed from the app (rows kept): submit_match_result,
-- respond_to_match_result, set_match_goals, rate_match_player and
-- get_match_ratings are no longer granted to authenticated.
--
-- Re-created from their latest definitions, with only these changes:
-- match_rating_shown and the view match_stat_players (assists from
-- match_assists too), both from 20261118140000_match_stats_decisions.sql;
-- get_match_page (assists and ratings) from 20261112154127_match_page.sql;
-- match_jobs_tick from 20261118184516_match_streaks.sql.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

alter table public.app_rules
  add column rating_start numeric(4,2) not null default 6.5,
  add column rating_win numeric(4,2) not null default 0.6,
  add column rating_draw numeric(4,2) not null default 0.2,
  add column rating_loss numeric(4,2) not null default -0.3,
  add column rating_goal numeric(4,2) not null default 0.8,
  add column rating_assist numeric(4,2) not null default 0.5,
  add column rating_clean_sheet numeric(4,2) not null default 0.5,
  add column rating_conceded numeric(4,2) not null default -0.1,
  add column rating_conceded_max numeric(4,2) not null default -1.0,
  add column rating_motm numeric(4,2) not null default 0.3,
  add column rating_min numeric(4,2) not null default 3.0,
  add column rating_max numeric(4,2) not null default 10.0,
  add column match_score_tries integer not null default 3 check (match_score_tries > 0),
  add constraint app_rules_rating_range check (rating_min < rating_max);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.matches
  add column score_tries integer not null default 0,
  add column ratings_final_at timestamptz,
  -- A lone captain's "Check the score" card: pending from score_check_since
  -- (the log or the latest score correction) for 24 hours; score_check_by
  -- answered it (null with accepted: nobody answered in 24 hours).
  add column score_check text check (score_check in ('pending', 'accepted', 'rejected')),
  add column score_check_since timestamptz,
  add column score_check_by uuid references public.profiles (id) on delete set null,
  add column score_check_at timestamptz;

create index matches_score_check_pending on public.matches (score_check_since) where score_check = 'pending';

-- Each captain's current score for the match (one per side he captains).
create table public.match_score_entries (
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  entered_by uuid not null references public.profiles (id),
  side_a_score integer not null check (side_a_score >= 0),
  side_b_score integer not null check (side_b_score >= 0),
  entered_at timestamptz not null default now(),
  primary key (match_id, side)
);

-- Assists per player (a tally: the logging screens don't pair an assist
-- with a goal). Older matches keep theirs in match_goals.assist_player_id.
create table public.match_assists (
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  player_id uuid not null references public.match_players (id) on delete cascade,
  assists integer not null check (assists > 0),
  entered_by uuid not null,
  primary key (match_id, player_id)
);

-- A player's match rating (S13B), one decimal.
create table public.match_player_ratings (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.match_players (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  rating numeric(3,1) not null check (rating between 1 and 10),
  computed_at timestamptz not null default now(),
  primary key (match_id, player_id)
);
create index match_player_ratings_profile_idx on public.match_player_ratings (profile_id);

alter table public.match_score_entries enable row level security;
alter table public.match_assists enable row level security;
alter table public.match_player_ratings enable row level security;
-- A captain's score is read through get_match_log only (the other captain
-- sees it only after entering his own).
revoke all on public.match_score_entries from public, anon, authenticated;
grant all on public.match_score_entries to service_role;
create policy "Everyone who can see the match page reads its assists" on public.match_assists
  for select to authenticated using (public.match_page_visible(match_id));
create policy "Everyone who can see the match page reads its ratings" on public.match_player_ratings
  for select to authenticated using (public.match_page_visible(match_id));
revoke all on public.match_assists, public.match_player_ratings from public, anon, authenticated;
grant select on public.match_assists, public.match_player_ratings to authenticated;
grant all on public.match_assists, public.match_player_ratings to service_role;

insert into public.notification_types (type, always_sent) values
  ('match_score_mismatch', false),
  ('match_score_check', false),
  ('match_score_rejected', false)
on conflict (type) do nothing;

-- A score still waiting for its answer becomes that captain's entry.
insert into public.match_score_entries (match_id, side, entered_by, side_a_score, side_b_score, entered_at)
select s.match_id, s.side, s.submitted_by, s.side_a_score, s.side_b_score, s.submitted_at
from public.match_result_submissions s
join public.matches m on m.id = s.match_id
where s.response is null and m.status in ('scheduled', 'played')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Ratings
-- ---------------------------------------------------------------------------

-- Recomputes every rating of p_match_id from its score, goals, assists and
-- (once voting has closed, at p_now) Man of the Match. A match that isn't
-- confirmed, or is a forfeit, has none.
create or replace function public.match_compute_ratings(p_match_id uuid, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  r public.app_rules := public.app_rules_now();
  v_count integer;
begin
  select * into v_match from public.matches where id = p_match_id;
  delete from public.match_player_ratings where match_id = p_match_id;
  if v_match.id is null or v_match.status <> 'confirmed' or v_match.forfeit_side is not null
     or v_match.side_a_score is null or v_match.side_b_score is null then
    return 0;
  end if;

  with players as (
    select mp.id, mp.profile_id, mp.side,
           case mp.side when 'a' then v_match.side_a_score else v_match.side_b_score end as goals_for,
           case mp.side when 'a' then v_match.side_b_score else v_match.side_a_score end as goals_against
    from public.match_players mp
    join public.match_attendance a on a.match_id = mp.match_id and a.profile_id = mp.profile_id
    where mp.match_id = p_match_id and mp.profile_id is not null and mp.left_at is null and mp.side in ('a', 'b')
  ),
  tally as (
    select v.nominee_player_id, count(*) as votes
    from public.motm_votes v where v.match_id = p_match_id
    group by v.nominee_player_id
  ),
  stats as (
    select p.*,
           (select count(*) from public.match_goals g where g.match_id = p_match_id and g.scorer_player_id = p.id) as goals,
           coalesce((select x.assists from public.match_assists x where x.match_id = p_match_id and x.player_id = p.id), 0)
             + (select count(*) from public.match_goals g where g.match_id = p_match_id and g.assist_player_id = p.id) as assists,
           (p_now >= v_match.confirmed_at + interval '24 hours'
            and exists (select 1 from tally t where t.nominee_player_id = p.id
                        and t.votes = (select max(votes) from tally))) as motm
    from players p
  )
  insert into public.match_player_ratings (match_id, player_id, profile_id, rating, computed_at)
  select p_match_id, s.id, s.profile_id,
         round(least(r.rating_max, greatest(r.rating_min,
           r.rating_start
           + case sign(s.goals_for - s.goals_against) when 1 then r.rating_win when 0 then r.rating_draw else r.rating_loss end
           + s.goals * r.rating_goal
           + s.assists * r.rating_assist
           + case when s.goals_against = 0 then r.rating_clean_sheet else 0 end
           + greatest(s.goals_against * r.rating_conceded, r.rating_conceded_max)
           + case when s.motm then r.rating_motm else 0 end)), 1),
         p_now
  from stats s;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A player's match rating, shown to everyone who can see the match (S13B):
-- the match is confirmed and not a forfeit. Replaces the 1–10 vote rating
-- (decision 1f.4), so season averages and Team of the Week read it. The
-- venue page's top players (venue_highlights, 20261124200100) read it too:
-- a rating counts once the match is confirmed, with no 24-hour wait and no
-- 3-vote minimum (that file's header still describes the vote rule).
create or replace function public.match_rating_shown(p_match_id uuid, p_player_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.rating
  from public.match_player_ratings r
  join public.matches m on m.id = r.match_id
  where r.match_id = p_match_id and r.player_id = p_player_id
    and m.status = 'confirmed' and m.forfeit_side is null;
$$;

-- As 20261118140000, with assists also from match_assists (same columns).
create or replace view public.match_stat_players as
select
  p.profile_id,
  p.match_id,
  mp.id as player_id,
  p.kickoff_at,
  extract(year from p.kickoff_at at time zone 'Asia/Nicosia')::integer as season_year,
  lf.league_id,
  p.venue_id,
  nullif(lower(btrim(v.city)), '') as city_key,
  p.side,
  p.team_id,
  p.result,
  p.forfeit_side is not null as is_forfeit,
  public.stats_side_goals(p.goals_for, p.forfeit_side, p.side, true) as team_goals_for,
  public.stats_side_goals(p.goals_against, p.forfeit_side, p.side, false) as team_goals_against,
  case
    when mp.position = 'gk' then 'gk'
    when mp.position like 'd%' then 'def'
    when mp.position like 'm%' then 'mid'
    when mp.position like 'f%' then 'fwd'
    else 'outfield'
  end as position_group,
  (select count(*) from public.match_goals g where g.match_id = p.match_id and g.scorer_player_id = mp.id)::integer as goals,
  ((select count(*) from public.match_goals g where g.match_id = p.match_id and g.assist_player_id = mp.id)
   + coalesce((select x.assists from public.match_assists x where x.match_id = p.match_id and x.player_id = mp.id), 0))::integer
    as assists,
  (m.forfeit_side is null and now() >= m.confirmed_at + interval '24 hours'
   and exists (
     with tally as (
       select x.nominee_player_id, count(*) as votes
       from public.motm_votes x where x.match_id = p.match_id
       group by x.nominee_player_id
     )
     select 1 from tally t
     where t.nominee_player_id = mp.id and t.votes = (select max(votes) from tally))) as motm,
  public.match_rating_shown(p.match_id, mp.id) as rating
from public.match_form_players p
join public.matches m on m.id = p.match_id
join public.match_players mp on mp.match_id = p.match_id and mp.profile_id = p.profile_id
left join public.venues v on v.id = p.venue_id
left join public.league_fixtures lf on lf.id = m.league_fixture_id;

-- ---------------------------------------------------------------------------
-- Writing a side's stats
-- ---------------------------------------------------------------------------

-- Whether captains may still tick players in or out (as
-- captain_mark_attendance): not void, from 60 minutes before kickoff until
-- the result deadline.
create or replace function public.match_ticks_open(p_match public.matches)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_match.status <> 'void'
     and now() >= p_match.kickoff_at - interval '60 minutes'
     and now() < p_match.result_deadline_at;
$$;

-- Replaces p_side's goals and assists from p_stats
-- ({"players": [{"playerId", "goals", "assists", "played"}], "ownGoals": n}).
-- Each player must be on that side and still in the match; goals plus own
-- goals equal p_score; assists are at most p_score. A player marked
-- "Didn't play" (played false), or one with no check-in once the ticks have
-- closed, can't score or assist (player_did_not_play).
create or replace function public.match_write_side_stats(p_match_id uuid, p_side text, p_stats jsonb, p_score integer,
                                                         p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player jsonb;
  v_id uuid;
  v_goals integer;
  v_assists integer;
  v_own integer;
  v_ids uuid[] := '{}';
  v_goal_counts integer[] := '{}';
  v_assist_counts integer[] := '{}';
  v_sort integer := 0;
  v_ticks_open boolean;
  i integer;
  j integer;
begin
  if p_stats is null or jsonb_typeof(p_stats) <> 'object'
     or (p_stats ? 'players' and jsonb_typeof(p_stats -> 'players') <> 'array') then
    raise exception 'invalid_stats';
  end if;
  v_ticks_open := public.match_ticks_open((select m from public.matches m where m.id = p_match_id));
  begin
    v_own := coalesce((p_stats ->> 'ownGoals')::integer, 0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_stats';
  end;
  if v_own < 0 then
    raise exception 'invalid_stats';
  end if;

  for v_player in select e from jsonb_array_elements(coalesce(p_stats -> 'players', '[]')) e loop
    if jsonb_typeof(v_player) <> 'object' then
      raise exception 'invalid_stats';
    end if;
    begin
      v_id := (v_player ->> 'playerId')::uuid;
      v_goals := coalesce((v_player ->> 'goals')::integer, 0);
      v_assists := coalesce((v_player ->> 'assists')::integer, 0);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_stats';
    end;
    if v_id is null or v_goals < 0 or v_assists < 0 or v_id = any (v_ids) then
      raise exception 'invalid_stats';
    end if;
    if not public.match_player_on_side(p_match_id, v_id, p_side) then
      raise exception 'not_your_player';
    end if;
    if v_player ? 'played' and jsonb_typeof(v_player -> 'played') <> 'boolean' then
      raise exception 'invalid_stats';
    end if;
    if v_goals + v_assists > 0
       and (v_player -> 'played' = 'false'::jsonb
            or (not v_ticks_open and exists (
                  select 1 from public.match_players mp
                  where mp.id = v_id and mp.profile_id is not null
                    and not exists (select 1 from public.match_attendance a
                                    where a.match_id = p_match_id and a.profile_id = mp.profile_id)))) then
      raise exception 'player_did_not_play';
    end if;
    v_ids := v_ids || v_id;
    v_goal_counts := v_goal_counts || v_goals;
    v_assist_counts := v_assist_counts || v_assists;
  end loop;

  if coalesce((select sum(x) from unnest(v_goal_counts) x), 0) + v_own <> p_score then
    raise exception 'score_mismatch';
  end if;
  if coalesce((select sum(x) from unnest(v_assist_counts) x), 0) > p_score then
    raise exception 'too_many_assists';
  end if;

  delete from public.match_goals where match_id = p_match_id and side = p_side;
  delete from public.match_assists where match_id = p_match_id and side = p_side;
  for i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
    for j in 1 .. v_goal_counts[i] loop
      v_sort := v_sort + 1;
      insert into public.match_goals (match_id, side, sort, scorer_player_id, entered_by)
      values (p_match_id, p_side, v_sort, v_ids[i], p_uid);
    end loop;
    if v_assist_counts[i] > 0 then
      insert into public.match_assists (match_id, side, player_id, assists, entered_by)
      values (p_match_id, p_side, v_ids[i], v_assist_counts[i], p_uid);
    end if;
  end loop;
  for j in 1 .. v_own loop
    v_sort := v_sort + 1;
    insert into public.match_goals (match_id, side, sort, scorer_player_id, entered_by)
    values (p_match_id, p_side, v_sort, null, p_uid);
  end loop;
end;
$$;

-- The captain confirms who played (decision 1l, 25 November): every player
-- of p_side counts as played unless p_stats marks them played false. A
-- played player without a check-in is ticked in (method 'captain', as
-- captain_mark_attendance); a player who didn't play loses only a captain
-- tick. A QR or venue check-in is never removed (cannot_remove_check_in),
-- nor the tick of a player who has voted for Man of the Match
-- (check_in_used). Ticks change only while match_ticks_open
-- (check_in_closed); a flag that changes nothing always passes. Guests have
-- no check-in.
create or replace function public.match_write_side_attendance(p_match_id uuid, p_side text, p_stats jsonb, p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open boolean := public.match_ticks_open((select m from public.matches m where m.id = p_match_id));
  v_out uuid[];
  r record;
begin
  select coalesce(array_agg((e ->> 'playerId')::uuid), '{}') into v_out
  from jsonb_array_elements(coalesce(p_stats -> 'players', '[]')) e
  where e -> 'played' = 'false'::jsonb;

  for r in
    select mp.id, mp.profile_id, a.method
    from public.match_players mp
    left join public.match_attendance a on a.match_id = mp.match_id and a.profile_id = mp.profile_id
    where mp.match_id = p_match_id and mp.side = p_side and mp.left_at is null and mp.profile_id is not null
    order by mp.id
  loop
    if not (r.id = any (v_out)) then
      if r.method is null then
        if not v_open then
          raise exception 'check_in_closed';
        end if;
        insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
        values (p_match_id, r.profile_id, 'captain', p_uid)
        on conflict (match_id, profile_id) do nothing;
      end if;
    elsif r.method is not null then
      if r.method <> 'captain' then
        raise exception 'cannot_remove_check_in';
      end if;
      if exists (select 1 from public.motm_votes v where v.match_id = p_match_id and v.voter_profile_id = r.profile_id) then
        raise exception 'check_in_used';
      end if;
      if not v_open then
        raise exception 'check_in_closed';
      end if;
      delete from public.match_attendance where match_id = p_match_id and profile_id = r.profile_id;
    end if;
  end loop;
end;
$$;

-- p_side's goals (including own goals) already logged.
create or replace function public.match_side_goal_count(p_match_id uuid, p_side text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.match_goals where match_id = p_match_id and side = p_side;
$$;

-- Confirms p_match_id with p_a:p_b (via 'agreed' or 'deadline'), answers
-- its submission row, tells everyone and computes the ratings.
create or replace function public.match_confirm_result(p_match_id uuid, p_a integer, p_b integer, p_via text,
                                                       p_at timestamptz, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.matches
  set status = 'confirmed', side_a_score = p_a, side_b_score = p_b, confirmed_via = p_via, confirmed_at = p_at
  where id = p_match_id;
  update public.match_result_submissions
  set response = 'accepted', responded_by = coalesce(responded_by, p_by), responded_at = coalesce(responded_at, p_at)
  where match_id = p_match_id and response is null;
  perform public.match_notify(p_match_id, 'match_result_confirmed', 'Result confirmed',
    public.match_score_line(p_match_id, p_a, p_b), array['a', 'b'], true, p_by);
  perform public.match_compute_ratings(p_match_id, p_at);
end;
$$;

-- The match is disputed: it won't count (no ratings, levels or power
-- ranking; in a league the organiser decides).
create or replace function public.match_dispute_result(p_match_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.matches set status = 'disputed' where id = p_match_id;
  update public.match_result_submissions
  set response = 'rejected', responded_at = coalesce(responded_at, p_at)
  where match_id = p_match_id and response is null;
  perform public.match_notify(p_match_id, 'match_result_disputed', 'Result disputed',
    'The captains'' scores didn''t match. The match won''t count.', array['a', 'b'], true, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Checking a lone captain's score (decision 1l item 11)
-- ---------------------------------------------------------------------------

-- The card's state at p_now: a pending card 24 hours old counts as accepted.
create or replace function public.match_score_check_state(p_match public.matches, p_now timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_match.score_check = 'pending' and p_now >= p_match.score_check_since + interval '24 hours'
              then 'accepted' else p_match.score_check end;
$$;

-- Who may check p_match_id's score: every player who played (a profile with
-- a check-in, on a side, not left) except the booker (the captain who
-- logged it) and, if he played, his side. Nobody unless both sides have a
-- Futty player who played (otherwise no level can move).
create or replace function public.match_score_checkers(p_match_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with booker as (
    select e.entered_by as id from public.match_score_entries e where e.match_id = p_match_id and e.side = 'a'
  ),
  played as (
    select mp.profile_id, mp.side
    from public.match_players mp
    join public.match_attendance a on a.match_id = mp.match_id and a.profile_id = mp.profile_id
    where mp.match_id = p_match_id and mp.left_at is null and mp.profile_id is not null and mp.side in ('a', 'b')
  )
  select p.profile_id
  from played p
  where exists (select 1 from played x where x.side = 'a')
    and exists (select 1 from played x where x.side = 'b')
    and p.profile_id is distinct from (select b.id from booker b)
    and p.side is distinct from (select x.side from played x join booker b on b.id = x.profile_id)
  order by p.profile_id;
$$;

-- Opens (or opens again) the card for the score p_match_id has now: answers
-- cleared, 24 hours from now, a push to each checker. A Friendly game, or
-- one with nobody to check, has no card.
create or replace function public.match_open_score_check(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_to uuid[];
begin
  select * into v_match from public.matches where id = p_match_id;
  select array_agg(c) into v_to from public.match_score_checkers(p_match_id) c;
  if not v_match.is_competitive or v_to is null then
    update public.matches
    set score_check = null, score_check_since = null, score_check_by = null, score_check_at = null
    where id = p_match_id;
    return;
  end if;
  update public.matches
  set score_check = 'pending', score_check_since = now(), score_check_by = null, score_check_at = null
  where id = p_match_id;
  perform public.send_notification(c, 'match_score_check', jsonb_build_object(
    'title', 'Check the score',
    'body', public.match_score_line(p_match_id, v_match.side_a_score, v_match.side_b_score) || '. Accept or reject it.',
    'matchId', p_match_id))
  from unnest(v_to) c;
end;
$$;

-- A player answers the card: p_accept true (Accept) or false (Reject). The
-- first answer settles it; later ones (or any after 24 hours) are ignored.
-- A Reject tells the booker. Returns {status, ignored}.
create or replace function public.respond_to_match_score(p_match_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_state text;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if not public.match_is_member(p_match_id, v_uid) then
    raise exception 'not_in_match';
  end if;
  if p_accept is null then
    raise exception 'invalid_answer';
  end if;
  if not exists (select 1 from public.match_score_checkers(p_match_id) c where c = v_uid) then
    raise exception 'cannot_check_score';
  end if;
  v_state := public.match_score_check_state(v_match);
  if v_state is distinct from 'pending' then
    return jsonb_build_object('status', coalesce(v_state, 'none'), 'ignored', true);
  end if;

  update public.matches
  set score_check = case when p_accept then 'accepted' else 'rejected' end, score_check_by = v_uid, score_check_at = now()
  where id = p_match_id;
  if not p_accept then
    perform public.send_notification(e.entered_by, 'match_score_rejected', jsonb_build_object(
      'title', 'Your score was rejected',
      'body', 'Check it and fix it.',
      'matchId', p_match_id))
    from public.match_score_entries e where e.match_id = p_match_id and e.side = 'a';
  end if;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'rejected' end, 'ignored', false);
end;
$$;

-- The caller's open "Check the score" cards, for Home.
create or replace function public.get_my_scores_to_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'matchId', m.id,
           'kickoffAt', m.kickoff_at,
           'labelA', (select ms.label from public.match_sides ms where ms.match_id = m.id and ms.side = 'a'),
           'labelB', (select ms.label from public.match_sides ms where ms.match_id = m.id and ms.side = 'b'),
           'sideAScore', m.side_a_score,
           'sideBScore', m.side_b_score,
           'checkUntil', m.score_check_since + interval '24 hours')
         order by m.score_check_since desc, m.id), '[]')
  from public.matches m
  where m.score_check = 'pending' and m.status = 'confirmed' and now() < m.score_check_since + interval '24 hours'
    and exists (select 1 from public.match_score_checkers(m.id) c where c = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- What the app calls
-- ---------------------------------------------------------------------------

-- Logs the score and the caller's sides' stats. p_stats:
--   {"a": {"players": [{"playerId", "goals", "assists"}], "ownGoals": n}, "b": {...}}
-- with only the sides the caller writes. Returns {status, tries, maxTries}.
create or replace function public.log_match_result(p_match_id uuid, p_side_a_score integer, p_side_b_score integer,
                                                   p_stats jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_sides text[];
  v_side text;
  v_other text;
  v_mine public.match_score_entries;
  v_theirs public.match_score_entries;
  v_own_score integer;
  v_own_changed boolean;
  v_numbers_changed boolean;
  v_max integer := (public.app_rules_now()).match_score_tries;
  s text;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  v_sides := public.match_side_writer(p_match_id, v_uid);
  if v_sides is null then
    if public.match_is_member(p_match_id, v_uid) then
      raise exception 'not_captain';
    end if;
    raise exception 'not_in_match';
  end if;
  if v_match.status not in ('scheduled', 'played') or now() < v_match.kickoff_at or now() >= v_match.result_deadline_at then
    raise exception 'result_window_closed';
  end if;
  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'invalid_score';
  end if;
  if p_stats is null or jsonb_typeof(p_stats) <> 'object' then
    raise exception 'invalid_stats';
  end if;
  -- Stats for a side he doesn't write: those players aren't his.
  for s in select k from jsonb_object_keys(p_stats) k loop
    if s not in ('a', 'b') then
      raise exception 'invalid_stats';
    end if;
    if not s = any (v_sides) then
      raise exception 'not_your_player';
    end if;
  end loop;

  -- One captain writes both sides: his score is the result.
  if cardinality(v_sides) = 2 then
    if not (p_stats ? 'a' and p_stats ? 'b') then
      raise exception 'stats_required';
    end if;
    perform public.match_write_side_stats(p_match_id, 'a', p_stats -> 'a', p_side_a_score, v_uid);
    perform public.match_write_side_stats(p_match_id, 'b', p_stats -> 'b', p_side_b_score, v_uid);
    perform public.match_write_side_attendance(p_match_id, 'a', p_stats -> 'a', v_uid);
    perform public.match_write_side_attendance(p_match_id, 'b', p_stats -> 'b', v_uid);
    insert into public.match_score_entries (match_id, side, entered_by, side_a_score, side_b_score)
    values (p_match_id, 'a', v_uid, p_side_a_score, p_side_b_score)
    on conflict (match_id, side) do update
    set entered_by = excluded.entered_by, side_a_score = excluded.side_a_score, side_b_score = excluded.side_b_score,
        entered_at = now();
    insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
    values (p_match_id, 'a', p_side_a_score, p_side_b_score, v_uid)
    on conflict (match_id) do nothing;
    update public.matches set score_tries = score_tries + 1 where id = p_match_id;
    perform public.match_confirm_result(p_match_id, p_side_a_score, p_side_b_score, 'agreed', now(), v_uid);
    -- The players who played check it for levels (decision 1l item 11).
    perform public.match_open_score_check(p_match_id);
    return jsonb_build_object('status', 'confirmed', 'tries', v_match.score_tries + 1, 'maxTries', v_max);
  end if;

  -- Two captains: each logs both scores and his own side's stats.
  v_side := v_sides[1];
  v_other := case v_side when 'a' then 'b' else 'a' end;
  v_own_score := case v_side when 'a' then p_side_a_score else p_side_b_score end;
  select * into v_mine from public.match_score_entries where match_id = p_match_id and side = v_side;
  v_own_changed := v_mine.match_id is null
                   or v_own_score <> case v_side when 'a' then v_mine.side_a_score else v_mine.side_b_score end;
  v_numbers_changed := v_mine.match_id is null
                       or (v_mine.side_a_score, v_mine.side_b_score) <> (p_side_a_score, p_side_b_score);

  if p_stats ? v_side then
    perform public.match_write_side_stats(p_match_id, v_side, p_stats -> v_side, v_own_score, v_uid);
    perform public.match_write_side_attendance(p_match_id, v_side, p_stats -> v_side, v_uid);
  elsif v_own_changed or public.match_side_goal_count(p_match_id, v_side) <> v_own_score then
    raise exception 'stats_required';
  end if;

  insert into public.match_score_entries (match_id, side, entered_by, side_a_score, side_b_score)
  values (p_match_id, v_side, v_uid, p_side_a_score, p_side_b_score)
  on conflict (match_id, side) do update
  set entered_by = excluded.entered_by, side_a_score = excluded.side_a_score, side_b_score = excluded.side_b_score,
      entered_at = now();
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
  values (p_match_id, v_side, p_side_a_score, p_side_b_score, v_uid)
  on conflict (match_id) do nothing;

  select * into v_theirs from public.match_score_entries where match_id = p_match_id and side = v_other;
  if v_theirs.match_id is null then
    -- The other captain logs his.
    if v_mine.match_id is null then
      perform public.match_notify(p_match_id, 'match_result_submitted', 'Log the score',
        'The other captain logged the score. Add yours.', array[v_other], false, v_uid);
    end if;
    return jsonb_build_object('status', 'waiting', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;
  if not v_numbers_changed then
    -- Only his stats changed: no new try.
    return jsonb_build_object('status', 'mismatch', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;

  update public.matches set score_tries = score_tries + 1 where id = p_match_id
  returning * into v_match;
  if (v_theirs.side_a_score, v_theirs.side_b_score) = (p_side_a_score, p_side_b_score) then
    perform public.match_confirm_result(p_match_id, p_side_a_score, p_side_b_score, 'agreed', now(), v_uid);
    return jsonb_build_object('status', 'confirmed', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;
  if v_match.score_tries >= v_max then
    perform public.match_dispute_result(p_match_id, now());
    return jsonb_build_object('status', 'disputed', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;
  perform public.send_notification(c.captain, 'match_score_mismatch', jsonb_build_object(
    'title', 'Scores don''t match',
    'body', format('Check the score with the other captain. %s of %s tries left.', v_max - v_match.score_tries, v_max),
    'matchId', p_match_id))
  from (select distinct coalesce(e.entered_by, ms.captain_profile_id) as captain
        from public.match_sides ms
        left join public.match_score_entries e on e.match_id = ms.match_id and e.side = ms.side
        where ms.match_id = p_match_id) c
  where c.captain is not null;
  return jsonb_build_object('status', 'mismatch', 'tries', v_match.score_tries, 'maxTries', v_max);
end;
$$;

-- Corrects the caller's sides' goals and assists (and who played), for 24
-- hours after the result was confirmed; the ratings follow. A lone captain
-- (both sides his) may also send a new score, p_side_a_score and
-- p_side_b_score (decided by Anghelo 25 November): a side whose score
-- changed must be sent with goals that add up to it; the other side's stats
-- stay. Two captains' agreed score is final (score_locked), and so is a
-- Losers pay match's, whose money settles from it (score_locked). A changed
-- score tells every player "Score corrected" (match_result_confirmed, so the
-- same preference); levels, applied once the game is final, read the
-- corrected score. Levels like Playtomic (decision 1l item 11): once the
-- players accepted the score (or 24 hours passed without an answer) it is
-- locked (score_locked); a corrected score sends "Check the score" again,
-- answers cleared, 24 hours from now.
create or replace function public.set_match_stats(p_match_id uuid, p_stats jsonb,
                                                  p_side_a_score integer default null,
                                                  p_side_b_score integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_sides text[];
  v_score_changed boolean := false;
  s text;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  v_sides := public.match_side_writer(p_match_id, v_uid);
  if v_sides is null then
    if public.match_is_member(p_match_id, v_uid) then
      raise exception 'not_captain';
    end if;
    raise exception 'not_in_match';
  end if;
  if v_match.status <> 'confirmed' or v_match.forfeit_side is not null then
    raise exception 'match_not_confirmed';
  end if;
  if now() >= v_match.confirmed_at + interval '24 hours' then
    raise exception 'scorers_window_closed';
  end if;
  if p_stats is null or jsonb_typeof(p_stats) <> 'object' or p_stats = '{}'::jsonb then
    raise exception 'invalid_stats';
  end if;

  if p_side_a_score is not null or p_side_b_score is not null then
    if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
      raise exception 'invalid_score';
    end if;
    v_score_changed := (p_side_a_score, p_side_b_score) <> (v_match.side_a_score, v_match.side_b_score);
  end if;
  if v_score_changed then
    if cardinality(v_sides) < 2
       or public.match_score_check_state(v_match) = 'accepted'
       or exists (select 1 from public.venue_bookings b where b.id = v_match.booking_id and b.losers_pay) then
      raise exception 'score_locked';
    end if;
    if (p_side_a_score <> v_match.side_a_score and not p_stats ? 'a')
       or (p_side_b_score <> v_match.side_b_score and not p_stats ? 'b') then
      raise exception 'stats_required';
    end if;
    update public.matches set side_a_score = p_side_a_score, side_b_score = p_side_b_score
    where id = p_match_id
    returning * into v_match;
    update public.match_score_entries set side_a_score = p_side_a_score, side_b_score = p_side_b_score
    where match_id = p_match_id and side = 'a';
  end if;

  for s in select k from jsonb_object_keys(p_stats) k loop
    if s not in ('a', 'b') then
      raise exception 'invalid_stats';
    end if;
    if not s = any (v_sides) then
      raise exception 'not_your_player';
    end if;
    perform public.match_write_side_stats(p_match_id, s, p_stats -> s,
      case s when 'a' then v_match.side_a_score else v_match.side_b_score end, v_uid);
    perform public.match_write_side_attendance(p_match_id, s, p_stats -> s, v_uid);
  end loop;
  perform public.match_compute_ratings(p_match_id);

  if v_score_changed then
    perform public.match_notify(p_match_id, 'match_result_confirmed', 'Score corrected',
      public.match_score_line(p_match_id, p_side_a_score, p_side_b_score), array['a', 'b'], true, v_uid);
    perform public.match_open_score_check(p_match_id);
  end if;
end;
$$;

-- Everything the logging screens need, for a member of the match (or anyone
-- signed in once it is confirmed). The other captain's score is shown only
-- once the caller has logged his own.
create or replace function public.get_match_log(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_sides text[];
  v_my_side text;
  v_mine public.match_score_entries;
  v_theirs public.match_score_entries;
  v_open boolean;
  v_correct boolean;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or v_uid is null or not public.match_page_visible(p_match_id) then
    raise exception 'match_not_found';
  end if;
  v_sides := coalesce(public.match_side_writer(p_match_id, v_uid), '{}');
  v_my_side := case when cardinality(v_sides) = 2 then 'a' else v_sides[1] end;
  if v_my_side is not null then
    select * into v_mine from public.match_score_entries where match_id = p_match_id and side = v_my_side;
    if v_mine.match_id is not null and cardinality(v_sides) = 1 then
      select * into v_theirs from public.match_score_entries
      where match_id = p_match_id and side = case v_my_side when 'a' then 'b' else 'a' end;
    end if;
  end if;
  v_open := cardinality(v_sides) > 0 and v_match.status in ('scheduled', 'played')
            and now() >= v_match.kickoff_at and now() < v_match.result_deadline_at;
  v_correct := cardinality(v_sides) > 0 and v_match.status = 'confirmed' and v_match.forfeit_side is null
               and now() < v_match.confirmed_at + interval '24 hours';

  return jsonb_build_object(
    'matchId', v_match.id,
    'status', v_match.status,
    'kind', v_match.kind,
    'kickoffAt', v_match.kickoff_at,
    'kickoffLocal', to_char(v_match.kickoff_at at time zone 'Asia/Nicosia', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'venueName', (select v.name from public.venues v where v.id = v_match.venue_id),
    'pitchName', case when v_match.booking_id is not null then public.booking_pitch_label(v_match.booking_id) end,
    'sides', (select coalesce(jsonb_agg(jsonb_build_object('side', s.side, 'label', s.label, 'teamId', s.team_id)
                                        order by s.side), '[]')
              from public.match_sides s where s.match_id = p_match_id),
    'writableSides', to_jsonb(v_sides),
    'canLog', v_open,
    'canCorrect', v_correct,
    'correctionsUntil', case when v_match.status = 'confirmed' then v_match.confirmed_at + interval '24 hours' end,
    'ticksOpen', public.match_ticks_open(v_match),
    'score', case when v_match.status = 'confirmed' and v_match.forfeit_side is null
                  then jsonb_build_object('a', v_match.side_a_score, 'b', v_match.side_b_score) end,
    'myEntry', case when v_mine.match_id is not null
                    then jsonb_build_object('a', v_mine.side_a_score, 'b', v_mine.side_b_score) end,
    'theirEntry', case when v_theirs.match_id is not null
                       then jsonb_build_object('a', v_theirs.side_a_score, 'b', v_theirs.side_b_score) end,
    'tries', v_match.score_tries,
    'maxTries', (public.app_rules_now()).match_score_tries,
    'players', (select coalesce(jsonb_agg(public.match_player_json(mp.id)
                                          || jsonb_build_object('side', mp.side,
                                                                'checkIn', (select a.method from public.match_attendance a
                                                                            where a.match_id = p_match_id
                                                                              and a.profile_id = mp.profile_id),
                                                                'votedMotm', exists (
                                                                  select 1 from public.motm_votes v
                                                                  where v.match_id = p_match_id
                                                                    and v.voter_profile_id = mp.profile_id),
                                                                'avatarStyle', p.avatar_style,
                                                                'avatarKitColour', p.avatar_kit_colour,
                                                                'avatarNumber', p.avatar_number)
                                          order by mp.side, mp.created_at, mp.id), '[]')
                from public.match_players mp
                left join public.profiles p on p.id = mp.profile_id
                where mp.match_id = p_match_id and mp.left_at is null and mp.side in ('a', 'b')),
    'stats', (select coalesce(jsonb_object_agg(x.side, jsonb_build_object(
                'players', (select coalesce(jsonb_agg(jsonb_build_object(
                                'playerId', mp.id,
                                'goals', (select count(*) from public.match_goals g
                                          where g.match_id = p_match_id and g.scorer_player_id = mp.id),
                                'assists', coalesce((select a.assists from public.match_assists a
                                                     where a.match_id = p_match_id and a.player_id = mp.id), 0))
                                order by mp.created_at, mp.id), '[]')
                            from public.match_players mp
                            where mp.match_id = p_match_id and mp.side = x.side and mp.left_at is null),
                'ownGoals', (select count(*) from public.match_goals g
                             where g.match_id = p_match_id and g.side = x.side and g.scorer_player_id is null))), '{}')
              from unnest(v_sides) x(side))
  );
end;
$$;

-- The caller's games that still need a score from him (Home's "Log the
-- score"): he is a captain, the window is open, and he hasn't logged his
-- score yet or it differs from the other captain's. Newest first.
create or replace function public.get_my_matches_to_log()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'matchId', x.id,
           'kickoffAt', x.kickoff_at,
           'labelA', x.label_a,
           'labelB', x.label_b,
           'state', case when x.mine is null then 'log' else 'mismatch' end)
         order by x.kickoff_at desc, x.id), '[]')
  from (
    select m.id, m.kickoff_at,
           (select ms.label from public.match_sides ms where ms.match_id = m.id and ms.side = 'a') as label_a,
           (select ms.label from public.match_sides ms where ms.match_id = m.id and ms.side = 'b') as label_b,
           w.sides,
           (select row(e.side_a_score, e.side_b_score)::text from public.match_score_entries e
            where e.match_id = m.id and e.side = case when cardinality(w.sides) = 2 then 'a' else w.sides[1] end) as mine,
           (select row(e.side_a_score, e.side_b_score)::text from public.match_score_entries e
            where e.match_id = m.id and cardinality(w.sides) = 1 and e.side <> w.sides[1]) as theirs
    from public.matches m
    cross join lateral (select public.match_side_writer(m.id, auth.uid()) as sides) w
    where m.status in ('scheduled', 'played') and now() >= m.kickoff_at and now() < m.result_deadline_at
      and w.sides is not null
      and (exists (select 1 from public.match_sides ms where ms.match_id = m.id and ms.captain_profile_id = auth.uid())
           or exists (select 1 from public.match_sides ms join public.team_members tm on tm.team_id = ms.team_id
                      where ms.match_id = m.id and tm.profile_id = auth.uid() and tm.role = 'captain'))
  ) x
  where x.mine is null or (x.theirs is not null and x.theirs <> x.mine);
$$;

-- As 20261112154127, plus each player's assists (match_assists) and rating.
create or replace function public.get_match_page(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_played boolean;
  v_closes timestamptz;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or v_uid is null or not public.match_page_visible(p_match_id) then
    raise exception 'match_not_found';
  end if;
  -- Confirmed by a result (not a forfeit): it has a score, goals and a vote.
  v_played := v_match.status = 'confirmed' and v_match.forfeit_side is null;
  v_closes := case when v_played then v_match.confirmed_at + interval '24 hours' end;

  return jsonb_build_object(
    'matchId', v_match.id,
    'status', v_match.status,
    'kind', v_match.kind,
    'format', v_match.format,
    'playersPerSide', v_match.players_per_side,
    'kickoffAt', v_match.kickoff_at,
    'kickoffLocal', to_char(v_match.kickoff_at at time zone 'Asia/Nicosia', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'endsAt', v_match.ends_at,
    'venue', (select jsonb_build_object('id', v.id, 'name', v.name) from public.venues v where v.id = v_match.venue_id),
    'sides', (select coalesce(jsonb_agg(jsonb_build_object(
                'side', s.side,
                'label', s.label,
                'teamId', s.team_id,
                'score', case when v_played then case s.side when 'a' then v_match.side_a_score else v_match.side_b_score end end)
              order by s.side), '[]')
              from public.match_sides s where s.match_id = p_match_id),
    'forfeit', case when v_match.status = 'confirmed' and v_match.forfeit_side is not null
                    then jsonb_build_object('side', v_match.forfeit_side, 'reason', v_match.forfeit_reason) end,
    'confirmedAt', case when v_match.status = 'confirmed' then v_match.confirmed_at end,
    'scorersOpenUntil', v_closes,
    'motmVotingClosesAt', v_closes,
    'motmOpen', coalesce(now() < v_closes, false),
    'goals', case when v_played then (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'side', g.side,
                        'scorer', public.match_player_json(g.scorer_player_id),
                        'assist', public.match_player_json(g.assist_player_id))
                      order by g.side, g.sort), '[]')
               from public.match_goals g where g.match_id = p_match_id)
             else '[]' end,
    -- S13B: assists as tallies, and every player's match rating.
    'assists', case when v_played then (
                 select coalesce(jsonb_agg(public.match_player_json(a.player_id)
                                           || jsonb_build_object('side', a.side, 'assists', a.assists)
                                           order by a.side, a.assists desc, a.player_id), '[]')
                 from public.match_assists a where a.match_id = p_match_id)
               else '[]' end,
    'ratings', case when v_played then (
                 select coalesce(jsonb_agg(public.match_player_json(r.player_id)
                                           || jsonb_build_object('side', mp.side, 'rating', r.rating)
                                           order by r.rating desc, r.player_id), '[]')
                 from public.match_player_ratings r
                 join public.match_players mp on mp.id = r.player_id
                 where r.match_id = p_match_id)
               else '[]' end,
    'motm', case when v_played and now() >= v_closes then (
              with tally as (
                select v.nominee_player_id, count(*) as votes
                from public.motm_votes v where v.match_id = p_match_id
                group by v.nominee_player_id
              )
              select coalesce(jsonb_agg(public.match_player_json(t.nominee_player_id) || jsonb_build_object('votes', t.votes)
                                        order by t.nominee_player_id), '[]')
              from tally t
              where t.votes = (select max(votes) from tally))
            else '[]' end,
    'myVote', (select v.nominee_player_id from public.motm_votes v
               where v.match_id = p_match_id and v.voter_profile_id = v_uid),
    -- Levels like Playtomic: the "Check the score" card, if the match has one.
    'scoreCheck', case when v_match.score_check is not null then jsonb_build_object(
                    'state', public.match_score_check_state(v_match),
                    'canAnswer', public.match_score_check_state(v_match) = 'pending'
                                 and exists (select 1 from public.match_score_checkers(p_match_id) c where c = v_uid),
                    'checkUntil', v_match.score_check_since + interval '24 hours') end,
    -- A position whose player has since left or changed side is left out.
    'lineups', (select coalesce(jsonb_agg(jsonb_build_object(
                  'side', l.side,
                  'formation', l.formation,
                  'positions', (
                    select coalesce(jsonb_agg(public.match_player_json(mp.id) || jsonb_build_object('key', e.key)
                                              order by array_position(public.match_formation_positions(l.formation), e.key)), '[]')
                    from jsonb_each_text(l.positions) e
                    join public.match_players mp on mp.id = e.value::uuid
                    where mp.match_id = l.match_id and mp.side = l.side and mp.left_at is null))
                order by l.side), '[]')
                from public.match_lineups l where l.match_id = p_match_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The job
-- ---------------------------------------------------------------------------

-- Ratings once Man of the Match voting has closed: final, with the +0.3.
create or replace function public.match_ratings_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.matches
    where status = 'confirmed' and ratings_final_at is null and p_now >= confirmed_at + interval '24 hours'
    order by confirmed_at, id
  loop
    perform public.match_compute_ratings(v_id, p_now);
    update public.matches set ratings_final_at = p_now where id = v_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- match_jobs_tick, from 20261118184516_match_streaks.sql. At the deadline:
-- two captains' different scores → disputed; one captain's score stands
-- (deadline); none → no_result. Final ratings ("ratings") run before levels.
create or replace function public.match_jobs_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voided integer;
  v_played integer;
  v_confirmed integer := 0;
  v_disputed integer := 0;
  v_no_result integer;
  v_row record;
begin
  update public.matches m
  set status = 'void'
  from public.venue_bookings b
  where b.id = m.booking_id
    and b.status = 'cancelled'
    and m.status in ('scheduled', 'played')
    and coalesce((select min(c.cancelled_at) from public.booking_cancellations c
                  where c.booking_id = b.id and c.scope <> 'my_spot'), now()) < m.ends_at;
  get diagnostics v_voided = row_count;

  update public.matches set status = 'played' where status = 'scheduled' and ends_at <= now();
  get diagnostics v_played = row_count;

  for v_row in
    select m.id, m.result_deadline_at,
           (select count(*) from public.match_score_entries e where e.match_id = m.id) as entries,
           (select count(distinct (e.side_a_score, e.side_b_score)) from public.match_score_entries e
            where e.match_id = m.id) as scores
    from public.matches m
    where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
      and exists (select 1 from public.match_score_entries e where e.match_id = m.id)
    order by m.result_deadline_at, m.id
    for update of m
  loop
    if v_row.scores > 1 then
      perform public.match_dispute_result(v_row.id, v_row.result_deadline_at);
      v_disputed := v_disputed + 1;
    else
      perform public.match_confirm_result(v_row.id, e.side_a_score, e.side_b_score, 'deadline', v_row.result_deadline_at, null)
      from public.match_score_entries e where e.match_id = v_row.id
      order by e.entered_at limit 1;
      v_confirmed := v_confirmed + 1;
    end if;
  end loop;

  update public.matches m
  set status = 'no_result'
  where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
    and not exists (select 1 from public.match_score_entries e where e.match_id = m.id);
  get diagnostics v_no_result = row_count;

  return jsonb_build_object('played', v_played, 'confirmed', v_confirmed, 'disputed', v_disputed,
                            'no_result', v_no_result, 'voided', v_voided)
         || public.match_reminders_tick(now())
         || jsonb_build_object('ratings', public.match_ratings_tick(now()))
         || jsonb_build_object('levels', public.match_levels_tick(now()))
         || jsonb_build_object('team_of_the_week', public.team_of_the_week_tick(now()))
         || jsonb_build_object('streak_badges', public.streak_badges_tick(now()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: every past confirmed match that isn't a forfeit gets its rating
-- from what was logged (score only where no goals were). Idempotent.
-- ---------------------------------------------------------------------------

create or replace function public.match_backfill_ratings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.matches
    where status = 'confirmed' and forfeit_side is null
    order by confirmed_at, id
  loop
    perform public.match_compute_ratings(v_id, now());
    update public.matches
    set ratings_final_at = case when now() >= confirmed_at + interval '24 hours' then coalesce(ratings_final_at, now()) end
    where id = v_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

select public.match_backfill_ratings();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.match_compute_ratings(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.match_compute_ratings(uuid, timestamptz) to service_role;
revoke all on function public.match_write_side_stats(uuid, text, jsonb, integer, uuid) from public, anon, authenticated;
grant execute on function public.match_write_side_stats(uuid, text, jsonb, integer, uuid) to service_role;
revoke all on function public.match_ticks_open(public.matches) from public, anon, authenticated;
grant execute on function public.match_ticks_open(public.matches) to service_role;
revoke all on function public.match_write_side_attendance(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.match_write_side_attendance(uuid, text, jsonb, uuid) to service_role;
revoke all on function public.match_side_goal_count(uuid, text) from public, anon, authenticated;
grant execute on function public.match_side_goal_count(uuid, text) to service_role;
revoke all on function public.match_confirm_result(uuid, integer, integer, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.match_confirm_result(uuid, integer, integer, text, timestamptz, uuid) to service_role;
revoke all on function public.match_dispute_result(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.match_dispute_result(uuid, timestamptz) to service_role;
revoke all on function public.match_score_check_state(public.matches, timestamptz) from public, anon, authenticated;
grant execute on function public.match_score_check_state(public.matches, timestamptz) to service_role;
revoke all on function public.match_score_checkers(uuid) from public, anon, authenticated;
grant execute on function public.match_score_checkers(uuid) to service_role;
revoke all on function public.match_open_score_check(uuid) from public, anon, authenticated;
grant execute on function public.match_open_score_check(uuid) to service_role;
revoke all on function public.match_ratings_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.match_ratings_tick(timestamptz) to service_role;
revoke all on function public.match_backfill_ratings() from public, anon, authenticated;
grant execute on function public.match_backfill_ratings() to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;

-- match_rating_shown is called by the stats views as the reader (as before).
revoke all on function public.match_rating_shown(uuid, uuid) from public, anon;
grant execute on function public.match_rating_shown(uuid, uuid) to authenticated, service_role;

revoke all on function public.log_match_result(uuid, integer, integer, jsonb) from public, anon;
grant execute on function public.log_match_result(uuid, integer, integer, jsonb) to authenticated, service_role;
revoke all on function public.set_match_stats(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.set_match_stats(uuid, jsonb, integer, integer) to authenticated, service_role;
revoke all on function public.get_my_matches_to_log() from public, anon;
grant execute on function public.get_my_matches_to_log() to authenticated, service_role;
revoke all on function public.respond_to_match_score(uuid, boolean) from public, anon;
grant execute on function public.respond_to_match_score(uuid, boolean) to authenticated, service_role;
revoke all on function public.get_my_scores_to_check() from public, anon;
grant execute on function public.get_my_scores_to_check() to authenticated, service_role;
revoke all on function public.get_match_log(uuid) from public, anon;
grant execute on function public.get_match_log(uuid) to authenticated, service_role;

-- The old score, goals and 1–10 rating calls: no longer the app's.
revoke all on function public.submit_match_result(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_match_result(uuid, integer, integer) to service_role;
revoke all on function public.respond_to_match_result(uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_to_match_result(uuid, boolean) to service_role;
revoke all on function public.set_match_goals(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_match_goals(uuid, jsonb, text) to service_role;
revoke all on function public.rate_match_player(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.rate_match_player(uuid, uuid, integer) to service_role;
revoke all on function public.get_match_ratings(uuid) from public, anon, authenticated;
grant execute on function public.get_match_ratings(uuid) to service_role;
