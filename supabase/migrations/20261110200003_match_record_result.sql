-- A2: result confirmation (docs/specs/match-record.md sections 3, 5.1, 5.2,
-- 6.2, decisions 2, 3, 5, 1a.5). This replaces the 3-attempt logic
-- (friendly_matches.score_attempts, league_fixtures.score_attempts) for new
-- matches only; matches recorded before A2 keep the old tables.
--
-- One captain submits the score; the other side accepts (confirmed) or
-- rejects (disputed). Unanswered, it stands at result_deadline_at = ends_at
-- + 24 hours; with no submission the match ends as no_result. "Exactly at
-- the deadline" counts as past it.

-- The side the profile captains in this match, or null: the side's
-- captain_profile_id (the booker on side a; a team captain on side b of a
-- named game), or any captain of a named side's team (decision 3).
create or replace function public.match_captain_side(p_match_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.side
  from public.match_sides s
  where s.match_id = p_match_id
    and p_profile_id is not null
    and (s.captain_profile_id = p_profile_id
         or (s.team_id is not null and exists (
               select 1 from public.team_members tm
               where tm.team_id = s.team_id and tm.profile_id = p_profile_id and tm.role = 'captain')))
  order by s.side
  limit 1;
$$;

-- Sends p_type to everyone in the match on p_sides (players who haven't
-- left, plus those sides' captains), and in a pickup game also to players
-- who haven't picked a side when p_unsided, except p_except.
create or replace function public.match_notify(
  p_match_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_sides text[],
  p_unsided boolean,
  p_except uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  for v_profile in
    select mp.profile_id from public.match_players mp
    where mp.match_id = p_match_id and mp.profile_id is not null and mp.left_at is null
      and (mp.side = any (p_sides) or (p_unsided and mp.side is null))
    union
    select s.captain_profile_id from public.match_sides s
    where s.match_id = p_match_id and s.captain_profile_id is not null and s.side = any (p_sides)
  loop
    if v_profile is distinct from p_except then
      perform public.send_notification(v_profile, p_type,
        jsonb_build_object('title', p_title, 'body', p_body, 'matchId', p_match_id));
    end if;
  end loop;
end;
$$;

-- "Bibs 5–3 Non-bibs"
create or replace function public.match_score_line(p_match_id uuid, p_a integer, p_b integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format('%s %s–%s %s',
    (select label from public.match_sides where match_id = p_match_id and side = 'a'), p_a, p_b,
    (select label from public.match_sides where match_id = p_match_id and side = 'b'));
$$;

create or replace function public.submit_match_result(p_match_id uuid, p_side_a_score integer, p_side_b_score integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_side text;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  v_side := public.match_captain_side(p_match_id, v_uid);
  if v_side is null then
    if not exists (select 1 from public.match_players mp
                   where mp.match_id = p_match_id and mp.profile_id = v_uid and mp.left_at is null) then
      raise exception 'not_in_match';
    end if;
    raise exception 'not_captain';
  end if;

  if v_match.status not in ('scheduled', 'played') or now() < v_match.kickoff_at or now() >= v_match.result_deadline_at then
    raise exception 'result_window_closed';
  end if;
  if exists (select 1 from public.match_result_submissions where match_id = p_match_id) then
    raise exception 'result_already_submitted';
  end if;
  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'invalid_score';
  end if;

  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
  values (p_match_id, v_side, p_side_a_score, p_side_b_score, v_uid);

  perform public.match_notify(p_match_id, 'match_result_submitted', 'Check the score',
    public.match_score_line(p_match_id, p_side_a_score, p_side_b_score) || '. Accept or reject it in the match.',
    array[case when v_side = 'a' then 'b' else 'a' end], v_match.kind = 'pickup', v_uid);
end;
$$;

create or replace function public.respond_to_match_result(p_match_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_submission public.match_result_submissions;
  v_captain_side text;
  v_player public.match_players;
  v_other text;
  v_allowed boolean;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  v_captain_side := public.match_captain_side(p_match_id, v_uid);
  select * into v_player from public.match_players mp
  where mp.match_id = p_match_id and mp.profile_id = v_uid and mp.left_at is null;
  if v_captain_side is null and v_player.id is null then
    raise exception 'not_in_match';
  end if;

  select * into v_submission from public.match_result_submissions where match_id = p_match_id for update;
  if not found then
    raise exception 'no_result_submitted';
  end if;

  -- Named game: the other side's captain. Pickup: any player on the other
  -- side; a player with no side can't answer (decisions 3 and 1a.5).
  v_other := case when v_submission.side = 'a' then 'b' else 'a' end;
  v_allowed := case
    when v_match.kind = 'named' then v_captain_side = v_other
    else v_player.side = v_other
  end;
  if not coalesce(v_allowed, false) then
    raise exception 'not_allowed';
  end if;
  if v_submission.response is not null then
    raise exception 'already_answered';
  end if;
  if v_match.status not in ('scheduled', 'played') or now() >= v_match.result_deadline_at then
    raise exception 'result_window_closed';
  end if;
  if p_accept is null then
    raise exception 'invalid_answer';
  end if;

  update public.match_result_submissions
  set response = case when p_accept then 'accepted' else 'rejected' end,
      responded_by = v_uid,
      responded_at = now()
  where id = v_submission.id;

  if p_accept then
    update public.matches
    set status = 'confirmed', side_a_score = v_submission.side_a_score, side_b_score = v_submission.side_b_score,
        confirmed_via = 'agreed', confirmed_at = now()
    where id = p_match_id;
    perform public.match_notify(p_match_id, 'match_result_confirmed', 'Result confirmed',
      public.match_score_line(p_match_id, v_submission.side_a_score, v_submission.side_b_score),
      array['a', 'b'], true, v_uid);
  else
    update public.matches set status = 'disputed' where id = p_match_id;
    perform public.match_notify(p_match_id, 'match_result_disputed', 'Result disputed',
      public.match_score_line(p_match_id, v_submission.side_a_score, v_submission.side_b_score)
        || ' was rejected. The match won''t count.',
      array['a', 'b'], true, v_uid);
  end if;
end;
$$;

-- P8 records a Gipedo Pano pull-out under 6 hours as a pulled_out forfeit
-- (decision 5). The other side wins; no score; never moves levels.
create or replace function public.record_match_forfeit(p_match_id uuid, p_side text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  if p_side is null or p_side not in ('a', 'b') then
    raise exception 'invalid_side';
  end if;
  if p_reason is null or p_reason not in ('pulled_out', 'no_show') then
    raise exception 'invalid_reason';
  end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_match.status in ('confirmed', 'no_result', 'void') then
    raise exception 'match_closed';
  end if;

  update public.matches
  set status = 'confirmed', forfeit_side = p_side, forfeit_reason = p_reason,
      side_a_score = null, side_b_score = null,
      confirmed_via = 'forfeit', confirmed_at = now()
  where id = p_match_id;
end;
$$;

-- Every 15 minutes (idempotent: a second run changes nothing):
--   voids a match whose booking was cancelled before it ended;
--   scheduled → played once ends_at has passed;
--   at result_deadline_at: an unanswered submission stands (confirmed via
--   deadline), no submission → no_result.
create or replace function public.match_jobs_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voided integer;
  v_played integer;
  v_confirmed integer := 0;
  v_no_result integer;
  v_row record;
begin
  update public.matches m
  set status = 'void'
  from public.venue_bookings b
  where b.id = m.booking_id
    and b.status = 'cancelled'
    and m.status in ('scheduled', 'played')
    and coalesce((select min(c.cancelled_at) from public.booking_cancellations c
                  where c.booking_id = b.id and c.scope <> 'my_spot'), now()) < m.ends_at;
  get diagnostics v_voided = row_count;

  update public.matches set status = 'played' where status = 'scheduled' and ends_at <= now();
  get diagnostics v_played = row_count;

  for v_row in
    select m.id, m.result_deadline_at, s.side_a_score, s.side_b_score
    from public.matches m
    join public.match_result_submissions s on s.match_id = m.id
    where m.status in ('scheduled', 'played') and m.result_deadline_at <= now() and s.response is null
    order by m.result_deadline_at, m.id
    for update of m
  loop
    update public.matches
    set status = 'confirmed', side_a_score = v_row.side_a_score, side_b_score = v_row.side_b_score,
        confirmed_via = 'deadline', confirmed_at = v_row.result_deadline_at
    where id = v_row.id;
    perform public.match_notify(v_row.id, 'match_result_confirmed', 'Result confirmed',
      public.match_score_line(v_row.id, v_row.side_a_score, v_row.side_b_score), array['a', 'b'], true, null);
    v_confirmed := v_confirmed + 1;
  end loop;

  update public.matches m
  set status = 'no_result'
  where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
    and not exists (select 1 from public.match_result_submissions s where s.match_id = m.id);
  get diagnostics v_no_result = row_count;

  return jsonb_build_object('played', v_played, 'confirmed', v_confirmed, 'no_result', v_no_result, 'voided', v_voided);
end;
$$;

-- Contract 3 (section 6.2): one row per settled match, service_role only.
-- Replaces P4c's stub (same columns, same types, same order).
create or replace view public.match_result_confirmed with (security_invoker = true) as
select
  m.id as match_id,
  m.booking_id,
  m.venue_id,
  m.friendly_match_id,
  m.league_fixture_id,
  sa.team_id as side_a_team_id,
  sb.team_id as side_b_team_id,
  case when m.status = 'confirmed' and m.forfeit_side is null then m.side_a_score end as side_a_score,
  case when m.status = 'confirmed' and m.forfeit_side is null then m.side_b_score end as side_b_score,
  case
    when m.status <> 'confirmed' then null
    when m.forfeit_side = 'a' then 'side_b_won'
    when m.forfeit_side = 'b' then 'side_a_won'
    when m.side_a_score > m.side_b_score then 'side_a_won'
    when m.side_a_score < m.side_b_score then 'side_b_won'
    else 'draw'
  end::text as outcome,
  m.status as result_status,
  m.status = 'disputed' as disputed,
  case when m.status = 'confirmed' then m.confirmed_via end as confirmed_via,
  m.forfeit_side,
  m.forfeit_reason,
  m.kickoff_at,
  m.ends_at,
  m.kickoff_at at time zone 'Asia/Nicosia' as kickoff_local,
  m.ends_at at time zone 'Asia/Nicosia' as ends_local,
  case m.status
    when 'confirmed' then m.confirmed_at
    when 'disputed' then r.responded_at
    else m.result_deadline_at
  end as settled_at
from public.matches m
left join public.match_sides sa on sa.match_id = m.id and sa.side = 'a'
left join public.match_sides sb on sb.match_id = m.id and sb.side = 'b'
left join public.match_result_submissions r on r.match_id = m.id
where m.status in ('confirmed', 'disputed', 'no_result');

revoke all on public.match_result_confirmed from public, anon, authenticated;
grant select on public.match_result_confirmed to service_role;

revoke all on function public.match_captain_side(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_captain_side(uuid, uuid) to service_role;
revoke all on function public.match_notify(uuid, text, text, text, text[], boolean, uuid) from public, anon, authenticated;
grant execute on function public.match_notify(uuid, text, text, text, text[], boolean, uuid) to service_role;
revoke all on function public.match_score_line(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.match_score_line(uuid, integer, integer) to service_role;
revoke all on function public.record_match_forfeit(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_match_forfeit(uuid, text, text) to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;

-- What the app may call: they check the caller themselves.
revoke all on function public.submit_match_result(uuid, integer, integer) from public, anon;
grant execute on function public.submit_match_result(uuid, integer, integer) to authenticated, service_role;
revoke all on function public.respond_to_match_result(uuid, boolean) from public, anon;
grant execute on function public.respond_to_match_result(uuid, boolean) to authenticated, service_role;
