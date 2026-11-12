-- A3b-1: form, recent matches, head-to-head and "players you play with
-- most" (docs/specs/match-record.md section 7, decisions 1b.2, 1b.3, 1c).
--
-- Players outside a match see it only through these views (section 4.1),
-- so they run as their owner (not security_invoker) and expose confirmed
-- matches only; disputed, no_result, void and unplayed matches never
-- appear. They never expose ratings or votes. The app reads form here and
-- never computes it; lib/match/form.ts holds the same rules for tests and
-- mocks, and supabase/tests/match-form-*.test.sql checks the two agree.
--
-- Result for a side, as lib/match/form.ts formResult: the side that
-- forfeited gets L_forfeit and the other side W; otherwise W, D or L from
-- the score. A forfeit has no score, so no goals.

-- Internal: one row per side of every confirmed match.
create view public.match_form_sides as
select
  m.id as match_id,
  m.kind,
  m.venue_id,
  m.kickoff_at,
  s.side,
  s.team_id,
  s.label,
  o.team_id as opponent_team_id,
  o.label as opponent_label,
  case when s.side = 'a' then m.side_a_score else m.side_b_score end as goals_for,
  case when s.side = 'a' then m.side_b_score else m.side_a_score end as goals_against,
  case
    when m.forfeit_side = s.side then 'L_forfeit'
    when m.forfeit_side is not null then 'W'
    when m.side_a_score = m.side_b_score then 'D'
    when (m.side_a_score > m.side_b_score) = (s.side = 'a') then 'W'
    else 'L'
  end::text as result,
  m.forfeit_side,
  m.forfeit_reason
from public.matches m
join public.match_sides s on s.match_id = m.id
join public.match_sides o on o.match_id = m.id and o.side <> s.side
where m.status = 'confirmed';

-- Internal: the players a confirmed match counts for (formSide in
-- lib/match/form.ts). A profile on a side who hadn't left, and who checked
-- in (1b.2), or held a spot in a forfeit (1b.3). Guests never count; a
-- pickup player with no side gets nothing (section 10, question 10).
create view public.match_form_players as
select mp.profile_id, fs.*
from public.match_form_sides fs
join public.match_players mp on mp.match_id = fs.match_id and mp.side = fs.side
where mp.profile_id is not null
  and mp.left_at is null
  and (exists (select 1 from public.match_attendance a where a.match_id = fs.match_id and a.profile_id = mp.profile_id)
       or (fs.forfeit_side is not null and mp.share_id is not null));

-- A player's last 5 results, newest first (position 1 = newest).
create view public.player_form as
select profile_id, position, match_id, kickoff_at, result
from (
  select p.profile_id, p.match_id, p.kickoff_at, p.result,
         row_number() over (partition by p.profile_id order by p.kickoff_at desc, p.match_id) as position
  from public.match_form_players p
) ranked
where position <= 5;

-- A named team's last 5 results, newest first, whoever checked in (1b.3).
create view public.team_form as
select team_id, position, match_id, kickoff_at, result
from (
  select s.team_id, s.match_id, s.kickoff_at, s.result,
         row_number() over (partition by s.team_id order by s.kickoff_at desc, s.match_id) as position
  from public.match_form_sides s
  where s.team_id is not null
) ranked
where position <= 5;

-- Recent matches on a player's profile: every confirmed match that counts
-- for them (the same rule as form), from their side. The app orders by
-- kickoff_at and pages.
create view public.player_recent_matches as
select
  p.profile_id,
  p.match_id,
  p.kickoff_at,
  p.kickoff_at at time zone 'Asia/Nicosia' as kickoff_local,
  p.venue_id,
  v.name as venue_name,
  p.kind,
  p.side,
  p.label,
  p.opponent_label,
  p.team_id,
  p.opponent_team_id,
  p.goals_for,
  p.goals_against,
  p.result,
  p.forfeit_side,
  p.forfeit_reason
from public.match_form_players p
left join public.venues v on v.id = p.venue_id;

-- Head-to-head between two named teams, from team_id's side (each pair
-- appears both ways). A forfeit counts as a win and a loss (section 7:
-- "a forfeit counts as a loss in stats") with no goals. last_3 is the
-- newest three: [{matchId, kickoffAt, result, goalsFor, goalsAgainst}].
create view public.head_to_head as
select
  h.team_id,
  h.opponent_team_id,
  count(*) as played,
  count(*) filter (where h.result = 'W') as won,
  count(*) filter (where h.result = 'D') as drawn,
  count(*) filter (where h.result in ('L', 'L_forfeit')) as lost,
  coalesce(sum(h.goals_for), 0) as goals_for,
  coalesce(sum(h.goals_against), 0) as goals_against,
  (
    select jsonb_agg(jsonb_build_object('matchId', l.match_id, 'kickoffAt', l.kickoff_at, 'result', l.result,
                                        'goalsFor', l.goals_for, 'goalsAgainst', l.goals_against)
                     order by l.kickoff_at desc, l.match_id)
    from (
      select * from public.match_form_sides x
      where x.team_id = h.team_id and x.opponent_team_id = h.opponent_team_id
      order by x.kickoff_at desc, x.match_id
      limit 3
    ) l
  ) as last_3
from public.match_form_sides h
where h.team_id is not null and h.opponent_team_id is not null
group by h.team_id, h.opponent_team_id;

-- "Players you play with most" (decision 1c): confirmed matches where both
-- checked in on the same side. Personal, so a player reads only their own
-- list (profile_id = auth.uid()). security_barrier keeps that filter ahead
-- of anything in the caller's query.
create view public.player_teammates with (security_barrier = true) as
select
  me.profile_id,
  mate.profile_id as teammate_profile_id,
  count(*) as matches_together,
  max(m.kickoff_at) as last_played_at
from public.matches m
join public.match_players me on me.match_id = m.id
join public.match_attendance me_in on me_in.match_id = m.id and me_in.profile_id = me.profile_id
join public.match_players mate on mate.match_id = m.id and mate.side = me.side and mate.profile_id <> me.profile_id
join public.match_attendance mate_in on mate_in.match_id = m.id and mate_in.profile_id = mate.profile_id
where m.status = 'confirmed'
  and me.profile_id = auth.uid()
  and me.side is not null
  and me.left_at is null
  and mate.left_at is null
group by me.profile_id, mate.profile_id;

revoke all on public.match_form_sides, public.match_form_players from public, anon, authenticated;
grant select on public.match_form_sides, public.match_form_players to service_role;

revoke all on public.player_form, public.team_form, public.player_recent_matches, public.head_to_head,
  public.player_teammates from public, anon, authenticated;
grant select on public.player_form, public.team_form, public.player_recent_matches, public.head_to_head,
  public.player_teammates to authenticated, service_role;
