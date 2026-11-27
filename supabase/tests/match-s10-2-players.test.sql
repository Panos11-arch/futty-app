-- S10: a league match's players are its teams' members, synced until
-- kickoff and frozen after (match-record.md decision 1n).
begin;

do $$
declare
  cap_h uuid := tests.create_user('s10-2-cap-h@futty.test');
  cap_a uuid := tests.create_user('s10-2-cap-a@futty.test');
  leaver uuid := tests.create_user('s10-2-leaver@futty.test');
  early uuid := tests.create_user('s10-2-early@futty.test');
  late uuid := tests.create_user('s10-2-late@futty.test');
  new_cap uuid := tests.create_user('s10-2-new-cap@futty.test');
  t_h uuid := tests.s10_team('S10-2 Home', cap_h, array[leaver]);
  t_a uuid := tests.s10_team('S10-2 Away', cap_a);
  v_hub uuid := tests.s10_league();
  v_season uuid := tests.s10_season(v_hub, array[t_h, t_a]);
  v_fixture uuid := tests.s10_fixture(v_season, t_h, t_a);
  v_match uuid := tests.s10_schedule(v_fixture, now() + interval '2 days');
  v_side text := (select side from public.match_sides where match_id = tests.s10_match(v_fixture) and team_id = t_h);
begin
  assert exists (select 1 from public.match_players where match_id = v_match and profile_id = leaver and left_at is null),
    'a member is on the match';

  -- Before kickoff: a member who joins is added, one who leaves is removed.
  perform tests.join_team(t_h, early);
  assert (select side from public.match_players where match_id = v_match and profile_id = early and left_at is null)
         = v_side, 'a member who joins before kickoff is on the match, on his team''s side';
  delete from public.team_members where team_id = t_h and profile_id = leaver;
  assert (select left_at from public.match_players where match_id = v_match and profile_id = leaver) is not null,
    'a member who leaves before kickoff is removed';

  -- A new captain before kickoff captains the side.
  update public.team_members set role = 'player' where team_id = t_h and profile_id = cap_h;
  perform tests.join_team(t_h, new_cap, 'captain');
  assert (select captain_profile_id from public.match_sides where match_id = v_match and team_id = t_h) = new_cap,
    'the side follows the team''s captain';

  -- From kickoff the list never changes.
  update public.matches set kickoff_at = now() - interval '10 minutes', ends_at = now() + interval '50 minutes',
                            result_deadline_at = now() + interval '1 day'
  where id = v_match;
  perform tests.join_team(t_h, late);
  assert not exists (select 1 from public.match_players where match_id = v_match and profile_id = late),
    'a member who joins after kickoff isn''t on the match';
  delete from public.team_members where team_id = t_h and profile_id = early;
  assert (select left_at from public.match_players where match_id = v_match and profile_id = early) is null,
    'a member who leaves after kickoff stays on the match';
end $$;

rollback;
