-- A4a (docs/specs/match-record.md section 6.3, decision 1e): motm_vote_open
-- goes through send_notification to checked-in players when a match is
-- confirmed (agreed, or at the deadline), once per player; never for a
-- forfeit; a player ticked in after confirmation, while voting is open,
-- gets it once too.
begin;

do $$
declare
  booker uuid := tests.create_user('a4n-booker@futty.test');
  bib uuid := tests.create_user('a4n-bib@futty.test');
  nonbib uuid := tests.create_user('a4n-nonbib@futty.test');
  late uuid := tests.create_user('a4n-late@futty.test');
  absent uuid := tests.create_user('a4n-absent@futty.test');
  stranger uuid := tests.create_user('a4n-stranger@futty.test');
  -- Kicked off 2 hours ago, ended an hour ago, waiting for the result.
  m uuid := tests.form_match(now() - interval '2 hours', 'played');
  m_deadline uuid := tests.form_match(now() - interval '26 hours', 'played');
  m_forfeit uuid := tests.form_match(now() + interval '1 day', 'scheduled');
  v_m uuid;
  v_n public.notifications;
begin
  foreach v_m in array array[m, m_deadline, m_forfeit] loop
    update public.match_sides set captain_profile_id = booker where match_id = v_m and side = 'a';
    perform tests.form_player(v_m, booker, 'a', true, true);
    perform tests.form_player(v_m, bib, 'a', true, true);
    perform tests.form_player(v_m, nonbib, 'b', true, true);
    perform tests.form_player(v_m, late, 'a', true, false);
    perform tests.form_player(v_m, absent, 'b', true, false);
  end loop;

  -- Agreed: the booker submits 4-2, a Non-bibs player accepts.
  assert tests.error_as(booker, format('select public.submit_match_result(%L, 4, 2)', m)) is null, 'submit';
  assert tests.notified(bib, 'motm_vote_open', m) = 0, 'not before confirmation';
  assert tests.error_as(nonbib, format('select public.respond_to_match_result(%L, true)', m)) is null, 'accept';
  assert tests.notified(booker, 'motm_vote_open', m) = 1, 'booker';
  assert tests.notified(bib, 'motm_vote_open', m) = 1, 'bib';
  assert tests.notified(nonbib, 'motm_vote_open', m) = 1, 'nonbib';
  assert tests.notified(absent, 'motm_vote_open', m) = 0, 'not checked in';
  assert tests.notified(late, 'motm_vote_open', m) = 0, 'not yet checked in';
  assert tests.notified(stranger, 'motm_vote_open') = 0, 'stranger';
  v_n := tests.last_notification(bib, 'motm_vote_open');
  assert v_n.title = 'Man of the match', format('title: %s', v_n.title);
  assert v_n.body like 'Bibs 4–2 Non-bibs. Who was man of the match? Voting closes tomorrow at %', format('body: %s', v_n.body);
  assert v_n.data ->> 'matchId' = m::text, 'matchId';

  -- The captain ticks a late player in after confirmation: they get it once.
  assert tests.error_as(booker, format('select public.captain_mark_attendance(%L, %L)', m, array[late])) is null, 'tick';
  assert tests.notified(late, 'motm_vote_open', m) = 1, 'late player';
  assert tests.error_as(booker, format('select public.captain_mark_attendance(%L, %L)', m, array[late, bib])) is null, 'tick again';
  assert tests.notified(late, 'motm_vote_open', m) = 1 and tests.notified(bib, 'motm_vote_open', m) = 1, 'still once';

  -- At the deadline: an unanswered submission stands; the job runs twice.
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by, submitted_at)
  values (m_deadline, 'a', 1, 0, booker, now() - interval '24 hours');
  update public.matches set result_deadline_at = now() - interval '5 minutes' where id = m_deadline;
  perform tests.act_as_service_role();
  perform public.match_jobs_tick();
  perform public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert (select status from public.matches where id = m_deadline) = 'confirmed', 'confirmed at the deadline';
  assert tests.notified(bib, 'motm_vote_open', m_deadline) = 1, 'deadline once';
  assert tests.notified(nonbib, 'motm_vote_open', m_deadline) = 1, 'deadline nonbib';
  assert tests.notified(absent, 'motm_vote_open', m_deadline) = 0, 'deadline not checked in';

  -- A forfeit opens no vote.
  perform tests.act_as_service_role();
  perform public.record_match_forfeit(m_forfeit, 'b', 'pulled_out');
  perform tests.act_as_postgres();
  assert tests.notified(bib, 'motm_vote_open', m_forfeit) = 0, 'forfeit';
  assert tests.notified(booker, 'motm_vote_open', m_forfeit) = 0, 'forfeit booker';
end $$;

rollback;
