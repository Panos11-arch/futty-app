-- S14 placement (docs/specs/match-record.md decision 1k, items 3 and 4):
-- team_of_the_week_place(format, players) puts the picked players in the
-- format's shape without positions:
--   * strikers: the most goals per game;
--   * then, by goals + assists per game: midfield, then defence, except the
--     lowest, who goes in goal;
--   * ties at every step: more games, then the higher rating, then the
--     earlier sign-up;
--   * player of the week: the highest rating, same ties;
--   * fewer players than slots: strikers, midfield, keeper, then defence.
begin;

-- p as a placement input.
create function tests.p14(p_id uuid, p_games integer, p_goals integer, p_assists integer, p_rating numeric,
                          p_signed_up timestamptz default '2026-01-01 00:00+00')
returns jsonb
language sql
as $$
  select jsonb_build_object('profile_id', p_id, 'games', p_games, 'goals', p_goals, 'assists', p_assists,
                            'rating', p_rating, 'signed_up_at', p_signed_up);
$$;

-- The placement as 'slot:profile' in sort order, run as service_role.
create function tests.place14(p_format text, p_players jsonb)
returns text[]
language plpgsql
as $$
declare
  v text[];
begin
  perform tests.act_as_service_role();
  select array_agg(x.slot || ':' || x.profile_id order by x.sort) into v
  from public.team_of_the_week_place(p_format, p_players) x;
  perform tests.act_as_postgres();
  return coalesce(v, '{}');
end;
$$;

create function tests.potw14(p_format text, p_players jsonb)
returns uuid
language plpgsql
as $$
declare
  v uuid;
begin
  perform tests.act_as_service_role();
  select x.profile_id into v from public.team_of_the_week_place(p_format, p_players) x where x.player_of_the_week;
  perform tests.act_as_postgres();
  return v;
end;
$$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  ids uuid[];
  v_players jsonb;
  v_slots text[];
  v_format text;
  v_shape integer[];
  i integer;
begin
  -- 1. 5-a-side: keeper 1, defence 1, midfield 2, striker 1.
  --    D usually plays in defence but scored 5: he's the striker.
  --    A (0 G + 0 A) has the fewest goals + assists: the keeper.
  v_players := jsonb_build_array(
    tests.p14(a, 1, 0, 0, 7.0),
    tests.p14(b, 1, 1, 2, 7.5),
    tests.p14(c, 1, 1, 0, 7.2),
    tests.p14(d, 1, 5, 0, 9.0),
    tests.p14(e, 1, 0, 2, 7.3));
  v_slots := tests.place14('5-a-side', v_players);
  assert v_slots = array['gk:' || a, 'def:' || c, 'mid:' || b, 'mid:' || e, 'fwd:' || d],
    format('D (5 goals) up front; B (3 G+A) and E (2) in midfield; C (1) in defence; A (0) in goal, got %s', v_slots);
  assert tests.potw14('5-a-side', v_players) = d, 'player of the week: the highest rating';

  -- 2. Worked example: 10 goals in 1 game (10.0 per game) ranks above 20 goals in 5 (4.0 per game).
  v_players := jsonb_build_array(
    tests.p14(a, 5, 20, 0, 8.0),
    tests.p14(b, 1, 10, 0, 8.0),
    tests.p14(c, 1, 0, 0, 7.0),
    tests.p14(d, 1, 0, 1, 7.0),
    tests.p14(e, 1, 0, 2, 7.0));
  v_slots := tests.place14('5-a-side', v_players);
  assert v_slots[5] = 'fwd:' || b, format('10 in 1 game is the striker, got %s', v_slots);
  assert v_slots[3:4] = array['mid:' || a, 'mid:' || e], format('A (4.0 per game) then E (2.0) in midfield, got %s', v_slots);
  assert v_slots[1] = 'gk:' || c, format('C (0) in goal, got %s', v_slots);

  -- 3. Ties go to more games, then the higher rating, then the earlier sign-up.
  --    Strikers: A and B both 1.0 goals per game; B played 2 games.
  v_players := jsonb_build_array(
    tests.p14(a, 1, 1, 0, 9.0),
    tests.p14(b, 2, 2, 0, 7.0),
    tests.p14(c, 1, 0, 0, 7.0),
    tests.p14(d, 1, 0, 0, 7.0),
    tests.p14(e, 1, 0, 0, 7.0));
  assert tests.place14('5-a-side', v_players) @> array['fwd:' || b], 'striker tie: more games';
  --    Same games: the higher rating.
  v_players := jsonb_build_array(
    tests.p14(a, 1, 1, 0, 9.0),
    tests.p14(b, 1, 1, 0, 7.0),
    tests.p14(c, 1, 0, 0, 7.0),
    tests.p14(d, 1, 0, 0, 7.0),
    tests.p14(e, 1, 0, 0, 7.0));
  assert tests.place14('5-a-side', v_players) @> array['fwd:' || a], 'striker tie: higher rating';
  --    Same rating: the earlier sign-up.
  v_players := jsonb_build_array(
    tests.p14(a, 1, 1, 0, 7.0, '2026-02-01 00:00+00'),
    tests.p14(b, 1, 1, 0, 7.0, '2026-01-01 00:00+00'),
    tests.p14(c, 1, 0, 0, 7.0),
    tests.p14(d, 1, 0, 0, 7.0),
    tests.p14(e, 1, 0, 0, 7.0));
  assert tests.place14('5-a-side', v_players) @> array['fwd:' || b], 'striker tie: earlier sign-up';
  --    The keeper: C, D and E all have 0 goals + assists; E has the lowest rating, so he loses the tie and goes in goal.
  v_players := jsonb_build_array(
    tests.p14(a, 1, 2, 0, 9.0),
    tests.p14(b, 1, 0, 1, 8.0),
    tests.p14(c, 1, 0, 0, 7.5),
    tests.p14(d, 1, 0, 0, 7.4),
    tests.p14(e, 1, 0, 0, 7.0));
  v_slots := tests.place14('5-a-side', v_players);
  assert v_slots = array['gk:' || e, 'def:' || d, 'mid:' || b, 'mid:' || c, 'fwd:' || a],
    format('keeper tie: the one who loses the tie goes in goal, got %s', v_slots);
  --    Player of the week tie: same rating, more games.
  v_players := jsonb_build_array(
    tests.p14(a, 1, 2, 0, 9.0),
    tests.p14(b, 3, 0, 1, 9.0),
    tests.p14(c, 1, 0, 0, 7.5),
    tests.p14(d, 1, 0, 0, 7.4),
    tests.p14(e, 1, 0, 0, 7.0));
  assert tests.potw14('5-a-side', v_players) = b, 'player of the week tie: more games';

  -- 4. Every shape: keeper, defence, midfield, strikers.
  foreach v_format in array array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] loop
    v_shape := case v_format
                 when '5-a-side' then array[1, 1, 2, 1]
                 when '6-a-side' then array[1, 2, 2, 1]
                 when '7-a-side' then array[1, 2, 3, 1]
                 when '9-a-side' then array[1, 3, 3, 2]
                 else array[1, 4, 3, 3] end;
    ids := '{}';
    v_players := '[]';
    for i in 1 .. (v_shape[1] + v_shape[2] + v_shape[3] + v_shape[4]) loop
      ids := ids || gen_random_uuid();
      v_players := v_players || jsonb_build_array(tests.p14(ids[i], 1, i, 0, 7.0));
    end loop;
    v_slots := tests.place14(v_format, v_players);
    assert (select array[count(*) filter (where s like 'gk:%'), count(*) filter (where s like 'def:%'),
                         count(*) filter (where s like 'mid:%'), count(*) filter (where s like 'fwd:%')]::integer[]
            from unnest(v_slots) s) = v_shape,
      format('%s shape %s, got %s', v_format, v_shape, v_slots);
    -- More goals, further forward; the fewest in goal.
    assert v_slots[array_length(v_slots, 1)] like 'fwd:%' and v_slots[1] = 'gk:' || ids[1],
      format('%s: the fewest goals in goal, got %s', v_format, v_slots);
  end loop;

  -- 5. Fewer players than slots: strikers, midfield, keeper, then defence.
  v_players := jsonb_build_array(tests.p14(a, 1, 3, 0, 8.0), tests.p14(b, 1, 1, 0, 7.0), tests.p14(c, 1, 0, 1, 6.9));
  v_slots := tests.place14('5-a-side', v_players);
  assert v_slots = array['mid:' || b, 'mid:' || c, 'fwd:' || a], format('three players: no keeper or defender, got %s', v_slots);
  v_players := v_players || jsonb_build_array(tests.p14(d, 1, 0, 0, 7.0));
  v_slots := tests.place14('5-a-side', v_players);
  assert v_slots = array['gk:' || d, 'mid:' || b, 'mid:' || c, 'fwd:' || a], format('four: a keeper, no defender, got %s', v_slots);
  assert tests.place14('5-a-side', '[]') = '{}', 'nobody: nothing';

  -- 6. An unknown format is refused.
  perform tests.act_as_service_role();
  assert tests.error_of(format('select * from public.team_of_the_week_place(%L, %L)', '8-a-side', '[]')) = 'unknown_format',
    'unknown format';
  perform tests.act_as_postgres();
end $$;

rollback;
