-- S6 Find a match (docs/specs/15-design.md section 0.6, image 05): the public
-- open games, for the Matches screen. One row per game anyone signed in can
-- join or take on: open squad posts ("Need players"), Booking v2 published
-- games (B1e "Publish game") and opposition posts. Never a full game, never
-- one that has started, never one at a venue that isn't live, never a
-- cancelled booking's post. Booking v2 posts are open exactly as
-- booking_post_quotes says (20261124133924_pay_b1d_followups): a players post
-- until kickoff, an opposition post while opposition_open_error is null and
-- side B isn't found.
--
-- Each row carries what the card shows and the server decides: the organiser
-- (the poster, or the posting team on an older opposition post), players in
-- the game and its places ("3/10"), up to five people for the avatar circles,
-- and the level range of the people in it (player_levels: min and max on a
-- players game; the average, one decimal, on an opposition post). Prices are
-- not here: the app keeps reading them from booking_post_quotes and
-- squad_post_prices, exactly as B4 does.
--
-- Filters (all optional): format, town or venue, Cyprus days, and a start
-- time window in Cyprus time [from, to). Cyprus time throughout
-- (Asia/Nicosia), never UTC.

create function public.find_matches(
  p_format text default null,
  p_town text default null,
  p_venue_id uuid default null,
  p_days date[] default null,
  p_from time default null,
  p_to time default null
)
returns table (
  post_id uuid,
  kind text,
  scheduled_at timestamptz,
  format text,
  venue_id uuid,
  venue_name text,
  venue_city text,
  organiser_id uuid,
  organiser_name text,
  team_id uuid,
  team_name text,
  players_in integer,
  capacity integer,
  level_min numeric,
  level_max numeric,
  people jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if cardinality(p_days) > 31 then
    raise exception 'too_many_days';
  end if;

  return query
    with posts as (
      select p.*, b.id as b_id, b.booking_kind as b_kind, b.capacity as b_capacity, sd.players as side_players,
             v.name as v_name, v.city as v_city
      from public.squad_posts p
      join public.venues v on v.id = p.venue_id and v.is_live
      left join public.venue_bookings b on b.id = p.venue_booking_id
      left join public.booking_sides sd
        on b.booking_kind = 'half' and sd.booking_id = b.id and sd.side = coalesce(p.side, 'a')
      where p.status = 'open'
        and p.scheduled_at > now()
        and (b.id is null or b.status <> 'cancelled')
        and (p_format is null or p.format = p_format)
        and (p_venue_id is null or p.venue_id = p_venue_id)
        and (p_town is null or lower(v.city) = lower(p_town))
        and (p_days is null or cardinality(p_days) = 0
             or (p.scheduled_at at time zone 'Asia/Nicosia')::date = any (p_days))
        and (p_from is null or (p.scheduled_at at time zone 'Asia/Nicosia')::time >= p_from)
        and (p_to is null or p_to = '24:00'::time or (p.scheduled_at at time zone 'Asia/Nicosia')::time < p_to)
        -- Booking v2: open as booking_post_quotes says.
        and (b.booking_kind is null
             or (p.type = 'players' and now() < public.booking_kickoff_at(b.booking_day, b.start_time))
             or (p.type = 'opposition' and public.opposition_open_error(b) is null
                 and not exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b')))
    ),
    -- Who is in each game, booker first: a Booking v2 game's live shares (on
    -- its side, or side A's for an opposition post); an older players post's
    -- joiners (house players by name); an older opposition post's team.
    members as (
      select x.id as m_post, s.profile_id as m_profile, null::text as m_name,
             row_number() over (partition by x.id order by s.is_booker desc, s.created_at, s.id) as m_rank
      from posts x
      join public.booking_payment_shares s on s.booking_id = x.b_id
      where x.b_kind is not null
        and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')
        -- A players post: its side's players. An opposition post (side B
        -- wanted): side A's.
        and (x.b_kind = 'whole' or s.side = case when x.type = 'opposition' then 'a' else coalesce(x.side, 'a') end)
      union all
      select x.id, j.profile_id, case when j.is_house_player then j.display_name end,
             row_number() over (partition by x.id order by j.joined_at, j.id)
      from posts x
      join public.squad_post_joiners j on j.post_id = x.id
      where x.b_kind is null and x.type = 'players'
      union all
      select x.id, tm.profile_id, null::text,
             row_number() over (partition by x.id order by (tm.role = 'captain') desc, tm.joined_at, tm.id)
      from posts x
      join public.team_members tm on tm.team_id = x.team_id
      where x.b_kind is null and x.type = 'opposition' and tm.profile_id is not null
    ),
    named as (
      select m.m_post, m.m_profile, m.m_rank, pl.level,
             coalesce(m.m_name, nullif(pr.full_name, ''), pr.username, 'Player') as m_display
      from members m
      left join public.profiles pr on pr.id = m.m_profile
      left join public.player_levels pl on pl.profile_id = m.m_profile
    ),
    totals as (
      select n.m_post,
             count(*)::integer as n_in,
             min(n.level) as lv_min,
             max(n.level) as lv_max,
             round(avg(n.level), 1) as lv_avg,
             jsonb_agg(jsonb_build_object('id', n.m_profile, 'name', n.m_display) order by n.m_rank)
               filter (where n.m_rank <= 5) as n_people
      from named n
      group by n.m_post
    ),
    shaped as (
      select x.*,
             coalesce(t.n_in, 0) as players_now,
             case
               when x.b_kind is not null then coalesce(x.side_players, x.b_capacity)
               when x.type = 'players' then x.players_needed
             end as places,
             t.lv_min, t.lv_max, t.lv_avg, coalesce(t.n_people, '[]'::jsonb) as avatars
      from posts x
      left join totals t on t.m_post = x.id
    )
    select
      s.id,
      s.type,
      s.scheduled_at,
      s.format,
      s.venue_id,
      s.v_name,
      s.v_city,
      s.posted_by,
      coalesce(nullif(op.full_name, ''), op.username, 'Player'),
      tm.id,
      tm.name,
      case when s.type = 'players' or s.b_kind is not null then s.players_now end,
      s.places,
      case when s.type = 'players' then s.lv_min else s.lv_avg end,
      case when s.type = 'players' then s.lv_max else s.lv_avg end,
      s.avatars
    from shaped s
    left join public.profiles op on op.id = s.posted_by
    left join public.teams tm on tm.id = s.team_id
    -- Never a full game.
    where s.type = 'opposition' or s.places is null or s.players_now < s.places
    order by s.scheduled_at, s.id
    limit 200;
end;
$$;

revoke all on function public.find_matches(text, text, uuid, date[], time, time) from public, anon, service_role;
grant execute on function public.find_matches(text, text, uuid, date[], time, time) to authenticated;
