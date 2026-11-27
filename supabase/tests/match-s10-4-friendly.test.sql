-- S10: league games are always Competitive; the server refuses Friendly
-- (match-record.md decision 1n; Panos, 26 November).
begin;

do $$
declare
  cap_h uuid := tests.create_user('s10-4-cap-h@futty.test');
  cap_a uuid := tests.create_user('s10-4-cap-a@futty.test');
  t_h uuid := tests.s10_team('S10-4 Home', cap_h);
  t_a uuid := tests.s10_team('S10-4 Away', cap_a);
  v_hub uuid := tests.s10_league();
  v_season uuid := tests.s10_season(v_hub, array[t_h, t_a]);
  v_match uuid := tests.s10_schedule(tests.s10_fixture(v_season, t_h, t_a), now() + interval '2 days');
  v_other uuid;
  v_error text;
begin
  v_error := tests.error_as(cap_h, format('select public.set_match_competitive(%L, false)', v_match));
  assert v_error = 'league_always_competitive', 'Friendly is refused on a league match, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(cap_a, format('select public.set_match_competitive(%L, false)', v_match));
  assert v_error = 'league_always_competitive', 'by either captain';
  assert (select competitive from public.matches where id = v_match), 'still Competitive';
  v_error := tests.error_as(cap_h, format('select public.set_match_competitive(%L, true)', v_match));
  assert v_error is null, 'Competitive is allowed, got ' || coalesce(v_error, '');

  -- Anyone else is still refused first.
  v_error := tests.error_as(tests.create_user('s10-4-other@futty.test'),
                            format('select public.set_match_competitive(%L, false)', v_match));
  assert v_error = 'not_captain', 'not a captain, got ' || coalesce(v_error, 'no error');

  -- A match that isn't a league game can still switch.
  v_other := tests.form_match(now() + interval '1 day', 'scheduled', null, null, t_h, t_a);
  update public.match_sides set captain_profile_id = cap_h where match_id = v_other and side = 'a';
  v_error := tests.error_as(cap_h, format('select public.set_match_competitive(%L, false)', v_other));
  assert v_error is null, 'a non-league match can go Friendly, got ' || coalesce(v_error, '');
  assert not (select competitive from public.matches where id = v_other), 'it is Friendly';
end $$;

rollback;
