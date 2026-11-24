-- S5: the venue page's Home tab (venue_highlights).
--   Top players: the best average match rating at this venue over the last
--   30 days, from ratings the match page already shows (match_rating_shown:
--   confirmed, not a forfeit, 3 or more ratings, the 24-hour window closed),
--   with at least 3 such matches. Best average first; ties go to more
--   matches. At most 5.
--   Recent results: the last confirmed matches at this venue with a score
--   (no forfeits), newest first, with each side's label, team and score. At
--   most 5.
-- Only for a venue the caller can see (venue_visible); never another
-- venue's matches, never an individual rating.
begin;

-- p_profile plays p_match on side a, checked in, and gets p_score from three raters.
create function tests.vh_rated(p_match uuid, p_profile uuid, p_score integer)
returns void
language plpgsql
as $$
declare
  i integer;
begin
  perform tests.form_player(p_match, p_profile, 'a', true, true);
  for i in 1..3 loop
    insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score)
    values (p_match, tests.create_user('vh-r-' || gen_random_uuid() || '@futty.test'), tests.player_id(p_match, p_profile),
            p_score);
  end loop;
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
  team_a uuid := tests.create_team('VH Lions');
  team_b uuid := tests.create_team('VH Tigers');
  m uuid;
  ms uuid[] := '{}';
  i integer;
  r jsonb;
  v_top jsonb;
  v_results jsonb;
begin
  update public.venues set is_live = true where id in (v_venue, v_other);
  update public.venues set is_live = false where id = v_hidden;

  -- best: 4 matches here in the last 30 days, rated 8; good: 3 rated 7, and
  -- one rated 9 at another venue; two: only 2 matches here, rated 10; old: 3
  -- matches here 40 days ago, rated 10.
  for i in 1..4 loop
    m := tests.form_match(now() - make_interval(days => 2 + i), 'confirmed', i, 1, p_venue => v_venue);
    ms := ms || m;
    perform tests.vh_rated(m, best, 8);
    if i <= 3 then perform tests.vh_rated(m, good, 7); end if;
    if i <= 2 then perform tests.vh_rated(m, two, 10); end if;
  end loop;
  m := tests.form_match(now() - interval '3 days', 'confirmed', 2, 2, p_venue => v_other);
  perform tests.vh_rated(m, good, 9);
  for i in 1..3 loop
    m := tests.form_match(now() - make_interval(days => 40 + i), 'confirmed', 0, 0, p_venue => v_venue);
    perform tests.vh_rated(m, old, 10);
  end loop;
  -- Not shown: a match confirmed less than 24 hours ago (the rating window is
  -- open), a disputed match and a forfeit.
  m := tests.form_match(now() - interval '3 hours', 'confirmed', 4, 0, team_a, team_b, p_venue => v_venue);
  perform tests.vh_rated(m, two, 10);
  m := tests.form_match(now() - interval '1 day 1 hour', 'disputed', 9, 9, p_venue => v_venue);
  m := tests.form_match(now() - interval '1 day 2 hours', 'confirmed', null, null, team_a, team_b, 'b', 'pulled_out',
                        p_venue => v_venue);

  perform tests.act_as(v_viewer);
  r := public.venue_highlights(v_venue);
  v_top := r -> 'top_players';
  assert jsonb_array_length(v_top) = 2, format('best and good only (%s)', v_top);
  assert (v_top -> 0 ->> 'profile_id')::uuid = best and (v_top -> 0 ->> 'rating')::numeric = 8
         and (v_top -> 0 ->> 'matches')::integer = 4, format('best first (%s)', v_top -> 0);
  assert (v_top -> 1 ->> 'profile_id')::uuid = good and (v_top -> 1 ->> 'rating')::numeric = 7
         and (v_top -> 1 ->> 'matches')::integer = 3, format('good second, this venue only (%s)', v_top -> 1);
  assert r::text not like '%rater%', 'no individual rating';

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
