-- S5: the venue page's Home tab (venue_highlights).
--   Top players: the best average match rating at this venue over the last
--   30 days, from ratings the match page shows (match_rating_shown: the
--   S13B rating computed from a confirmed match's stats, not a forfeit),
--   with at least 3 such matches. A rating counts as soon as the match is
--   confirmed (no 24-hour wait, no minimum number of votes), and a
--   correction within 24 hours recomputes it. Best average first; ties go
--   to more matches. At most 5.
--   Recent results: the last confirmed matches at this venue with a score
--   (no forfeits), newest first, with each side's label, team and score. At
--   most 5.
-- Only for a venue the caller can see (venue_visible); never another
-- venue's matches, never an individual rating.
--
-- Ratings (app_rules defaults): 6.5; win +0.6, draw +0.2; each goal +0.8;
-- each assist +0.5; clean sheet +0.5; each goal conceded -0.1.
begin;

-- p_profile plays p_match on p_side and checks in.
create function tests.vh_play(p_match uuid, p_profile uuid, p_side text default 'a')
returns void
language sql
as $$
  select tests.form_player(p_match, p_profile, p_side, true, true);
$$;

-- A goal for side a in p_match by p_scorer, set up by p_assist.
create function tests.vh_goal(p_match uuid, p_scorer uuid, p_assist uuid default null)
returns void
language sql
as $$
  insert into public.match_goals (match_id, side, sort, scorer_player_id, assist_player_id, entered_by)
  values (p_match, 'a', (select count(*) + 1 from public.match_goals where match_id = p_match),
          tests.player_id(p_match, p_scorer),
          case when p_assist is not null then tests.player_id(p_match, p_assist) end, p_scorer);
$$;

-- The S13B ratings of p_match, as on confirmation.
create function tests.vh_rate(p_match uuid)
returns void
language plpgsql
as $$
begin
  perform tests.act_as_service_role();
  perform public.match_compute_ratings(p_match);
  perform tests.act_as_postgres();
end;
$$;

do $$
declare
  v_owner uuid := tests.create_user('vh-owner@futty.test');
  v_viewer uuid := tests.create_user('vh-viewer@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other uuid := tests.create_venue(p_pitches => 1);
  v_hidden uuid := tests.create_venue(p_pitches => 1);
  best uuid := tests.create_user('vh-best@futty.test');
  good uuid := tests.create_user('vh-good@futty.test');
  two uuid := tests.create_user('vh-two@futty.test');
  old uuid := tests.create_user('vh-old@futty.test');
  cap uuid := tests.create_user('vh-cap@futty.test');
  team_a uuid := tests.create_team('VH Lions');
  team_b uuid := tests.create_team('VH Tigers');
  m uuid;
  v_named uuid;
  ms uuid[] := '{}';
  i integer;
  r jsonb;
  v_top jsonb;
  v_results jsonb;
begin
  update public.venues set is_live = true where id in (v_venue, v_other);
  update public.venues set is_live = false where id = v_hidden;

  -- Four pickups here, 3 to 6 days ago, side a winning i:1 (i = 1 a draw).
  -- best plays all four and scores once in each; good plays the first three
  -- and sets up best's goal; two plays the first two and scores in the second.
  --   i = 1 (1:1): best 6.5 + 0.2 - 0.1 + 0.8 = 7.4; good 6.6 + 0.5 = 7.1; two 6.6
  --   i = 2 (2:1): best 7.0 + 0.8 = 7.8; good 7.5; two 7.8
  --   i = 3 (3:1): best 7.8; good 7.5
  --   i = 4 (4:1): best 7.8
  -- best: (7.4 + 3 x 7.8) / 4 = 7.70 over 4; good: 22.1 / 3 = 7.37 over 3.
  for i in 1..4 loop
    m := tests.form_match(now() - make_interval(days => 2 + i), 'confirmed', i, 1, p_venue => v_venue);
    ms := ms || m;
    perform tests.vh_play(m, best);
    if i <= 3 then perform tests.vh_play(m, good); end if;
    if i <= 2 then perform tests.vh_play(m, two); end if;
    perform tests.vh_goal(m, best, case when i <= 3 then good end);
    if i = 2 then perform tests.vh_goal(m, two); end if;
    perform tests.vh_rate(m);
  end loop;
  assert (select array_agg(tests.s13b_rating(x, best) order by n) from unnest(ms) with ordinality u(x, n))
         = array[7.4, 7.8, 7.8, 7.8]::numeric[], 'best''s computed ratings';

  -- good at another venue: a 2:2 with two goals (8.2), never counted here.
  m := tests.form_match(now() - interval '3 days', 'confirmed', 2, 2, p_venue => v_other);
  perform tests.vh_play(m, good);
  perform tests.vh_goal(m, good);
  perform tests.vh_goal(m, good);
  perform tests.vh_rate(m);
  -- old: three 0:0 draws here 40 days ago (7.2 each), past the 30 days.
  for i in 1..3 loop
    m := tests.form_match(now() - make_interval(days => 40 + i), 'confirmed', 0, 0, p_venue => v_venue);
    perform tests.vh_play(m, old);
    perform tests.vh_rate(m);
  end loop;

  -- Confirmed 1 hour ago (kicked off 3 hours ago), a named 4:0: counts at
  -- once. two scores twice: 6.5 + 0.6 + 0.5 + 1.6 = 9.2, his third match
  -- here: (6.6 + 7.8 + 9.2) / 3 = 7.87. cap (side a's captain) the other two.
  v_named := tests.form_match(now() - interval '3 hours', 'confirmed', 4, 0, team_a, team_b, p_venue => v_venue);
  update public.match_sides set captain_profile_id = cap where match_id = v_named and side = 'a';
  perform tests.vh_play(v_named, two);
  perform tests.vh_play(v_named, cap);
  perform tests.vh_goal(v_named, two);
  perform tests.vh_goal(v_named, two);
  perform tests.vh_goal(v_named, cap);
  perform tests.vh_goal(v_named, cap);
  perform tests.vh_rate(v_named);
  assert tests.s13b_rating(v_named, two) = 9.2, format('two''s rating at once (%s)', tests.s13b_rating(v_named, two));

  -- Not shown: a disputed match and a forfeit (no ratings), though best plays both.
  m := tests.form_match(now() - interval '1 day 1 hour', 'disputed', 9, 9, p_venue => v_venue);
  perform tests.vh_play(m, best);
  perform tests.vh_rate(m);
  m := tests.form_match(now() - interval '1 day 2 hours', 'confirmed', null, null, team_a, team_b, 'b', 'pulled_out',
                        p_venue => v_venue);
  perform tests.vh_play(m, best);
  perform tests.vh_rate(m);

  perform tests.act_as(v_viewer);
  r := public.venue_highlights(v_venue);
  v_top := r -> 'top_players';
  assert jsonb_array_length(v_top) = 3, format('two, best and good (%s)', v_top);
  assert (v_top -> 0 ->> 'profile_id')::uuid = two and (v_top -> 0 ->> 'rating')::numeric = 7.87
         and (v_top -> 0 ->> 'matches')::integer = 3,
    format('two first, the hour-old match counted (%s)', v_top -> 0);
  assert (v_top -> 1 ->> 'profile_id')::uuid = best and (v_top -> 1 ->> 'rating')::numeric = 7.70
         and (v_top -> 1 ->> 'matches')::integer = 4,
    format('best second, no disputed match or forfeit (%s)', v_top -> 1);
  assert (v_top -> 2 ->> 'profile_id')::uuid = good and (v_top -> 2 ->> 'rating')::numeric = 7.37
         and (v_top -> 2 ->> 'matches')::integer = 3, format('good third, this venue only (%s)', v_top -> 2);
  assert r::text not like '%rater%', 'no individual rating';
  perform tests.act_as_postgres();

  -- A correction within 24 hours changes the highlight: cap gives two's two
  -- goals to himself. two: 6.5 + 0.6 + 0.5 = 7.6, (6.6 + 7.8 + 7.6) / 3 = 7.33.
  perform tests.act_as(cap);
  perform public.set_match_stats(v_named, jsonb_build_object('a', tests.s13b_side(v_named, array[two, cap], array[0, 4])));
  perform tests.act_as(v_viewer);
  v_top := public.venue_highlights(v_venue) -> 'top_players';
  assert (select array_agg(x ->> 'profile_id' order by n) from jsonb_array_elements(v_top) with ordinality e(x, n))
         = array[best, good, two]::text[], format('after the correction: best, good, two (%s)', v_top);
  assert (v_top -> 2 ->> 'rating')::numeric = 7.33, format('two recomputed (%s)', v_top -> 2);

  -- Recent results: the 3-hour-old 4-0 (named), then the four 30-day games;
  -- at most 5; no disputed match or forfeit.
  v_results := r -> 'recent_results';
  assert jsonb_array_length(v_results) = 5, format('five results (%s)', v_results);
  assert v_results -> 0 -> 'sides' = jsonb_build_array(
           jsonb_build_object('side', 'a', 'label', 'VH Lions', 'team_id', team_a, 'score', 4),
           jsonb_build_object('side', 'b', 'label', 'VH Tigers', 'team_id', team_b, 'score', 0)),
    format('the newest first, with its teams (%s)', v_results -> 0);
  assert (v_results -> 1 ->> 'match_id')::uuid = ms[1] and v_results -> 1 -> 'sides' -> 0 ->> 'label' = 'Bibs'
         and (v_results -> 1 -> 'sides' -> 1 ->> 'team_id') is null,
    format('then the pickup games (%s)', v_results -> 1);
  assert (select bool_and((x ->> 'kickoff_at') is not null) from jsonb_array_elements(v_results) x), 'kickoff times';

  -- Nothing yet: empty lists, not an error.
  r := public.venue_highlights(v_other);
  assert jsonb_array_length(r -> 'top_players') = 0, 'one match is not enough';
  assert jsonb_array_length(r -> 'recent_results') = 1, 'its one result';

  -- Refused: a venue the caller can't see; signed out.
  assert tests.error_of(format('select public.venue_highlights(%L)', v_hidden)) = 'venue_not_found', 'a hidden venue';
  assert tests.error_of(format('select public.venue_highlights(%L)', gen_random_uuid())) = 'venue_not_found',
    'an unknown venue';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.venue_highlights(%L)', v_venue)) is not null, 'signed out';
  perform tests.act_as_postgres();
  assert not has_function_privilege('anon', 'public.venue_highlights(uuid)', 'execute'), 'anon can''t call it';
end $$;

rollback;
