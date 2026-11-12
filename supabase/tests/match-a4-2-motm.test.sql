-- A4a (docs/specs/match-record.md sections 4.7, 5.3, decisions 1b.2, 1e):
-- man of the match. Only checked-in players vote, once, not for themselves,
-- for a checked-in player, in a confirmed match that isn't a forfeit, until
-- 24 hours after confirmed_at. Ties are shared; the result shows on the
-- match page once voting closes; nobody sees anyone else's vote.
begin;

do $$
declare
  v_home uuid := tests.create_team('A4M Home');
  v_away uuid := tests.create_team('A4M Away');
  p1 uuid := tests.create_user('a4m-p1@futty.test');
  p2 uuid := tests.create_user('a4m-p2@futty.test');
  p3 uuid := tests.create_user('a4m-p3@futty.test');
  p4 uuid := tests.create_user('a4m-p4@futty.test');
  absent uuid := tests.create_user('a4m-absent@futty.test');
  stranger uuid := tests.create_user('a4m-stranger@futty.test');
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 3, 2, v_home, v_away);
  m_late uuid := tests.form_match(now() - interval '26 hours', 'confirmed', 3, 2, v_home, v_away);
  m_forfeit uuid := tests.form_match(now() - interval '3 hours', 'confirmed', null, null, v_home, v_away, 'a', 'no_show');
  m_disputed uuid := tests.form_match(now() - interval '3 hours', 'disputed', null, null, v_home, v_away);
  v_m uuid;
  v_page jsonb;
begin
  foreach v_m in array array[m, m_late, m_forfeit, m_disputed] loop
    perform tests.form_player(v_m, p1, 'a', true, true);
    perform tests.form_player(v_m, p2, 'a', true, true);
    perform tests.form_player(v_m, p3, 'b', true, true);
    perform tests.form_player(v_m, p4, 'b', true, true);
    perform tests.form_player(v_m, absent, 'b', true, false);
  end loop;

  -- Who may vote.
  assert tests.error_as(absent, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p1))) = 'not_checked_in',
    'not checked in';
  assert tests.error_as(stranger, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p1))) = 'not_checked_in',
    'stranger';
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p1))) = 'cannot_vote_for_self',
    'self';
  -- Who may be voted for: a player who played (checked in), either side.
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, absent))) = 'nominee_not_eligible',
    'nominee not checked in';
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m_late, p3))) = 'nominee_not_eligible',
    'nominee from another match';
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m, tests.guest_player(m, 'a', 'Guest'))) = 'nominee_not_eligible',
    'guest';

  -- 2-2 tie: p1 and p2 vote p3, p3 and p4 vote p1.
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p3))) is null, 'p1 votes';
  assert tests.error_as(p2, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p3))) is null, 'p2 votes';
  assert tests.error_as(p3, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p1))) is null, 'p3 votes';
  assert tests.error_as(p4, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p1))) is null, 'p4 votes';
  -- One vote each: a second one is refused, even for someone else.
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m, tests.player_id(m, p4))) = 'already_voted',
    'second vote';
  assert (select nominee_player_id from public.motm_votes where match_id = m and voter_profile_id = p1) = tests.player_id(m, p3),
    'first vote kept';

  -- Votes are hidden: a voter sees only their own; nobody can write the table.
  perform tests.act_as(p1);
  assert (select count(*) from public.motm_votes) = 1, 'own vote only';
  perform tests.act_as_postgres();
  assert tests.error_as(p1, format('insert into public.motm_votes values (%L, %L, %L)', m_late, p1, tests.player_id(m_late, p3)))
         like 'permission denied%', 'direct insert';

  -- While voting is open the page shows no result, only the caller's vote.
  v_page := tests.page_as(p2, m);
  assert (v_page ->> 'motmOpen')::boolean, 'open';
  assert v_page -> 'motm' = '[]', format('no result while open: %s', v_page -> 'motm');
  assert v_page ->> 'myVote' = tests.player_id(m, p3)::text, 'my vote';
  assert tests.page_as(stranger, m) -> 'myVote' = 'null', 'no vote';

  -- Voting closes 24 hours after confirmation.
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m_late, tests.player_id(m_late, p3))) = 'voting_closed',
    'at 24h';
  -- No man of the match for a forfeit or a disputed match.
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m_forfeit, tests.player_id(m_forfeit, p3))) = 'match_not_confirmed',
    'forfeit';
  assert tests.error_as(p1, format('select public.cast_motm_vote(%L, %L)', m_disputed, tests.player_id(m_disputed, p3))) = 'match_not_confirmed',
    'disputed';

  -- Once voting has closed, ties are shared: both p1 and p3 with 2 votes.
  update public.matches set confirmed_at = now() - interval '24 hours' where id = m;
  v_page := tests.page_as(stranger, m);
  assert not (v_page ->> 'motmOpen')::boolean, 'closed';
  assert jsonb_array_length(v_page -> 'motm') = 2, format('shared: %s', v_page -> 'motm');
  assert (select array_agg((e ->> 'profileId')::uuid order by e ->> 'profileId') from jsonb_array_elements(v_page -> 'motm') e)
         = (select array_agg(x order by x::text) from unnest(array[p1, p3]) x), 'p1 and p3';
  assert (select bool_and((e ->> 'votes')::int = 2) from jsonb_array_elements(v_page -> 'motm') e), 'two votes each';

  -- One more vote would have broken the tie: a clear winner is alone.
  insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
  values (m, absent, tests.player_id(m, p3));
  v_page := tests.page_as(stranger, m);
  assert jsonb_array_length(v_page -> 'motm') = 1 and v_page -> 'motm' -> 0 ->> 'profileId' = p3::text
         and (v_page -> 'motm' -> 0 ->> 'votes')::int = 3, format('winner: %s', v_page -> 'motm');
end $$;

rollback;
