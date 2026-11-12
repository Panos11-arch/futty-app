-- A3b security (docs/specs/match-record.md section 7, CLAUDE.md rule 4):
-- the form views are readable by signed-in players and show confirmed
-- matches only; signed-out users read nothing; the internal view, the
-- notification log and the reminder job are service_role only.
begin;

create function tests.mf_as(p_role text, p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  if p_role = 'anon' then
    perform tests.act_as_anon();
  else
    perform tests.act_as(p_user);
  end if;
  v_error := tests.error_of(p_sql);
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

do $$
declare
  v_home uuid := tests.create_team('Home FC');
  v_away uuid := tests.create_team('Away FC');
  me uuid := tests.create_user('mf4-me@futty.test');
  viewer uuid := tests.create_user('mf4-viewer@futty.test');
  m_confirmed uuid := tests.form_match('2026-11-07T17:00:00Z', 'confirmed', 3, 1, v_home, v_away);
  m_disputed uuid := tests.form_match('2026-11-06T17:00:00Z', 'disputed', null, null, v_home, v_away);
  m_no_result uuid := tests.form_match('2026-11-05T17:00:00Z', 'no_result', null, null, v_home, v_away);
  m_played uuid := tests.form_match('2026-11-04T17:00:00Z', 'played', null, null, v_home, v_away);
  m_void uuid := tests.form_match('2026-11-03T17:00:00Z', 'void', null, null, v_home, v_away);
  m_scheduled uuid := tests.form_match(now() + interval '1 day', 'scheduled', null, null, v_home, v_away);
  v_view text;
  v_error text;
begin
  perform tests.form_player(m, me, 'a', true, true)
  from unnest(array[m_confirmed, m_disputed, m_no_result, m_played, m_void, m_scheduled]) as m;

  -- Signed in: only the confirmed match, in every view.
  perform tests.act_as(viewer);
  assert (select array_agg(match_id) from public.player_form where profile_id = me) = array[m_confirmed], 'player_form';
  assert (select array_agg(match_id) from public.player_recent_matches where profile_id = me) = array[m_confirmed],
    'player_recent_matches';
  assert (select array_agg(match_id) from public.team_form where team_id = v_home) = array[m_confirmed], 'team_form';
  assert (select played from public.head_to_head where team_id = v_home and opponent_team_id = v_away) = 1, 'head_to_head';
  perform tests.act_as_postgres();

  -- Signed out: nothing.
  foreach v_view in array array['player_form', 'team_form', 'player_recent_matches', 'head_to_head', 'player_teammates'] loop
    v_error := tests.mf_as('anon', null, format('select count(*) from public.%I', v_view));
    assert v_error like 'permission denied%', format('anon reads %s: %s', v_view, v_error);
  end loop;

  -- Internal: service_role only.
  v_error := tests.mf_as('authenticated', me, 'select count(*) from public.match_form_players');
  assert v_error like 'permission denied%', format('match_form_players: %s', v_error);
  v_error := tests.mf_as('authenticated', me, 'select count(*) from public.match_notification_log');
  assert v_error like 'permission denied%', format('match_notification_log: %s', v_error);
  v_error := tests.mf_as('authenticated', me, 'select public.match_reminders_tick(now())');
  assert v_error like 'permission denied%', format('match_reminders_tick: %s', v_error);
  v_error := tests.mf_as('authenticated', me, format('select public.booking_unpaid_count(%L)', gen_random_uuid()));
  assert v_error like 'permission denied%', format('booking_unpaid_count: %s', v_error);
  v_error := tests.mf_as('anon', null, 'select public.match_reminders_tick(now())');
  assert v_error like 'permission denied%', format('anon match_reminders_tick: %s', v_error);

  -- The views can't be written.
  v_error := tests.mf_as('authenticated', me,
    format('insert into public.player_form (profile_id, position, match_id, kickoff_at, result) values (%L, 1, %L, now(), %L)',
           me, m_confirmed, 'W'));
  assert v_error is not null, 'player_form is read only';
end $$;

rollback;
