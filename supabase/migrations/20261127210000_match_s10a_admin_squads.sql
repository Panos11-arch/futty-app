-- S10A follow-up: an admin reads every team's squad in a tournament so he
-- can change one (decided by Panos, 27 November; match-record.md decision
-- 1o, item 3). The write, admin_set_squad, is unchanged
-- (20261127130200_match_s10a_tournament_play.sql).
--
-- admin_get_tournament_squads(p_tournament_id) returns, for each registered
-- team: its id, name and kit colour; its squad; the team's members who
-- could be added (in no squad of this tournament); and its last 20 squad
-- changes, newest first (who, when, added or removed, by an admin or the
-- captain). Plus the squad size (the format's starters to starters + subs).
-- Admins only (require_app_admin, not_admin). Names go through
-- competition_player_json, so a minor shows his first name only (A5).
-- New function only; no table or existing function changes.

create function public.admin_get_tournament_squads(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v public.tournaments;
begin
  select * into v from public.tournaments where id = p_tournament_id;
  if not found then
    raise exception 'tournament_not_found';
  end if;

  return jsonb_build_object(
    'squadMin', public.tournament_starters(v.format),
    'squadMax', public.tournament_starters(v.format) + v.squad_subs,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'teamId', tt.team_id,
               'teamName', t.name,
               'kitColour', tt.kit_colour,
               'squad', coalesce((
                 select jsonb_agg(public.competition_player_json(s.profile_id) order by s.added_at, s.profile_id)
                 from public.tournament_squads s
                 where s.tournament_id = v.id and s.team_id = tt.team_id), '[]'::jsonb),
               'candidates', coalesce((
                 select jsonb_agg(c.player order by c.player ->> 'name', c.profile_id)
                 from (select distinct tm.profile_id, public.competition_player_json(tm.profile_id) as player
                       from public.team_members tm
                       where tm.team_id = tt.team_id
                         and tm.profile_id is not null
                         and not exists (select 1 from public.tournament_squads s
                                         where s.tournament_id = v.id and s.profile_id = tm.profile_id)) c
                 where c.player is not null), '[]'::jsonb),
               'changes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'player', public.competition_player_json(l.profile_id),
                          'change', l.change,
                          'byAdmin', l.by_admin,
                          'changedBy', case when l.changed_by is not null then public.competition_player_json(l.changed_by) end,
                          'changedAt', l.changed_at)
                        order by l.changed_at desc, l.id desc)
                 from (select * from public.tournament_squad_changes c
                       where c.tournament_id = v.id and c.team_id = tt.team_id
                       order by c.changed_at desc, c.id desc
                       limit 20) l), '[]'::jsonb))
             order by tt.group_letter nulls last, tt.group_pos, t.name, tt.team_id)
      from public.tournament_teams tt join public.teams t on t.id = tt.team_id
      where tt.tournament_id = v.id), '[]'::jsonb));
end;
$$;

comment on function public.admin_get_tournament_squads(uuid) is
  'S10A: every registered team''s squad, the members who could be added, and the squad change log. Admins only (not_admin).';

revoke all on function public.admin_get_tournament_squads(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_tournament_squads(uuid) to authenticated, service_role;
