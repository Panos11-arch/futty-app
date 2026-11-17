-- A5a: a check-in is used once the player has rated someone in the match,
-- as it is once they have voted for man of the match (P6e, PR #111;
-- docs/specs/match-record.md section 5.4). venue_unmark_arrived, from
-- 20261117180513_match_no_shows.sql, now also refuses (check_in_used) when
-- the player has a match_ratings row as the rater. Everything else is as it
-- was there.
create or replace function public.venue_unmark_arrived(p_match_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method text;
begin
  perform public.venue_attendance_check(p_match_id, p_profile_id);
  select a.method into v_method from public.match_attendance a
  where a.match_id = p_match_id and a.profile_id = p_profile_id for update;
  if v_method is null then
    raise exception 'not_checked_in';
  end if;
  if v_method <> 'venue' then
    raise exception 'not_venue_check_in';
  end if;
  if exists (select 1 from public.motm_votes v where v.match_id = p_match_id and v.voter_profile_id = p_profile_id)
     or exists (select 1 from public.match_ratings r where r.match_id = p_match_id and r.rater_profile_id = p_profile_id) then
    raise exception 'check_in_used';
  end if;
  delete from public.match_attendance where match_id = p_match_id and profile_id = p_profile_id;
end;
$$;

revoke all on function public.venue_unmark_arrived(uuid, uuid) from public, anon;
grant execute on function public.venue_unmark_arrived(uuid, uuid) to authenticated, service_role;
