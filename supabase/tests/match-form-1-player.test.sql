-- A3b (docs/specs/match-record.md section 7, decisions 1b.2 and 1b.3): the
-- player_form and player_recent_matches views. The same cases as
-- lib/match/form.test.ts, on the same data as lib/match/mock.ts: only
-- confirmed matches count; a player counts with a check-in, and in a
-- forfeit every spot holder counts without one; last 5, newest first.
begin;

-- A player's form as a signed-in viewer reads it.
create function tests.mf_player_form(p_viewer uuid, p_profile uuid)
returns text[]
language plpgsql
as $$
declare
  v_form text[];
begin
  perform tests.act_as(p_viewer);
  select coalesce(array_agg(f.result order by f.position), '{}') into v_form
  from public.player_form f where f.profile_id = p_profile;
  perform tests.act_as_postgres();
  return v_form;
end;
$$;

do $$
declare
  v_home uuid := tests.create_team('Home FC');
  v_away uuid := tests.create_team('Away FC');
  anghelo uuid := tests.create_user('mf1-anghelo@futty.test');
  sami uuid := tests.create_user('mf1-sami@futty.test');
  left_early uuid := tests.create_user('mf1-left-early@futty.test');
  away_captain uuid := tests.create_user('mf1-away-captain@futty.test');
  away_sub uuid := tests.create_user('mf1-away-sub@futty.test');
  away_spot uuid := tests.create_user('mf1-away-spot@futty.test');
  stranger uuid := tests.create_user('mf1-stranger@futty.test');
  m_a_won uuid := tests.form_match('2026-11-07T17:00:00Z', 'confirmed', 3, 1, v_home, v_away);
  m_b_won uuid := tests.form_match('2026-11-05T17:00:00Z', 'confirmed', 0, 2, v_home, v_away);
  m_draw uuid := tests.form_match('2026-11-03T17:00:00Z', 'confirmed', 2, 2);
  m_forfeit_b uuid := tests.form_match('2026-10-31T17:00:00Z', 'confirmed', null, null, v_home, v_away, 'b', 'pulled_out');
  m_forfeit_a uuid := tests.form_match('2026-10-24T16:00:00Z', 'confirmed', null, null, v_home, v_away, 'a', 'no_show');
  m_disputed uuid := tests.form_match('2026-11-01T17:00:00Z', 'disputed', null, null, v_home, v_away);
  m_no_result uuid := tests.form_match('2026-11-02T17:00:00Z', 'no_result');
  m_older uuid := tests.form_match('2026-10-17T16:00:00Z', 'confirmed', 1, 0, v_home, v_away);
  m_oldest uuid := tests.form_match('2026-10-10T16:00:00Z', 'confirmed', 0, 1, v_home, v_away);
  v_recent record;
begin
  -- 3-1 win. Sami held a spot and didn't check in; one player left early;
  -- the away substitute is in the squad but didn't come.
  perform tests.form_player(m_a_won, anghelo, 'a', true, true);
  perform tests.form_player(m_a_won, sami, 'a', true, false);
  perform tests.form_player(m_a_won, left_early, 'a', true, true, true);
  perform tests.form_player(m_a_won, away_captain, 'b', false, true);
  perform tests.form_player(m_a_won, away_sub, 'b', false, false);
  perform tests.form_player(m_b_won, anghelo, 'a', true, true);
  perform tests.form_player(m_b_won, away_captain, 'b', false, true);
  perform tests.form_player(m_draw, anghelo, 'a', true, true);
  -- Away FC pulled out: nobody checked in. Spot holders on both sides still get it.
  perform tests.form_player(m_forfeit_b, anghelo, 'a', true, false);
  perform tests.form_player(m_forfeit_b, away_spot, 'b', true, false);
  perform tests.form_player(m_forfeit_b, away_sub, 'b', false, false);
  -- Home FC didn't show: Anghelo's and Sami's side forfeited.
  perform tests.form_player(m_forfeit_a, anghelo, 'a', true, false);
  perform tests.form_player(m_forfeit_a, sami, 'a', true, false);
  perform tests.form_player(m_forfeit_a, away_captain, 'b', false, true);
  -- Settled but not confirmed: never in form.
  perform tests.form_player(m_disputed, anghelo, 'a', true, true);
  perform tests.form_player(m_no_result, anghelo, 'a', true, true);
  -- Two older matches: seven confirmed matches, form shows five.
  perform tests.form_player(m_older, anghelo, 'a', true, true);
  perform tests.form_player(m_oldest, anghelo, 'a', true, true);

  -- Last 5 confirmed, newest first: 7 Nov W, 5 Nov L, 3 Nov D, 31 Oct W
  -- (forfeit win, no check-in), 24 Oct L (forfeit, no check-in).
  assert tests.mf_player_form(stranger, anghelo) = array['W', 'L', 'D', 'W', 'L_forfeit'],
    format('anghelo form: %s', tests.mf_player_form(stranger, anghelo));
  assert (select array_agg(position order by position) from public.player_form where profile_id = anghelo)
         = array[1, 2, 3, 4, 5]::bigint[], 'positions 1 to 5';

  -- Sami gets nothing for the normal match he missed, only his forfeit loss.
  assert tests.mf_player_form(stranger, sami) = array['L_forfeit'], format('sami: %s', tests.mf_player_form(stranger, sami));
  -- A forfeiting spot holder with no check-in gets "L (forfeit)".
  assert tests.mf_player_form(stranger, away_spot) = array['L_forfeit'], 'away spot holder';
  -- A squad member without a spot or a check-in never counts, forfeit or not.
  assert tests.mf_player_form(stranger, away_sub) = '{}', 'away substitute';
  -- A player who left doesn't count, even with a check-in row.
  assert tests.mf_player_form(stranger, left_early) = '{}', 'left early';
  -- The away captain counts on side b: 7 Nov L, 5 Nov W, 24 Oct W (they won the forfeit, checked in).
  assert tests.mf_player_form(stranger, away_captain) = array['L', 'W', 'W'],
    format('away captain: %s', tests.mf_player_form(stranger, away_captain));
  -- Someone who wasn't in any match has no form.
  assert tests.mf_player_form(anghelo, stranger) = '{}', 'stranger';

  -- Disputed and no_result matches the player checked in to are left out.
  assert not exists (select 1 from public.player_form where match_id in (m_disputed, m_no_result)), 'unsettled in form';

  -- Recent matches: every confirmed match that counts for the player, with
  -- the same rule, newest first; forfeits show which side forfeited and why.
  perform tests.act_as(stranger);
  assert (select count(*) from public.player_recent_matches where profile_id = anghelo) = 7, 'anghelo recent count';
  assert (select array_agg(result order by kickoff_at desc) from public.player_recent_matches where profile_id = anghelo)
         = array['W', 'L', 'D', 'W', 'L_forfeit', 'W', 'L'], 'anghelo recent results';
  select * into v_recent from public.player_recent_matches where profile_id = anghelo and match_id = m_a_won;
  assert v_recent.side = 'a' and v_recent.label = 'Home FC' and v_recent.opponent_label = 'Away FC'
         and v_recent.team_id = v_home and v_recent.opponent_team_id = v_away
         and v_recent.goals_for = 3 and v_recent.goals_against = 1 and v_recent.kind = 'named'
         and v_recent.kickoff_local = timestamp '2026-11-07 19:00', 'recent 3-1 row';
  select * into v_recent from public.player_recent_matches where profile_id = anghelo and match_id = m_forfeit_a;
  assert v_recent.result = 'L_forfeit' and v_recent.forfeit_side = 'a' and v_recent.forfeit_reason = 'no_show'
         and v_recent.goals_for is null and v_recent.goals_against is null, 'recent forfeit row';
  -- 24 Oct 16:00Z is 19:00 in Cyprus (UTC+3 before the clocks go back).
  assert v_recent.kickoff_local = timestamp '2026-10-24 19:00', 'kickoff_local before the clock change';
  select * into v_recent from public.player_recent_matches where profile_id = anghelo and match_id = m_draw;
  assert v_recent.label = 'Bibs' and v_recent.opponent_label = 'Non-bibs' and v_recent.team_id is null
         and v_recent.result = 'D', 'recent pickup row';
  assert not exists (select 1 from public.player_recent_matches where profile_id = sami and match_id = m_a_won),
    'sami missed the 3-1';
  perform tests.act_as_postgres();
end $$;

rollback;
