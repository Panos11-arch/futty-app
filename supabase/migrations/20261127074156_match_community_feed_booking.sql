-- Bug 27 Nov (Panos): "Open post" on my own Community post opened the posts
-- list, which never shows my own post ("Nothing open right now"). The feed
-- now gives each of my own posts its booking (booking_id), so the app opens
-- that game (app/booking/[id].tsx, as My bookings does). Anyone else's post
-- and every match result carry null: no one else's booking id is sent.
--
-- Same function as 20261126160000_match_community.sql, plus booking_id last.
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
  booking_id uuid
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
        null::integer as side_a_score, null::integer as side_b_score, null::text as forfeit_side,
        -- Only my own post's booking: the game "Open post" opens.
        case when r.posted_by = v_me then r.venue_booking_id end as booking_id
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
        null::uuid
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

revoke all on function public.community_feed(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.community_feed(text, timestamptz, uuid, integer) to authenticated, service_role;
