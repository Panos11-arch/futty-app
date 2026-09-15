-- "House players": venue staff who can fill an open spot on a "Need
-- players" post with no Futty account and no payment obligation at all.
--
-- Run AFTER supabase/booking-payment-splits.sql, supabase/squads.sql and
-- supabase/venue-owners.sql. Run in the Supabase dashboard: SQL Editor >
-- New query > Run. Safe to re-run.
--
-- EXISTING SHAPE (found by inspection — squad_post_joiners predates this
-- repo, same as squad_posts itself; see supabase/squads.sql's own header):
-- a "Need players" post's roster IS squad_post_joiners — one row per joined
-- player, (post_id, profile_id), a unique constraint on that pair stops the
-- same profile joining twice (join_squad_post's ON unique_violation catch),
-- and profile_id was NOT NULL — every roster entry was a real account.
-- Payment is a SEPARATE table (booking_payment_shares,
-- supabase/booking-payment-splits.sql): joining doesn't itself create a
-- payment share, it's the on_squad_post_joiner_add_share trigger
-- (auto_add_booking_share_on_join) that reacts to the join and adds one,
-- for exactly the (booking_id, profile_id) pair. So a roster entry with no
-- payment share is already a normal, supported shape at the DB level — the
-- trigger already skips linking a share when there's nothing to link
-- (free venue, no booking) — a house player just needs the SAME trigger to
-- also skip when there's no real profile_id to attach a share to at all,
-- which is the one change needed below (item 2) to keep house players
-- completely out of the payment flow. players_needed/joined_count on the
-- client side (lib/use-squad-posts.ts) already just counts
-- squad_post_joiners rows regardless of shape, so a house player fills a
-- spot for free with no other change needed there either.

-- 1. profile_id becomes optional; display_name/is_house_player carry a
-- house player's free-text identity instead. The check constraint enforces
-- exactly one shape per row — never both, never neither — so a normal
-- joined player (real account, real hold) and a house player (name only,
-- no account, no payment) can never be confused for each other by a query
-- that forgets to check is_house_player.
alter table public.squad_post_joiners alter column profile_id drop not null;
alter table public.squad_post_joiners add column if not exists display_name text;
alter table public.squad_post_joiners add column if not exists is_house_player boolean not null default false;

alter table public.squad_post_joiners drop constraint if exists squad_post_joiners_house_player_shape_check;
alter table public.squad_post_joiners add constraint squad_post_joiners_house_player_shape_check
  check (
    (is_house_player = false and profile_id is not null and display_name is null)
    or
    (is_house_player = true and profile_id is null and display_name is not null)
  );

-- 2. The one change needed to keep a house player completely out of the
-- payment-splitting/authorization flow (item 3 of the spec) — everything
-- else about add_booking_share_internal/create-share-payment/stripe-webhook
-- is untouched; this just stops a house player's join from ever reaching
-- it. Redefined from supabase/booking-payment-splits.sql: same trigger
-- function, same trigger, new early-return.
create or replace function public.auto_add_booking_share_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if new.profile_id is null then
    return new; -- house player — no account to attach a payment share to
  end if;

  select * into v_post from public.squad_posts where id = new.post_id;

  if v_post.id is not null and v_post.venue_booking_id is not null and v_post.type = 'players' then
    perform public.add_booking_share_internal(v_post.venue_booking_id, new.profile_id);
  end if;

  return new;
end;
$$;

-- 3. Who may add one, and to which posts: only a signed-in venue_owner
-- account, and only to a "Need players" post linked to a booking at a
-- venue THEY own — same owner_profile_id match as the existing owner-block
-- RLS policy ("Owners can block their own venue", supabase/venue-
-- owners.sql), just checked inside a function instead of an RLS predicate
-- since every squad_post_joiners write already goes through a function,
-- never a direct insert policy (see supabase/squads.sql's own reasoning).
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

grant execute on function public.add_house_player(uuid, text) to authenticated;
