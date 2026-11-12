-- A3b (docs/specs/match-record.md section 7, decision 1b.3): the team_form
-- view. Same cases as teamForm in lib/match/form.test.ts: every confirmed
-- match a named team played, newest first, last 5, whoever checked in.
-- Pickup games and other teams never count; disputed never counts.
begin;

create function tests.mf_team_form(p_viewer uuid, p_team uuid)
returns text[]
language plpgsql
as $$
declare
  v_form text[];
begin
  perform tests.act_as(p_viewer);
  select coalesce(array_agg(f.result order by f.position), '{}') into v_form
  from public.team_form f where f.team_id = p_team;
  perform tests.act_as_postgres();
  return v_form;
end;
$$;

do $$
declare
  v_home uuid := tests.create_team('Home FC');
  v_away uuid := tests.create_team('Away FC');
  v_other uuid := tests.create_team('Other FC');
  anghelo uuid := tests.create_user('mf2-anghelo@futty.test');
  away_captain uuid := tests.create_user('mf2-away-captain@futty.test');
  viewer uuid := tests.create_user('mf2-viewer@futty.test');
  m_a_won uuid := tests.form_match('2026-11-07T17:00:00Z', 'confirmed', 3, 1, v_home, v_away);
  m_b_won uuid := tests.form_match('2026-11-05T17:00:00Z', 'confirmed', 0, 2, v_home, v_away);
  m_draw uuid := tests.form_match('2026-11-03T17:00:00Z', 'confirmed', 2, 2);
  m_forfeit_b uuid := tests.form_match('2026-10-31T17:00:00Z', 'confirmed', null, null, v_home, v_away, 'b', 'pulled_out');
  m_forfeit_a uuid := tests.form_match('2026-10-24T16:00:00Z', 'confirmed', null, null, v_home, v_away, 'a', 'no_show');
  m_disputed uuid := tests.form_match('2026-11-01T17:00:00Z', 'disputed', null, null, v_home, v_away);
  m_older uuid := tests.form_match('2026-10-17T16:00:00Z', 'confirmed', 1, 0, v_home, v_away);
  m_oldest uuid := tests.form_match('2026-10-10T16:00:00Z', 'confirmed', 0, 1, v_home, v_away);
  v_with text[];
begin
  perform tests.form_player(m_a_won, anghelo, 'a', true, true);
  perform tests.form_player(m_a_won, away_captain, 'b', false, true);
  perform tests.form_player(m_b_won, anghelo, 'a', true, true);
  perform tests.form_player(m_draw, anghelo, 'a', true, true);
  perform tests.form_player(m_forfeit_a, away_captain, 'b', false, true);
  perform tests.form_player(m_disputed, anghelo, 'a', true, true);
  perform tests.form_player(m_older, anghelo, 'a', true, true);
  perform tests.form_player(m_oldest, anghelo, 'a', true, true);

  -- 7 Nov W, 5 Nov L, 31 Oct W (they pulled out), 24 Oct L (forfeit), 17 Oct W; 10 Oct is the sixth.
  v_with := tests.mf_team_form(viewer, v_home);
  assert v_with = array['W', 'L', 'W', 'L_forfeit', 'W'], format('home: %s', v_with);
  assert tests.mf_team_form(viewer, v_away) = array['L', 'W', 'L_forfeit', 'W', 'L'],
    format('away: %s', tests.mf_team_form(viewer, v_away));

  -- Ignores attendance: nobody checked in and no squads, the same form.
  delete from public.match_attendance;
  delete from public.match_players;
  assert tests.mf_team_form(viewer, v_home) = v_with, 'home form without check-ins';
  assert tests.mf_team_form(viewer, v_away) = array['L', 'W', 'L_forfeit', 'W', 'L'], 'away form without check-ins';

  -- Pickup games, disputed matches and other teams aren't in a team form.
  assert not exists (select 1 from public.team_form where match_id in (m_draw, m_disputed)), 'pickup or disputed';
  assert tests.mf_team_form(viewer, v_other) = '{}', 'other team';
end $$;

rollback;
