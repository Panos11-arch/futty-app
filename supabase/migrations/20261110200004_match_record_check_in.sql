-- A2: check-in and pickup sides (docs/specs/match-record.md section 5.4,
-- decisions 1a.1, 1a.4, 1a.5).
--
-- The venue shows a per-match code as a QR; players scan it in the app.
-- QR check-in: from 60 minutes before kickoff until 1 hour after the end.
-- A captain ticks their side's players from 60 minutes before kickoff until
-- the result deadline. Pickup players pick Bibs or Non-bibs; the booker can
-- move anyone (and stays on Bibs); sides lock once a result is submitted.

-- The code, for the venue's staff only.
create or replace function public.get_match_check_in_code(p_match_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_code text;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if not public.is_venue_staff(v_match.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  insert into public.match_check_in_codes (match_id, code)
  values (p_match_id, encode(extensions.gen_random_bytes(16), 'hex'))
  on conflict (match_id) do nothing;
  select code into v_code from public.match_check_in_codes where match_id = p_match_id;
  return v_code;
end;
$$;

create or replace function public.check_in_to_match(p_match_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if not exists (select 1 from public.match_players mp
                 where mp.match_id = p_match_id and mp.profile_id = v_uid and mp.left_at is null) then
    raise exception 'not_in_match';
  end if;
  if not exists (select 1 from public.match_check_in_codes c where c.match_id = p_match_id and c.code = p_code) then
    raise exception 'invalid_code';
  end if;
  if v_match.status = 'void'
     or now() < v_match.kickoff_at - interval '60 minutes'
     or now() >= v_match.ends_at + interval '1 hour' then
    raise exception 'check_in_closed';
  end if;

  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  values (p_match_id, v_uid, 'qr', v_uid)
  on conflict (match_id, profile_id) do nothing;
end;
$$;

create or replace function public.captain_mark_attendance(p_match_id uuid, p_profile_ids uuid[])
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
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  v_side := public.match_captain_side(p_match_id, v_uid);
  if v_side is null then
    raise exception 'not_captain';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_profile_ids, '{}')) as p(profile_id)
    where not exists (select 1 from public.match_players mp
                      where mp.match_id = p_match_id and mp.profile_id = p.profile_id
                        and mp.left_at is null and mp.side = v_side)
  ) then
    raise exception 'not_in_match';
  end if;
  if v_match.status = 'void'
     or now() < v_match.kickoff_at - interval '60 minutes'
     or now() >= v_match.result_deadline_at then
    raise exception 'check_in_closed';
  end if;

  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  select distinct p_match_id, p.profile_id, 'captain', v_uid
  from unnest(coalesce(p_profile_ids, '{}')) as p(profile_id)
  on conflict (match_id, profile_id) do nothing;
end;
$$;

-- Sides can change only in a pickup game that has no result submitted.
create or replace function public.match_sides_open(p_match public.matches)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_match.status in ('scheduled', 'played')
     and not exists (select 1 from public.match_result_submissions s where s.match_id = p_match.id);
$$;

create or replace function public.choose_match_side(p_match_id uuid, p_side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_booker uuid;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_match.kind <> 'pickup' then
    raise exception 'not_pickup';
  end if;
  if not exists (select 1 from public.match_players mp
                 where mp.match_id = p_match_id and mp.profile_id = v_uid and mp.left_at is null) then
    raise exception 'not_in_match';
  end if;
  select b.created_by into v_booker from public.venue_bookings b where b.id = v_match.booking_id;
  if p_side is null or p_side not in ('a', 'b') or (v_uid = v_booker and p_side <> 'a') then
    raise exception 'invalid_side';
  end if;
  if not public.match_sides_open(v_match) then
    raise exception 'sides_locked';
  end if;

  update public.match_players set side = p_side
  where match_id = p_match_id and profile_id = v_uid;
end;
$$;

create or replace function public.set_match_player_side(p_match_id uuid, p_player_id uuid, p_side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_booker uuid;
  v_player public.match_players;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if v_match.kind <> 'pickup' then
    raise exception 'not_pickup';
  end if;
  select b.created_by into v_booker from public.venue_bookings b where b.id = v_match.booking_id;
  if v_uid is null or v_uid is distinct from v_booker then
    raise exception 'not_booker';
  end if;
  select * into v_player from public.match_players
  where id = p_player_id and match_id = p_match_id and left_at is null;
  if not found then
    raise exception 'not_in_match';
  end if;
  if (p_side is not null and p_side not in ('a', 'b'))
     or (v_player.profile_id = v_booker and p_side is distinct from 'a') then
    raise exception 'invalid_side';
  end if;
  if not public.match_sides_open(v_match) then
    raise exception 'sides_locked';
  end if;

  update public.match_players set side = p_side where id = p_player_id;
end;
$$;

revoke all on function public.match_sides_open(public.matches) from public, anon, authenticated;
grant execute on function public.match_sides_open(public.matches) to service_role;

-- What the app may call: they check the caller themselves.
revoke all on function public.get_match_check_in_code(uuid) from public, anon;
grant execute on function public.get_match_check_in_code(uuid) to authenticated, service_role;
revoke all on function public.check_in_to_match(uuid, text) from public, anon;
grant execute on function public.check_in_to_match(uuid, text) to authenticated, service_role;
revoke all on function public.captain_mark_attendance(uuid, uuid[]) from public, anon;
grant execute on function public.captain_mark_attendance(uuid, uuid[]) to authenticated, service_role;
revoke all on function public.choose_match_side(uuid, text) from public, anon;
grant execute on function public.choose_match_side(uuid, text) to authenticated, service_role;
revoke all on function public.set_match_player_side(uuid, uuid, text) from public, anon;
grant execute on function public.set_match_player_side(uuid, uuid, text) to authenticated, service_role;
