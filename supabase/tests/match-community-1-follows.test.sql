-- S7 Community, part 1: child safety on follows and contacts (A3-A5), and
-- "Start following some accounts" (follow_suggestions, dismissals).
-- Allowed and refused cases.
begin;

-- A player with this date of birth and name.
create function tests.cm_user(p_dob date, p_full_name text, p_username text default null)
returns uuid
language sql
as $$
  select tests.create_user('cm-' || gen_random_uuid() || '@futty.test', jsonb_strip_nulls(jsonb_build_object(
    'date_of_birth', p_dob, 'full_name', p_full_name, 'username', p_username)));
$$;

-- Runs p_sql as p_user (null: anon) and returns its error, or null.
create function tests.cm_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  if p_user is null then
    perform tests.act_as_anon();
  else
    perform tests.act_as(p_user);
  end if;
  v_error := tests.error_of(p_sql);
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

-- A confirmed match yesterday; returns its id.
create function tests.cm_match()
returns uuid
language sql
as $$
  select tests.form_match(now() - interval '1 day', 'confirmed', 3, 2);
$$;

-- ---- Follows across the adult/minor line are refused ---------------------------
do $$
declare
  v_adult uuid := tests.cm_user((tests.cyprus_today() - interval '30 years')::date, 'Andreas Adult');
  v_adult2 uuid := tests.cm_user((tests.cyprus_today() - interval '25 years')::date, 'Anna Adult');
  v_minor uuid := tests.cm_user((tests.cyprus_today() - interval '15 years')::date, 'Maria Minor');
  v_minor2 uuid := tests.cm_user((tests.cyprus_today() - interval '16 years')::date, 'Marios Minor');
  v_team uuid := tests.create_team('Kato United');
  v_error text;
begin
  v_error := tests.cm_as(v_adult, format(
    'insert into public.user_follows (follower_id, target_type, target_id) values (%L, ''player'', %L)', v_adult, v_minor));
  assert v_error like '%age_pair_refused%', 'adult follows minor: refused, got ' || coalesce(v_error, 'no error');

  v_error := tests.cm_as(v_minor, format(
    'insert into public.user_follows (follower_id, target_type, target_id) values (%L, ''player'', %L)', v_minor, v_adult));
  assert v_error like '%age_pair_refused%', 'minor follows adult: refused, got ' || coalesce(v_error, 'no error');

  v_error := tests.cm_as(v_adult, format(
    'insert into public.user_follows (follower_id, target_type, target_id) values (%L, ''player'', %L)', v_adult, v_adult2));
  assert v_error is null, 'adult follows adult: allowed, got ' || coalesce(v_error, '');

  v_error := tests.cm_as(v_minor, format(
    'insert into public.user_follows (follower_id, target_type, target_id) values (%L, ''player'', %L)', v_minor, v_minor2));
  assert v_error is null, 'minor follows minor: allowed, got ' || coalesce(v_error, '');

  -- Team follows are unaffected, for either age group.
  v_error := tests.cm_as(v_minor, format(
    'insert into public.user_follows (follower_id, target_type, target_id) values (%L, ''team'', %L)', v_minor, v_team));
  assert v_error is null, 'minor follows a team: allowed, got ' || coalesce(v_error, '');
  v_error := tests.cm_as(v_adult, format(
    'insert into public.user_follows (follower_id, target_type, target_id) values (%L, ''team'', %L)', v_adult, v_team));
  assert v_error is null, 'adult follows a team: allowed, got ' || coalesce(v_error, '');

  -- Turning an allowed follow into a cross-age one is refused too.
  v_error := tests.cm_as(v_adult, format(
    'update public.user_follows set target_id = %L where follower_id = %L and target_id = %L', v_minor, v_adult, v_adult2));
  assert v_error like '%age_pair_refused%', 'retargeting to a minor: refused, got ' || coalesce(v_error, 'no error');
end;
$$;

-- ---- Contacts matching hides the other age group ------------------------------
do $$
declare
  v_adult uuid := tests.cm_user((tests.cyprus_today() - interval '30 years')::date, 'Andreas Adult', 'andreas_c');
  v_adult2 uuid := tests.cm_user((tests.cyprus_today() - interval '25 years')::date, 'Anna Adult', 'anna_c');
  v_minor uuid := tests.cm_user((tests.cyprus_today() - interval '15 years')::date, 'Maria Minor', 'maria_c');
  v_minor2 uuid := tests.cm_user((tests.cyprus_today() - interval '16 years')::date, 'Marios Minor', 'marios_c');
  v_rows jsonb;
begin
  update public.profiles set phone = '+357 99 100001' where id = v_adult2;
  update public.profiles set phone = '+357 99 100002' where id = v_minor;
  update public.profiles set phone = '+357 99 100003' where id = v_minor2;
  update public.profiles set phone = '+357 99 100004' where id = v_adult;

  perform tests.act_as(v_adult);
  select jsonb_agg(jsonb_build_object('id', c.profile_id, 'username', c.username)) into v_rows
  from public.match_contacts_by_phone(array['+35799100001', '+35799100002', '+35799100003']) c;
  perform tests.act_as_postgres();
  assert jsonb_array_length(v_rows) = 1, 'adult: only the adult contact, got ' || v_rows::text;
  assert v_rows -> 0 ->> 'id' = v_adult2::text, 'adult sees the adult contact';
  assert v_rows -> 0 ->> 'username' = 'anna_c', 'an adult''s username shows';

  perform tests.act_as(v_minor);
  select jsonb_agg(jsonb_build_object('id', c.profile_id, 'username', c.username)) into v_rows
  from public.match_contacts_by_phone(array['+35799100001', '+35799100003', '+35799100004']) c;
  perform tests.act_as_postgres();
  assert jsonb_array_length(v_rows) = 1, 'minor: only the minor contact, got ' || v_rows::text;
  assert v_rows -> 0 ->> 'id' = v_minor2::text, 'minor sees the minor contact';
  assert v_rows -> 0 ->> 'username' is null, 'a minor''s username never shows (A5)';
end;
$$;

-- ---- follow_suggestions: matches in common -------------------------------------
do $$
declare
  v_me uuid := tests.cm_user((tests.cyprus_today() - interval '30 years')::date, 'Me Player');
  v_mate uuid := tests.cm_user((tests.cyprus_today() - interval '28 years')::date, 'Nikos Mate');
  v_rival uuid := tests.cm_user((tests.cyprus_today() - interval '27 years')::date, 'Petros Rival');
  v_left uuid := tests.cm_user((tests.cyprus_today() - interval '26 years')::date, 'Leon Left');
  v_absent uuid := tests.cm_user((tests.cyprus_today() - interval '26 years')::date, 'Absent Player');
  v_followed uuid := tests.cm_user((tests.cyprus_today() - interval '26 years')::date, 'Fanis Followed');
  v_blocked uuid := tests.cm_user((tests.cyprus_today() - interval '26 years')::date, 'Bob Blocked');
  v_blocker uuid := tests.cm_user((tests.cyprus_today() - interval '26 years')::date, 'Bill Blocker');
  v_minor uuid := tests.cm_user((tests.cyprus_today() - interval '15 years')::date, 'Maria Minor');
  v_m1 uuid := tests.cm_match();
  v_m2 uuid := tests.cm_match();
  v_unconfirmed uuid := tests.form_match(now() - interval '1 day', 'played', 1, 0);
  v_rows jsonb;
  v_error text;
begin
  -- Match 1: me and the mate on side a, the rival on b, and everyone else.
  perform tests.form_player(v_m1, v_me, 'a', false, true);
  perform tests.form_player(v_m1, v_mate, 'a', false, true);
  perform tests.form_player(v_m1, v_rival, 'b', false, true);
  perform tests.form_player(v_m1, v_left, 'b', false, true, true);   -- left: doesn't count
  perform tests.form_player(v_m1, v_absent, 'b', false, false);      -- never checked in
  perform tests.form_player(v_m1, v_followed, 'b', false, true);
  perform tests.form_player(v_m1, v_blocked, 'b', false, true);
  perform tests.form_player(v_m1, v_blocker, 'b', false, true);
  perform tests.form_player(v_m1, v_minor, 'b', false, true);
  insert into public.match_players (match_id, guest_name, side) values (v_m1, 'Guest', 'a');
  -- Match 2: me and the mate again.
  perform tests.form_player(v_m2, v_me, 'a', false, true);
  perform tests.form_player(v_m2, v_mate, 'b', false, true);
  -- Not confirmed: never counts.
  perform tests.form_player(v_unconfirmed, v_me, 'a', false, true);
  perform tests.form_player(v_unconfirmed, v_rival, 'a', false, true);

  insert into public.user_follows (follower_id, target_type, target_id) values (v_me, 'player', v_followed);
  insert into public.blocked_users (blocker_id, blocked_id) values (v_me, v_blocked);
  insert into public.blocked_users (blocker_id, blocked_id) values (v_blocker, v_me);

  perform tests.act_as(v_me);
  select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'n', s.matches_in_common)) into v_rows
  from public.follow_suggestions() s;
  perform tests.act_as_postgres();

  assert jsonb_array_length(v_rows) = 2, 'only the mate and the rival, got ' || v_rows::text;
  assert v_rows -> 0 ->> 'id' = v_mate::text and (v_rows -> 0 ->> 'n')::int = 2, 'mate first with 2 in common';
  assert v_rows -> 0 ->> 'name' = 'Nikos Mate', 'an adult''s full name';
  assert v_rows -> 1 ->> 'id' = v_rival::text and (v_rows -> 1 ->> 'n')::int = 1,
    'the opponent counts once (the unconfirmed match does not)';

  -- Dismiss the mate: gone, and only for me.
  v_error := tests.cm_as(v_me, format('select public.dismiss_follow_suggestion(%L)', v_mate));
  assert v_error is null, 'dismiss: allowed, got ' || coalesce(v_error, '');
  v_error := tests.cm_as(v_me, format('select public.dismiss_follow_suggestion(%L)', v_mate));
  assert v_error is null, 'dismissing twice is fine';
  perform tests.act_as(v_me);
  assert not exists (select 1 from public.follow_suggestions() s where s.id = v_mate), 'dismissed: gone';
  perform tests.act_as_postgres();
  perform tests.act_as(v_rival);
  assert exists (select 1 from public.follow_suggestions() s where s.id = v_mate), 'someone else still sees the mate';
  -- Another player's dismissals can't be read or written directly.
  assert not exists (select 1 from public.follow_suggestion_dismissals), 'the rival reads no one else''s dismissals';
  perform tests.act_as_postgres();
  v_error := tests.cm_as(v_rival, format(
    'insert into public.follow_suggestion_dismissals (profile_id, dismissed_profile_id) values (%L, %L)', v_me, v_rival));
  assert v_error is not null, 'no direct writes';
  v_error := tests.cm_as(v_me, format(
    'delete from public.follow_suggestion_dismissals where profile_id = %L', v_me));
  perform tests.act_as_postgres();
  assert exists (select 1 from public.follow_suggestion_dismissals where profile_id = v_me), 'no direct deletes';

  v_error := tests.cm_as(v_me, format('select public.dismiss_follow_suggestion(%L)', v_me));
  assert v_error like '%not_found%', 'dismissing yourself: refused';
  v_error := tests.cm_as(null, 'select * from public.follow_suggestions()');
  assert v_error is not null, 'anon: refused';
  v_error := tests.cm_as(null, format('select public.dismiss_follow_suggestion(%L)', v_mate));
  assert v_error is not null, 'anon dismiss: refused';

  -- The minor sees no adult from that match, and the adults never see her.
  perform tests.act_as(v_minor);
  assert not exists (select 1 from public.follow_suggestions()), 'a minor is suggested no adult';
  perform tests.act_as_postgres();
  perform tests.act_as(v_rival);
  assert not exists (select 1 from public.follow_suggestions() s where s.id = v_minor), 'an adult is suggested no minor';
  perform tests.act_as_postgres();
end;
$$;

-- ---- Minors among minors: first name only ---------------------------------------
do $$
declare
  v_minor uuid := tests.cm_user((tests.cyprus_today() - interval '15 years')::date, 'Maria Papadopoulou', 'maria_p');
  v_minor2 uuid := tests.cm_user((tests.cyprus_today() - interval '16 years')::date, 'Marios Georgiou', 'marios_g');
  v_m uuid := tests.cm_match();
  v_row record;
begin
  perform tests.form_player(v_m, v_minor, 'a', false, true);
  perform tests.form_player(v_m, v_minor2, 'b', false, true);
  perform tests.act_as(v_minor);
  select * into v_row from public.follow_suggestions() s;
  perform tests.act_as_postgres();
  assert v_row.id = v_minor2, 'minor sees the other minor';
  assert v_row.full_name = 'Marios', 'first name only, got ' || coalesce(v_row.full_name, 'null');
  assert v_row.username is null, 'no username for a minor';
end;
$$;

rollback;
