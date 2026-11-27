-- S7b (part 1 of 2, server): player posts, likes and comments.
--
-- Posts: text (1-1000), up to 4 photos, or a shared result from the
-- author's own confirmed match. "Who can see this": everyone, followers or
-- my city. Under-18s and adults are two separate communities: a post keeps
-- the community its author was in on the day it was posted (is_minor, Cyprus
-- date), and only people in that community see it, like it or comment on
-- it. Under-18s (decided 25 November): no photos, no "my city", Followers by
-- default, and comments on their posts only from their followers.
--
-- Nothing here is reachable while app_rules.posts_enabled is false (the
-- default): every posts RPC and the photo upload refuse, and the feed shows
-- no posts. Posts and comments are only ever written by the community-post
-- Edge Function (service role), after the text and photo checks pass
-- (create_post_internal, add_comment_internal). Moderation is in
-- 20261127230100_match_s7b_moderation.sql.

-- ---- 1. Rules ------------------------------------------------------------------------

alter table public.app_rules
  add column posts_enabled boolean not null default false,
  add column community_guidelines_version integer not null default 1
    constraint app_rules_community_guidelines_version check (community_guidelines_version >= 1),
  -- Decided by Anghelo, 27 November: per account, per Cyprus day.
  add column posts_per_day integer not null default 10
    constraint app_rules_posts_per_day check (posts_per_day >= 1),
  add column comments_per_day integer not null default 100
    constraint app_rules_comments_per_day check (comments_per_day >= 1);

-- ---- 2. Tables -----------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text check (body is null or char_length(body) between 1 and 1000),
  audience text not null check (audience in ('everyone', 'followers', 'city')),
  -- The author's city when posting (profiles.city): "My city" matches it.
  city text,
  community text not null check (community in ('adult', 'minor')),
  match_id uuid references public.matches (id) on delete set null,
  photo_count smallint not null default 0 check (photo_count between 0 and 4),
  hidden_reason text check (hidden_reason in ('reports', 'admin')),
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (audience <> 'city' or city is not null),
  check (community <> 'minor' or (audience <> 'city' and photo_count = 0)),
  check ((hidden_reason is null) = (hidden_at is null))
);
create index posts_feed_idx on public.posts (created_at desc, id desc) where deleted_at is null;
create index posts_author_idx on public.posts (author_id, created_at desc);

-- Photo n of a post is stored at post-photos/posts/<post_id>/<n>.jpg.
create table public.post_photos (
  post_id uuid not null references public.posts (id) on delete cascade,
  idx smallint not null check (idx between 0 and 3),
  path text not null unique,
  primary key (post_id, idx)
);

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index post_likes_profile_idx on public.post_likes (profile_id);

-- One level only: there are no replies to comments.
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  -- Always the post's community: a thread never mixes the two.
  community text not null check (community in ('adult', 'minor')),
  hidden_reason text check (hidden_reason in ('reports', 'admin')),
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((hidden_reason is null) = (hidden_at is null))
);
create index post_comments_post_idx on public.post_comments (post_id, created_at, id);
create index post_comments_author_idx on public.post_comments (author_id, created_at desc);

-- "I agree" to the community guidelines, per version.
create table public.guideline_agreements (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null,
  agreed_at timestamptz not null default now(),
  primary key (profile_id, version)
);

-- Suspensions (with an end) and bans (no end), set from the admin queue
-- (admin_moderate). A suspended or banned player can't post, comment or
-- like; a banned player's posts and comments are hidden.
create table public.account_restrictions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('suspend', 'ban')),
  until timestamptz,
  reason text not null check (char_length(trim(reason)) > 0),
  admin_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  check ((kind = 'ban') = (until is null))
);
create index account_restrictions_profile_idx on public.account_restrictions (profile_id) where lifted_at is null;

-- Nothing is read or written directly from the app: only through the
-- functions below.
alter table public.posts enable row level security;
alter table public.post_photos enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.guideline_agreements enable row level security;
alter table public.account_restrictions enable row level security;
revoke all on public.posts, public.post_photos, public.post_likes, public.post_comments,
  public.guideline_agreements, public.account_restrictions from public, anon, authenticated;
grant all on public.posts, public.post_photos, public.post_likes, public.post_comments,
  public.guideline_agreements, public.account_restrictions to service_role;

-- ---- 3. Helpers (service_role only) ----------------------------------------------------

create function public.assert_posts_enabled()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.app_rules_now()).posts_enabled then
    raise exception 'posts_disabled';
  end if;
end;
$$;

-- 'minor' or 'adult' today (Cyprus date). Turning 18 moves a player to the
-- adult community that day.
create function public.viewer_community(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_minor(p_profile_id) then 'minor' else 'adult' end;
$$;

-- 'ban', 'suspend' or null: the player's restriction in force now.
create function public.active_restriction(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.kind
  from public.account_restrictions r
  where r.profile_id = p_profile_id and r.lifted_at is null and (r.until is null or r.until > now())
  order by (r.kind = 'ban') desc
  limit 1;
$$;

-- Whether p_viewer follows player p_author.
create function public.follows_player(p_viewer uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_follows f
    where f.follower_id = p_viewer and f.target_type = 'player' and f.target_id = p_author
  );
$$;

-- Who sees a post. The author always sees their own (even hidden). Anyone
-- else: not hidden, author not banned or deleted, not blocked either way,
-- the same community today, and the post's audience lets them.
create function public.post_visible_to(p_viewer uuid, p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and p.deleted_at is null
      and p_viewer is not null
      and (
        p.author_id = p_viewer
        or (
          p.hidden_reason is null
          and public.active_restriction(p.author_id) is distinct from 'ban'
          and not public.profile_is_deleted(p.author_id)
          and not public.blocked_between(p_viewer, p.author_id)
          and public.viewer_community(p_viewer) = p.community
          and (
            p.audience = 'everyone'
            or (p.audience = 'followers' and public.follows_player(p_viewer, p.author_id))
            or (p.audience = 'city' and p.city = (select pr.city from public.profiles pr where pr.id = p_viewer))
          )
        )
      )
  );
$$;

-- Who sees a comment: the post is visible to them, and the comment isn't
-- deleted, hidden (except to its author), by a banned or deleted player, or
-- by someone blocked either way.
create function public.comment_visible_to(p_viewer uuid, p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.post_comments c
    where c.id = p_comment_id
      and c.deleted_at is null
      and public.post_visible_to(p_viewer, c.post_id)
      and (
        c.author_id = p_viewer
        or (
          c.hidden_reason is null
          and public.active_restriction(c.author_id) is distinct from 'ban'
          and not public.profile_is_deleted(c.author_id)
          and not public.blocked_between(p_viewer, c.author_id)
        )
      )
  );
$$;

-- Everything that stops a player posting, commenting or liking.
create function public.assert_can_interact(p_profile_id uuid, p_needs_guidelines boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_restriction text := public.active_restriction(p_profile_id);
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  -- The community is worked out from the date of birth: none, no posting.
  case public.age_status(p_profile_id)
    when 'ok' then null;
    when 'too_young' then raise exception 'too_young';
    else raise exception 'date_of_birth_required';
  end case;
  if v_restriction = 'ban' then
    raise exception 'account_banned';
  elsif v_restriction = 'suspend' then
    raise exception 'account_suspended';
  end if;
  if p_needs_guidelines and not exists (
    select 1 from public.guideline_agreements g
    where g.profile_id = p_profile_id and g.version = (public.app_rules_now()).community_guidelines_version
  ) then
    raise exception 'guidelines_required';
  end if;
end;
$$;

-- At most posts_per_day posts and comments_per_day comments per Cyprus day
-- (deleted ones count too). Checked by community-post before the text and
-- photo checks, so a refused post costs nothing, and again on insert.
create function public.assert_daily_limit(p_profile_id uuid, p_kind text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rules public.app_rules := public.app_rules_now();
  v_day_start timestamptz := (public.cyprus_date(now())::timestamp) at time zone 'Asia/Nicosia';
  v_count integer;
begin
  if p_kind = 'post' then
    select count(*) into v_count from public.posts p
    where p.author_id = p_profile_id and p.created_at >= v_day_start;
    if v_count >= v_rules.posts_per_day then
      raise exception 'daily_limit';
    end if;
  elsif p_kind = 'comment' then
    select count(*) into v_count from public.post_comments c
    where c.author_id = p_profile_id and c.created_at >= v_day_start;
    if v_count >= v_rules.comments_per_day then
      raise exception 'daily_limit';
    end if;
  else
    raise exception 'invalid_kind';
  end if;
end;
$$;

-- Whether p_author played in p_match_id and its result is confirmed.
create function public.match_shareable_by(p_author uuid, p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matches m
    join public.match_players mp on mp.match_id = m.id
    where m.id = p_match_id and m.status = 'confirmed'
      and mp.profile_id = p_author and mp.left_at is null
  );
$$;

-- One post as p_viewer sees it.
create function public.post_json(p_viewer uuid, p_post public.posts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_post.id,
    'authorId', p_post.author_id,
    'authorName', coalesce(public.community_display_name(a), 'Player'),
    'avatarStyle', a.avatar_style,
    'avatarKitColour', a.avatar_kit_colour,
    'avatarNumber', a.avatar_number,
    'avatarIllustration', a.avatar_illustration,
    'body', p_post.body,
    'audience', p_post.audience,
    'matchId', p_post.match_id,
    'photoPaths', coalesce((select jsonb_agg(ph.path order by ph.idx) from public.post_photos ph where ph.post_id = p_post.id),
                           '[]'::jsonb),
    'likeCount', (select count(*) from public.post_likes l where l.post_id = p_post.id),
    'commentCount', (select count(*) from public.post_comments c
                     where c.post_id = p_post.id and public.comment_visible_to(p_viewer, c.id)),
    'liked', exists (select 1 from public.post_likes l where l.post_id = p_post.id and l.profile_id = p_viewer),
    'mine', p_post.author_id = p_viewer,
    'hidden', p_post.hidden_reason is not null,
    'createdAt', p_post.created_at
  )
  from public.profiles a
  where a.id = p_post.author_id;
$$;

-- ---- 4. Writes: the community-post Edge Function only (service_role) -----------------

-- A new post, after its text and photos passed the checks. p_post_id is
-- chosen by the function so the photos can be moved to
-- posts/<p_post_id>/<n>.jpg first. Every rule is checked again here: the
-- app is never trusted for the audience, age, photos or match.
create function public.create_post_internal(
  p_author uuid,
  p_post_id uuid,
  p_body text,
  p_audience text,
  p_match_id uuid,
  p_photo_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := nullif(trim(p_body), '');
  v_photos integer := coalesce(p_photo_count, 0);
  v_minor boolean;
  v_city text;
begin
  perform public.assert_posts_enabled();
  perform public.assert_can_interact(p_author, true);
  perform public.assert_daily_limit(p_author, 'post');

  v_minor := public.is_minor(p_author);
  select pr.city into v_city from public.profiles pr where pr.id = p_author;

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'body_too_long';
  end if;
  if p_audience is null or p_audience not in ('everyone', 'followers', 'city') then
    raise exception 'invalid_audience';
  end if;
  if p_audience = 'city' and v_minor then
    raise exception 'audience_not_allowed';
  end if;
  if p_audience = 'city' and nullif(trim(v_city), '') is null then
    raise exception 'city_required';
  end if;
  if v_photos < 0 or v_photos > 4 then
    raise exception 'too_many_photos';
  end if;
  -- Under-18s: text and shared results only at launch (25 November).
  if v_photos > 0 and v_minor then
    raise exception 'minor_photos_refused';
  end if;
  if p_match_id is not null and not public.match_shareable_by(p_author, p_match_id) then
    raise exception 'match_not_shareable';
  end if;
  if v_body is null and v_photos = 0 and p_match_id is null then
    raise exception 'post_empty';
  end if;

  insert into public.posts (id, author_id, body, audience, city, community, match_id, photo_count)
  values (coalesce(p_post_id, gen_random_uuid()), p_author, v_body, p_audience, nullif(trim(v_city), ''),
          case when v_minor then 'minor' else 'adult' end, p_match_id, v_photos)
  returning id into p_post_id;

  insert into public.post_photos (post_id, idx, path)
  select p_post_id, n, format('posts/%s/%s.jpg', p_post_id, n)
  from generate_series(0, v_photos - 1) n;

  return p_post_id;
end;
$$;

-- A comment, after its text passed the check.
create function public.add_comment_internal(p_author uuid, p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := nullif(trim(p_body), '');
  v_post public.posts;
  v_id uuid;
  v_me public.profiles;
begin
  perform public.assert_posts_enabled();
  perform public.assert_can_interact(p_author, true);
  perform public.assert_daily_limit(p_author, 'comment');

  if v_body is null or char_length(v_body) > 500 then
    raise exception 'comment_length';
  end if;
  if not public.post_visible_to(p_author, p_post_id) then
    raise exception 'post_not_found';
  end if;
  select * into v_post from public.posts where id = p_post_id;
  -- A thread never mixes the two communities (an author who has turned 18
  -- can't join their own old under-18 thread either).
  if public.viewer_community(p_author) <> v_post.community then
    raise exception 'community_mismatch';
  end if;
  -- Under-18s' posts: comments only from their followers.
  if v_post.community = 'minor' and p_author <> v_post.author_id
     and not public.follows_player(p_author, v_post.author_id) then
    raise exception 'followers_only';
  end if;

  insert into public.post_comments (post_id, author_id, body, community)
  values (p_post_id, p_author, v_body, v_post.community)
  returning id into v_id;

  if v_post.author_id <> p_author then
    select * into v_me from public.profiles where id = p_author;
    perform public.send_notification(v_post.author_id, 'post_commented', jsonb_build_object(
      'title', 'New comment',
      'body', coalesce(public.community_display_name(v_me), 'Player') || ' commented on your post',
      'post_id', p_post_id, 'comment_id', v_id));
  end if;
  return v_id;
end;
$$;

-- ---- 5. Signed-in RPCs ----------------------------------------------------------------

create function public.agree_guidelines()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer := (public.app_rules_now()).community_guidelines_version;
begin
  perform public.assert_posts_enabled();
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.guideline_agreements (profile_id, version) values (auth.uid(), v_version)
  on conflict do nothing;
  return v_version;
end;
$$;

-- What the composer offers: the audiences the caller may pick, the
-- default, whether photos are allowed, and whether they have agreed to the
-- current guidelines.
create function public.my_post_defaults()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_minor boolean;
  v_has_city boolean;
  v_version integer := (public.app_rules_now()).community_guidelines_version;
begin
  perform public.assert_posts_enabled();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  v_minor := public.is_minor(v_me);
  select nullif(trim(p.city), '') is not null into v_has_city from public.profiles p where p.id = v_me;
  return jsonb_build_object(
    'audiences', case
      when v_minor then jsonb_build_array('followers', 'everyone')
      when v_has_city then jsonb_build_array('everyone', 'followers', 'city')
      else jsonb_build_array('everyone', 'followers')
    end,
    'defaultAudience', case when v_minor then 'followers' else 'everyone' end,
    'photos', not v_minor,
    'guidelinesVersion', v_version,
    'agreed', exists (select 1 from public.guideline_agreements g where g.profile_id = v_me and g.version = v_version)
  );
end;
$$;

-- Like or unlike. Returns whether the caller now likes it, and the count.
create function public.toggle_like(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_post public.posts;
  v_liked boolean;
  v_profile public.profiles;
begin
  perform public.assert_posts_enabled();
  perform public.assert_can_interact(v_me, false);
  if not public.post_visible_to(v_me, p_post_id) then
    raise exception 'post_not_found';
  end if;
  select * into v_post from public.posts where id = p_post_id;
  if public.viewer_community(v_me) <> v_post.community then
    raise exception 'community_mismatch';
  end if;

  delete from public.post_likes where post_id = p_post_id and profile_id = v_me;
  if found then
    v_liked := false;
  else
    insert into public.post_likes (post_id, profile_id) values (p_post_id, v_me);
    v_liked := true;
    -- One like notice per post per hour.
    if v_post.author_id <> v_me and not exists (
      select 1 from public.notifications n
      where n.profile_id = v_post.author_id and n.type = 'post_liked'
        and n.data ->> 'post_id' = p_post_id::text and n.created_at > now() - interval '1 hour'
    ) then
      select * into v_profile from public.profiles where id = v_me;
      perform public.send_notification(v_post.author_id, 'post_liked', jsonb_build_object(
        'title', 'New like',
        'body', coalesce(public.community_display_name(v_profile), 'Player') || ' liked your post',
        'post_id', p_post_id));
    end if;
  end if;

  return jsonb_build_object('liked', v_liked,
    'likeCount', (select count(*) from public.post_likes where post_id = p_post_id));
end;
$$;

create function public.delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_posts_enabled();
  update public.posts set deleted_at = now()
  where id = p_post_id and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_yours';
  end if;
end;
$$;

create function public.delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_posts_enabled();
  update public.post_comments set deleted_at = now()
  where id = p_comment_id and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_yours';
  end if;
end;
$$;

create function public.get_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  perform public.assert_posts_enabled();
  if not public.post_visible_to(auth.uid(), p_post_id) then
    raise exception 'post_not_found';
  end if;
  select * into v_post from public.posts where id = p_post_id;
  return public.post_json(auth.uid(), v_post);
end;
$$;

-- A post's comments the caller may see, oldest first, after the cursor.
create function public.post_comments_page(
  p_post_id uuid,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  author_id uuid,
  author_name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  avatar_illustration text,
  body text,
  mine boolean,
  hidden boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  perform public.assert_posts_enabled();
  if not public.post_visible_to(v_me, p_post_id) then
    raise exception 'post_not_found';
  end if;
  return query
    select c.id, c.author_id, coalesce(public.community_display_name(a), 'Player'),
           a.avatar_style, a.avatar_kit_colour, a.avatar_number, a.avatar_illustration,
           c.body, c.author_id = v_me, c.hidden_reason is not null, c.created_at
    from public.post_comments c
    join public.profiles a on a.id = c.author_id
    where c.post_id = p_post_id
      and public.comment_visible_to(v_me, c.id)
      and (p_after_at is null or c.created_at > p_after_at
           or (c.created_at = p_after_at and p_after_id is not null and c.id > p_after_id))
    order by c.created_at, c.id
    limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

-- Who liked a post, minus anyone blocked either way or deleted.
create function public.post_likers(p_post_id uuid)
returns table (
  profile_id uuid,
  name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  avatar_illustration text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  perform public.assert_posts_enabled();
  if not public.post_visible_to(v_me, p_post_id) then
    raise exception 'post_not_found';
  end if;
  return query
    select a.id, coalesce(public.community_display_name(a), 'Player'),
           a.avatar_style, a.avatar_kit_colour, a.avatar_number, a.avatar_illustration
    from public.post_likes l
    join public.profiles a on a.id = l.profile_id
    where l.post_id = p_post_id
      and (l.profile_id = v_me
           or (not public.blocked_between(v_me, l.profile_id) and not public.profile_is_deleted(l.profile_id)
               and public.active_restriction(l.profile_id) is distinct from 'ban'))
    order by l.created_at desc
    limit 200;
end;
$$;

-- The caller's own confirmed matches, newest first: what a result post can share.
create function public.my_shareable_matches()
returns table (
  match_id uuid,
  kickoff_at timestamptz,
  format text,
  side_a_label text,
  side_b_label text,
  side_a_score integer,
  side_b_score integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_posts_enabled();
  return query
    select m.id, m.kickoff_at, m.format, sa.label, sb.label, m.side_a_score, m.side_b_score
    from public.matches m
    join public.match_sides sa on sa.match_id = m.id and sa.side = 'a'
    join public.match_sides sb on sb.match_id = m.id and sb.side = 'b'
    where public.match_shareable_by(auth.uid(), m.id)
    order by m.kickoff_at desc
    limit 50;
end;
$$;

-- ---- 6. Photos: the private post-photos bucket -------------------------------------------
--
-- The app uploads a resized JPEG to pending/<its own id>/...; community-post
-- checks it and moves it to posts/<post_id>/<n>.jpg. A storage policy runs
-- as the signed-in user, who can't call the service_role-only helpers, so
-- the two policies call these two small security definer functions (they
-- answer only about the caller, auth.uid()).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-photos', 'post-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Whether the caller may upload a photo now: posts on, an adult (no photos
-- from under-18s at launch), age known, not suspended or banned.
create function public.post_photo_upload_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (public.app_rules_now()).posts_enabled
     and public.age_status(auth.uid()) = 'ok'
     and not public.is_minor(auth.uid())
     and public.active_restriction(auth.uid()) is null;
$$;

-- Whether the caller may read this object: their own pending upload, or a
-- photo of a post they can see.
create function public.post_photo_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if auth.uid() is null or v_parts is null then
    return false;
  end if;
  if v_parts[1] = 'pending' then
    return v_parts[2] = auth.uid()::text;
  end if;
  if v_parts[1] = 'posts' and v_parts[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return (public.app_rules_now()).posts_enabled and public.post_visible_to(auth.uid(), v_parts[2]::uuid);
  end if;
  return false;
end;
$$;

create policy "Players upload post photos to their own pending folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = 'pending'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.post_photo_upload_allowed()
  );

create policy "Players read the post photos they may see" on storage.objects
  for select to authenticated using (
    bucket_id = 'post-photos' and public.post_photo_readable(name)
  );

-- ---- 7. Notifications ------------------------------------------------------------------

insert into public.notification_types (type, always_sent, default_enabled) values
  ('post_liked', false, true),
  ('post_commented', false, true)
on conflict (type) do nothing;

-- ---- 8. The Community feed: posts and "My city" ----------------------------------------
--
-- community_feed, re-created from its latest definition
-- (20261127074156_match_community_feed_booking.sql). Changes:
--   * a 'city' scope (My city): posts from the caller's city and open squad
--     posts at venues in it;
--   * 'post' items (players' posts the caller may see, post_visible_to),
--     only while posts_enabled;
--   * seven new return columns, last: post_body, post_audience,
--     photo_count, shared_match_id, like_count, comment_count, liked.
-- A new return column needs a drop; nothing else depends on the function.

drop function public.community_feed(text, timestamptz, uuid, integer);

create function public.community_feed(
  p_scope text,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (
  kind text,
  item_id uuid,
  sort_at timestamptz,
  actor_kind text,
  actor_id uuid,
  actor_name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  avatar_illustration text,
  post_type text,
  post_status text,
  scheduled_at timestamptz,
  format text,
  venue_name text,
  spots integer,
  level_min numeric,
  level_max numeric,
  v2 boolean,
  mine boolean,
  can_message boolean,
  league boolean,
  side_a_label text,
  side_a_team_id uuid,
  side_b_label text,
  side_b_team_id uuid,
  side_a_score integer,
  side_b_score integer,
  forfeit_side text,
  booking_id uuid,
  post_body text,
  post_audience text,
  photo_count smallint,
  shared_match_id uuid,
  like_count integer,
  comment_count integer,
  liked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_posts_on boolean := (public.app_rules_now()).posts_enabled;
  v_my_city text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_scope is null or p_scope not in ('for_you', 'following', 'mine', 'city') then
    raise exception 'invalid_scope';
  end if;
  select nullif(trim(p.city), '') into v_my_city from public.profiles p where p.id = v_me;

  return query
    with followed_teams as (
      select f.target_id as team_id from public.user_follows f
      where f.follower_id = v_me and f.target_type = 'team'
    ),
    followed_players as (
      select f.target_id as profile_id from public.user_follows f
      where f.follower_id = v_me and f.target_type = 'player'
        and public.community_player_visible(v_me, f.target_id)
    ),
    open_posts as (
      select fm.* from public.find_matches() fm
      where p_scope in ('for_you', 'following', 'city')
    ),
    post_rows as (
      select sp.id, sp.created_at, sp.posted_by, sp.team_id, sp.type, sp.status, sp.scheduled_at, sp.format,
             sp.venue_id, sp.venue_booking_id,
             op.capacity, op.players_in, op.level_min, op.level_max,
             (op.post_id is not null) as is_open
      from public.squad_posts sp
      left join open_posts op on op.post_id = sp.id
      where (p_scope = 'mine' and sp.posted_by = v_me)
         or (p_scope = 'for_you' and op.post_id is not null)
         or (p_scope = 'following' and op.post_id is not null
             and (sp.team_id in (select team_id from followed_teams)
                  or sp.posted_by in (select profile_id from followed_players)))
         or (p_scope = 'city' and op.post_id is not null and v_my_city is not null
             and exists (select 1 from public.venues cv where cv.id = sp.venue_id and cv.city = v_my_city))
    ),
    posts as (
      select
        'squad_post'::text as kind,
        r.id as item_id,
        r.created_at as sort_at,
        case when r.team_id is not null and r.type = 'opposition' then 'team' else 'player' end as actor_kind,
        case when r.team_id is not null and r.type = 'opposition' then r.team_id else r.posted_by end as actor_id,
        case when r.team_id is not null and r.type = 'opposition' then t.name
             else coalesce(public.community_display_name(pp), 'Player') end as actor_name,
        pp.avatar_style, pp.avatar_kit_colour, pp.avatar_number, pp.avatar_illustration,
        r.type as post_type,
        r.status as post_status,
        r.scheduled_at,
        r.format,
        v.name as venue_name,
        case when r.is_open and r.type = 'players' and r.capacity is not null
             then greatest(r.capacity - coalesce(r.players_in, 0), 0) end as spots,
        r.level_min,
        r.level_max,
        (b.booking_kind is not null) as v2,
        (r.posted_by = v_me) as mine,
        (r.posted_by is not null and r.posted_by <> v_me
         and public.are_friends(v_me, r.posted_by)
         and public.community_player_visible(v_me, r.posted_by)) as can_message,
        null::boolean as league,
        null::text as side_a_label, null::uuid as side_a_team_id,
        null::text as side_b_label, null::uuid as side_b_team_id,
        null::integer as side_a_score, null::integer as side_b_score, null::text as forfeit_side,
        -- Only my own post's booking: the game "Open post" opens.
        case when r.posted_by = v_me then r.venue_booking_id end as booking_id,
        null::text as post_body, null::text as post_audience, null::smallint as photo_count,
        null::uuid as shared_match_id, null::integer as like_count, null::integer as comment_count,
        null::boolean as liked
      from post_rows r
      left join public.profiles pp on pp.id = r.posted_by
      left join public.teams t on t.id = r.team_id
      left join public.venues v on v.id = r.venue_id
      left join public.venue_bookings b on b.id = r.venue_booking_id
      -- Never a post by someone blocked either way.
      where r.posted_by is null or r.posted_by = v_me or not public.blocked_between(v_me, r.posted_by)
    ),
    -- One row per confirmed match reached through a follow: a followed team
    -- (side a first), otherwise a followed, visible player (earliest id).
    via as (
      select m.id as match_id, 0 as pref, 'team'::text as a_kind, s.team_id as a_id, s.side
      from public.matches m
      join public.match_sides s on s.match_id = m.id
      where p_scope in ('for_you', 'following')
        and m.status = 'confirmed'
        and s.team_id in (select team_id from followed_teams)
      union all
      select fp.match_id, 1, 'player', fp.profile_id, fp.side
      from public.match_form_players fp
      where p_scope in ('for_you', 'following')
        and fp.profile_id in (select profile_id from followed_players)
    ),
    picked as (
      select distinct on (x.match_id) x.match_id, x.a_kind, x.a_id
      from via x
      order by x.match_id, x.pref, x.side, x.a_id
    ),
    results as (
      select
        'match_result'::text,
        m.id,
        m.confirmed_at,
        k.a_kind,
        k.a_id,
        case when k.a_kind = 'team' then t.name else public.community_display_name(pp) end,
        pp.avatar_style, pp.avatar_kit_colour, pp.avatar_number, pp.avatar_illustration,
        null::text, null::text, m.kickoff_at, m.format, v.name,
        null::integer, null::numeric, null::numeric, null::boolean, null::boolean, null::boolean,
        (m.league_fixture_id is not null),
        sa.label, sa.team_id, sb.label, sb.team_id,
        m.side_a_score, m.side_b_score, m.forfeit_side,
        null::uuid,
        null::text, null::text, null::smallint, null::uuid, null::integer, null::integer, null::boolean
      from picked k
      join public.matches m on m.id = k.match_id
      join public.match_sides sa on sa.match_id = m.id and sa.side = 'a'
      join public.match_sides sb on sb.match_id = m.id and sb.side = 'b'
      left join public.teams t on k.a_kind = 'team' and t.id = k.a_id
      left join public.profiles pp on k.a_kind = 'player' and pp.id = k.a_id
      left join public.venues v on v.id = m.venue_id
    ),
    -- Players' posts (S7b), only while posts are on.
    user_posts as (
      select
        'post'::text,
        up.id,
        up.created_at,
        'player'::text,
        up.author_id,
        coalesce(public.community_display_name(ap), 'Player'),
        ap.avatar_style, ap.avatar_kit_colour, ap.avatar_number, ap.avatar_illustration,
        null::text, null::text, null::timestamptz, null::text, null::text,
        null::integer, null::numeric, null::numeric, null::boolean,
        (up.author_id = v_me),
        null::boolean, null::boolean,
        null::text, null::uuid, null::text, null::uuid, null::integer, null::integer, null::text,
        null::uuid,
        up.body, up.audience, up.photo_count, up.match_id,
        (select count(*)::integer from public.post_likes l where l.post_id = up.id),
        (select count(*)::integer from public.post_comments c
         where c.post_id = up.id and public.comment_visible_to(v_me, c.id)),
        exists (select 1 from public.post_likes l where l.post_id = up.id and l.profile_id = v_me)
      from public.posts up
      join public.profiles ap on ap.id = up.author_id
      where v_posts_on
        and up.deleted_at is null
        and (p_before_at is null or up.created_at <= p_before_at)
        and (
          (p_scope = 'mine' and up.author_id = v_me)
          or (p_scope = 'for_you' and public.post_visible_to(v_me, up.id))
          or (p_scope = 'following' and up.author_id in (select profile_id from followed_players)
              and public.post_visible_to(v_me, up.id))
          or (p_scope = 'city' and v_my_city is not null and up.city = v_my_city
              and public.post_visible_to(v_me, up.id))
        )
    ),
    everything as (
      select * from posts
      union all
      select * from results
      union all
      select * from user_posts
    )
    select e.*
    from everything e
    where p_before_at is null
       or e.sort_at < p_before_at
       or (e.sort_at = p_before_at and p_before_id is not null and e.item_id < p_before_id)
    order by e.sort_at desc, e.item_id desc
    limit v_limit;
end;
$$;

-- ---- 9. Grants --------------------------------------------------------------------------

-- Internal: service_role only (other security definer functions call them).
revoke all on function public.assert_posts_enabled() from public, anon, authenticated;
revoke all on function public.viewer_community(uuid) from public, anon, authenticated;
revoke all on function public.active_restriction(uuid) from public, anon, authenticated;
revoke all on function public.follows_player(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_visible_to(uuid, uuid) from public, anon, authenticated;
revoke all on function public.comment_visible_to(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_can_interact(uuid, boolean) from public, anon, authenticated;
revoke all on function public.assert_daily_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.match_shareable_by(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_json(uuid, public.posts) from public, anon, authenticated;
revoke all on function public.create_post_internal(uuid, uuid, text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.add_comment_internal(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assert_posts_enabled() to service_role;
grant execute on function public.viewer_community(uuid) to service_role;
grant execute on function public.active_restriction(uuid) to service_role;
grant execute on function public.follows_player(uuid, uuid) to service_role;
grant execute on function public.post_visible_to(uuid, uuid) to service_role;
grant execute on function public.comment_visible_to(uuid, uuid) to service_role;
grant execute on function public.assert_can_interact(uuid, boolean) to service_role;
grant execute on function public.assert_daily_limit(uuid, text) to service_role;
grant execute on function public.match_shareable_by(uuid, uuid) to service_role;
grant execute on function public.post_json(uuid, public.posts) to service_role;
grant execute on function public.create_post_internal(uuid, uuid, text, text, uuid, integer) to service_role;
grant execute on function public.add_comment_internal(uuid, uuid, text) to service_role;

-- Signed in.
revoke all on function public.agree_guidelines() from public, anon;
revoke all on function public.my_post_defaults() from public, anon;
revoke all on function public.toggle_like(uuid) from public, anon;
revoke all on function public.delete_post(uuid) from public, anon;
revoke all on function public.delete_comment(uuid) from public, anon;
revoke all on function public.get_post(uuid) from public, anon;
revoke all on function public.post_comments_page(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.post_likers(uuid) from public, anon;
revoke all on function public.my_shareable_matches() from public, anon;
revoke all on function public.community_feed(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.agree_guidelines() to authenticated, service_role;
grant execute on function public.my_post_defaults() to authenticated, service_role;
grant execute on function public.toggle_like(uuid) to authenticated, service_role;
grant execute on function public.delete_post(uuid) to authenticated, service_role;
grant execute on function public.delete_comment(uuid) to authenticated, service_role;
grant execute on function public.get_post(uuid) to authenticated, service_role;
grant execute on function public.post_comments_page(uuid, timestamptz, uuid, integer) to authenticated, service_role;
grant execute on function public.post_likers(uuid) to authenticated, service_role;
grant execute on function public.my_shareable_matches() to authenticated, service_role;
grant execute on function public.community_feed(text, timestamptz, uuid, integer) to authenticated, service_role;

-- Called by the storage policies, as the signed-in user. They answer only
-- about the caller.
revoke all on function public.post_photo_upload_allowed() from public, anon;
revoke all on function public.post_photo_readable(text) from public, anon;
grant execute on function public.post_photo_upload_allowed() to authenticated, service_role;
grant execute on function public.post_photo_readable(text) to authenticated, service_role;
