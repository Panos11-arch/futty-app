-- P2 rule 4: every join function refuses a venue that isn't live
-- (book_slot does too, in pay_guards_book_slot). create_squad_post gets the
-- same check in pay_guards_squad_posts; invites in pay_guards_invites.

-- Raises venue_not_live for a venue switched off. Internal: only called from
-- other security definer functions, never by the app.
create or replace function public.assert_venue_live(p_venue_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.venues where id = p_venue_id and not is_live) then
    raise exception 'venue_not_live';
  end if;
end;
$$;

revoke all on function public.assert_venue_live(uuid) from public, anon, authenticated;

-- A squad post's venue: its own venue_id, or its linked booking's.
create or replace function public.squad_post_venue_id(p_post public.squad_posts)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_post.venue_id, (select b.venue_id from public.venue_bookings b where b.id = p_post.venue_booking_id));
$$;

revoke all on function public.squad_post_venue_id(public.squad_posts) from public, anon, authenticated;

create or replace function public.join_squad_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_joined_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'players' then
    raise exception 'not_a_players_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  perform public.assert_venue_live(public.squad_post_venue_id(v_post));

  select count(*) into v_joined_count from public.squad_post_joiners where post_id = p_post_id;
  if v_joined_count >= v_post.players_needed then
    raise exception 'squad_full';
  end if;

  begin
    insert into public.squad_post_joiners (post_id, profile_id) values (p_post_id, auth.uid());
  exception when unique_violation then
    raise exception 'already_joined';
  end;
end;
$$;

create or replace function public.offer_opposition(p_post_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  if v_post.team_id = p_team_id then
    raise exception 'cannot_offer_own_post';
  end if;
  perform public.assert_venue_live(public.squad_post_venue_id(v_post));

  update public.squad_posts
  set status = 'matched', matched_team_id = p_team_id
  where id = p_post_id;
end;
$$;

create or replace function public.add_house_player(p_post_id uuid, p_name text)
returns public.squad_post_joiners
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_is_owner boolean;
  v_joined_count integer;
  v_name text;
  v_row public.squad_post_joiners;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'venue_owner') then
    raise exception 'not_venue_owner';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'name_required';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'players' then
    raise exception 'not_a_players_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  if v_post.venue_booking_id is null then
    raise exception 'not_linked_to_booking';
  end if;

  select exists (
    select 1
    from public.venue_bookings b
    join public.venues v on v.id = b.venue_id
    where b.id = v_post.venue_booking_id and v.owner_profile_id = auth.uid()
  ) into v_is_owner;
  if not v_is_owner then
    raise exception 'not_your_venue';
  end if;
  perform public.assert_venue_live(public.squad_post_venue_id(v_post));

  select count(*) into v_joined_count from public.squad_post_joiners where post_id = p_post_id;
  if v_joined_count >= v_post.players_needed then
    raise exception 'squad_full';
  end if;

  insert into public.squad_post_joiners (post_id, profile_id, display_name, is_house_player)
  values (p_post_id, null, v_name, true)
  returning * into v_row;

  return v_row;
end;
$$;
