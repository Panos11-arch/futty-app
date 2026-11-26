-- S8 follow-up (Panos, 26 November): Profile's "People you play with most"
-- (my_teammates), "Your venues" (my_venues) and the Showed up tile
-- (my_profile_showed_up, docs/specs/match-record.md "Showed up"). Each reads
-- the caller's own rows only.
begin;

-- The caller's Showed up figures (back to postgres afterwards).
create function tests.su(p_user uuid, p_format text default null)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  v := public.my_profile_showed_up(p_format);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- A late-cancel line, the way cancel_booking_internal writes one.
create function tests.su_line(p_cancellation uuid, p_booking uuid, p_profile uuid, p_window text)
returns void
language sql
as $$
  insert into public.booking_cancellation_lines (cancellation_id, booking_id, share_id, profile_id, venue_id, "window", action, reason)
  select p_cancellation, p_booking, s.id, p_profile, b.venue_id, p_window, 'keep', 'test_keep'
  from public.booking_payment_shares s join public.venue_bookings b on b.id = s.booking_id
  where s.booking_id = p_booking and s.profile_id = p_profile;
$$;

-- 1. Showed up: check-ins and no-shows in confirmed, final games this season.
do $$
declare
  me uuid := tests.create_user('su-me@futty.test');
  other uuid := tests.create_user('su-other@futty.test');
  v_ago timestamptz := now() - interval '2 days';
  m1 uuid := tests.form_match(v_ago, 'confirmed', 2, 1);
  m2 uuid := tests.form_match(v_ago, 'confirmed', 0, 0);
  m3 uuid := tests.form_match(v_ago, 'confirmed', 1, 0);
  m_forfeit_missed uuid := tests.form_match(v_ago, 'confirmed', null, null, null, null, 'a', 'no_show');
  m_forfeit_played uuid := tests.form_match(v_ago, 'confirmed', null, null, null, null, 'b', 'pulled_out');
  m_void uuid := tests.form_match(v_ago, 'void');
  m_no_result uuid := tests.form_match(v_ago, 'no_result');
  m_last_year uuid := tests.form_match(date_trunc('year', now()) - interval '10 days', 'confirmed', 1, 1);
  m_not_final uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 1, 0);
  m_no_spot uuid := tests.form_match(v_ago, 'confirmed', 3, 3);
  v jsonb;
begin
  -- Showed up in m1, no-show in m2.
  perform tests.form_player(m1, me, 'a', true, true);
  perform tests.form_player(m2, me, 'a', true, false);
  v := tests.su(me);
  assert (v->>'counted')::int = 2 and (v->>'showedUp')::int = 1 and (v->>'missed')::int = 1,
         format('one check-in and one no-show, got %s', v);
  assert v->'pct' = 'null'::jsonb, format('"–" until 3 counted games, got %s', v);

  -- A Friendly game counts too: 2 of 3 is 67%.
  update public.matches set competitive = false where id = m3;
  perform tests.form_player(m3, me, 'a', true, true);
  v := tests.su(me);
  assert (v->>'counted')::int = 3 and (v->>'pct')::int = 67, format('2 of 3 is 67%%, got %s', v);

  -- Not counted either way: forfeits, void and no-result games, last year,
  -- a game before its result deadline, a game without a spot.
  perform tests.form_player(m_forfeit_missed, me, 'a', true, false);
  perform tests.form_player(m_forfeit_played, me, 'a', true, true);
  perform tests.form_player(m_void, me, 'a', true, false);
  perform tests.form_player(m_no_result, me, 'a', true, false);
  perform tests.form_player(m_last_year, me, 'a', true, false);
  perform tests.form_player(m_not_final, me, 'a', true, false);
  perform tests.form_player(m_no_spot, me, 'a', false, false);
  v := tests.su(me);
  assert (v->>'counted')::int = 3 and (v->>'pct')::int = 67,
         format('forfeits, void, no result, last year, not final and no spot are not counted, got %s', v);

  -- The format filter: m3 is a 7-a-side.
  update public.matches set format = '7-a-side' where id = m3;
  v := tests.su(me, '5-a-side');
  assert (v->>'counted')::int = 2 and v->'pct' = 'null'::jsonb, format('5-a-side only, got %s', v);
  v := tests.su(me, '7-a-side');
  assert (v->>'counted')::int = 1 and (v->>'showedUp')::int = 1, format('7-a-side only, got %s', v);

  -- Own data only.
  v := tests.su(other);
  assert (v->>'counted')::int = 0 and v->'pct' = 'null'::jsonb, format('another player has none of mine, got %s', v);

  -- Signed out: refused.
  perform tests.act_as_anon();
  assert tests.error_of('select public.my_profile_showed_up(null)') like 'permission denied%', 'anon cannot call it';
  perform tests.act_as_postgres();
end $$;

-- 2. Late cancels: only the canceller's own 'late' line is a miss.
do $$
declare
  v_booker uuid := tests.create_user('su-booker@futty.test');
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 1);
  v_mate uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_mate2 uuid := (tests.player(v_booking.id, 2)).profile_id;
  v_cancel uuid;
  v_match uuid;
  v jsonb;
begin
  -- The booker cancels the whole booking late: their own line is 'late',
  -- everyone else's is 'other'. The match is void.
  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan)
  values (v_booking.id, 'whole_team', v_booker, 'test', '{}') returning id into v_cancel;
  perform tests.su_line(v_cancel, v_booking.id, v_booker, 'late');
  perform tests.su_line(v_cancel, v_booking.id, v_mate, 'other');
  perform tests.su_line(v_cancel, v_booking.id, v_mate2, 'other');
  v_match := tests.form_match(now() - interval '2 days', 'void');
  update public.matches set booking_id = v_booking.id where id = v_match;

  v := tests.su(v_booker);
  assert (v->>'counted')::int = 1 and (v->>'missed')::int = 1, format('the booker gets 1 miss, got %s', v);
  v := tests.su(v_mate);
  assert (v->>'counted')::int = 0, format('another player gets none, got %s', v);
  v := tests.su(v_mate2);
  assert (v->>'counted')::int = 0, format('nor the third player, got %s', v);
end $$;

do $$
declare
  v_booker uuid := tests.create_user('su-booker2@futty.test');
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 1);
  v_free uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_middle uuid := (tests.player(v_booking.id, 2)).profile_id;
  v_late uuid := (tests.player(v_booking.id, 3)).profile_id;
  v_cancel uuid;
  v_match uuid;
  v jsonb;
begin
  -- Three players cancel their own spot: free, middle and late.
  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan)
  values (v_booking.id, 'my_spot', v_free, 'test', '{}') returning id into v_cancel;
  perform tests.su_line(v_cancel, v_booking.id, v_free, 'free');
  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan)
  values (v_booking.id, 'my_spot', v_middle, 'test', '{}') returning id into v_cancel;
  perform tests.su_line(v_cancel, v_booking.id, v_middle, 'middle');
  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan)
  values (v_booking.id, 'my_spot', v_late, 'test', '{}') returning id into v_cancel;
  perform tests.su_line(v_cancel, v_booking.id, v_late, 'late');

  assert (tests.su(v_free)->>'counted')::int = 0, 'a free-hour cancel is not a miss';
  assert (tests.su(v_middle)->>'counted')::int = 0, 'a middle-window cancel is not a miss';
  v := tests.su(v_late);
  assert (v->>'missed')::int = 1, format('a late cancel is a miss, got %s', v);
  assert (tests.su(v_late, '7-a-side')->>'counted')::int = 0, 'the format filter applies to late cancels';

  -- A game later forfeited doesn't count either way.
  v_match := tests.form_match(now() - interval '2 days', 'confirmed', null, null, null, null, 'a', 'pulled_out');
  update public.matches set booking_id = v_booking.id where id = v_match;
  assert (tests.su(v_late)->>'counted')::int = 0, 'a late cancel in a forfeited game is not counted';
end $$;

-- 3. People you play with most: own list, no blocked pairs, no adult/minor
--    pairs, no deleted players, a minor's first name only.
do $$
declare
  me uuid := tests.create_user('tm-me@futty.test');
  mate uuid := tests.create_user('tm-mate@futty.test');
  often uuid := tests.create_user('tm-often@futty.test');
  blocked uuid := tests.create_user('tm-blocked@futty.test');
  blocker uuid := tests.create_user('tm-blocker@futty.test');
  gone uuid := tests.create_user('tm-gone@futty.test');
  kid uuid := tests.create_user('tm-kid@futty.test');
  kid_mate uuid := tests.create_user('tm-kidmate@futty.test');
  outsider uuid := tests.create_user('tm-outsider@futty.test');
  m uuid;
  i integer;
  v jsonb;
begin
  update public.profiles set date_of_birth = '1995-05-05', full_name = 'Adult ' || left(id::text, 4)
  where id in (me, mate, often, blocked, blocker, gone, outsider);
  update public.profiles set full_name = 'Nikos Mate' where id = mate;
  update public.profiles set date_of_birth = tests.cyprus_today() - interval '15 years', full_name = 'Maria Kid', first_name = 'Maria'
  where id = kid;
  update public.profiles set date_of_birth = tests.cyprus_today() - interval '16 years', full_name = 'Marios Kidmate', first_name = 'Marios'
  where id = kid_mate;

  for i in 1 .. 2 loop
    m := tests.form_match(now() - make_interval(days => i + 1), 'confirmed', 1, 0);
    perform tests.form_player(m, me, 'a', true, true);
    perform tests.form_player(m, often, 'a', true, true);
  end loop;
  m := tests.form_match(now() - interval '1 day', 'confirmed', 1, 0);
  perform tests.form_player(m, me, 'a', true, true);
  perform tests.form_player(m, mate, 'a', true, true);
  perform tests.form_player(m, blocked, 'a', true, true);
  perform tests.form_player(m, blocker, 'a', true, true);
  perform tests.form_player(m, gone, 'a', true, true);
  m := tests.form_match(now() - interval '1 day', 'confirmed', 1, 0);
  perform tests.form_player(m, kid, 'a', true, true);
  perform tests.form_player(m, kid_mate, 'a', true, true);
  perform tests.form_player(m, outsider, 'a', true, true);

  insert into public.blocked_users (blocker_id, blocked_id) values (me, blocked), (blocker, me);
  update auth.users set deleted_at = now() where id = gone;

  perform tests.act_as(me);
  select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name, 'n', t.matches_together)) into v from public.my_teammates(20) t;
  perform tests.act_as_postgres();
  assert jsonb_array_length(v) = 2, format('only the two visible teammates, got %s', v);
  assert v->0->>'id' = often::text and (v->0->>'n')::int = 2, format('most games first, got %s', v);
  assert v->1->>'id' = mate::text and v->1->>'name' = 'Nikos Mate', format('then Nikos, got %s', v);

  -- A minor: an adult teammate is left out, a minor teammate shows by first name.
  perform tests.act_as(kid);
  select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name)) into v from public.my_teammates(20) t;
  perform tests.act_as_postgres();
  assert jsonb_array_length(v) = 1 and v->0->>'id' = kid_mate::text, format('a minor sees only the minor, got %s', v);
  perform tests.act_as(kid_mate);
  select jsonb_agg(t.display_name) into v from public.my_teammates(20) t;
  perform tests.act_as_postgres();
  assert v = '["Maria"]'::jsonb, format('a minor shows by first name only, got %s', v);

  -- An adult never sees the minors they played with.
  perform tests.act_as(outsider);
  select jsonb_agg(t.id) into v from public.my_teammates(20) t;
  perform tests.act_as_postgres();
  assert v is null, format('adult/minor pairs are left out, got %s', v);

  -- Signed out: refused.
  perform tests.act_as_anon();
  assert tests.error_of('select * from public.my_teammates(5)') like 'permission denied%', 'anon cannot call it';
  perform tests.act_as_postgres();
end $$;

-- 4. Your venues: venues of the caller's own games, most games first.
do $$
declare
  me uuid := tests.create_user('ven-me@futty.test');
  other uuid := tests.create_user('ven-other@futty.test');
  v_home uuid := tests.create_venue();
  v_away uuid := tests.create_venue();
  v_theirs uuid := tests.create_venue();
  m uuid;
  i integer;
  v jsonb;
begin
  update public.venues set name = 'Home Ground' where id = v_home;
  update public.venues set name = 'Away Ground' where id = v_away;
  for i in 1 .. 2 loop
    m := tests.form_match(now() - make_interval(days => i + 1), 'confirmed', 1, 0, p_venue => v_home);
    perform tests.form_player(m, me, 'a', true, true);
  end loop;
  m := tests.form_match(now() - interval '1 day', 'confirmed', 1, 0, p_venue => v_away);
  perform tests.form_player(m, me, 'a', true, true);
  -- Not mine: someone else's game, and a game I didn't check in to.
  m := tests.form_match(now() - interval '1 day', 'confirmed', 1, 0, p_venue => v_theirs);
  perform tests.form_player(m, other, 'a', true, true);
  perform tests.form_player(m, me, 'b', true, false);

  perform tests.act_as(me);
  select jsonb_agg(jsonb_build_object('id', x.venue_id, 'name', x.name, 'games', x.games)) into v from public.my_venues(20) x;
  perform tests.act_as_postgres();
  assert jsonb_array_length(v) = 2, format('two venues, got %s', v);
  assert v->0->>'name' = 'Home Ground' and (v->0->>'games')::int = 2, format('most games first, got %s', v);
  assert v->1->>'name' = 'Away Ground' and (v->1->>'games')::int = 1, format('then the other, got %s', v);

  perform tests.act_as(other);
  select jsonb_agg(x.venue_id) into v from public.my_venues(20) x;
  perform tests.act_as_postgres();
  assert v = jsonb_build_array(v_theirs), format('another player sees only their own, got %s', v);

  perform tests.act_as_anon();
  assert tests.error_of('select * from public.my_venues(5)') like 'permission denied%', 'anon cannot call it';
  perform tests.act_as_postgres();
end $$;

rollback;
