-- S8 follow-up (Panos, 26 November): three read-only functions for the
-- caller's own Profile. Each uses auth.uid() and takes no profile id, so no
-- one can read another player's lists or figures through them.
--
--   my_teammates(limit)          "People you play with most"
--   my_venues(limit)             "Your venues"
--   my_profile_showed_up(format) the Showed up tile
--
-- my_teammates reads player_teammates (20261112000755_match_form_views.sql)
-- with S7's community rules (20261126160000_match_community.sql): no blocked
-- pair either way, no adult/minor pair, no deleted account, and a minor's
-- first name only (community_player_visible, community_display_name).
--
-- my_venues reads match_stat_players (latest: 20261125213559_match_s14_totw_rules.sql):
-- the caller's checked-in places in confirmed games, all time.
--
-- my_profile_showed_up follows docs/specs/match-record.md "Showed up":
-- this Cyprus calendar year, checked in ÷ (checked in + no-show + late
-- cancel), whole %, null until 3 counted games. Check-ins and no-shows
-- count only in confirmed games past their result deadline (not void, not
-- a forfeit; a cancelled booking or match never gives a no-show), using
-- match_spot_holder and match_attendance_state
-- (20261117180513_match_no_shows.sql). A late cancel is the caller's own
-- booking_cancellation_lines row with "window" = 'late' (spec 13's
-- free-cancellation cut-off passed), for a booking this season whose game
-- wasn't a forfeit. Friendly games count. Nothing is re-created.

-- ---- People you play with most ----------------------------------------------

create or replace function public.my_teammates(p_limit integer default 20)
returns table (
  id uuid, display_name text, matches_together integer, last_played_at timestamptz,
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
  select p.id, public.community_display_name(p), t.matches_together::integer, t.last_played_at,
         p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration
  from public.player_teammates t
  join public.profiles p on p.id = t.teammate_profile_id
  where t.profile_id = v_me
    and public.community_player_visible(v_me, p.id)
  order by t.matches_together desc, t.last_played_at desc, p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---- Your venues -------------------------------------------------------------

create or replace function public.my_venues(p_limit integer default 20)
returns table (venue_id uuid, name text, city text, games integer, last_played_at timestamptz)
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
  select v.id, v.name, v.city, count(distinct s.match_id)::integer, max(s.kickoff_at)
  from public.match_stat_players s
  join public.venues v on v.id = s.venue_id
  where s.profile_id = v_me
  group by v.id, v.name, v.city
  order by count(distinct s.match_id) desc, max(s.kickoff_at) desc, v.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---- Showed up ---------------------------------------------------------------

create or replace function public.my_profile_showed_up(p_format text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_year integer := extract(year from now() at time zone 'Asia/Nicosia')::integer;
  v_showed integer;
  v_no_show integer;
  v_late integer;
  v_counted integer;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  -- Spot holders in confirmed, final games this season (no forfeits).
  with games as (
    select public.match_attendance_state(m.id, v_me) as state
    from public.matches m
    join public.match_players mp on mp.match_id = m.id and mp.profile_id = v_me
    where m.status = 'confirmed'
      and m.confirmed_via is distinct from 'forfeit'
      and m.forfeit_side is null
      and now() >= m.result_deadline_at
      and extract(year from m.kickoff_at at time zone 'Asia/Nicosia')::integer = v_year
      and (p_format is null or m.format = p_format)
      and public.match_spot_holder(m.id, v_me)
  )
  select count(*) filter (where state = 'checked_in'), count(*) filter (where state = 'no_show')
  into v_showed, v_no_show
  from games;

  -- The caller's own late cancels this season (one per booking), unless the
  -- game was a forfeit or the caller checked in to it anyway.
  select count(distinct l.booking_id)
  into v_late
  from public.booking_cancellation_lines l
  join public.venue_bookings b on b.id = l.booking_id
  where l.profile_id = v_me
    and l."window" = 'late'
    and extract(year from b.booking_day)::integer = v_year
    and (p_format is null or b.format = p_format)
    and not exists (
      select 1 from public.matches m
      where m.booking_id = b.id
        and (m.confirmed_via = 'forfeit' or m.forfeit_side is not null
             or exists (select 1 from public.match_attendance a where a.match_id = m.id and a.profile_id = v_me)));

  v_counted := v_showed + v_no_show + v_late;
  return jsonb_build_object(
    'counted', v_counted,
    'showedUp', v_showed,
    'missed', v_no_show + v_late,
    'pct', case when v_counted >= 3 then round(100.0 * v_showed / v_counted)::integer end
  );
end;
$$;

-- ---- Grants ------------------------------------------------------------------

revoke all on function public.my_teammates(integer) from public, anon;
revoke all on function public.my_venues(integer) from public, anon;
revoke all on function public.my_profile_showed_up(text) from public, anon;
grant execute on function public.my_teammates(integer) to authenticated, service_role;
grant execute on function public.my_venues(integer) to authenticated, service_role;
grant execute on function public.my_profile_showed_up(text) to authenticated, service_role;
