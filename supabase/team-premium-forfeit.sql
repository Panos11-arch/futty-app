-- What happens to a team's active league fixtures when Team Premium is
-- revoked (Apple refund) mid-registration. Run AFTER supabase/team-premium-
-- payments.sql and supabase/league-fixtures.sql. Run in the Supabase
-- dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Chosen behaviour: forfeit remaining fixtures only — past results and
-- standings points already earned stay on the table untouched; every
-- not-yet-completed fixture in that specific format (unscheduled, proposed,
-- or agreed-but-not-played) is resolved as a loss for the team and a
-- walkover win for their opponent, exactly the same shape
-- resolve_unscheduled_fixture (supabase/scores.sql) already uses for a
-- "couldn't agree a day" outcome — no goals, just played/won/lost. Marking
-- the fixture 'completed' is what actually stops further play: submit_
-- fixture_score and propose_fixture_schedule already refuse anything past
-- that status, so there's no separate "eliminated" flag to introduce.
--
-- Scoped to one format at a time (p_format), since a team can hold 9-a-side
-- Premium and 11-a-side Premium independently — losing one shouldn't touch
-- the other. Does NOT remove the team from league_teams — their existing
-- row (and whatever points/goal difference they'd already banked) stays
-- exactly as it was.
create or replace function public.forfeit_team_premium_fixtures(p_team_id uuid, p_format text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture record;
  v_opponent_id uuid;
begin
  for v_fixture in
    select lf.*
    from public.league_fixtures lf
    join public.leagues l on l.id = lf.league_id
    where l.format = p_format
      and lf.status <> 'completed'
      and (lf.home_team_id = p_team_id or lf.away_team_id = p_team_id)
    for update
  loop
    v_opponent_id := case
      when v_fixture.home_team_id = p_team_id then v_fixture.away_team_id
      else v_fixture.home_team_id
    end;

    update public.league_fixtures set status = 'completed' where id = v_fixture.id;

    update public.league_teams
    set played = played + 1, lost = lost + 1
    where league_id = v_fixture.league_id and team_id = p_team_id;

    update public.league_teams
    set played = played + 1, won = won + 1
    where league_id = v_fixture.league_id and team_id = v_opponent_id;

    perform public.apply_personal_match_stats(p_team_id, 'lost', 0);
    perform public.apply_personal_match_stats(v_opponent_id, 'won', 0);
  end loop;
end;
$$;

-- Deliberately no grant to authenticated — this only runs from
-- apple-server-notifications (service role, which bypasses grants
-- entirely), triggered by a real Apple refund. A captain never calls this
-- directly; there is no "forfeit myself" button.
