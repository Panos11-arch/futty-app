-- A2 follow-up: a pickup match becomes a named game when a friendly is
-- agreed for its booking (docs/specs/match-record.md decision 1b.1, 11
-- November, agreed with Panos). Replaces create_match_for_booking from
-- 20261110200002_match_record_create; everything not listed here is as it
-- was there (section 6.1).
--
-- On every call for a confirmed booking the friendly is looked up
-- (squad_posts.venue_booking_id -> friendly_matches.squad_post_id):
--   * an existing pickup match that is still scheduled, before kickoff and
--     with no result submitted becomes named: side a = the booker's team
--     (captained by the booker), side b = the opponent team (its first
--     captain). Check-ins and the check-in code are kept. Otherwise it
--     changes nothing and raises no error.
--   * a named match's roster: every player holding a spot (side b if a
--     member of side b's team and not side a's, otherwise a; the booker is
--     always a), plus every member of side b's team without a spot (side
--     b, no share). Picked sides are replaced. A player who is neither a
--     spot holder nor a member of side b's team gets left_at.
-- A booking named on its first call gets the same roster, so calling it
-- again gives the same result.

create or replace function public.create_match_for_booking(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_match public.matches;
  v_kickoff timestamptz;
  v_ends timestamptz;
  v_friendly public.friendly_matches;
  v_post_team uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_label_a text := 'Bibs';
  v_label_b text := 'Non-bibs';
  v_captain_b uuid;
  v_side_a_team uuid;
  v_side_b_team uuid;
  v_cancelled_at timestamptz;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_booking.booking_type = 'owner_block' then
    raise exception 'not_a_game';
  end if;

  select * into v_match from public.matches where booking_id = p_booking_id for update;

  if v_booking.status = 'cancelled' then
    if v_match.id is null then
      raise exception 'booking_not_confirmed';
    end if;
    -- When the whole booking was cancelled; now if that isn't recorded.
    select min(c.cancelled_at) into v_cancelled_at
    from public.booking_cancellations c
    where c.booking_id = p_booking_id and c.scope <> 'my_spot';
    if v_match.status in ('scheduled', 'played') and coalesce(v_cancelled_at, now()) < v_match.ends_at then
      update public.matches set status = 'void' where id = v_match.id;
    end if;
    return v_match.id;
  end if;

  if v_booking.status is distinct from 'confirmed' then
    if v_match.id is not null then
      return v_match.id;
    end if;
    raise exception 'booking_not_confirmed';
  end if;

  -- Closed, or past kickoff: nothing changes (no error).
  if v_match.id is not null and (v_match.status not in ('scheduled', 'played') or now() >= v_match.kickoff_at) then
    return v_match.id;
  end if;

  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  v_ends := public.booking_kickoff_at(v_booking.booking_day, v_booking.end_time);
  if v_ends <= v_kickoff then
    v_ends := v_ends + interval '1 day';  -- ends at or after midnight
  end if;

  -- A named game: the booking's squad post led to a friendly match.
  select fm.id, sp.team_id into v_friendly.id, v_post_team
  from public.squad_posts sp
  join public.friendly_matches fm on fm.squad_post_id = sp.id
  where sp.venue_booking_id = p_booking_id
    and coalesce(fm.status, '') <> 'cancelled'
    and fm.home_team_id is not null and fm.away_team_id is not null
  order by fm.id
  limit 1;

  if v_friendly.id is not null then
    select * into v_friendly from public.friendly_matches where id = v_friendly.id;
    -- The booker's team is side a.
    v_team_a := case
      when v_booking.team_id in (v_friendly.home_team_id, v_friendly.away_team_id) then v_booking.team_id
      when v_post_team in (v_friendly.home_team_id, v_friendly.away_team_id) then v_post_team
      when exists (select 1 from public.team_members tm
                   where tm.team_id = v_friendly.away_team_id and tm.profile_id = v_booking.created_by)
           and not exists (select 1 from public.team_members tm
                           where tm.team_id = v_friendly.home_team_id and tm.profile_id = v_booking.created_by)
        then v_friendly.away_team_id
      else v_friendly.home_team_id
    end;
    v_team_b := case when v_team_a = v_friendly.home_team_id then v_friendly.away_team_id else v_friendly.home_team_id end;
    v_label_a := coalesce((select t.name from public.teams t where t.id = v_team_a), v_label_a);
    v_label_b := coalesce((select t.name from public.teams t where t.id = v_team_b), v_label_b);
    v_captain_b := (select tm.profile_id from public.team_members tm
                    where tm.team_id = v_team_b and tm.role = 'captain'
                    order by tm.joined_at, tm.id limit 1);
  end if;

  if v_match.id is not null then
    update public.matches
    set kickoff_at = v_kickoff,
        ends_at = v_ends,
        result_deadline_at = v_ends + interval '24 hours',
        venue_id = v_booking.venue_id,
        format = v_booking.format,
        players_per_side = greatest(v_booking.capacity / 2, 1)
    where id = v_match.id
    returning * into v_match;

    -- Decision 1b.1: the friendly was agreed after the match was made.
    if v_match.kind = 'pickup' and v_friendly.id is not null and v_match.status = 'scheduled'
       and not exists (select 1 from public.match_result_submissions r where r.match_id = v_match.id) then
      update public.matches
      set kind = 'named', friendly_match_id = v_friendly.id
      where id = v_match.id
      returning * into v_match;

      update public.match_sides ms
      set team_id = v.team_id, label = v.label, captain_profile_id = v.captain
      from (values ('a', v_team_a, v_label_a, v_booking.created_by),
                   ('b', v_team_b, v_label_b, v_captain_b)) as v(side, team_id, label, captain)
      where ms.match_id = v_match.id and ms.side = v.side;
    end if;
  else
    insert into public.matches (booking_id, venue_id, friendly_match_id, kind, format, players_per_side,
                                kickoff_at, ends_at, result_deadline_at)
    values (p_booking_id, v_booking.venue_id, v_friendly.id,
            case when v_friendly.id is not null then 'named' else 'pickup' end, v_booking.format,
            greatest(v_booking.capacity / 2, 1), v_kickoff, v_ends, v_ends + interval '24 hours')
    returning * into v_match;

    insert into public.match_sides (match_id, side, team_id, label, captain_profile_id)
    values
      (v_match.id, 'a', v_team_a, v_label_a, v_booking.created_by),
      (v_match.id, 'b', v_team_b, v_label_b, v_captain_b);

    insert into public.match_check_in_codes (match_id, code)
    values (v_match.id, encode(extensions.gen_random_bytes(16), 'hex'));
  end if;

  select ms.team_id into v_side_a_team from public.match_sides ms where ms.match_id = v_match.id and ms.side = 'a';
  select ms.team_id into v_side_b_team from public.match_sides ms where ms.match_id = v_match.id and ms.side = 'b';

  if v_match.kind = 'named' then
    -- Named roster (decision 1b.1): spot holders, then side b's team
    -- members without a spot. Sides are set on every call.
    insert into public.match_players (match_id, profile_id, share_id, side)
    select v_match.id, r.profile_id, r.share_id, r.side
    from (
      select s.profile_id, s.id as share_id,
             case
               when s.profile_id <> v_booking.created_by
                and exists (select 1 from public.team_members tm
                            where tm.team_id = v_side_b_team and tm.profile_id = s.profile_id)
                and not exists (select 1 from public.team_members tm
                                where tm.team_id = v_side_a_team and tm.profile_id = s.profile_id)
                 then 'b'
               else 'a'
             end as side
      from public.booking_payment_shares s
      where s.booking_id = p_booking_id
        and s.status in ('pending', 'authorized', 'paid', 'covered')
      union all
      select distinct tm.profile_id, null::uuid, 'b'
      from public.team_members tm
      where tm.team_id = v_side_b_team
        and tm.profile_id is not null
        and not exists (select 1 from public.booking_payment_shares s
                        where s.booking_id = p_booking_id and s.profile_id = tm.profile_id
                          and s.status in ('pending', 'authorized', 'paid', 'covered'))
    ) r
    on conflict (match_id, profile_id) where profile_id is not null
    do update set side = excluded.side, share_id = excluded.share_id, left_at = null;
  else
    -- Pickup roster: the booker is on Bibs and the others choose.
    insert into public.match_players (match_id, profile_id, share_id, side)
    select v_match.id, s.profile_id, s.id,
           case when s.profile_id = v_booking.created_by then 'a' end
    from public.booking_payment_shares s
    where s.booking_id = p_booking_id
      and s.status in ('pending', 'authorized', 'paid', 'covered')
    on conflict (match_id, profile_id) where profile_id is not null
    do update set share_id = excluded.share_id, left_at = null;
  end if;

  -- Anyone who no longer holds a spot (and, in a named game, isn't on side
  -- b's team) has left.
  update public.match_players mp
  set left_at = now()
  where mp.match_id = v_match.id
    and mp.profile_id is not null
    and mp.left_at is null
    and not exists (
      select 1 from public.booking_payment_shares s
      where s.booking_id = p_booking_id and s.profile_id = mp.profile_id
        and s.status in ('pending', 'authorized', 'paid', 'covered')
    )
    and not (v_match.kind = 'named' and exists (
      select 1 from public.team_members tm where tm.team_id = v_side_b_team and tm.profile_id = mp.profile_id
    ));

  return v_match.id;
end;
$$;

revoke all on function public.create_match_for_booking(uuid) from public, anon, authenticated;
grant execute on function public.create_match_for_booking(uuid) to service_role;
