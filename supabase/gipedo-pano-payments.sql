-- "Gipedo Pano" (Cypriot grassroots tradition: the losing team pays for the
-- whole pitch) as an optional payment mode for "Need opposition" matches,
-- PLUS the general forfeit/no-show result logic this turned out to require
-- (see below) for both friendly matches and league fixtures.
--
-- Run AFTER supabase/opposition-match-payments.sql, supabase/manual-capture-
-- payments.sql and supabase/scores.sql. Run in the Supabase dashboard: SQL
-- Editor > New query > Run. Safe to re-run.
--
-- REUSES the existing authorize-then-capture flow exactly as-is for the
-- booking/authorization step (book_slot, offer_opposition, create-share-
-- payment, stripe-webhook's handleAuthorized) — nothing here changes how a
-- hold gets placed. What changes is WHEN and WHO gets captured:
--
-- Today, stripe-webhook's captureIfFull captures every authorized share the
-- moment the roster fills — which happens well before kickoff, let alone
-- before any score is known. That's fine for 'split' bookings (each player
-- always pays their own share regardless of outcome), but it's incompatible
-- with Gipedo Pano, which needs the capture decision to wait for the
-- result. So for 'gipedo_pano' bookings, captureIfFull (redefined in
-- supabase/functions/stripe-webhook/index.ts) now leaves every share
-- 'authorized' — held, not captured — and the functions below decide the
-- real outcome once one exists, recording it as `payment_settlement` on
-- friendly_matches. supabase/functions/settle-gipedo-pano is the only place
-- that actually talks to Stripe from there: it captures the losing team's
-- holds and voids the winning team's, or (draw) captures everyone's own
-- share same as a normal match, or (void) releases every hold.
--
-- SCOPE NOTE: "Need opposition" posts only ever produce friendly_matches
-- (see supabase/scores.sql item 4) — league_fixtures come from league
-- season generation, never from a squad post — so Gipedo Pano itself only
-- ever applies to friendly_matches. The forfeit/no-show RESULT logic below
-- (who's recorded as won/lost when a match never gets a genuine agreed
-- score) is extended to league_fixtures too, for consistency, since the
-- exact same "kept changing their submitted score" signal already existed
-- there — but league fixtures have no payment_mode and nothing here ever
-- calls Stripe for one.
--
-- FORFEIT/NO-SHOW DESIGN (new — nothing like this existed before this
-- file): rather than inventing a new "report a no-show" UI, this reuses two
-- signals the app already has:
--   1. Dispute lockout (3 mismatched score-submission attempts): each side
--      is already judged "at fault" if it submitted more than one distinct
--      score (see check_friendly_score_match/check_fixture_score_match's
--      existing v_home_changed/v_away_changed, used for the XP penalty).
--      If exactly ONE side is at fault, that's now also treated as a
--      forfeit loss for that side. If both or neither are at fault, the
--      outcome stays ambiguous — treated as void, same as before (no
--      stats change beyond the existing XP penalty).
--   2. True silence (nobody, or only one side, ever submits a score at
--      all): a new time-based sweep (resolve_stale_friendly_matches /
--      resolve_stale_fixtures, cron-scheduled at the bottom) catches
--      matches/fixtures still unresolved 24h after kickoff. Exactly one
--      side having submitted anything at all counts as the other side's
--      no-show forfeit; neither side submitting, or both having submitted
--      but simply never re-checked, is void.

-- 1. Which mode a "Need opposition" post is offering. Only meaningful for
-- type = 'opposition' — enforced in create_squad_post below, not by a table
-- constraint, same reasoning as position_needed/level_needed in
-- supabase/squad-post-filters.sql only applying to 'players' posts.
alter table public.squad_posts add column if not exists payment_mode text not null default 'split';
alter table public.squad_posts drop constraint if exists squad_posts_payment_mode_check;
alter table public.squad_posts add constraint squad_posts_payment_mode_check
  check (payment_mode in ('split', 'gipedo_pano'));

-- Dropped first: adding a parameter changes the function's identity — same
-- reasoning as every other create_squad_post redefinition.
drop function if exists public.create_squad_post(uuid, timestamptz, text, text, text, uuid, integer, uuid, text, text);

create or replace function public.create_squad_post(
  p_venue_id uuid,
  p_scheduled_at timestamptz,
  p_format text,
  p_post_type text,
  p_level text default null,
  p_team_id uuid default null,
  p_players_needed integer default null,
  p_venue_booking_id uuid default null,
  p_position_needed text default null,
  p_level_needed text default null,
  p_payment_mode text default 'split'
)
returns public.squad_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_payment_mode not in ('split', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;

  if p_post_type = 'opposition' then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
    ) then
      raise exception 'not_captain';
    end if;
  elsif p_post_type = 'players' then
    if p_players_needed is null or p_players_needed < 1 then
      raise exception 'players_needed_required';
    end if;
    -- Gipedo Pano only makes sense once there are two full rosters with a
    -- winner and a loser — a "need players" post never gets there.
    if p_payment_mode <> 'split' then
      raise exception 'invalid_payment_mode';
    end if;
  else
    raise exception 'invalid_post_type';
  end if;

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, level, team_id, players_needed, posted_by, status,
     venue_booking_id, position_needed, level_needed, payment_mode)
  values
    (p_venue_id, p_scheduled_at, p_format, p_post_type, p_level, p_team_id, p_players_needed, auth.uid(), 'open',
     p_venue_booking_id, p_position_needed, p_level_needed, p_payment_mode)
  returning * into v_post;

  return v_post;
end;
$$;

grant execute on function public.create_squad_post(
  uuid, timestamptz, text, text, text, uuid, integer, uuid, text, text, text
) to authenticated;

-- 2. Result-tracking columns. `forfeit_result` records how a match/fixture
-- ended without a genuine agreed score — kept separate from `status`/
-- `score_locked` (which already exist and whose exact check constraints
-- predate this repo) rather than repurposing either, so this never risks
-- colliding with a constraint this file can't see.
alter table public.friendly_matches add column if not exists forfeit_result text;
alter table public.friendly_matches drop constraint if exists friendly_matches_forfeit_result_check;
alter table public.friendly_matches add constraint friendly_matches_forfeit_result_check
  check (forfeit_result is null or forfeit_result in ('home_forfeited', 'away_forfeited', 'void'));

alter table public.league_fixtures add column if not exists forfeit_result text;
alter table public.league_fixtures drop constraint if exists league_fixtures_forfeit_result_check;
alter table public.league_fixtures add constraint league_fixtures_forfeit_result_check
  check (forfeit_result is null or forfeit_result in ('home_forfeited', 'away_forfeited', 'void'));

-- `payment_settlement` is the Gipedo Pano-only decision of who gets
-- captured vs voided: 'home_wins'/'away_wins' name the WINNING side (the
-- settlement executor below captures the other side and voids this one),
-- 'draw' means capture everyone's own share same as a normal match, 'void'
-- means release every hold. Stays null for every 'split' booking and for
-- any match with no linked, priced booking — nothing here ever touches
-- those.
alter table public.friendly_matches add column if not exists payment_settlement text;
alter table public.friendly_matches drop constraint if exists friendly_matches_payment_settlement_check;
alter table public.friendly_matches add constraint friendly_matches_payment_settlement_check
  check (payment_settlement is null or payment_settlement in ('home_wins', 'away_wins', 'draw', 'void'));

alter table public.friendly_matches add column if not exists payment_settled_at timestamptz;

-- 3. Shared stats fan-out for a forfeit outcome — same shape as
-- apply_friendly_match_result (supabase/scores.sql) but driven by an
-- explicit winner/loser rather than a scoreline, since a forfeit has no
-- real score to compare. Goals are left untouched (0 added either way): a
-- forfeit didn't produce a real scoreline worth recording as goals for/
-- against.
create or replace function public.apply_friendly_forfeit_stats(
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_result text -- 'home_forfeited' | 'away_forfeited'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home_result text;
  v_away_result text;
begin
  if p_result = 'home_forfeited' then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'won'; v_away_result := 'lost';
  end if;

  update public.teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end
  where id = p_home_team_id;

  update public.teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end
  where id = p_away_team_id;

  perform public.apply_personal_match_stats(p_home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(p_away_team_id, v_away_result, 0);
end;
$$;

create or replace function public.apply_fixture_forfeit_stats(
  p_league_id uuid,
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_result text -- 'home_forfeited' | 'away_forfeited'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home_result text;
  v_away_result text;
begin
  if p_result = 'home_forfeited' then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'won'; v_away_result := 'lost';
  end if;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end
  where league_id = p_league_id and team_id = p_home_team_id;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end
  where league_id = p_league_id and team_id = p_away_team_id;

  perform public.apply_personal_match_stats(p_home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(p_away_team_id, v_away_result, 0);
end;
$$;

-- 4. What Gipedo Pano settlement to record for a friendly match, given its
-- outcome — shared by the confirmed-score path, the dispute-lockout path,
-- and the stale-match sweep below. No-op (leaves payment_settlement null)
-- unless the match's squad post is actually 'gipedo_pano' and has a real
-- priced booking behind it.
create or replace function public.record_gipedo_pano_settlement(p_match_id uuid, p_settlement text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_booking public.venue_bookings;
begin
  select * into v_match from public.friendly_matches where id = p_match_id;
  if v_match.id is null or v_match.squad_post_id is null then
    return;
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.id is null or v_post.payment_mode <> 'gipedo_pano' or v_post.venue_booking_id is null then
    return;
  end if;

  select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 then
    return;
  end if;

  update public.friendly_matches
  set payment_settlement = p_settlement
  where id = p_match_id;
end;
$$;

-- 5. Redefined from supabase/scores.sql: same confirmed/dispute-lockout
-- shape, now also (a) recording a Gipedo Pano settlement once the score is
-- genuinely confirmed or (b) recording a forfeit result — and matching
-- Gipedo Pano settlement — when dispute lockout has exactly one side at
-- fault.
create or replace function public.check_friendly_score_match(p_match_id uuid)
returns public.friendly_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.friendly_matches;
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.friendly_match_scores;
  v_away_last public.friendly_match_scores;
  v_settlement text;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match_not_found';
  end if;

  select * into v_home_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    update public.friendly_matches set status = 'confirmed' where id = p_match_id;

    perform public.apply_friendly_match_result(
      v_match.home_team_id, v_match.away_team_id, v_home_last.home_score, v_home_last.away_score
    );

    v_settlement := case
      when v_home_last.home_score > v_home_last.away_score then 'home_wins'
      when v_home_last.away_score > v_home_last.home_score then 'away_wins'
      else 'draw'
    end;
    perform public.record_gipedo_pano_settlement(p_match_id, v_settlement);

  elsif v_match.score_attempts >= 3 then
    update public.friendly_matches set status = 'locked' where id = p_match_id;

    select count(distinct (home_score, away_score)) > 1 into v_home_changed
    from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id;

    select count(distinct (home_score, away_score)) > 1 into v_away_changed
    from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id;

    if v_home_changed then
      update public.profiles set xp = xp - 20 where id = v_home_last.submitted_by_profile_id;
    end if;
    if v_away_changed then
      update public.profiles set xp = xp - 20 where id = v_away_last.submitted_by_profile_id;
    end if;

    -- Exactly one side at fault (kept changing its number) is now also a
    -- forfeit loss for that side — both/neither at fault stays ambiguous
    -- (void), same as before this file existed.
    if v_home_changed and not v_away_changed then
      update public.friendly_matches set forfeit_result = 'home_forfeited' where id = p_match_id;
      perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'home_forfeited');
      perform public.record_gipedo_pano_settlement(p_match_id, 'away_wins');
    elsif v_away_changed and not v_home_changed then
      update public.friendly_matches set forfeit_result = 'away_forfeited' where id = p_match_id;
      perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'away_forfeited');
      perform public.record_gipedo_pano_settlement(p_match_id, 'home_wins');
    else
      update public.friendly_matches set forfeit_result = 'void' where id = p_match_id;
      perform public.record_gipedo_pano_settlement(p_match_id, 'void');
    end if;
  end if;

  select * into v_match from public.friendly_matches where id = p_match_id;
  return v_match;
end;
$$;

-- Redefined from supabase/scores.sql: unchanged body, just needs to exist
-- after the drop/recreate above so submit_friendly_score keeps calling the
-- new check_friendly_score_match.
create or replace function public.submit_friendly_score(
  p_match_id uuid,
  p_home_score integer,
  p_away_score integer
)
returns public.friendly_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_my_team uuid;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match_not_found';
  end if;
  if v_match.status <> 'pending_score' then
    raise exception 'score_not_open';
  end if;

  select tm.team_id into v_my_team
  from public.team_members tm
  where tm.profile_id = auth.uid()
    and tm.team_id in (v_match.home_team_id, v_match.away_team_id)
  limit 1;
  if v_my_team is null then
    raise exception 'not_on_team';
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.scheduled_at is null or now() < v_post.scheduled_at + interval '2 hours' then
    raise exception 'too_early';
  end if;

  insert into public.friendly_match_scores
    (friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score)
  values (p_match_id, v_my_team, auth.uid(), p_home_score, p_away_score);

  update public.friendly_matches
  set score_attempts = score_attempts + 1
  where id = p_match_id;

  return public.check_friendly_score_match(p_match_id);
end;
$$;

grant execute on function public.submit_friendly_score(uuid, integer, integer) to authenticated;

-- 6. Same forfeit extension for league fixtures — stats/pts only, no
-- payment (league fixtures have no payment_mode). Redefined from
-- supabase/scores.sql.
create or replace function public.check_fixture_score_match(p_fixture_id uuid)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.fixture_score_submissions;
  v_away_last public.fixture_score_submissions;
  v_home_result text;
  v_away_result text;
  v_home_dispute_count integer;
  v_away_dispute_count integer;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  select * into v_home_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    if v_home_last.home_score > v_home_last.away_score then
      v_home_result := 'won'; v_away_result := 'lost';
    elsif v_home_last.away_score > v_home_last.home_score then
      v_home_result := 'lost'; v_away_result := 'won';
    else
      v_home_result := 'drawn'; v_away_result := 'drawn';
    end if;

    update public.league_fixtures set status = 'completed' where id = p_fixture_id;

    update public.league_teams
    set played = played + 1,
        won = won + case when v_home_result = 'won' then 1 else 0 end,
        drawn = drawn + case when v_home_result = 'drawn' then 1 else 0 end,
        lost = lost + case when v_home_result = 'lost' then 1 else 0 end,
        goals_for = goals_for + v_home_last.home_score,
        goals_against = goals_against + v_home_last.away_score
    where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;

    update public.league_teams
    set played = played + 1,
        won = won + case when v_away_result = 'won' then 1 else 0 end,
        drawn = drawn + case when v_away_result = 'drawn' then 1 else 0 end,
        lost = lost + case when v_away_result = 'lost' then 1 else 0 end,
        goals_for = goals_for + v_home_last.away_score,
        goals_against = goals_against + v_home_last.home_score
    where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;

    perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home_result, v_home_last.home_score);
    perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away_result, v_home_last.away_score);

  elsif v_fixture.score_attempts >= 3 then
    update public.league_fixtures set score_locked = true where id = p_fixture_id;

    select count(distinct (home_score, away_score)) > 1 into v_home_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id;

    select count(distinct (home_score, away_score)) > 1 into v_away_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id;

    if v_home_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.home_team_id
      returning dispute_count into v_home_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.home_team_id and role = 'captain'
      );

      if v_home_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;
      end if;
    end if;
    if v_away_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.away_team_id
      returning dispute_count into v_away_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.away_team_id and role = 'captain'
      );

      if v_away_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;
      end if;
    end if;

    if v_home_changed and not v_away_changed then
      update public.league_fixtures set forfeit_result = 'home_forfeited' where id = p_fixture_id;
      perform public.apply_fixture_forfeit_stats(
        v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'home_forfeited'
      );
    elsif v_away_changed and not v_home_changed then
      update public.league_fixtures set forfeit_result = 'away_forfeited' where id = p_fixture_id;
      perform public.apply_fixture_forfeit_stats(
        v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'away_forfeited'
      );
    else
      update public.league_fixtures set forfeit_result = 'void' where id = p_fixture_id;
    end if;
  end if;

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;

create or replace function public.submit_fixture_score(
  p_fixture_id uuid,
  p_home_score integer,
  p_away_score integer
)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;
  if v_fixture.status = 'completed' then
    raise exception 'already_completed';
  end if;
  if v_fixture.score_locked then
    raise exception 'score_locked';
  end if;
  if v_fixture.status <> 'agreed' then
    raise exception 'schedule_not_agreed';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() < ((v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia') + interval '2 hours' then
    raise exception 'too_early';
  end if;

  insert into public.fixture_score_submissions (fixture_id, submitted_by_team_id, home_score, away_score)
  values (p_fixture_id, v_my_team, p_home_score, p_away_score);

  update public.league_fixtures
  set score_attempts = score_attempts + 1
  where id = p_fixture_id;

  return public.check_fixture_score_match(p_fixture_id);
end;
$$;

grant execute on function public.submit_fixture_score(uuid, integer, integer) to authenticated;

-- 7. Stale-match sweep: catches a match/fixture that never even reached
-- dispute lockout because one or both sides just never submitted anything
-- — nothing before this file detected that at all. 24h after kickoff is
-- deliberately generous past submit_friendly_score/submit_fixture_score's
-- own 2-hour-after-kickoff opening, so this only ever fires on a match
-- that's genuinely gone silent, not one still within its normal
-- score-reporting window.
create or replace function public.friendly_matches_needing_resolution()
returns table (match_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select fm.id
  from public.friendly_matches fm
  join public.squad_posts sp on sp.id = fm.squad_post_id
  where fm.status = 'pending_score'
    and sp.scheduled_at is not null
    and now() > sp.scheduled_at + interval '24 hours';
$$;

revoke all on function public.friendly_matches_needing_resolution() from authenticated, anon;

create or replace function public.resolve_stale_friendly_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_home_submitted boolean;
  v_away_submitted boolean;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null or v_match.status <> 'pending_score' then
    return;
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.scheduled_at is null or now() <= v_post.scheduled_at + interval '24 hours' then
    return;
  end if;

  select exists (
    select 1 from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id
  ) into v_home_submitted;

  select exists (
    select 1 from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id
  ) into v_away_submitted;

  update public.friendly_matches set status = 'locked' where id = p_match_id;

  if v_home_submitted and not v_away_submitted then
    -- Away never engaged at all — treated as their no-show, home wins by
    -- forfeit.
    update public.friendly_matches set forfeit_result = 'away_forfeited' where id = p_match_id;
    perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'away_forfeited');
    perform public.record_gipedo_pano_settlement(p_match_id, 'home_wins');
  elsif v_away_submitted and not v_home_submitted then
    update public.friendly_matches set forfeit_result = 'home_forfeited' where id = p_match_id;
    perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'home_forfeited');
    perform public.record_gipedo_pano_settlement(p_match_id, 'away_wins');
  else
    -- Neither side ever submitted anything, or both did but never reached
    -- 3 attempts to trigger dispute lockout on their own — either way,
    -- there's no reliable signal for a winner. Void.
    update public.friendly_matches set forfeit_result = 'void' where id = p_match_id;
    perform public.record_gipedo_pano_settlement(p_match_id, 'void');
  end if;
end;
$$;

revoke all on function public.resolve_stale_friendly_match(uuid) from authenticated, anon;

create or replace function public.resolve_stale_friendly_matches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in select match_id from public.friendly_matches_needing_resolution() loop
    perform public.resolve_stale_friendly_match(v_row.match_id);
  end loop;
end;
$$;

revoke all on function public.resolve_stale_friendly_matches() from authenticated, anon;

-- Same sweep for league fixtures — stats/pts only, no payment.
create or replace function public.fixtures_needing_resolution()
returns table (fixture_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select f.id
  from public.league_fixtures f
  where f.status = 'agreed'
    and not f.score_locked
    and f.scheduled_day is not null
    and f.scheduled_time is not null
    and now() > ((f.scheduled_day + f.scheduled_time) at time zone 'Asia/Nicosia') + interval '24 hours';
$$;

revoke all on function public.fixtures_needing_resolution() from authenticated, anon;

create or replace function public.resolve_stale_fixture(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_home_submitted boolean;
  v_away_submitted boolean;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null or v_fixture.status <> 'agreed' or v_fixture.score_locked then
    return;
  end if;

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() <= ((v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia') + interval '24 hours' then
    return;
  end if;

  select exists (
    select 1 from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id
  ) into v_home_submitted;

  select exists (
    select 1 from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id
  ) into v_away_submitted;

  update public.league_fixtures set score_locked = true where id = p_fixture_id;

  if v_home_submitted and not v_away_submitted then
    update public.league_fixtures set forfeit_result = 'away_forfeited' where id = p_fixture_id;
    perform public.apply_fixture_forfeit_stats(
      v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'away_forfeited'
    );
  elsif v_away_submitted and not v_home_submitted then
    update public.league_fixtures set forfeit_result = 'home_forfeited' where id = p_fixture_id;
    perform public.apply_fixture_forfeit_stats(
      v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'home_forfeited'
    );
  else
    update public.league_fixtures set forfeit_result = 'void' where id = p_fixture_id;
  end if;
end;
$$;

revoke all on function public.resolve_stale_fixture(uuid) from authenticated, anon;

create or replace function public.resolve_stale_fixtures()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in select fixture_id from public.fixtures_needing_resolution() loop
    perform public.resolve_stale_fixture(v_row.fixture_id);
  end loop;
end;
$$;

revoke all on function public.resolve_stale_fixtures() from authenticated, anon;

-- Pure SQL, no external API calls — unlike cancel-unpaid-bookings/
-- settle-gipedo-pano this can run directly as a cron job body, no pg_net
-- or Edge Function involved.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'resolve-stale-match-results';

  perform cron.schedule(
    'resolve-stale-match-results',
    '*/30 * * * *',
    $sql$ select public.resolve_stale_friendly_matches(); select public.resolve_stale_fixtures(); $sql$
  );
exception when undefined_table or undefined_function or invalid_schema_name then
  raise notice 'pg_cron not enabled — enable it under Database > Extensions, then re-run this file.';
end $$;

-- 8. Gipedo Pano settlement execution — read side. Returns exactly the
-- (share, action) pairs supabase/functions/settle-gipedo-pano needs to
-- execute against Stripe: 'capture' for a losing team's (or, on a draw,
-- everyone's own) hold, 'void' for a winning team's. Only ever returns
-- 'authorized' shares on a booking whose match has a recorded settlement
-- not yet executed — service-role only, same reasoning as
-- bookings_needing_share_cancellation.
create or replace function public.gipedo_pano_pending_settlement_shares()
returns table (
  match_id uuid,
  share_id uuid,
  stripe_payment_intent_id text,
  action text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    fm.id as match_id,
    s.id as share_id,
    s.stripe_payment_intent_id,
    case
      when fm.payment_settlement = 'void' then 'void'
      when fm.payment_settlement = 'draw' then 'capture'
      when fm.payment_settlement = 'home_wins' and tm.team_id = fm.home_team_id then 'void'
      when fm.payment_settlement = 'home_wins' and tm.team_id = fm.away_team_id then 'capture'
      when fm.payment_settlement = 'away_wins' and tm.team_id = fm.away_team_id then 'void'
      when fm.payment_settlement = 'away_wins' and tm.team_id = fm.home_team_id then 'capture'
    end as action
  from public.friendly_matches fm
  join public.squad_posts sp on sp.id = fm.squad_post_id
  join public.booking_payment_shares s on s.booking_id = sp.venue_booking_id
  join public.team_members tm
    on tm.profile_id = s.profile_id and tm.team_id in (fm.home_team_id, fm.away_team_id)
  where fm.payment_settlement is not null
    and fm.payment_settled_at is null
    and s.status = 'authorized';
$$;

revoke all on function public.gipedo_pano_pending_settlement_shares() from authenticated, anon;

-- Write side: applies one share's outcome. p_new_status is 'paid' (captured)
-- or 'cancelled' (voided) — the actual Stripe call already happened by the
-- time this is called; this only ever records the result.
create or replace function public.mark_gipedo_pano_share_settled(p_share_id uuid, p_new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_new_status not in ('paid', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  update public.booking_payment_shares
  set status = p_new_status,
      paid_at = case when p_new_status = 'paid' then now() else paid_at end
  where id = p_share_id
    and status = 'authorized';
end;
$$;

revoke all on function public.mark_gipedo_pano_share_settled(uuid, text) from authenticated, anon;

create or replace function public.finalize_gipedo_pano_settlement(p_match_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.friendly_matches set payment_settled_at = now() where id = p_match_id;
$$;

revoke all on function public.finalize_gipedo_pano_settlement(uuid) from authenticated, anon;

-- 9. Fix: bookings_needing_share_cancellation (supabase/manual-capture-
-- payments.sql) previously treated ANY still-'authorized' share within 3h
-- of kickoff as needing cancellation — correct for 'split' bookings, where
-- 'authorized' is always transient (captureIfFull captures the instant the
-- roster fills). But a Gipedo Pano booking with a FULL roster is meant to
-- stay 'authorized' for days after kickoff, deliberately, waiting on the
-- result. Redefined to only flag a booking that's still short of its full
-- roster this close to kickoff, using the same booking_total_shares_needed
-- (supabase/opposition-match-payments.sql) captureIfFull itself uses to
-- decide "full" — a Gipedo Pano booking whose roster IS full is correctly
-- left alone here.
create or replace function public.bookings_needing_share_cancellation()
returns table (booking_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select b.id
  from public.venue_bookings b
  where b.status = 'confirmed'
    -- amount_cents > 0 guard: a free venue or an owner_block never gets any
    -- booking_payment_shares rows at all (add_booking_share_internal skips
    -- them outright), so without this a free/owner-block booking would
    -- read as "0 of N shares authorized" and be wrongly flagged — the
    -- original version never hit this because its inner join to
    -- booking_payment_shares naturally excluded a booking with zero share
    -- rows.
    and b.amount_cents > 0
    and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' <= now() + interval '3 hours'
    and (
      select count(*) from public.booking_payment_shares s
      where s.booking_id = b.id and s.status in ('authorized', 'paid')
    ) < public.booking_total_shares_needed(b.id);
$$;
