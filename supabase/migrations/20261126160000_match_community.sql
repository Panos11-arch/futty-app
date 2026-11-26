-- S7 Community (docs/specs/15-design.md, image 18): the feed, "Start
-- following some accounts" with "N matches in common", and player search,
-- with the age rules A3-A5 (docs/specs/05-product.md section 16) and blocks.
--
-- Child safety (decided 25 November):
--   * An adult can't follow a minor player and a minor can't follow an adult
--     player: refused on the server (user_follows_age_guard). Team follows
--     are unaffected (team results are public).
--   * Follows made before this rule are kept (they come back to life when the
--     minor turns 18) but the feed never shows anything reached through an
--     adult<->minor player follow: it checks age_pair_allowed at read time.
--   * Contacts matching (match_contacts_by_phone, latest definition in the
--     baseline) no longer returns the other age group, and never a minor's
--     username.
--
-- "Played" means what form means (match_form_players,
-- 20261112000755_match_form_views.sql): a confirmed match, on a side, not
-- left, checked in or holding a spot in a forfeit. Guests never count.

-- ---- Follow guard ---------------------------------------------------------------

create or replace function public.user_follows_age_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_type = 'player' and not public.age_pair_allowed(new.follower_id, new.target_id) then
    raise exception 'age_pair_refused';
  end if;
  return new;
end;
$$;

create trigger user_follows_age_guard
before insert or update on public.user_follows
for each row execute function public.user_follows_age_guard();

-- ---- Contacts matching (re-created from the baseline definition) ---------------
-- Changes: drops the other age group (A4, A5), hides a minor's username, and
-- leaves out blocked pairs, either way (blocked_between).

create or replace function public.match_contacts_by_phone(p_phone_numbers text[])
returns table (phone_number text, profile_id uuid, username text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(array_length(p_phone_numbers, 1), 0) > 2000 then
    raise exception 'too_many_numbers';
  end if;

  return query
  with contacts as (
    select
      raw,
      right(regexp_replace(raw, '\D', '', 'g'), 9) as digits
    from unnest(p_phone_numbers) as raw
  )
  select distinct on (contacts.raw)
    contacts.raw as phone_number,
    p.id as profile_id,
    case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end
  from contacts
  join public.profiles p
    on right(regexp_replace(p.phone, '\D', '', 'g'), 9) = contacts.digits
  where p.phone is not null
    and length(contacts.digits) = 9
    and p.id <> auth.uid()
    and public.age_pair_allowed(auth.uid(), p.id)
    and not public.blocked_between(auth.uid(), p.id)
  order by contacts.raw, p.username;
end;
$$;

-- ---- Dismissed suggestions ------------------------------------------------------

create table public.follow_suggestion_dismissals (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  dismissed_profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, dismissed_profile_id),
  check (profile_id <> dismissed_profile_id)
);

alter table public.follow_suggestion_dismissals enable row level security;

-- Read your own; writes only through dismiss_follow_suggestion.
create policy "Players read their own dismissals" on public.follow_suggestion_dismissals
  for select to authenticated using (profile_id = auth.uid());

revoke all on table public.follow_suggestion_dismissals from anon;
revoke insert, update, delete on table public.follow_suggestion_dismissals from authenticated;

-- ---- Internal helpers -----------------------------------------------------------

-- The name the caller sees for a player: a minor's first name only (A5).
create or replace function public.community_display_name(p_profile public.profiles)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when public.name_hidden(p_profile.id, p_profile.date_of_birth)
      then public.minor_first_name(p_profile.first_name, p_profile.full_name)
    else coalesce(nullif(trim(p_profile.full_name), ''), p_profile.username, 'Player')
  end;
$$;

-- Whether p_viewer sees content reached through a follow of player
-- p_player: not blocked either way, same age group (A4), not deleted.
create or replace function public.community_player_visible(p_viewer uuid, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_player is not null
     and not public.blocked_between(p_viewer, p_player)
     and public.age_pair_allowed(p_viewer, p_player)
     and not public.profile_is_deleted(p_player);
$$;

-- ---- Suggestions ----------------------------------------------------------------

-- Players who shared at least one confirmed match with the caller, either
-- side, that the caller doesn't follow and hasn't dismissed. Never across
-- the adult/minor line, never a blocked pair.
create or replace function public.follow_suggestions(p_limit integer default 20)
returns table (
  id uuid, username text, full_name text, matches_in_common integer,
  avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  return query
    with mine as (
      select distinct fp.match_id from public.match_form_players fp where fp.profile_id = v_me
    ),
    together as (
      select fp.profile_id, count(distinct fp.match_id)::integer as n, max(fp.kickoff_at) as last_at
      from public.match_form_players fp
      join mine on mine.match_id = fp.match_id
      where fp.profile_id <> v_me
      group by fp.profile_id
    )
    select p.id,
           case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
           public.community_display_name(p),
           t.n,
           p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration
    from together t
    join public.profiles p on p.id = t.profile_id
    where public.community_player_visible(v_me, p.id)
      and not exists (select 1 from public.user_follows f
                      where f.follower_id = v_me and f.target_type = 'player' and f.target_id = p.id)
      and not exists (select 1 from public.follow_suggestion_dismissals d
                      where d.profile_id = v_me and d.dismissed_profile_id = p.id)
    order by t.n desc, t.last_at desc, p.id
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

create or replace function public.dismiss_follow_suggestion(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_profile_id is null or p_profile_id = v_me
     or not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception 'not_found';
  end if;
  insert into public.follow_suggestion_dismissals (profile_id, dismissed_profile_id)
  values (v_me, p_profile_id)
  on conflict do nothing;
end;
$$;

-- ---- Player search --------------------------------------------------------------

-- At least 2 characters, up to 20 players, by username or the name the
-- caller sees (so a minor's hidden surname never matches). Same age group
-- only (A5: never a minor in an adult's search; a minor gets no adult, since
-- they couldn't follow them), never a blocked pair, never yourself.
create or replace function public.search_players(p_query text)
returns table (
  id uuid, username text, full_name text,
  avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_q text := trim(coalesce(p_query, ''));
  v_like text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  v_like := replace(replace(replace(left(v_q, 50), '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id,
           case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
           public.community_display_name(p),
           p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration
    from public.profiles p
    where p.username is not null
      and p.id <> v_me
      and public.community_player_visible(v_me, p.id)
      and ((not public.name_hidden(p.id, p.date_of_birth) and p.username ilike v_like || '%')
           or public.community_display_name(p) ilike '%' || v_like || '%')
    order by (lower(public.community_display_name(p)) like lower(v_like) || '%') desc,
             public.community_display_name(p), p.id
    limit 20;
end;
$$;

-- ---- Feed -----------------------------------------------------------------------

-- p_scope:
--   'for_you'   open squad posts (exactly the games find_matches lists) and
--               confirmed results of the teams and players the caller follows;
--   'following' only posts and results from teams and players followed;
--   'mine'      the caller's own squad posts, any status.
-- Newest first, keyset paged on (sort_at, item_id). A player follow only
-- counts while community_player_visible (age group, blocks); a team follow
-- always counts. Results carry the score only (no ratings or goals).
create or replace function public.community_feed(
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
  forfeit_side text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_scope is null or p_scope not in ('for_you', 'following', 'mine') then
    raise exception 'invalid_scope';
  end if;

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
      where p_scope in ('for_you', 'following')
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
        null::integer as side_a_score, null::integer as side_b_score, null::text as forfeit_side
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
        m.side_a_score, m.side_b_score, m.forfeit_side
      from picked k
      join public.matches m on m.id = k.match_id
      join public.match_sides sa on sa.match_id = m.id and sa.side = 'a'
      join public.match_sides sb on sb.match_id = m.id and sb.side = 'b'
      left join public.teams t on k.a_kind = 'team' and t.id = k.a_id
      left join public.profiles pp on k.a_kind = 'player' and pp.id = k.a_id
      left join public.venues v on v.id = m.venue_id
    ),
    everything as (
      select * from posts
      union all
      select * from results
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

-- ---- Grants ---------------------------------------------------------------------

-- Internal: service_role only.
revoke all on function public.user_follows_age_guard() from public, anon, authenticated;
revoke all on function public.community_display_name(public.profiles) from public, anon, authenticated;
revoke all on function public.community_player_visible(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_follows_age_guard() to service_role;
grant execute on function public.community_display_name(public.profiles) to service_role;
grant execute on function public.community_player_visible(uuid, uuid) to service_role;

-- Signed in.
revoke all on function public.follow_suggestions(integer) from public, anon;
grant execute on function public.follow_suggestions(integer) to authenticated, service_role;
revoke all on function public.dismiss_follow_suggestion(uuid) from public, anon;
grant execute on function public.dismiss_follow_suggestion(uuid) to authenticated, service_role;
revoke all on function public.search_players(text) from public, anon;
grant execute on function public.search_players(text) to authenticated, service_role;
revoke all on function public.community_feed(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.community_feed(text, timestamptz, uuid, integer) to authenticated, service_role;

-- match_contacts_by_phone keeps the baseline's grants (create or replace).
