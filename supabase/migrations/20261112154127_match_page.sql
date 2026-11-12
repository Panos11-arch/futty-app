-- A4a: the match page (docs/specs/match-record.md sections 4.6, 4.7, 4.9,
-- decision 1e; 05-product section 3): score, scorers and assists, man of
-- the match, lineups, venue and date, in one read.
--
-- get_match_page is readable by the match's members at any time (lineups
-- before kickoff) and by everyone signed in once the match is confirmed;
-- anyone else gets match_not_found, as if the match didn't exist. Score,
-- goals and man of the match appear only for a confirmed match that isn't a
-- forfeit; the man of the match result only once voting has closed (ties
-- shared, decision 1e.3). Individual votes are never shown: only the
-- caller's own (myVote).

-- {playerId, profileId, name, guestName} for a match_players row; null for
-- no row. name: the profile's full name (or first and last name, or
-- username), or the guest's name.
create or replace function public.match_player_json(p_player_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'playerId', mp.id,
    'profileId', mp.profile_id,
    'name', coalesce(nullif(trim(p.full_name), ''), nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
                     p.username, mp.guest_name),
    'guestName', mp.guest_name)
  from public.match_players mp
  left join public.profiles p on p.id = mp.profile_id
  where mp.id = p_player_id;
$$;

create or replace function public.get_match_page(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_played boolean;
  v_closes timestamptz;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or v_uid is null or not public.match_page_visible(p_match_id) then
    raise exception 'match_not_found';
  end if;
  -- Confirmed by a result (not a forfeit): it has a score, goals and a vote.
  v_played := v_match.status = 'confirmed' and v_match.forfeit_side is null;
  v_closes := case when v_played then v_match.confirmed_at + interval '24 hours' end;

  return jsonb_build_object(
    'matchId', v_match.id,
    'status', v_match.status,
    'kind', v_match.kind,
    'format', v_match.format,
    'playersPerSide', v_match.players_per_side,
    'kickoffAt', v_match.kickoff_at,
    'kickoffLocal', to_char(v_match.kickoff_at at time zone 'Asia/Nicosia', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'endsAt', v_match.ends_at,
    'venue', (select jsonb_build_object('id', v.id, 'name', v.name) from public.venues v where v.id = v_match.venue_id),
    'sides', (select coalesce(jsonb_agg(jsonb_build_object(
                'side', s.side,
                'label', s.label,
                'teamId', s.team_id,
                'score', case when v_played then case s.side when 'a' then v_match.side_a_score else v_match.side_b_score end end)
              order by s.side), '[]')
              from public.match_sides s where s.match_id = p_match_id),
    'forfeit', case when v_match.status = 'confirmed' and v_match.forfeit_side is not null
                    then jsonb_build_object('side', v_match.forfeit_side, 'reason', v_match.forfeit_reason) end,
    'confirmedAt', case when v_match.status = 'confirmed' then v_match.confirmed_at end,
    'scorersOpenUntil', v_closes,
    'motmVotingClosesAt', v_closes,
    'motmOpen', coalesce(now() < v_closes, false),
    'goals', case when v_played then (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'side', g.side,
                        'scorer', public.match_player_json(g.scorer_player_id),
                        'assist', public.match_player_json(g.assist_player_id))
                      order by g.side, g.sort), '[]')
               from public.match_goals g where g.match_id = p_match_id)
             else '[]' end,
    'motm', case when v_played and now() >= v_closes then (
              with tally as (
                select v.nominee_player_id, count(*) as votes
                from public.motm_votes v where v.match_id = p_match_id
                group by v.nominee_player_id
              )
              select coalesce(jsonb_agg(public.match_player_json(t.nominee_player_id) || jsonb_build_object('votes', t.votes)
                                        order by t.nominee_player_id), '[]')
              from tally t
              where t.votes = (select max(votes) from tally))
            else '[]' end,
    'myVote', (select v.nominee_player_id from public.motm_votes v
               where v.match_id = p_match_id and v.voter_profile_id = v_uid),
    -- A position whose player has since left or changed side is left out.
    'lineups', (select coalesce(jsonb_agg(jsonb_build_object(
                  'side', l.side,
                  'formation', l.formation,
                  'positions', (
                    select coalesce(jsonb_agg(public.match_player_json(mp.id) || jsonb_build_object('key', e.key)
                                              order by array_position(public.match_formation_positions(l.formation), e.key)), '[]')
                    from jsonb_each_text(l.positions) e
                    join public.match_players mp on mp.id = e.value::uuid
                    where mp.match_id = l.match_id and mp.side = l.side and mp.left_at is null))
                order by l.side), '[]')
                from public.match_lineups l where l.match_id = p_match_id)
  );
end;
$$;

revoke all on function public.match_player_json(uuid) from public, anon, authenticated;
grant execute on function public.match_player_json(uuid) to service_role;

revoke all on function public.get_match_page(uuid) from public, anon;
grant execute on function public.get_match_page(uuid) to authenticated, service_role;
