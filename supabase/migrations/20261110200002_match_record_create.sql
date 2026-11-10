-- A2: contract 1, create_match_for_booking (docs/specs/match-record.md
-- section 6.1, decisions 1, 3, 1a.2, 1a.3, 1a.8).
--
-- Called by the payment code whenever a booking is confirmed and whenever
-- its roster changes before kickoff (a share added, cancelled or refunded);
-- always safe to call. One match per booking: a second call returns the
-- same id and re-syncs it.
--   confirmed          kickoff, end and venue copied again; the roster is
--                      the shares that hold a spot (pending, authorized,
--                      paid, covered, decision 1); a player whose share no
--                      longer does gets left_at. From kickoff on nothing
--                      changes. A void or settled match never changes.
--   pending_payment    with a match (P4b's undo): the match is left as it
--                      is (decision 1a.2). Without one: booking_not_confirmed.
--   cancelled          a match that hasn't ended becomes void (a forfeit
--                      or other settled result stays).
-- kickoff_at and ends_at come from booking_kickoff_at (decision 1a.3).

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
  v_kind text := 'pickup';
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

  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  v_ends := public.booking_kickoff_at(v_booking.booking_day, v_booking.end_time);
  if v_ends <= v_kickoff then
    v_ends := v_ends + interval '1 day';  -- ends at or after midnight
  end if;

  if v_match.id is not null then
    if v_match.status not in ('scheduled', 'played') or now() >= v_match.kickoff_at then
      return v_match.id;
    end if;
    update public.matches
    set kickoff_at = v_kickoff,
        ends_at = v_ends,
        result_deadline_at = v_ends + interval '24 hours',
        venue_id = v_booking.venue_id,
        format = v_booking.format,
        players_per_side = greatest(v_booking.capacity / 2, 1)
    where id = v_match.id
    returning * into v_match;
  else
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
      v_kind := 'named';
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
    end if;

    insert into public.matches (booking_id, venue_id, friendly_match_id, kind, format, players_per_side,
                                kickoff_at, ends_at, result_deadline_at)
    values (p_booking_id, v_booking.venue_id, v_friendly.id, v_kind, v_booking.format,
            greatest(v_booking.capacity / 2, 1), v_kickoff, v_ends, v_ends + interval '24 hours')
    returning * into v_match;

    insert into public.match_sides (match_id, side, team_id, label, captain_profile_id)
    values
      (v_match.id, 'a', v_team_a,
       coalesce((select t.name from public.teams t where t.id = v_team_a), 'Bibs'),
       v_booking.created_by),
      (v_match.id, 'b', v_team_b,
       coalesce((select t.name from public.teams t where t.id = v_team_b), 'Non-bibs'),
       (select tm.profile_id from public.team_members tm
        where v_team_b is not null and tm.team_id = v_team_b and tm.role = 'captain'
        order by tm.joined_at, tm.id limit 1));

    insert into public.match_check_in_codes (match_id, code)
    values (v_match.id, encode(extensions.gen_random_bytes(16), 'hex'));
  end if;

  -- Roster: every share that holds a spot plays. A new player's side: in a
  -- named game, b if they're on side b's team and not side a's, otherwise
  -- a; in a pickup game the booker is on Bibs and the others choose.
  insert into public.match_players (match_id, profile_id, share_id, side)
  select v_match.id, s.profile_id, s.id,
         case
           when s.profile_id = v_booking.created_by then 'a'
           when v_match.kind = 'pickup' then null
           when exists (select 1 from public.match_sides ms join public.team_members tm on tm.team_id = ms.team_id
                        where ms.match_id = v_match.id and ms.side = 'b' and tm.profile_id = s.profile_id)
            and not exists (select 1 from public.match_sides ms join public.team_members tm on tm.team_id = ms.team_id
                            where ms.match_id = v_match.id and ms.side = 'a' and tm.profile_id = s.profile_id)
             then 'b'
           else 'a'
         end
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id
    and s.status in ('pending', 'authorized', 'paid', 'covered')
  on conflict (match_id, profile_id) where profile_id is not null
  do update set share_id = excluded.share_id, left_at = null;

  update public.match_players mp
  set left_at = now()
  where mp.match_id = v_match.id
    and mp.profile_id is not null
    and mp.left_at is null
    and not exists (
      select 1 from public.booking_payment_shares s
      where s.booking_id = p_booking_id and s.profile_id = mp.profile_id
        and s.status in ('pending', 'authorized', 'paid', 'covered')
    );

  return v_match.id;
end;
$$;

revoke all on function public.create_match_for_booking(uuid) from public, anon, authenticated;
grant execute on function public.create_match_for_booking(uuid) to service_role;
