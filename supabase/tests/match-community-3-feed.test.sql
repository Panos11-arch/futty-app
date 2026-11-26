-- S7 Community, part 3: the feed (community_feed). Open squad posts and
-- confirmed results through follows; child safety: nothing reached through
-- an adult<->minor player follow (follows made before the guard existed),
-- while team results stay public. Blocks, minor names, scopes, paging.
begin;

create function tests.cf_user(p_dob date, p_full_name text)
returns uuid
language sql
as $$
  select tests.create_user('cf-' || gen_random_uuid() || '@futty.test', jsonb_build_object(
    'date_of_birth', p_dob, 'full_name', p_full_name));
$$;

create function tests.cf_adult(p_full_name text)
returns uuid
language sql
as $$
  select tests.cf_user((tests.cyprus_today() - interval '30 years')::date, p_full_name);
$$;

create function tests.cf_minor(p_full_name text)
returns uuid
language sql
as $$
  select tests.cf_user((tests.cyprus_today() - interval '15 years')::date, p_full_name);
$$;

-- A follow written as it was before the age guard (a legacy row).
create function tests.cf_legacy_follow(p_follower uuid, p_target uuid)
returns void
language plpgsql
as $$
begin
  alter table public.user_follows disable trigger user_follows_age_guard;
  insert into public.user_follows (follower_id, target_type, target_id) values (p_follower, 'player', p_target);
  alter table public.user_follows enable trigger user_follows_age_guard;
end;
$$;

-- A confirmed pickup match p_days ago with these players checked in on side a.
create function tests.cf_result(p_days integer, p_players uuid[], p_team_a uuid default null, p_team_b uuid default null)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.form_match(now() - make_interval(days => p_days), 'confirmed', 4, 1, p_team_a, p_team_b);
  v_p uuid;
begin
  foreach v_p in array p_players loop
    perform tests.form_player(v, v_p, 'a', false, true);
  end loop;
  return v;
end;
$$;

-- An open "Need players" post two days ahead at a live venue.
create function tests.cf_post(p_poster uuid, p_venue uuid, p_status text default 'open', p_team uuid default null,
                              p_type text default 'players')
returns uuid
language sql
as $$
  insert into public.squad_posts (type, venue_id, scheduled_at, format, players_needed, status, posted_by, team_id)
  values (p_type, p_venue, now() + interval '2 days', '5-a-side', 3, p_status, p_poster, p_team)
  returning id;
$$;

create function tests.cf_feed(p_as uuid, p_scope text, p_before_at timestamptz default null,
                              p_before_id uuid default null, p_limit integer default 50)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_as);
  select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_at desc, f.item_id desc), '[]') into v
  from public.community_feed(p_scope, p_before_at, p_before_id, p_limit) f;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- Whether the feed holds this item.
create function tests.cf_has(p_feed jsonb, p_item uuid)
returns boolean
language sql
as $$
  select exists (select 1 from jsonb_array_elements(p_feed) e where e ->> 'item_id' = p_item::text);
$$;

create function tests.cf_item(p_feed jsonb, p_item uuid)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(p_feed) e where e ->> 'item_id' = p_item::text;
$$;

-- ---- Child safety: player follows never cross the adult/minor line ------------
do $$
declare
  v_adult uuid := tests.cf_adult('Andreas Adult');
  v_adult2 uuid := tests.cf_adult('Anna Adult');
  v_minor uuid := tests.cf_minor('Maria Papadopoulou');
  v_minor2 uuid := tests.cf_minor('Marios Georgiou');
  v_team uuid := tests.create_team('Kato United');
  v_rivals uuid := tests.create_team('Limassol Lions');
  v_minor_match uuid;
  v_adult_match uuid;
  v_minor2_match uuid;
  v_team_match uuid;
  v_feed jsonb;
begin
  -- Legacy follows across the line, both ways, plus same-age ones.
  perform tests.cf_legacy_follow(v_adult, v_minor);
  perform tests.cf_legacy_follow(v_minor, v_adult2);
  perform tests.cf_legacy_follow(v_minor, v_minor2);
  insert into public.user_follows (follower_id, target_type, target_id) values (v_adult, 'player', v_adult2);
  perform tests.follow_team(v_adult, v_team);
  perform tests.follow_team(v_minor, v_team);

  v_minor_match := tests.cf_result(1, array[v_minor]);
  v_adult_match := tests.cf_result(2, array[v_adult2]);
  v_minor2_match := tests.cf_result(3, array[v_minor2]);
  -- A team match a minor played in: team results are public.
  v_team_match := tests.cf_result(4, array[v_minor], v_team, v_rivals);

  -- An adult following a minor sees none of the minor's player results.
  foreach v_feed in array array[tests.cf_feed(v_adult, 'for_you'), tests.cf_feed(v_adult, 'following')] loop
    assert not tests.cf_has(v_feed, v_minor_match), 'adult: no result through a minor follow';
    assert tests.cf_has(v_feed, v_adult_match), 'adult: an adult''s result through a player follow';
    assert tests.cf_has(v_feed, v_team_match), 'adult: team results still show';
  end loop;
  v_feed := tests.cf_feed(v_adult, 'following');
  assert tests.cf_item(v_feed, v_team_match) ->> 'actor_kind' = 'team', 'reached through the team';
  assert tests.cf_item(v_feed, v_team_match) ->> 'actor_name' = 'Kato United', 'the team''s name';
  assert tests.cf_item(v_feed, v_adult_match) ->> 'actor_id' = v_adult2::text, 'reached through Anna';
  assert tests.cf_item(v_feed, v_adult_match) ->> 'actor_name' = 'Anna Adult', 'an adult''s full name';
  assert (tests.cf_item(v_feed, v_adult_match) ->> 'side_a_score')::int = 4, 'the score';

  -- A minor following an adult likewise sees none of the adult's player results.
  foreach v_feed in array array[tests.cf_feed(v_minor, 'for_you'), tests.cf_feed(v_minor, 'following')] loop
    assert not tests.cf_has(v_feed, v_adult_match), 'minor: no result through an adult follow';
    assert tests.cf_has(v_feed, v_minor2_match), 'minor: another minor''s result';
    assert tests.cf_has(v_feed, v_team_match), 'minor: team results still show';
  end loop;
  v_feed := tests.cf_feed(v_minor, 'following');
  assert tests.cf_item(v_feed, v_minor2_match) ->> 'actor_name' = 'Marios', 'a minor''s first name only';

  -- The minor turns 18 (date of birth moved): the old follow counts again.
  update public.profiles set date_of_birth = (tests.cyprus_today() - interval '18 years')::date where id = v_minor;
  assert tests.cf_has(tests.cf_feed(v_adult, 'following'), v_minor_match), 'at 18 the follow counts again';
end;
$$;

-- ---- Results: only confirmed, blocks, the league flag ---------------------------
do $$
declare
  v_me uuid := tests.cf_adult('Me Player');
  v_friend uuid := tests.cf_adult('Fanis Followed');
  v_blocked uuid := tests.cf_adult('Bob Blocked');
  v_team uuid := tests.create_team('Paphos Rovers');
  v_other uuid := tests.create_team('Nicosia Stars');
  v_unconfirmed uuid := tests.form_match(now() - interval '1 day', 'played', 1, 0, v_team, v_other);
  v_blocked_match uuid;
  v_both uuid;
  v_feed jsonb;
begin
  perform tests.follow_team(v_me, v_team);
  insert into public.user_follows (follower_id, target_type, target_id) values (v_me, 'player', v_friend);
  insert into public.user_follows (follower_id, target_type, target_id) values (v_me, 'player', v_blocked);
  insert into public.blocked_users (blocker_id, blocked_id) values (v_blocked, v_me);
  v_blocked_match := tests.cf_result(1, array[v_blocked]);
  -- A followed team and a followed player in one match: one row, through the team.
  v_both := tests.cf_result(2, array[v_friend], v_other, v_team);

  v_feed := tests.cf_feed(v_me, 'following');
  assert not tests.cf_has(v_feed, v_unconfirmed), 'an unconfirmed match never shows';
  assert not tests.cf_has(v_feed, v_blocked_match), 'a blocked player''s result never shows';
  assert (select count(*) from jsonb_array_elements(v_feed) e where e ->> 'item_id' = v_both::text) = 1, 'one row per match';
  assert tests.cf_item(v_feed, v_both) ->> 'actor_id' = v_team::text, 'the team wins over the player';
  assert tests.cf_item(v_feed, v_both) ->> 'side_a_label' = 'Nicosia Stars', 'side labels';
  assert tests.cf_item(v_feed, v_both) ->> 'side_b_team_id' = v_team::text, 'side team ids';
  assert (tests.cf_item(v_feed, v_both) ->> 'league')::boolean = false, 'not a league match';
  assert tests.cf_feed(v_me, 'mine') = '[]', 'mine holds no results';
end;
$$;

-- ---- Squad posts: scopes, blocks, minor names, messaging ------------------------
do $$
declare
  v_me uuid := tests.cf_adult('Me Player');
  v_stranger uuid := tests.cf_adult('Stelios Stranger');
  v_friend uuid := tests.cf_adult('Fanis Followed');
  v_blocked uuid := tests.cf_adult('Bob Blocked');
  v_minor uuid := tests.cf_minor('Maria Papadopoulou');
  v_team uuid := tests.create_team('Larnaca Lions');
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_stranger_post uuid;
  v_friend_post uuid;
  v_blocked_post uuid;
  v_minor_post uuid;
  v_team_post uuid;
  v_my_open uuid;
  v_my_closed uuid;
  v_closed uuid;
  v_feed jsonb;
  v_error text;
begin
  update public.venues set is_live = true, name = 'Nuevo Campo' where id = v_venue;
  insert into public.user_follows (follower_id, target_type, target_id) values (v_me, 'player', v_friend);
  perform tests.cf_legacy_follow(v_me, v_minor);
  perform tests.follow_team(v_me, v_team);
  insert into public.blocked_users (blocker_id, blocked_id) values (v_me, v_blocked);

  v_stranger_post := tests.cf_post(v_stranger, v_venue);
  v_friend_post := tests.cf_post(v_friend, v_venue);
  v_blocked_post := tests.cf_post(v_blocked, v_venue);
  v_minor_post := tests.cf_post(v_minor, v_venue);
  v_team_post := tests.cf_post(v_stranger, v_venue, 'open', v_team, 'opposition');
  v_my_open := tests.cf_post(v_me, v_venue);
  v_my_closed := tests.cf_post(v_me, v_venue, 'cancelled');
  v_closed := tests.cf_post(v_stranger, v_venue, 'cancelled');

  -- For you: every open post anyone can join, except a blocked poster's.
  v_feed := tests.cf_feed(v_me, 'for_you');
  assert tests.cf_has(v_feed, v_stranger_post), 'for you: a stranger''s open post';
  assert tests.cf_has(v_feed, v_minor_post), 'for you: an open post is public';
  assert tests.cf_item(v_feed, v_minor_post) ->> 'actor_name' = 'Maria', 'a minor poster: first name only';
  assert not tests.cf_has(v_feed, v_blocked_post), 'for you: no blocked poster';
  assert not tests.cf_has(v_feed, v_closed), 'for you: no closed post';
  assert tests.cf_item(v_feed, v_stranger_post) ->> 'kind' = 'squad_post', 'kind';
  assert tests.cf_item(v_feed, v_stranger_post) ->> 'venue_name' = 'Nuevo Campo', 'venue name';
  assert (tests.cf_item(v_feed, v_stranger_post) ->> 'spots')::int = 3, 'spots left';
  assert (tests.cf_item(v_feed, v_stranger_post) ->> 'can_message')::boolean = false, 'no chat without friends';
  assert (tests.cf_item(v_feed, v_my_open) ->> 'mine')::boolean, 'my own post is marked mine';
  assert tests.cf_item(v_feed, v_team_post) ->> 'actor_kind' = 'team', 'an opposition post by a team';
  assert tests.cf_item(v_feed, v_team_post) ->> 'actor_name' = 'Larnaca Lions', 'the team''s name';

  -- Following: only followed players (same age group) and teams.
  v_feed := tests.cf_feed(v_me, 'following');
  assert tests.cf_has(v_feed, v_friend_post), 'following: a followed player''s post';
  assert tests.cf_has(v_feed, v_team_post), 'following: a followed team''s post';
  assert not tests.cf_has(v_feed, v_stranger_post), 'following: no stranger';
  assert not tests.cf_has(v_feed, v_minor_post), 'following: nothing through a minor follow';

  -- Mine: my posts, any status.
  v_feed := tests.cf_feed(v_me, 'mine');
  assert jsonb_array_length(v_feed) = 2, 'mine: my two posts, got ' || v_feed::text;
  assert tests.cf_has(v_feed, v_my_open) and tests.cf_has(v_feed, v_my_closed), 'mine: open and cancelled';
  assert tests.cf_item(v_feed, v_my_closed) ->> 'spots' is null, 'a closed post has no spots';

  -- Paging: one at a time, newest first, no repeats.
  v_feed := tests.cf_feed(v_me, 'mine', p_limit => 1);
  assert jsonb_array_length(v_feed) = 1, 'page 1';
  v_feed := v_feed || tests.cf_feed(v_me, 'mine', (v_feed -> 0 ->> 'sort_at')::timestamptz,
                                    (v_feed -> 0 ->> 'item_id')::uuid, 1);
  assert jsonb_array_length(v_feed) = 2 and v_feed -> 0 ->> 'item_id' <> v_feed -> 1 ->> 'item_id', 'page 2';

  -- Refused: a bad scope, anon.
  perform tests.act_as(v_me);
  v_error := tests.error_of('select * from public.community_feed(''everyone'')');
  perform tests.act_as_postgres();
  assert v_error like '%invalid_scope%', 'bad scope: refused';
  perform tests.act_as_anon();
  v_error := tests.error_of('select * from public.community_feed(''for_you'')');
  perform tests.act_as_postgres();
  assert v_error is not null, 'anon: refused';
end;
$$;

rollback;
