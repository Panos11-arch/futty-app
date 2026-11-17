-- A5a: skill levels, ratings, competitive or casual, balance teams
-- (docs/specs/match-record.md decision 1f, sections 4.8, 5.5; 05 Product
-- section 4). The constants are decision 1f's, to confirm with Panos.
--
-- Starting level: 1.0 + points for the five sign-up answers, capped to
-- 1.0-6.0, rounded to 0.1; provisional, 0% reliability.
--
-- After a confirmed competitive match that isn't a forfeit, once both the
-- ratings window (confirmed_at + 24h) and the check-in window
-- (result_deadline_at) have closed, every checked-in player (1b.2) moves:
--   E    = 1 / (1 + 10^((opponents' average - own side's average) / 2))
--   S    = 1 win, 0.5 draw, 0 loss
--   K    = 0.40 for a player's first 10 competitive matches, then 0.20
--   move = K * (S - E) * (1 - reliability / 200)
-- then their match rating (3 or more ratings) nudges it by
-- 0.1 * (rating - 5.5) / 4.5, never more than 0.1 either way; clamped to
-- 1.0-7.0. reliability = min(100, 5 * competitive matches); provisional
-- until 5. A player with no level starts at a default 3.0. Casual, forfeit,
-- disputed, no_result and void matches never move levels; each match is
-- handled once (matches.levels_applied_at). match_jobs_tick runs it.
--
-- Ratings 1-10: only checked-in players rate checked-in players, not
-- themselves, once per player, until confirmed_at + 24h (closes section 10,
-- question 3). A match rating needs 3 or more ratings; with 6 or more the
-- highest and lowest are dropped; a rater who rated 3 or more players in the
-- match and gave every one of them the same score counts 0.25.
--
-- XP: nothing here reads or writes profiles.xp or teams.xp.

-- The starting level for the sign-up answers (position adds nothing).
create or replace function public.match_level_start(p_years text, p_highest text, p_frequency text, p_self_rating integer)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v numeric;
begin
  v := 1.0
     + case p_years when 'under_1' then 0 when '1_3' then 0.3 when '3_10' then 0.6 when 'over_10' then 0.8 end
     + case p_highest when 'kickabout' then 0 when 'amateur' then 0.7 when 'semi_pro' then 1.5 when 'professional' then 2.2 end
     + case p_frequency when 'rarely' then 0 when 'monthly' then 0.2 when 'weekly' then 0.5 when 'several_weekly' then 0.7 end;
  if v is null or p_self_rating is null or p_self_rating not between 1 and 10 then
    raise exception 'invalid_answer';
  end if;
  v := v + (p_self_rating - 1) / 9.0 * 1.5;
  return round(least(6.0, greatest(1.0, v)), 1);
end;
$$;

-- The app calls this once, after sign-up. A default level (never answered,
-- no competitive match yet) is replaced; anything else is level_already_set.
create or replace function public.set_starting_level(
  p_years text,
  p_highest text,
  p_frequency text,
  p_position text,
  p_self_rating integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_levels;
  v_level numeric;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_row from public.player_levels where profile_id = v_uid for update;
  if v_row.profile_id is not null and (v_row.source = 'questionnaire' or v_row.competitive_matches > 0) then
    raise exception 'level_already_set';
  end if;
  if p_position is null or p_position not in ('gk', 'def', 'mid', 'fwd') then
    raise exception 'invalid_answer';
  end if;
  v_level := public.match_level_start(p_years, p_highest, p_frequency, p_self_rating);

  insert into public.player_level_answers (profile_id, years_played, highest_level, play_frequency, position, self_rating)
  values (v_uid, p_years, p_highest, p_frequency, p_position, p_self_rating)
  on conflict (profile_id) do update
  set years_played = excluded.years_played, highest_level = excluded.highest_level,
      play_frequency = excluded.play_frequency, position = excluded.position, self_rating = excluded.self_rating;

  insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source)
  values (v_uid, v_level, true, 0, 0, 'questionnaire')
  on conflict (profile_id) do update
  set level = excluded.level, provisional = true, reliability_pct = 0, competitive_matches = 0,
      source = 'questionnaire', updated_at = now();

  insert into public.player_level_history (profile_id, match_id, reason, level_before, level_after)
  values (v_uid, null, 'start', v_row.level, v_level);

  return jsonb_build_object('level', v_level, 'provisional', true, 'reliabilityPct', 0, 'competitiveMatches', 0);
end;
$$;

-- Competitive or casual: any captain, while scheduled and before kickoff.
-- null goes back to the default (named competitive, pickup casual).
create or replace function public.set_match_competitive(p_match_id uuid, p_competitive boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if public.match_captain_side(p_match_id, auth.uid()) is null then
    raise exception 'not_captain';
  end if;
  if v_match.status <> 'scheduled' or now() >= v_match.kickoff_at then
    raise exception 'competitive_locked';
  end if;
  update public.matches set competitive = p_competitive where id = p_match_id;
end;
$$;

-- 0.25 for a rater who rated 3 or more players in the match and gave every
-- one of them the same score; otherwise 1.
create or replace function public.match_rater_weight(p_match_id uuid, p_rater_profile_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) >= 3 and count(distinct score) = 1 then 0.25 else 1 end
  from public.match_ratings
  where match_id = p_match_id and rater_profile_id = p_rater_profile_id;
$$;

-- A player's match rating: {"rating": weighted mean to 2 decimals, or null
-- with fewer than 3 ratings, "count": number of ratings}. With 6 or more,
-- one highest and one lowest are dropped first.
create or replace function public.match_rating_for(p_match_id uuid, p_player_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select score,
           public.match_rater_weight(match_id, rater_profile_id) as w,
           row_number() over (order by score, rater_profile_id) as low_n,
           row_number() over (order by score desc, rater_profile_id desc) as high_n,
           count(*) over () as n
    from public.match_ratings
    where match_id = p_match_id and rated_player_id = p_player_id
  )
  select jsonb_build_object(
    'rating', case when count(*) >= 3 then
                round(sum(w * score) filter (where n < 6 or (low_n > 1 and high_n > 1))
                      / sum(w) filter (where n < 6 or (low_n > 1 and high_n > 1)), 2) end,
    'count', count(*))
  from r;
$$;

-- A checked-in player rates another checked-in player 1-10.
create or replace function public.rate_match_player(p_match_id uuid, p_player_id uuid, p_score integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_player public.match_players;
  v_rated integer;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if not public.match_played(p_match_id, v_uid) then
    raise exception 'not_checked_in';
  end if;
  if v_match.status <> 'confirmed' or v_match.forfeit_side is not null then
    raise exception 'match_not_confirmed';
  end if;
  if now() >= v_match.confirmed_at + interval '24 hours' then
    raise exception 'rating_closed';
  end if;

  select * into v_player from public.match_players where id = p_player_id and match_id = p_match_id;
  if v_player.profile_id = v_uid then
    raise exception 'cannot_rate_self';
  end if;
  if v_player.id is null or v_player.profile_id is null or not public.match_played(p_match_id, v_player.profile_id) then
    raise exception 'player_not_eligible';
  end if;
  if p_score is null or p_score not between 1 and 10 then
    raise exception 'invalid_score';
  end if;

  insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score)
  values (p_match_id, v_uid, p_player_id, p_score)
  on conflict do nothing;
  get diagnostics v_rated = row_count;
  if v_rated = 0 then
    raise exception 'already_rated';
  end if;
end;
$$;

-- What the match page shows: each player's match rating (3 or more ratings,
-- one decimal) once the window has closed, and the caller's own ratings.
-- Individual ratings are never returned.
create or replace function public.get_match_ratings(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_rateable boolean;
  v_closes timestamptz;
  v_players jsonb := '[]';
  v_mine jsonb;
begin
  if not public.match_page_visible(p_match_id) then
    raise exception 'match_not_found';
  end if;
  select * into v_match from public.matches where id = p_match_id;
  v_rateable := v_match.status = 'confirmed' and v_match.forfeit_side is null;
  v_closes := case when v_rateable then v_match.confirmed_at + interval '24 hours' end;

  if v_rateable and now() >= v_closes then
    select coalesce(jsonb_agg(jsonb_build_object('playerId', x.id, 'profileId', x.profile_id,
                                                 'rating', round((x.r ->> 'rating')::numeric, 1),
                                                 'count', (x.r ->> 'count')::integer)
                              order by (x.r ->> 'rating')::numeric desc, x.id), '[]')
    into v_players
    from (select mp.id, mp.profile_id, public.match_rating_for(p_match_id, mp.id) as r
          from public.match_players mp
          where mp.match_id = p_match_id and mp.profile_id is not null) x
    where (x.r ->> 'count')::integer >= 3;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('playerId', rated_player_id, 'score', score) order by rated_player_id), '[]')
  into v_mine
  from public.match_ratings
  where match_id = p_match_id and rater_profile_id = auth.uid();

  return jsonb_build_object('ratingsOpen', v_rateable and now() < v_closes, 'ratingsCloseAt', v_closes,
                            'players', v_players, 'myRatings', v_mine);
end;
$$;

-- The booker splits a pickup's players (holding a spot or checked in, not
-- left; guests stay where they are) into two sides whose average levels are
-- closest. Sizes differ by one at most and the booker stays on side a. A
-- player with no level counts as 3.0 (nothing is written). Every split is
-- tried for 16 players or fewer (ties: the first found); above that, a
-- greedy split then the best swaps.
create or replace function public.balance_match_teams(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_booker uuid;
  v_ids uuid[];
  v_profiles uuid[];
  v_levels numeric[];
  v_n integer;
  v_has_booker boolean;
  v_size_a integer;
  v_on_a boolean[];
  v_mask bigint;
  v_sum_a numeric := 0;
  v_count_a integer := 0;
  v_total numeric;
  v_diff numeric;
  v_best numeric;
  v_bi integer;
  v_bj integer;
  v_new numeric;
  v_a uuid[] := '{}';
  v_b uuid[] := '{}';
  v_a_profiles jsonb;
  v_b_profiles jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_match.kind <> 'pickup' then
    raise exception 'not_pickup';
  end if;
  select b.created_by into v_booker from public.venue_bookings b where b.id = v_match.booking_id;
  if v_uid is null or v_uid is distinct from v_booker then
    raise exception 'not_booker';
  end if;
  if not public.match_sides_open(v_match) then
    raise exception 'sides_locked';
  end if;

  -- The booker first, then by level, highest first.
  select array_agg(x.id order by x.is_booker desc, x.level desc, x.id),
         array_agg(x.profile_id order by x.is_booker desc, x.level desc, x.id),
         array_agg(x.level order by x.is_booker desc, x.level desc, x.id)
  into v_ids, v_profiles, v_levels
  from (select mp.id, mp.profile_id, mp.profile_id = v_booker as is_booker, coalesce(pl.level, 3.0) as level
        from public.match_players mp
        left join public.player_levels pl on pl.profile_id = mp.profile_id
        where mp.match_id = p_match_id and mp.profile_id is not null and mp.left_at is null
          and (public.match_spot_holder(p_match_id, mp.profile_id)
               or exists (select 1 from public.match_attendance a
                          where a.match_id = p_match_id and a.profile_id = mp.profile_id))) x;
  v_n := coalesce(cardinality(v_ids), 0);
  v_has_booker := v_n > 0 and v_profiles[1] = v_booker;
  v_on_a := array_fill(false, array[greatest(v_n, 1)]);

  if v_n = 1 then
    v_on_a[1] := true;
  elsif v_n between 2 and 16 then
    -- Bit i - 1 of the mask puts player i on side a.
    select m.mask into v_mask
    from generate_series(0, (1::bigint << v_n) - 1) m(mask)
    cross join lateral (
      select count(*) filter (where m.mask & (1::bigint << (u.i - 1)::integer) <> 0) as c,
             coalesce(sum(u.l) filter (where m.mask & (1::bigint << (u.i - 1)::integer) <> 0), 0) as s,
             sum(u.l) as t
      from unnest(v_levels) with ordinality u(l, i)) x
    where x.c in (v_n / 2, (v_n + 1) / 2)
      and (not v_has_booker or m.mask & 1 = 1)
    order by abs(x.s / x.c - (x.t - x.s) / (v_n - x.c)), m.mask
    limit 1;
    for i in 1..v_n loop
      v_on_a[i] := v_mask & (1::bigint << (i - 1)) <> 0;
    end loop;
  elsif v_n > 16 then
    -- Greedy: highest level first, to the side with the lower total while
    -- it has room; then the best single swaps until none helps.
    v_size_a := (v_n + 1) / 2;
    v_total := 0;
    for i in 1..v_n loop
      v_total := v_total + v_levels[i];
      if (i = 1 and v_has_booker)
         or (v_count_a < v_size_a and ((i - 1 - v_count_a) >= v_n - v_size_a or v_sum_a <= v_total - v_levels[i] - v_sum_a)) then
        v_on_a[i] := true;
        v_count_a := v_count_a + 1;
        v_sum_a := v_sum_a + v_levels[i];
      end if;
    end loop;
    for k in 1..100 loop
      v_diff := abs(v_sum_a / v_size_a - (v_total - v_sum_a) / (v_n - v_size_a));
      v_best := v_diff;
      v_bi := null;
      for i in 1..v_n loop
        continue when not v_on_a[i] or (i = 1 and v_has_booker);
        for j in 1..v_n loop
          continue when v_on_a[j];
          v_new := abs((v_sum_a - v_levels[i] + v_levels[j]) / v_size_a
                       - (v_total - v_sum_a + v_levels[i] - v_levels[j]) / (v_n - v_size_a));
          if v_new < v_best then
            v_best := v_new;
            v_bi := i;
            v_bj := j;
          end if;
        end loop;
      end loop;
      exit when v_bi is null;
      v_on_a[v_bi] := false;
      v_on_a[v_bj] := true;
      v_sum_a := v_sum_a - v_levels[v_bi] + v_levels[v_bj];
    end loop;
  end if;

  for i in 1..v_n loop
    if v_on_a[i] then
      v_a := v_a || v_ids[i];
    else
      v_b := v_b || v_ids[i];
    end if;
  end loop;
  update public.match_players set side = 'a' where id = any (v_a) and side is distinct from 'a';
  update public.match_players set side = 'b' where id = any (v_b) and side is distinct from 'b';

  select coalesce(jsonb_agg(v_profiles[i] order by i), '[]') into v_a_profiles from generate_series(1, v_n) i where v_on_a[i];
  select coalesce(jsonb_agg(v_profiles[i] order by i), '[]') into v_b_profiles from generate_series(1, v_n) i where not v_on_a[i];
  return jsonb_build_object(
    'sideA', jsonb_build_object('players', v_a_profiles,
                                'average', (select round(avg(v_levels[i]), 2) from generate_series(1, v_n) i where v_on_a[i])),
    'sideB', jsonb_build_object('players', v_b_profiles,
                                'average', (select round(avg(v_levels[i]), 2) from generate_series(1, v_n) i where not v_on_a[i])));
end;
$$;

-- The level update for one match (see the top of this file). Returns
-- 'applied', 'skipped' (settled, but it moves no levels), 'not_yet' (a
-- window is still open) or 'already'.
create or replace function public.apply_match_levels(p_match_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_avg_a numeric;
  v_avg_b numeric;
  v_p record;
  v_level public.player_levels;
  v_s numeric;
  v_e numeric;
  v_k numeric;
  v_after numeric;
  v_final numeric;
  v_rating jsonb;
  v_profiles uuid[];
  v_players uuid[];
  v_sides text[];
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_match.levels_applied_at is not null then
    return 'already';
  end if;
  if v_match.status in ('scheduled', 'played')
     or (v_match.status = 'confirmed'
         and p_now < greatest(v_match.confirmed_at + interval '24 hours', v_match.result_deadline_at)) then
    return 'not_yet';
  end if;

  update public.matches set levels_applied_at = p_now where id = p_match_id;

  if v_match.status <> 'confirmed' or v_match.forfeit_side is not null or not v_match.is_competitive
     or v_match.side_a_score is null or v_match.side_b_score is null then
    return 'skipped';
  end if;

  -- Who counts: checked in, a profile, a side, not left (1b.2).
  select array_agg(mp.profile_id order by mp.profile_id), array_agg(mp.id order by mp.profile_id),
         array_agg(mp.side order by mp.profile_id)
  into v_profiles, v_players, v_sides
  from public.match_players mp
  join public.match_attendance a on a.match_id = mp.match_id and a.profile_id = mp.profile_id
  where mp.match_id = p_match_id and mp.left_at is null and mp.profile_id is not null and mp.side in ('a', 'b');

  if v_sides is null or not 'a' = any (v_sides) or not 'b' = any (v_sides) then
    return 'skipped';
  end if;

  insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source)
  select u.profile_id, 3.0, true, 0, 0, 'default' from unnest(v_profiles) u(profile_id)
  on conflict (profile_id) do nothing;
  perform 1 from public.player_levels where profile_id = any (v_profiles) order by profile_id for update;

  select avg(pl.level) filter (where u.side = 'a'), avg(pl.level) filter (where u.side = 'b')
  into v_avg_a, v_avg_b
  from unnest(v_profiles, v_sides) u(profile_id, side)
  join public.player_levels pl on pl.profile_id = u.profile_id;

  for v_p in select * from unnest(v_profiles, v_players, v_sides) u(profile_id, player_id, side) loop
    select * into v_level from public.player_levels where profile_id = v_p.profile_id;
    v_s := case sign(v_match.side_a_score - v_match.side_b_score) * (case v_p.side when 'a' then 1 else -1 end)
             when 1 then 1 when 0 then 0.5 else 0 end;
    v_e := 1 / (1 + power(10::numeric, (case v_p.side when 'a' then v_avg_b - v_avg_a else v_avg_a - v_avg_b end) / 2));
    v_k := case when v_level.competitive_matches < 10 then 0.40 else 0.20 end;
    v_after := round(least(7, greatest(1, v_level.level + v_k * (v_s - v_e) * (1 - v_level.reliability_pct / 200.0))), 2);
    insert into public.player_level_history (profile_id, match_id, reason, level_before, level_after)
    values (v_p.profile_id, p_match_id, 'result', v_level.level, v_after);

    v_final := v_after;
    v_rating := public.match_rating_for(p_match_id, v_p.player_id);
    if (v_rating ->> 'count')::integer >= 3 then
      v_final := round(least(7, greatest(1, v_after
                 + least(0.1, greatest(-0.1, 0.1 * ((v_rating ->> 'rating')::numeric - 5.5) / 4.5)))), 2);
      insert into public.player_level_history (profile_id, match_id, reason, level_before, level_after)
      values (v_p.profile_id, p_match_id, 'ratings', v_after, v_final);
    end if;

    update public.player_levels
    set level = v_final,
        competitive_matches = competitive_matches + 1,
        reliability_pct = least(100, 5 * (competitive_matches + 1)),
        provisional = competitive_matches + 1 < 5,
        updated_at = p_now
    where profile_id = v_p.profile_id;
  end loop;
  return 'applied';
end;
$$;

-- Every confirmed match whose windows have closed and that hasn't been
-- handled, oldest confirmation first. Returns how many it handled.
create or replace function public.match_levels_tick(p_now timestamptz default now())
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
    where status = 'confirmed' and levels_applied_at is null
      and p_now >= greatest(confirmed_at + interval '24 hours', result_deadline_at)
    order by confirmed_at, id
  loop
    if public.apply_match_levels(v_id, p_now) in ('applied', 'skipped') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- match_jobs_tick, from 20261112000758_match_reminders.sql, now also runs
-- the level update ("levels" in the counts).
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
    select m.id, m.result_deadline_at, s.side_a_score, s.side_b_score
    from public.matches m
    join public.match_result_submissions s on s.match_id = m.id
    where m.status in ('scheduled', 'played') and m.result_deadline_at <= now() and s.response is null
    order by m.result_deadline_at, m.id
    for update of m
  loop
    update public.matches
    set status = 'confirmed', side_a_score = v_row.side_a_score, side_b_score = v_row.side_b_score,
        confirmed_via = 'deadline', confirmed_at = v_row.result_deadline_at
    where id = v_row.id;
    perform public.match_notify(v_row.id, 'match_result_confirmed', 'Result confirmed',
      public.match_score_line(v_row.id, v_row.side_a_score, v_row.side_b_score), array['a', 'b'], true, null);
    v_confirmed := v_confirmed + 1;
  end loop;

  update public.matches m
  set status = 'no_result'
  where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
    and not exists (select 1 from public.match_result_submissions s where s.match_id = m.id);
  get diagnostics v_no_result = row_count;

  return jsonb_build_object('played', v_played, 'confirmed', v_confirmed, 'no_result', v_no_result, 'voided', v_voided)
         || public.match_reminders_tick(now())
         || jsonb_build_object('levels', public.match_levels_tick(now()));
end;
$$;

-- Internal: service_role only.
revoke all on function public.match_level_start(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.match_level_start(text, text, text, integer) to service_role;
revoke all on function public.match_rater_weight(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_rater_weight(uuid, uuid) to service_role;
revoke all on function public.match_rating_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_rating_for(uuid, uuid) to service_role;
revoke all on function public.apply_match_levels(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_match_levels(uuid, timestamptz) to service_role;
revoke all on function public.match_levels_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.match_levels_tick(timestamptz) to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;

-- What the app may call: they check the caller themselves.
revoke all on function public.set_starting_level(text, text, text, text, integer) from public, anon;
grant execute on function public.set_starting_level(text, text, text, text, integer) to authenticated, service_role;
revoke all on function public.set_match_competitive(uuid, boolean) from public, anon;
grant execute on function public.set_match_competitive(uuid, boolean) to authenticated, service_role;
revoke all on function public.rate_match_player(uuid, uuid, integer) from public, anon;
grant execute on function public.rate_match_player(uuid, uuid, integer) to authenticated, service_role;
revoke all on function public.get_match_ratings(uuid) from public, anon;
grant execute on function public.get_match_ratings(uuid) to authenticated, service_role;
revoke all on function public.balance_match_teams(uuid) from public, anon;
grant execute on function public.balance_match_teams(uuid) to authenticated, service_role;
