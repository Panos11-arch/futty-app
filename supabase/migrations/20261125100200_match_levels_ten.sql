-- S13B, part 3: personal levels on 1.0–10.0 (decided by Panos, 22
-- November; OK'd by Anghelo, owner of the level code).
--
-- * Every stored level is converted once: new = 1 + (old − 1) × 1.5,
--   rounded to 2 decimals (player_levels.level, player_level_history
--   level_before and level_after). No other table stores a numeric level:
--   squad posts keep their word levels and XP tiers, teams and saved
--   searches have none.
-- * The starting level is the self-rating the player picks at sign-up
--   (7 → 7.0), if it is within 1 of the rating the server expects from his
--   answers: expected = 3 + round(7 × points / 3.7), with the points of
--   decision 1f.2 (years 0/0.3/0.6/0.8, highest level 0/0.7/1.5/2.2, how
--   often 0/0.2/0.5/0.7; total 0–3.7), so 3–10. Outside it,
--   set_starting_level refuses with self_rating_out_of_range and the range
--   in the error's detail ({"low": n, "high": n}). match_level_expected
--   replaces match_level_start. Provisional until 5 competitive matches, as
--   before. A player with no answers starts at 4.0 (the old 3.0).
-- * After a confirmed competitive match, the same update scaled by 1.5:
--     E = 1 / (1 + 10^((opponents' average − own side's average) / 3))
--     K = 0.60 for a player's first 10 competitive matches, then 0.30
--     move = K × (S − E) × (1 − reliability / 200)
--   then the S13B match rating nudges it by 0.15 × (rating − 6.5) / 3.5,
--   never more than 0.15 either way; clamped to 1.0–10.0. Reliability and
--   the provisional rule are unchanged. Casual, forfeit, disputed,
--   no_result and void matches still never move a level. Every constant is
--   in app_rules.
--
-- Re-created from their latest definitions
-- (20261117192224_match_levels_functions.sql), with only these changes:
-- set_starting_level, apply_match_levels and balance_match_teams (its
-- default level). match_level_start is dropped.

alter table public.app_rules
  add column level_min numeric(4,2) not null default 1.0,
  add column level_max numeric(4,2) not null default 10.0,
  add column level_default numeric(4,2) not null default 4.0,
  add column level_elo_divisor numeric(4,2) not null default 3,
  add column level_k_new numeric(4,2) not null default 0.60,
  add column level_k numeric(4,2) not null default 0.30,
  add column level_k_new_matches integer not null default 10,
  add column level_nudge_max numeric(4,2) not null default 0.15,
  add column level_nudge_centre numeric(4,2) not null default 6.5,
  add column level_nudge_span numeric(4,2) not null default 3.5,
  add column level_self_rating_margin integer not null default 1 check (level_self_rating_margin >= 0),
  add constraint app_rules_level_range check (level_min < level_max and level_nudge_span > 0 and level_elo_divisor > 0);

-- A level on the old 1-7 scale on the new 1-10 scale.
create or replace function public.match_level_to_ten(p_level numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(1 + (p_level - 1) * 1.5, 2);
$$;

-- The conversion, once.
alter table public.player_levels drop constraint player_levels_level_check;
update public.player_levels set level = public.match_level_to_ten(level);
alter table public.player_levels add constraint player_levels_level_check check (level between 1 and 10);
update public.player_level_history
set level_before = public.match_level_to_ten(level_before),
    level_after = public.match_level_to_ten(level_after);

-- The rating the server expects from the three answers (3–10).
create or replace function public.match_level_expected(p_years text, p_highest text, p_frequency text)
returns integer
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v numeric;
begin
  v := case p_years when 'under_1' then 0 when '1_3' then 0.3 when '3_10' then 0.6 when 'over_10' then 0.8 end
     + case p_highest when 'kickabout' then 0 when 'amateur' then 0.7 when 'semi_pro' then 1.5 when 'professional' then 2.2 end
     + case p_frequency when 'rarely' then 0 when 'monthly' then 0.2 when 'weekly' then 0.5 when 'several_weekly' then 0.7 end;
  if v is null then
    raise exception 'invalid_answer';
  end if;
  return 3 + round(7 * v / 3.7)::integer;
end;
$$;

drop function public.match_level_start(text, text, text, integer);

-- The app calls this once, after sign-up. A default level (never answered,
-- no competitive match yet) is replaced; anything else is level_already_set.
-- The level is the self-rating, if it is within the margin of the expected
-- rating; otherwise self_rating_out_of_range, with the allowed range.
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
  v_rules public.app_rules := public.app_rules_now();
  v_expected integer;
  v_low integer;
  v_high integer;
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
  if p_self_rating is null or p_self_rating not between 1 and 10 then
    raise exception 'invalid_answer';
  end if;
  v_expected := public.match_level_expected(p_years, p_highest, p_frequency);
  v_low := greatest(1, v_expected - v_rules.level_self_rating_margin);
  v_high := least(10, v_expected + v_rules.level_self_rating_margin);
  if p_self_rating not between v_low and v_high then
    raise exception 'self_rating_out_of_range'
      using detail = jsonb_build_object('low', v_low, 'high', v_high)::text;
  end if;
  v_level := round(p_self_rating::numeric, 2);

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
  r public.app_rules := public.app_rules_now();
  v_avg_a numeric;
  v_avg_b numeric;
  v_p record;
  v_level public.player_levels;
  v_s numeric;
  v_e numeric;
  v_k numeric;
  v_after numeric;
  v_final numeric;
  v_rating numeric;
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

  -- The ratings are final once voting has closed (Man of the Match).
  if v_match.ratings_final_at is null then
    perform public.match_compute_ratings(p_match_id, p_now);
    update public.matches set ratings_final_at = p_now where id = p_match_id;
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
  select u.profile_id, r.level_default, true, 0, 0, 'default' from unnest(v_profiles) u(profile_id)
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
    v_e := 1 / (1 + power(10::numeric, (case v_p.side when 'a' then v_avg_b - v_avg_a else v_avg_a - v_avg_b end)
                                       / r.level_elo_divisor));
    v_k := case when v_level.competitive_matches < r.level_k_new_matches then r.level_k_new else r.level_k end;
    v_after := round(least(r.level_max, greatest(r.level_min,
                 v_level.level + v_k * (v_s - v_e) * (1 - v_level.reliability_pct / 200.0))), 2);
    insert into public.player_level_history (profile_id, match_id, reason, level_before, level_after)
    values (v_p.profile_id, p_match_id, 'result', v_level.level, v_after);

    v_final := v_after;
    select mr.rating into v_rating from public.match_player_ratings mr
    where mr.match_id = p_match_id and mr.player_id = v_p.player_id;
    if v_rating is not null then
      v_final := round(least(r.level_max, greatest(r.level_min, v_after
                 + least(r.level_nudge_max, greatest(-r.level_nudge_max,
                     r.level_nudge_max * (v_rating - r.level_nudge_centre) / r.level_nudge_span)))), 2);
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

-- The booker of a pickup splits it into two sides whose average levels are
-- closest (decision 1f.5). A player with no level counts as the default
-- level (app_rules.level_default, 4.0).
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
  from (select mp.id, mp.profile_id, mp.profile_id = v_booker as is_booker, coalesce(pl.level, (public.app_rules_now()).level_default) as level
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

revoke all on function public.match_level_to_ten(numeric) from public, anon, authenticated;
grant execute on function public.match_level_to_ten(numeric) to service_role;
revoke all on function public.match_level_expected(text, text, text) from public, anon, authenticated;
grant execute on function public.match_level_expected(text, text, text) to service_role;
