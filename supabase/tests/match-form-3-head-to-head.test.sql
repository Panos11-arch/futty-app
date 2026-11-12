-- A3b (docs/specs/match-record.md section 7, decision 1c): head_to_head
-- between named teams (won, drawn, lost, goals, last 3, from each team's
-- side) and player_teammates ("players you play with most": both checked
-- in, same side, confirmed; each player reads only their own list).
begin;

-- The results in a head_to_head row's last_3, in order.
create function tests.mf_last_3(p_last_3 jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(e ->> 'result' order by i), '{}') from jsonb_array_elements(p_last_3) with ordinality as t(e, i);
$$;

do $$
declare
  v_lions uuid := tests.create_team('Lions');
  v_tigers uuid := tests.create_team('Tigers');
  v_bears uuid := tests.create_team('Bears');
  me uuid := tests.create_user('mf3-me@futty.test');
  mate uuid := tests.create_user('mf3-mate@futty.test');
  opp uuid := tests.create_user('mf3-opp@futty.test');
  no_show uuid := tests.create_user('mf3-no-show@futty.test');
  m_draw uuid := tests.form_match('2026-11-07T17:00:00Z', 'confirmed', 2, 2, v_lions, v_tigers);
  m_won uuid := tests.form_match('2026-11-05T17:00:00Z', 'confirmed', 3, 1, v_lions, v_tigers);
  -- Tigers booked this one: Lions are side b.
  m_lost uuid := tests.form_match('2026-11-03T17:00:00Z', 'confirmed', 1, 0, v_tigers, v_lions);
  m_forfeit uuid := tests.form_match('2026-10-31T17:00:00Z', 'confirmed', null, null, v_lions, v_tigers, 'b', 'pulled_out');
  m_disputed uuid := tests.form_match('2026-10-24T16:00:00Z', 'disputed', null, null, v_lions, v_tigers);
  m_bears uuid := tests.form_match('2026-10-20T16:00:00Z', 'confirmed', 5, 0, v_lions, v_bears);
  m_pickup uuid := tests.form_match('2026-10-18T16:00:00Z', 'confirmed', 4, 4);
  v_row record;
begin
  perform tests.form_player(m_draw, me, 'a', true, true);
  perform tests.form_player(m_draw, mate, 'a', true, true);
  perform tests.form_player(m_draw, opp, 'b', false, true);
  perform tests.form_player(m_draw, no_show, 'a', true, false);
  perform tests.form_player(m_won, me, 'a', true, true);
  perform tests.form_player(m_won, mate, 'a', true, true);
  perform tests.form_player(m_lost, me, 'b', false, true);
  perform tests.form_player(m_lost, mate, 'b', false, true);
  perform tests.form_player(m_lost, opp, 'a', true, true);
  -- A forfeit nobody played: no check-ins, so not "played with".
  perform tests.form_player(m_forfeit, me, 'a', true, false);
  perform tests.form_player(m_forfeit, mate, 'a', true, false);
  -- Disputed: never counts.
  perform tests.form_player(m_disputed, me, 'a', true, true);
  perform tests.form_player(m_disputed, mate, 'a', true, true);

  perform tests.act_as(no_show);

  -- Lions v Tigers, from the Lions' side: 2-2 D, 3-1 W, 0-1 L, forfeit W
  -- (no goals). The disputed match and the Bears game aren't in it.
  select * into v_row from public.head_to_head where team_id = v_lions and opponent_team_id = v_tigers;
  assert v_row.played = 4 and v_row.won = 2 and v_row.drawn = 1 and v_row.lost = 1,
    format('lions record: %s', row_to_json(v_row));
  assert v_row.goals_for = 5 and v_row.goals_against = 4, format('lions goals: %s', row_to_json(v_row));
  assert tests.mf_last_3(v_row.last_3) = array['D', 'W', 'L'], format('lions last 3: %s', v_row.last_3);
  assert (v_row.last_3 -> 0 ->> 'matchId')::uuid = m_draw and (v_row.last_3 -> 1 ->> 'goalsFor')::int = 3
         and (v_row.last_3 -> 1 ->> 'goalsAgainst')::int = 1 and (v_row.last_3 -> 2 ->> 'goalsFor')::int = 0
         and (v_row.last_3 -> 2 ->> 'goalsAgainst')::int = 1, format('lions last 3 detail: %s', v_row.last_3);

  -- The same games from the Tigers' side.
  select * into v_row from public.head_to_head where team_id = v_tigers and opponent_team_id = v_lions;
  assert v_row.played = 4 and v_row.won = 1 and v_row.drawn = 1 and v_row.lost = 2
         and v_row.goals_for = 4 and v_row.goals_against = 5, format('tigers: %s', row_to_json(v_row));
  assert tests.mf_last_3(v_row.last_3) = array['D', 'L', 'W'], format('tigers last 3: %s', v_row.last_3);

  -- Lions v Bears is its own pair; a forfeit's last_3 entry has no goals.
  select * into v_row from public.head_to_head where team_id = v_lions and opponent_team_id = v_bears;
  assert v_row.played = 1 and v_row.won = 1 and v_row.goals_for = 5 and v_row.goals_against = 0, 'lions v bears';
  assert not exists (select 1 from public.head_to_head where team_id = v_bears and opponent_team_id = v_tigers),
    'teams that never met';
  assert not exists (select 1 from public.head_to_head where team_id is null or opponent_team_id is null), 'pickup';

  perform tests.act_as_postgres();

  -- A forfeit's entry in last_3 (the Tigers' four games, older one shown
  -- when the newer three are left out).
  delete from public.matches where id in (m_draw, m_won);
  perform tests.act_as(no_show);
  select * into v_row from public.head_to_head where team_id = v_tigers and opponent_team_id = v_lions;
  assert tests.mf_last_3(v_row.last_3) = array['W', 'L_forfeit'], format('tigers after delete: %s', v_row.last_3);
  assert v_row.last_3 -> 1 -> 'goalsFor' = 'null'::jsonb and v_row.lost = 1 and v_row.won = 1, 'forfeit in last_3';
  perform tests.act_as_postgres();
end $$;

-- Players you play with most.
do $$
declare
  v_lions uuid := tests.create_team('Lions');
  v_tigers uuid := tests.create_team('Tigers');
  me uuid := tests.create_user('mf3b-me@futty.test');
  mate uuid := tests.create_user('mf3b-mate@futty.test');
  opp uuid := tests.create_user('mf3b-opp@futty.test');
  no_show uuid := tests.create_user('mf3b-no-show@futty.test');
  m1 uuid := tests.form_match('2026-11-07T17:00:00Z', 'confirmed', 2, 2, v_lions, v_tigers);
  m2 uuid := tests.form_match('2026-11-05T17:00:00Z', 'confirmed', 3, 1, v_lions, v_tigers);
  m3 uuid := tests.form_match('2026-11-03T17:00:00Z', 'confirmed', 1, 0, v_tigers, v_lions);
  m_forfeit uuid := tests.form_match('2026-10-31T17:00:00Z', 'confirmed', null, null, v_lions, v_tigers, 'b', 'pulled_out');
  m_disputed uuid := tests.form_match('2026-10-24T16:00:00Z', 'disputed', null, null, v_lions, v_tigers);
  v_row record;
begin
  perform tests.form_player(m1, me, 'a', true, true);
  perform tests.form_player(m1, mate, 'a', true, true);
  perform tests.form_player(m1, opp, 'b', false, true);
  perform tests.form_player(m1, no_show, 'a', true, false);
  perform tests.form_player(m2, me, 'a', true, true);
  perform tests.form_player(m2, mate, 'a', true, true);
  perform tests.form_player(m3, me, 'b', false, true);
  perform tests.form_player(m3, mate, 'b', false, true);
  perform tests.form_player(m3, opp, 'a', true, true);
  perform tests.form_player(m_forfeit, me, 'a', true, false);
  perform tests.form_player(m_forfeit, mate, 'a', true, false);
  perform tests.form_player(m_disputed, me, 'a', true, true);
  perform tests.form_player(m_disputed, mate, 'a', true, true);

  perform tests.act_as(me);
  -- Same side, both checked in, confirmed: m1, m2 and m3 (on side b).
  assert (select count(*) from public.player_teammates) = 1, 'me: one teammate';
  select * into v_row from public.player_teammates where teammate_profile_id = mate;
  assert v_row.profile_id = me and v_row.matches_together = 3
         and v_row.last_played_at = timestamptz '2026-11-07T17:00:00Z', format('me and mate: %s', row_to_json(v_row));
  -- An opponent, a teammate who never checked in: not "played with".
  assert not exists (select 1 from public.player_teammates where teammate_profile_id in (opp, no_show)), 'opp, no show';
  perform tests.act_as_postgres();

  -- Only your own list: mate sees me; I can't read mate's list.
  perform tests.act_as(mate);
  assert (select matches_together from public.player_teammates where teammate_profile_id = me) = 3, 'mate sees me';
  assert (select count(*) from public.player_teammates where profile_id <> mate) = 0, 'mate sees only own rows';
  perform tests.act_as_postgres();
  perform tests.act_as(opp);
  assert (select count(*) from public.player_teammates where profile_id in (me, mate)) = 0, 'opp cannot read others';
  perform tests.act_as_postgres();
end $$;

rollback;
