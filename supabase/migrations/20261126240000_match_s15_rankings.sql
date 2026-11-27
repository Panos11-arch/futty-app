-- S15: the Rankings tab (docs/specs/15-design.md section 0.6, images 14,
-- 15 and 27; match-record.md decisions 1k and 1m). Two read-only functions
-- for the screens; nothing here writes or changes a rule.
--
-- 1. my_most_played_format(): the format the Rankings tab opens on. The
--    caller's format with the most games (match_stat_players, the same rows
--    my_profile_season counts, all seasons). Ties go to the smaller format.
--    Null with no games (the app then opens 5-a-side).
-- 2. get_team_power_ranking(team): the team's place in each format's power
--    ranking now, for the team profile. The rows come from
--    power_ranking_standing (S14b), so the listing rules (3 counted games,
--    hidden after 60 days, ties: more games, then the name) stay in one place.

create function public.my_most_played_format()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.format
  from public.match_stat_players s
  join public.matches m on m.id = s.match_id
  where s.profile_id = auth.uid()
    and m.format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
  group by m.format
  order by count(*) desc,
           array_position(array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'], m.format)
  limit 1;
$$;

-- The team's place in every format where it is listed at p_now, smallest
-- format first. Internal: get_team_power_ranking reads it at now().
create function public.team_power_ranking(p_team_id uuid, p_now timestamptz)
returns table (format text, rank integer, points numeric, matches integer)
language sql
stable
security definer
set search_path = ''
as $$
  select f.format, s.rank, s.points, s.matches
  from unnest(array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side']) with ordinality as f(format, n)
  cross join lateral public.power_ranking_standing(f.format, p_now) s
  where s.team_id = p_team_id
  order by f.n;
$$;

-- For players: a team's place in each format now.
create function public.get_team_power_ranking(p_team_id uuid)
returns table (format text, rank integer, points numeric, matches integer)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.team_power_ranking(p_team_id, now());
$$;

revoke all on function public.my_most_played_format() from public, anon, authenticated;
revoke all on function public.team_power_ranking(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_team_power_ranking(uuid) from public, anon, authenticated;
grant execute on function public.my_most_played_format() to authenticated, service_role;
grant execute on function public.team_power_ranking(uuid, timestamptz) to service_role;
grant execute on function public.get_team_power_ranking(uuid) to authenticated, service_role;
