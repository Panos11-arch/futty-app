-- S7b: posts, likes, comments and their photos
-- (20261127230000_match_s7b_posts.sql). Every rule is checked on the server:
-- the audience (everyone, followers, my city), the two communities (under-18s
-- and adults never see or touch each other's posts, in either direction),
-- blocking both ways, the under-18 safeguards, the daily limits, and the
-- posts_enabled switch that refuses everything.
begin;

create temporary table s7b (k text primary key, v uuid) on commit drop;
grant all on s7b to authenticated, anon, service_role;

create function tests.s7b(p_key text) returns uuid language sql stable as $$ select v from s7b where k = p_key $$;

-- A player with a date of birth and a city.
create function tests.s7b_user(p_key text, p_dob timestamp, p_city text default null)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.create_user(p_key || '@s7b.test', jsonb_build_object('date_of_birth', p_dob::date, 'full_name', initcap(p_key) || ' Surname'));
begin
  update public.profiles set city = p_city, date_of_birth = p_dob::date where id = v;
  insert into s7b values (p_key, v);
  return v;
end;
$$;

-- Runs p_sql as p_user and returns its first column as text.
create function tests.s7b_value(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as(p_user);
  execute p_sql into v;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- A post written the way community-post writes it (service role).
create function tests.s7b_post(p_author uuid, p_audience text, p_body text default 'Good game', p_photos integer default 0,
                               p_match uuid default null)
returns uuid
language plpgsql
as $$
declare
  v uuid;
begin
  perform tests.act_as_service_role();
  v := public.create_post_internal(p_author, gen_random_uuid(), p_body, p_audience, p_match, p_photos);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s7b_post_error(p_author uuid, p_audience text, p_body text default 'Good game',
                                     p_photos integer default 0, p_match uuid default null)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  v := tests.error_of(format('select public.create_post_internal(%L, gen_random_uuid(), %L, %L, %L, %s)',
                             p_author, p_body, p_audience, p_match, p_photos));
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s7b_comment_error(p_author uuid, p_post uuid, p_body text default 'Nice')
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  v := tests.error_of(format('select public.add_comment_internal(%L, %L, %L)', p_author, p_post, p_body));
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- Whether p_viewer gets the post from get_post (and the feed, for_you).
create function tests.s7b_sees(p_viewer uuid, p_post uuid)
returns boolean
language plpgsql
as $$
declare
  v_get text := tests.error_as(p_viewer, format('select public.get_post(%L)', p_post));
  v_feed boolean := tests.s7b_value(p_viewer, format(
    $q$select exists (select 1 from public.community_feed('for_you', null, null, 50) f where f.item_id = %L)$q$, p_post))::boolean;
begin
  assert (v_get is null) = v_feed,
    format('get_post (%s) and the feed (%s) disagree for %s', coalesce(v_get, 'seen'), v_feed, p_post);
  return v_get is null;
end;
$$;

-- ---- Setup ------------------------------------------------------------------------------
do $$
declare
  v_minor_dob timestamp := tests.cyprus_today() - interval '16 years';
begin
  perform tests.s7b_user('ada', '1995-01-01', 'Limassol');
  perform tests.s7b_user('ben', '1994-01-01', 'Limassol');
  perform tests.s7b_user('cal', '1993-01-01', 'Nicosia');
  perform tests.s7b_user('dan', '1992-01-01', 'Limassol');
  perform tests.s7b_user('mia', v_minor_dob, 'Limassol');
  perform tests.s7b_user('max', v_minor_dob, 'Limassol');
  perform tests.s7b_user('lea', v_minor_dob, 'Limassol');
  perform tests.s7b_user('nod', null, 'Limassol');
  -- Turns 18 today (Cyprus date).
  perform tests.s7b_user('tom', tests.cyprus_today() - interval '18 years', 'Limassol');

  update public.app_rules set posts_enabled = true;
  insert into public.guideline_agreements (profile_id, version)
  select v, 1 from s7b;

  -- Ben follows Ada; Max follows Mia; Dan follows Ada but Ada blocked Dan.
  insert into public.user_follows (follower_id, target_type, target_id) values
    (tests.s7b('ben'), 'player', tests.s7b('ada')),
    (tests.s7b('max'), 'player', tests.s7b('mia')),
    (tests.s7b('dan'), 'player', tests.s7b('ada'));
  insert into public.blocked_users (blocker_id, blocked_id) values (tests.s7b('ada'), tests.s7b('dan'));
end $$;

-- ---- The switch: posts_enabled false refuses every posts RPC -----------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  ben uuid := tests.s7b('ben');
  p uuid := tests.s7b_post(ada, 'everyone');
  c uuid;
  rpc text;
begin
  perform tests.act_as_service_role();
  c := public.add_comment_internal(ben, p, 'Nice');
  perform tests.act_as_postgres();

  update public.app_rules set posts_enabled = false;

  assert tests.s7b_post_error(ada, 'everyone') = 'posts_disabled', 'create_post_internal while off';
  assert tests.s7b_comment_error(ben, p) = 'posts_disabled', 'add_comment_internal while off';
  foreach rpc in array array[
    'select public.agree_guidelines()',
    'select public.my_post_defaults()',
    format('select public.toggle_like(%L)', p),
    format('select public.get_post(%L)', p),
    format('select * from public.post_comments_page(%L)', p),
    format('select * from public.post_likers(%L)', p),
    'select * from public.my_shareable_matches()',
    format('select public.delete_comment(%L)', c),
    format('select public.delete_post(%L)', p)
  ] loop
    assert coalesce(tests.error_as(case when rpc like '%delete_comment%' then ben else ada end, rpc), '') = 'posts_disabled',
      format('%s should be refused while posts are off', rpc);
  end loop;

  -- The feed shows no posts, even the author's own.
  assert tests.s7b_value(ada, $q$select count(*) from public.community_feed('mine') where kind = 'post'$q$)::int = 0,
    'no posts in the feed while off';
  -- Photo uploads are refused too.
  assert tests.error_as(ada, format($q$insert into storage.objects (bucket_id, name) values ('post-photos', 'pending/%s/a.jpg')$q$, ada))
    is not null, 'photo upload refused while off';

  update public.app_rules set posts_enabled = true;
  assert tests.s7b_sees(ada, p), 'back on: the author sees it again';
  delete from public.posts where id = p;
end $$;

-- ---- Internal writes are the Edge Function's only ---------------------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
begin
  assert tests.error_as(ada, format($q$select public.create_post_internal(%L, null, 'x', 'everyone', null, 0)$q$, ada))
    like 'permission denied%', 'create_post_internal is service_role only';
  assert tests.error_as(ada, format($q$select public.add_comment_internal(%L, gen_random_uuid(), 'x')$q$, ada))
    like 'permission denied%', 'add_comment_internal is service_role only';
  assert tests.error_as(ada, format('select public.post_visible_to(%L, gen_random_uuid())', ada))
    like 'permission denied%', 'post_visible_to is service_role only';
  assert tests.error_as(ada, 'select * from public.posts') like 'permission denied%', 'posts are not readable directly';
  assert tests.error_as(ada, format($q$insert into public.post_likes (post_id, profile_id) values (gen_random_uuid(), %L)$q$, ada))
    like 'permission denied%', 'likes are not writable directly';
  perform tests.act_as_anon();
  assert tests.error_of('select public.my_post_defaults()') like 'permission denied%', 'signed out: refused';
  perform tests.act_as_postgres();
end $$;

-- ---- Audience: everyone, followers, my city ---------------------------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  ben uuid := tests.s7b('ben');
  cal uuid := tests.s7b('cal');
  everyone_post uuid := tests.s7b_post(ada, 'everyone');
  followers_post uuid := tests.s7b_post(ada, 'followers');
  city_post uuid := tests.s7b_post(ada, 'city');
begin
  -- Everyone: any adult.
  assert tests.s7b_sees(ben, everyone_post), 'everyone: a follower sees it';
  assert tests.s7b_sees(cal, everyone_post), 'everyone: a non-follower sees it';
  -- Followers: Ben follows Ada, Cal doesn't.
  assert tests.s7b_sees(ben, followers_post), 'followers: a follower sees it';
  assert not tests.s7b_sees(cal, followers_post), 'followers: a non-follower does not';
  -- My city: Ben is in Limassol like Ada, Cal is in Nicosia.
  assert tests.s7b_sees(ben, city_post), 'city: same city sees it';
  assert not tests.s7b_sees(cal, city_post), 'city: another city does not';
  -- The author always sees their own.
  assert tests.s7b_sees(ada, followers_post) and tests.s7b_sees(ada, city_post), 'the author sees their own posts';

  -- The 'city' feed scope: Ben (Limassol) gets Ada's posts, Cal doesn't get the city one.
  assert tests.s7b_value(ben, format($q$select count(*) from public.community_feed('city') where item_id = %L$q$, city_post))::int = 1,
    'My city feed: same city';
  assert tests.s7b_value(cal, format($q$select count(*) from public.community_feed('city') where item_id = %L$q$, city_post))::int = 0,
    'My city feed: other city';
  -- Following: Ben follows Ada.
  assert tests.s7b_value(ben, format($q$select count(*) from public.community_feed('following') where item_id = %L$q$, everyone_post))::int = 1,
    'Following feed: followed author';
  assert tests.s7b_value(cal, format($q$select count(*) from public.community_feed('following') where item_id = %L$q$, everyone_post))::int = 0,
    'Following feed: not followed';
  assert tests.s7b_value(ada, $q$select count(*) from public.community_feed('mine') where kind = 'post'$q$)::int = 3,
    'Your posts: all three';

  -- Likes and comments follow the audience.
  assert tests.error_as(cal, format('select public.toggle_like(%L)', followers_post)) = 'post_not_found',
    'a non-follower cannot like a followers post';
  assert tests.s7b_comment_error(cal, followers_post) = 'post_not_found', 'a non-follower cannot comment on it';
  assert tests.s7b_comment_error(cal, city_post) = 'post_not_found', 'another city cannot comment on a city post';
  assert tests.error_as(ben, format('select public.toggle_like(%L)', followers_post)) is null, 'a follower can like it';
  assert tests.s7b_comment_error(ben, followers_post) is null, 'a follower can comment on it';
  assert tests.error_as(cal, format('select * from public.post_comments_page(%L)', followers_post)) = 'post_not_found',
    'a non-follower cannot read its comments';
  assert tests.error_as(cal, format('select * from public.post_likers(%L)', followers_post)) = 'post_not_found',
    'a non-follower cannot read its likes';

  -- City needs the author to have a city.
  update public.profiles set city = null where id = cal;
  assert tests.s7b_post_error(cal, 'city') = 'city_required', 'no city: My city refused';
  update public.profiles set city = 'Nicosia' where id = cal;
  assert tests.s7b_post_error(ada, 'friends') = 'invalid_audience', 'an unknown audience is refused';

  delete from public.posts where author_id = ada;
end $$;

-- ---- Likes: one per person, undone by a second tap; notices -----------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  ben uuid := tests.s7b('ben');
  cal uuid := tests.s7b('cal');
  p uuid := tests.s7b_post(ada, 'everyone');
  r jsonb;
begin
  r := tests.s7b_value(ben, format('select public.toggle_like(%L)', p))::jsonb;
  assert r = '{"liked": true, "likeCount": 1}'::jsonb, format('first tap likes: %s', r);
  r := tests.s7b_value(ben, format('select public.toggle_like(%L)', p))::jsonb;
  assert r = '{"liked": false, "likeCount": 0}'::jsonb, format('second tap unlikes: %s', r);
  r := tests.s7b_value(ben, format('select public.toggle_like(%L)', p))::jsonb;
  r := tests.s7b_value(cal, format('select public.toggle_like(%L)', p))::jsonb;
  assert r ->> 'likeCount' = '2', 'two people, two likes';
  -- One like notice per post per hour, never for your own like.
  assert (select count(*) from public.notifications where profile_id = ada and type = 'post_liked'
          and data ->> 'post_id' = p::text) = 1, 'one like notice per post an hour';
  perform tests.s7b_value(ada, format('select public.toggle_like(%L)', p));
  assert (select count(*) from public.notifications where profile_id = ada and type = 'post_liked'
          and data ->> 'post_id' = p::text) = 1, 'no notice for liking your own post';
  -- Comment notice.
  perform tests.act_as_service_role();
  perform public.add_comment_internal(ben, p, 'Great');
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications where profile_id = ada and type = 'post_commented'
          and data ->> 'post_id' = p::text) = 1, 'a comment notice';
  assert (tests.last_notification(ada, 'post_commented')).body = 'Ben Surname commented on your post', 'the comment notice text';

  -- Comment length: 1-500.
  assert tests.s7b_comment_error(ben, p, '   ') = 'comment_length', 'an empty comment is refused';
  assert tests.s7b_comment_error(ben, p, repeat('a', 501)) = 'comment_length', '501 characters is refused';
  assert tests.s7b_comment_error(ben, p, repeat('a', 500)) is null, '500 characters is fine';
  -- Post length: 1-1000, and something to post.
  assert tests.s7b_post_error(ada, 'everyone', repeat('a', 1001)) = 'body_too_long', '1001 characters is refused';
  assert tests.s7b_post_error(ada, 'everyone', '  ') = 'post_empty', 'nothing to post is refused';
  assert tests.s7b_post_error(ada, 'everyone', 'x', 5) = 'too_many_photos', 'five photos are refused';

  -- Deleting: own only.
  assert tests.error_as(ben, format('select public.delete_post(%L)', p)) = 'not_yours', 'only the author deletes a post';
  assert tests.error_as(ada, format('select public.delete_comment(%L)',
    (select id from public.post_comments where post_id = p and body = 'Great'))) = 'not_yours',
    'only the author deletes a comment';
  assert tests.error_as(ben, format('select public.delete_comment(%L)',
    (select id from public.post_comments where post_id = p and body = 'Great'))) is null,
    'the author deletes their comment';
  assert tests.s7b_value(ada, format('select public.get_post(%L)', p))::jsonb ->> 'commentCount' = '1',
    'a deleted comment is not counted';
  assert tests.error_as(ada, format('select public.delete_post(%L)', p)) is null, 'the author deletes the post';
  assert not tests.s7b_sees(ben, p) and not tests.s7b_sees(ada, p), 'a deleted post is gone for everyone';
  delete from public.posts where author_id = ada;
end $$;

-- ---- Two communities: adults and under-18s never mix, in any direction -----------------
do $$
declare
  ada uuid := tests.s7b('ada');
  ben uuid := tests.s7b('ben');
  mia uuid := tests.s7b('mia');
  max uuid := tests.s7b('max');
  lea uuid := tests.s7b('lea');
  adult_post uuid := tests.s7b_post(ada, 'everyone');
  minor_post uuid := tests.s7b_post(mia, 'everyone');
  r jsonb;
begin
  -- Seeing posts.
  assert not tests.s7b_sees(mia, adult_post), 'a minor never sees an adult''s post';
  assert not tests.s7b_sees(ben, minor_post), 'an adult never sees a minor''s post';
  assert tests.s7b_sees(max, minor_post) and tests.s7b_sees(lea, minor_post), 'minors see minors'' Everyone posts';
  -- Likes.
  assert tests.error_as(mia, format('select public.toggle_like(%L)', adult_post)) = 'post_not_found', 'a minor cannot like an adult''s post';
  assert tests.error_as(ben, format('select public.toggle_like(%L)', minor_post)) = 'post_not_found', 'an adult cannot like a minor''s post';
  -- Comments.
  assert tests.s7b_comment_error(mia, adult_post) = 'post_not_found', 'a minor cannot comment on an adult''s post';
  assert tests.s7b_comment_error(ben, minor_post) = 'post_not_found', 'an adult cannot comment on a minor''s post';
  -- Comment threads and likers: an adult can't read them, a minor can't read adults'.
  assert tests.error_as(ben, format('select * from public.post_comments_page(%L)', minor_post)) = 'post_not_found',
    'an adult cannot read a minor''s thread';
  assert tests.error_as(mia, format('select * from public.post_comments_page(%L)', adult_post)) = 'post_not_found',
    'a minor cannot read an adult''s thread';
  assert tests.error_as(ben, format('select * from public.post_likers(%L)', minor_post)) = 'post_not_found',
    'an adult cannot see who liked a minor''s post';
  assert tests.error_as(mia, format('select * from public.post_likers(%L)', adult_post)) = 'post_not_found',
    'a minor cannot see who liked an adult''s post';

  -- Under-18 safeguards: comments on a minor's post only from their followers.
  assert tests.s7b_comment_error(lea, minor_post) = 'followers_only', 'a non-follower can''t comment on a minor''s post';
  assert tests.s7b_comment_error(max, minor_post) is null, 'a follower (a minor) can';
  assert tests.s7b_comment_error(mia, minor_post) is null, 'the author can';
  assert (select bool_and(community = 'minor') from public.post_comments where post_id = minor_post), 'the thread stays minor';
  r := tests.s7b_value(max, format('select public.toggle_like(%L)', minor_post))::jsonb;
  assert (r ->> 'liked')::boolean, 'a minor likes a minor''s post';

  -- A minor's name: first name only, to other minors.
  assert tests.s7b_value(max, format('select public.get_post(%L)', minor_post))::jsonb ->> 'authorName' = 'Mia',
    'a minor shows first name only';
  delete from public.posts where author_id in (ada, mia);
end $$;

-- ---- Under-18 safeguards: defaults, no My city, no photos -------------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  mia uuid := tests.s7b('mia');
  d jsonb;
begin
  d := tests.s7b_value(mia, 'select public.my_post_defaults()')::jsonb;
  assert d ->> 'defaultAudience' = 'followers', format('a minor''s posts default to Followers: %s', d);
  assert d -> 'audiences' = '["followers", "everyone"]'::jsonb, 'a minor gets no My city';
  assert not (d ->> 'photos')::boolean, 'a minor gets no photos';
  d := tests.s7b_value(ada, 'select public.my_post_defaults()')::jsonb;
  assert d ->> 'defaultAudience' = 'everyone' and d -> 'audiences' = '["everyone", "followers", "city"]'::jsonb
     and (d ->> 'photos')::boolean and (d ->> 'agreed')::boolean, format('an adult''s defaults: %s', d);

  assert tests.s7b_post_error(mia, 'city') = 'audience_not_allowed', 'My city refused for a minor';
  assert tests.s7b_post_error(mia, 'everyone', 'x', 1) = 'minor_photos_refused', 'a minor''s photo post is refused';
  -- The upload itself is refused for a minor (storage), allowed for an adult.
  assert tests.error_as(mia, format($q$insert into storage.objects (bucket_id, name) values ('post-photos', 'pending/%s/a.jpg')$q$, mia))
    is not null, 'a minor''s photo upload is refused';
  assert tests.error_as(ada, format($q$insert into storage.objects (bucket_id, name) values ('post-photos', 'pending/%s/a.jpg')$q$, ada))
    is null, 'an adult uploads to their own pending folder';
  assert tests.error_as(ada, format($q$insert into storage.objects (bucket_id, name) values ('post-photos', 'pending/%s/b.jpg')$q$, mia))
    is not null, 'never into someone else''s folder';
  assert tests.error_as(ada, $q$insert into storage.objects (bucket_id, name) values ('post-photos', 'posts/x/0.jpg')$q$)
    is not null, 'never straight into posts/';
  assert not (select public from storage.buckets where id = 'post-photos'), 'the bucket is private';
end $$;

-- ---- No date of birth, too young, guidelines ---------------------------------------------
do $$
declare
  nod uuid := tests.s7b('nod');
  ada uuid := tests.s7b('ada');
begin
  assert tests.s7b_post_error(nod, 'everyone') = 'date_of_birth_required', 'no date of birth, no posting';
  delete from public.guideline_agreements where profile_id = ada;
  assert tests.s7b_post_error(ada, 'everyone') = 'guidelines_required', 'guidelines first (post)';
  assert not (tests.s7b_value(ada, 'select public.my_post_defaults()')::jsonb ->> 'agreed')::boolean, 'not agreed yet';
  assert tests.s7b_value(ada, 'select public.agree_guidelines()')::int = 1, 'agree to version 1';
  assert tests.s7b_post_error(ada, 'everyone') is null, 'after agreeing, posting works';
  -- A new version asks again.
  update public.app_rules set community_guidelines_version = 2;
  assert tests.s7b_post_error(ada, 'everyone') = 'guidelines_required', 'a new guidelines version asks again';
  assert tests.s7b_value(ada, 'select public.agree_guidelines()')::int = 2, 'agree to version 2';
  update public.app_rules set community_guidelines_version = 1;
  delete from public.posts where author_id = ada;
end $$;

-- ---- Turning 18: moves to the adults; old posts stay with the under-18s -----------------
do $$
declare
  tom uuid := tests.s7b('tom');
  ben uuid := tests.s7b('ben');
  max uuid := tests.s7b('max');
  old_post uuid;
  new_post uuid;
begin
  -- Yesterday Tom was 17: his post is in the under-18 community.
  update public.profiles set date_of_birth = tests.cyprus_today() - interval '18 years' + interval '1 day' where id = tom;
  old_post := tests.s7b_post(tom, 'everyone');
  assert (select community from public.posts where id = old_post) = 'minor', 'posted at 17: minor community';
  -- Today is his 18th birthday.
  update public.profiles set date_of_birth = tests.cyprus_today() - interval '18 years' where id = tom;
  new_post := tests.s7b_post(tom, 'everyone');
  assert (select community from public.posts where id = new_post) = 'adult', 'posted at 18: adult community';
  assert tests.s7b_sees(ben, new_post) and not tests.s7b_sees(max, new_post), 'his new post is for adults';
  assert tests.s7b_sees(max, old_post) and not tests.s7b_sees(ben, old_post), 'his old post stays with the under-18s';
  assert tests.s7b_sees(tom, old_post), 'he still sees his own old post';
  assert tests.s7b_comment_error(tom, old_post) = 'community_mismatch', 'he can''t join the under-18 thread any more';
  assert tests.error_as(tom, format('select public.toggle_like(%L)', old_post)) = 'community_mismatch',
    'or like in it';
  delete from public.posts where author_id = tom;
end $$;

-- ---- Blocking hides both people from each other, both ways -------------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  dan uuid := tests.s7b('dan');
  ben uuid := tests.s7b('ben');
  ada_post uuid := tests.s7b_post(ada, 'everyone');
  dan_post uuid := tests.s7b_post(dan, 'everyone');
  ben_post uuid := tests.s7b_post(ben, 'everyone');
begin
  -- Ada blocked Dan.
  assert not tests.s7b_sees(dan, ada_post), 'the blocked person doesn''t see the blocker''s post';
  assert not tests.s7b_sees(ada, dan_post), 'the blocker doesn''t see the blocked person''s post';
  assert tests.s7b_comment_error(dan, ada_post) = 'post_not_found', 'the blocked person can''t comment';
  assert tests.error_as(dan, format('select public.toggle_like(%L)', ada_post)) = 'post_not_found', 'or like';
  -- On a third person's post: neither sees the other's comment or like.
  perform tests.act_as_service_role();
  perform public.add_comment_internal(dan, ben_post, 'From Dan');
  perform public.add_comment_internal(ada, ben_post, 'From Ada');
  perform tests.act_as_postgres();
  perform tests.s7b_value(dan, format('select public.toggle_like(%L)', ben_post));
  assert tests.s7b_value(ada, format($q$select string_agg(body, ',') from public.post_comments_page(%L)$q$, ben_post)) = 'From Ada',
    'the blocker doesn''t see the blocked person''s comment';
  assert tests.s7b_value(dan, format($q$select string_agg(body, ',') from public.post_comments_page(%L)$q$, ben_post)) = 'From Dan',
    'the blocked person doesn''t see the blocker''s comment';
  assert tests.s7b_value(ada, format('select count(*) from public.post_likers(%L)', ben_post))::int = 0,
    'the blocker doesn''t see the blocked person among the likers';
  assert tests.s7b_value(ben, format('select count(*) from public.post_comments_page(%L)', ben_post))::int = 2,
    'the post''s author sees both';
  delete from public.posts where author_id in (ada, dan, ben);
end $$;

-- ---- Daily limits (Cyprus day), checked before anything is written -----------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  ben uuid := tests.s7b('ben');
  p uuid;
  i integer;
begin
  update public.app_rules set posts_per_day = 3, comments_per_day = 2;
  for i in 1..3 loop
    perform tests.s7b_post(ada, 'everyone');
  end loop;
  assert tests.s7b_post_error(ada, 'everyone') = 'daily_limit', 'over the post limit: refused';
  -- A deleted post still counts.
  update public.posts set deleted_at = now() where author_id = ada;
  assert tests.s7b_post_error(ada, 'everyone') = 'daily_limit', 'deleting doesn''t free a post';
  -- Yesterday's posts don't count.
  update public.posts set created_at = created_at - interval '1 day' where author_id = ada;
  assert tests.s7b_post_error(ada, 'everyone') is null, 'a new Cyprus day: posting again';

  p := tests.s7b_post(ben, 'everyone');
  assert tests.s7b_comment_error(ada, p) is null and tests.s7b_comment_error(ada, p) is null, 'at the comment limit: fine';
  assert tests.s7b_comment_error(ada, p) = 'daily_limit', 'over the comment limit: refused';

  -- The check community-post runs before the text and photo checks.
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$select public.assert_daily_limit(%L, 'comment')$q$, ada)) = 'daily_limit', 'assert_daily_limit: comments';
  assert tests.error_of(format($q$select public.assert_daily_limit(%L, 'post')$q$, ben)) is null, 'assert_daily_limit: under the limit';
  perform tests.act_as_postgres();
  update public.app_rules set posts_per_day = 10, comments_per_day = 100;
  delete from public.posts where author_id in (ada, ben);
end $$;

-- ---- A shared result: only the author's own confirmed matches ---------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  ben uuid := tests.s7b('ben');
  m uuid;
  open_m uuid;
begin
  insert into public.matches (kind, format, players_per_side, kickoff_at, ends_at, result_deadline_at, status,
                              side_a_score, side_b_score, confirmed_at, confirmed_via)
  values ('pickup', '5-a-side', 5, now() - interval '3 hours', now() - interval '2 hours', now() + interval '1 day',
          'confirmed', 3, 2, now(), 'agreed')
  returning id into m;
  insert into public.match_sides (match_id, side, label) values (m, 'a', 'Bibs'), (m, 'b', 'Non-bibs');
  insert into public.match_players (match_id, profile_id, side) values (m, ada, 'a');
  insert into public.matches (kind, format, players_per_side, kickoff_at, ends_at, result_deadline_at)
  values ('pickup', '5-a-side', 5, now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '2 days')
  returning id into open_m;
  insert into public.match_sides (match_id, side, label) values (open_m, 'a', 'Bibs'), (open_m, 'b', 'Non-bibs');
  insert into public.match_players (match_id, profile_id, side) values (open_m, ada, 'a');

  assert tests.s7b_value(ada, 'select count(*) from public.my_shareable_matches()')::int = 1, 'one confirmed match to share';
  assert tests.s7b_post_error(ada, 'everyone', null, 0, m) is null, 'sharing her own confirmed result';
  assert tests.s7b_post_error(ben, 'everyone', null, 0, m) = 'match_not_shareable', 'not someone else''s match';
  assert tests.s7b_post_error(ada, 'everyone', null, 0, open_m) = 'match_not_shareable', 'not an unconfirmed one';
  delete from public.posts where author_id = ada;
end $$;

-- ---- Photos: who can read them ------------------------------------------------------------
do $$
declare
  ada uuid := tests.s7b('ada');
  ben uuid := tests.s7b('ben');
  cal uuid := tests.s7b('cal');
  dan uuid := tests.s7b('dan');
  mia uuid := tests.s7b('mia');
  everyone_post uuid := tests.s7b_post(ada, 'everyone', 'Photos', 2);
  followers_post uuid := tests.s7b_post(ada, 'followers', 'Photos', 1);
begin
  -- community-post moves the checked photos here (service role).
  insert into storage.objects (bucket_id, name)
  select 'post-photos', path from public.post_photos where post_id in (everyone_post, followers_post);
  insert into storage.objects (bucket_id, name) values ('post-photos', 'pending/' || ada || '/c.jpg');

  assert tests.s7b_value(ada, format($q$select public.get_post(%L)$q$, everyone_post))::jsonb -> 'photoPaths'
       = jsonb_build_array('posts/' || everyone_post || '/0.jpg', 'posts/' || everyone_post || '/1.jpg'), 'photo paths in order';
  assert tests.s7b_value(ben, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'posts/%s/%%'$q$,
                                     everyone_post))::int = 2, 'an allowed viewer reads the photos';
  assert tests.s7b_value(ben, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'posts/%s/%%'$q$,
                                     followers_post))::int = 1, 'a follower reads a followers post''s photo';
  assert tests.s7b_value(cal, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'posts/%s/%%'$q$,
                                     followers_post))::int = 0, 'a non-follower can''t read a followers post''s photo';
  assert tests.s7b_value(dan, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'posts/%s/%%'$q$,
                                     everyone_post))::int = 0, 'a blocked person can''t read the photos';
  assert tests.s7b_value(mia, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'posts/%s/%%'$q$,
                                     everyone_post))::int = 0, 'the other community can''t read the photos';
  -- Pending files: the owner only.
  assert tests.s7b_value(ada, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name = 'pending/%s/c.jpg'$q$, ada))::int = 1,
    'the owner reads her pending upload';
  assert tests.s7b_value(ben, $q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'pending/%'$q$)::int = 0,
    'nobody else reads it';
  -- Posts off: nobody reads post photos.
  update public.app_rules set posts_enabled = false;
  assert tests.s7b_value(ben, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'posts/%s/%%'$q$,
                                     everyone_post))::int = 0, 'posts off: photos unreadable';
  update public.app_rules set posts_enabled = true;
  -- A hidden post's photos are not readable by others.
  update public.posts set hidden_reason = 'admin', hidden_at = now() where id = everyone_post;
  assert tests.s7b_value(ben, format($q$select count(*) from storage.objects where bucket_id = 'post-photos' and name like 'posts/%s/%%'$q$,
                                     everyone_post))::int = 0, 'a hidden post''s photos are unreadable';
  delete from public.posts where author_id = ada;
end $$;

rollback;
