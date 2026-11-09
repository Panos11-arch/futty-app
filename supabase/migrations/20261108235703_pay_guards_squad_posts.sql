-- P2 rule 5: a squad post can only link the caller's own booking, at the
-- same venue and format. The post's kickoff is taken from the booking, so
-- it can't drift from it (the app builds scheduled_at from the phone's own
-- time zone, which isn't Cyprus for everyone). Plus rule 4: no posts at a
-- venue that isn't live.

-- The 4-argument version wrote to columns squad_posts doesn't have
-- (booking_id, post_type, target_count), so every call already failed.
drop function if exists public.create_squad_post(uuid, text, uuid, integer);

-- The 8-argument version had no booking check, and with both versions
-- having defaults a call naming only the first 8 arguments was ambiguous.
-- The 11-argument version accepts every call the 8-argument one did.
drop function if exists public.create_squad_post(uuid, timestamptz, text, text, text, uuid, integer, uuid);

create or replace function public.create_squad_post(
  p_venue_id uuid,
  p_scheduled_at timestamptz,
  p_format text,
  p_post_type text,
  p_level text default null,
  p_team_id uuid default null,
  p_players_needed integer default null,
  p_venue_booking_id uuid default null,
  p_position_needed text default null,
  p_level_needed text default null,
  p_payment_mode text default 'split'
)
returns public.squad_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_scheduled_at timestamptz := p_scheduled_at;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_payment_mode not in ('split', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;

  if p_post_type = 'opposition' then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
    ) then
      raise exception 'not_captain';
    end if;
  elsif p_post_type = 'players' then
    if p_players_needed is null or p_players_needed < 1 then
      raise exception 'players_needed_required';
    end if;
    -- Gipedo Pano only makes sense once there are two full rosters with a
    -- winner and a loser; a "need players" post never gets there.
    if p_payment_mode <> 'split' then
      raise exception 'invalid_payment_mode';
    end if;
  else
    raise exception 'invalid_post_type';
  end if;

  if p_venue_booking_id is not null then
    select * into v_booking from public.venue_bookings where id = p_venue_booking_id;
    if v_booking.id is null or v_booking.created_by is distinct from auth.uid() then
      raise exception 'not_your_booking';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    if v_booking.venue_id is distinct from p_venue_id or v_booking.format is distinct from p_format then
      raise exception 'booking_mismatch';
    end if;
    v_scheduled_at := (v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia';
  end if;

  perform public.assert_venue_live(p_venue_id);

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, level, team_id, players_needed, posted_by, status,
     venue_booking_id, position_needed, level_needed, payment_mode)
  values
    (p_venue_id, v_scheduled_at, p_format, p_post_type, p_level, p_team_id, p_players_needed, auth.uid(), 'open',
     p_venue_booking_id, p_position_needed, p_level_needed, p_payment_mode)
  returning * into v_post;

  return v_post;
end;
$$;
