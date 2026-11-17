-- A8: post-match food and drink offers (spec 05, "Food and drink after the
-- game"; spec 13, "Post-match offers", decided 17 November).
--
--   * Once a score is in (a result was submitted, even one later rejected,
--     or the match is confirmed), every player in the match sees the
--     venue's active post-match offers that are available at that moment
--     in Cyprus time. They show until 2 hours after the match's end or
--     midnight on the match day (Cyprus), whichever comes first. Anyone
--     else who can open the match (a booker or captain not playing, the
--     venue's staff) gets an empty list.
--   * Opening an offer gives the player a 6-character code (no 0/O or 1/I),
--     one per player, offer and match, and records one view per code (the
--     first time it opens). The code is valid until midnight on the match
--     day, even after the item's own window has closed.
--   * Only staff of that venue redeem a code, once, and never their own.
--
-- The codes and views are the venue's numbers (views and redemptions per
-- venue), so they outlive a deleted profile or menu item. The app reads and writes them only through the functions below.
-- Each *_for function takes the caller and the time so the tests can set
-- them; the app calls the wrappers, which pass auth.uid() and now().

create table public.post_match_offer_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  match_id uuid not null references public.matches (id) on delete cascade,
  item_id uuid references public.venue_menu_items (id) on delete set null,
  venue_id uuid not null references public.venues (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles (id) on delete set null,
  unique (match_id, item_id, profile_id),
  check (redeemed_by is null or redeemed_at is not null)
);
create index post_match_offer_codes_venue_idx on public.post_match_offer_codes (venue_id);

create table public.post_match_offer_views (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null unique references public.post_match_offer_codes (id) on delete cascade,
  viewed_at timestamptz not null default now()
);

alter table public.post_match_offer_codes enable row level security;
alter table public.post_match_offer_views enable row level security;
revoke all on public.post_match_offer_codes, public.post_match_offer_views from public, anon, authenticated;
grant all on public.post_match_offer_codes, public.post_match_offer_views to service_role;

-- Internal: is the item on at p_at, Cyprus wall clock? A missing window or
-- weekday list means all day or every day; weekdays are ISO (1 = Monday),
-- as the venue import writes them. The window ends at available_to.
create or replace function public.menu_item_available_at(p_item public.venue_menu_items, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_item.available_weekdays is null
          or extract(isodow from (p_at at time zone 'Asia/Nicosia'))::smallint = any (p_item.available_weekdays))
     and (p_item.available_from is null or (p_at at time zone 'Asia/Nicosia')::time >= p_item.available_from)
     and (p_item.available_to is null or (p_at at time zone 'Asia/Nicosia')::time < p_item.available_to);
$$;

-- Internal: midnight in Cyprus at the end of the match day (the day of kickoff).
create or replace function public.match_day_end(p_match public.matches)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (((p_match.kickoff_at at time zone 'Asia/Nicosia')::date + 1)::timestamp) at time zone 'Asia/Nicosia';
$$;

-- Internal: are the match's offers on at p_now? A score is in (any
-- submission, even a rejected one, or a confirmed match; decided 17
-- November: the players are still at the venue) and it's before end + 2
-- hours and before midnight on the match day. The match screen shows the
-- offers on the same condition (lib/post-match-offers.ts, scoreEntered).
create or replace function public.post_match_offers_open(p_match public.matches, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_match.venue_id is not null
     and p_match.status <> 'void'
     and (p_match.status = 'confirmed'
          or exists (select 1 from public.match_result_submissions s where s.match_id = p_match.id))
     and p_now < least(p_match.ends_at + interval '2 hours', public.match_day_end(p_match));
$$;

-- Internal: does p_profile play in the match (and hasn't left)?
create or replace function public.post_match_offer_player(p_match_id uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null
     and exists (select 1 from public.match_players mp
                 where mp.match_id = p_match_id and mp.profile_id = p_profile and mp.left_at is null);
$$;

-- Internal: the match, if p_profile plays in it.
create or replace function public.post_match_offer_match(p_match_id uuid, p_profile uuid)
returns public.matches
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or not public.post_match_offer_player(p_match_id, p_profile) then
    raise exception 'not_in_match';
  end if;
  return v_match;
end;
$$;

-- An offer as the app shows it. Prices are the venue's own, in cents.
create or replace function public.post_match_offer_json(p_item public.venue_menu_items)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_item.id,
    'name', p_item.name,
    'description', p_item.description,
    'offer_text', p_item.offer_text,
    'price_cents', p_item.price_cents,
    'offer_price_cents', p_item.offer_price_cents,
    'photo_path', p_item.photo_path);
$$;

-- The offers p_profile sees for p_match_id at p_now: empty when they're
-- off, or when p_profile doesn't play in the match (a booker or captain not
-- playing and the venue's staff can open the match screen too).
create or replace function public.post_match_offers_for(p_match_id uuid, p_profile uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or not public.post_match_offer_player(p_match_id, p_profile)
     or not public.post_match_offers_open(v_match, p_now) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(public.post_match_offer_json(i) order by i.name)
    from public.venue_menu_items i
    where i.venue_id = v_match.venue_id and i.active and i.is_post_match_offer
      and public.menu_item_available_at(i, p_now)), '[]'::jsonb);
end;
$$;

-- A code and its offer as the app shows them (offer is null once the item
-- is deleted).
create or replace function public.post_match_offer_code_json(p_code public.post_match_offer_codes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', p_code.code,
    'expires_at', p_code.expires_at,
    'redeemed_at', p_code.redeemed_at,
    'offer', (select public.post_match_offer_json(i) from public.venue_menu_items i where i.id = p_code.item_id));
$$;

-- Internal: a new random code. Six characters from 32 (no 0/O or 1/I), from
-- gen_random_uuid's random bytes; 256 is a multiple of 32, so unbiased.
create or replace function public.new_post_match_offer_code()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(b, n) % 32 + 1, 1), '' order by n)
  from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0, 5) n;
$$;

-- Opens an offer for p_profile at p_now: their code for this offer and
-- match (made the first time, while the offer shows), with a view the
-- first time. A code already made opens until it expires, even once the
-- offer is off; after that, code_expired.
create or replace function public.open_post_match_offer_for(p_match_id uuid, p_item_id uuid, p_profile uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches := public.post_match_offer_match(p_match_id, p_profile);
  v_item public.venue_menu_items;
  v_code public.post_match_offer_codes;
begin
  select * into v_code from public.post_match_offer_codes
  where match_id = p_match_id and item_id = p_item_id and profile_id = p_profile;

  if found then
    if p_now >= v_code.expires_at then
      raise exception 'code_expired';
    end if;
  else
    select * into v_item from public.venue_menu_items
    where id = p_item_id and venue_id = v_match.venue_id and active and is_post_match_offer;
    if not found or not public.post_match_offers_open(v_match, p_now)
       or not public.menu_item_available_at(v_item, p_now) then
      raise exception 'offer_not_available';
    end if;

    loop
      insert into public.post_match_offer_codes (code, match_id, item_id, venue_id, profile_id, issued_at, expires_at)
      values (public.new_post_match_offer_code(), p_match_id, p_item_id, v_match.venue_id, p_profile, p_now,
              public.match_day_end(v_match))
      on conflict do nothing
      returning * into v_code;
      exit when found;
      -- Either the code was taken (try another) or this player's code was
      -- made meanwhile (use it).
      select * into v_code from public.post_match_offer_codes
      where match_id = p_match_id and item_id = p_item_id and profile_id = p_profile;
      exit when found;
    end loop;
  end if;

  insert into public.post_match_offer_views (code_id, viewed_at) values (v_code.id, p_now)
  on conflict (code_id) do nothing;
  return public.post_match_offer_code_json(v_code);
end;
$$;

-- Internal: the code p_staff typed at p_venue_id, checked and locked. A
-- code whose item or holder has been deleted is kept for the venue's
-- numbers but can't be redeemed.
create or replace function public.post_match_offer_code_for_staff(p_venue_id uuid, p_code text, p_staff uuid, p_now timestamptz)
returns public.post_match_offer_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.post_match_offer_codes;
begin
  if not public.is_venue_staff(p_venue_id, p_staff) then
    raise exception 'not_venue_staff';
  end if;
  select * into v_code from public.post_match_offer_codes
  where code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) and venue_id = p_venue_id
  for update;
  if not found then
    raise exception 'code_not_found';
  end if;
  if v_code.item_id is null or v_code.profile_id is null then
    raise exception 'offer_not_available';
  end if;
  if v_code.profile_id = p_staff then
    raise exception 'own_code';
  end if;
  if v_code.redeemed_at is not null then
    raise exception 'code_already_redeemed';
  end if;
  if p_now >= v_code.expires_at then
    raise exception 'code_expired';
  end if;
  return v_code;
end;
$$;

-- Staff: what a code is for, before redeeming it.
create or replace function public.check_offer_code_for(p_venue_id uuid, p_code text, p_staff uuid, p_now timestamptz)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.post_match_offer_code_json(public.post_match_offer_code_for_staff(p_venue_id, p_code, p_staff, p_now));
$$;

-- Staff: redeem a code, once.
create or replace function public.redeem_offer_code_for(p_venue_id uuid, p_code text, p_staff uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.post_match_offer_codes := public.post_match_offer_code_for_staff(p_venue_id, p_code, p_staff, p_now);
begin
  update public.post_match_offer_codes set redeemed_at = p_now, redeemed_by = p_staff
  where id = v_code.id and redeemed_at is null
  returning * into v_code;
  if not found then
    raise exception 'code_already_redeemed';
  end if;
  return public.post_match_offer_code_json(v_code);
end;
$$;

-- What the app calls: the signed-in caller, now.
create or replace function public.post_match_offers(p_match_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select public.post_match_offers_for(p_match_id, (select auth.uid()), now()); $$;

create or replace function public.open_post_match_offer(p_match_id uuid, p_item_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.open_post_match_offer_for(p_match_id, p_item_id, (select auth.uid()), now()); $$;

create or replace function public.check_offer_code(p_venue_id uuid, p_code text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.check_offer_code_for(p_venue_id, p_code, (select auth.uid()), now()); $$;

create or replace function public.redeem_offer_code(p_venue_id uuid, p_code text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.redeem_offer_code_for(p_venue_id, p_code, (select auth.uid()), now()); $$;

revoke all on function public.menu_item_available_at(public.venue_menu_items, timestamptz) from public, anon, authenticated;
revoke all on function public.match_day_end(public.matches) from public, anon, authenticated;
revoke all on function public.post_match_offers_open(public.matches, timestamptz) from public, anon, authenticated;
revoke all on function public.post_match_offer_player(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_match_offer_match(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_match_offer_json(public.venue_menu_items) from public, anon, authenticated;
revoke all on function public.post_match_offers_for(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.post_match_offer_code_json(public.post_match_offer_codes) from public, anon, authenticated;
revoke all on function public.new_post_match_offer_code() from public, anon, authenticated;
revoke all on function public.open_post_match_offer_for(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.post_match_offer_code_for_staff(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.check_offer_code_for(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.redeem_offer_code_for(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.menu_item_available_at(public.venue_menu_items, timestamptz) to service_role;
grant execute on function public.match_day_end(public.matches) to service_role;
grant execute on function public.post_match_offers_open(public.matches, timestamptz) to service_role;
grant execute on function public.post_match_offer_player(uuid, uuid) to service_role;
grant execute on function public.post_match_offer_match(uuid, uuid) to service_role;
grant execute on function public.post_match_offer_json(public.venue_menu_items) to service_role;
grant execute on function public.post_match_offers_for(uuid, uuid, timestamptz) to service_role;
grant execute on function public.post_match_offer_code_json(public.post_match_offer_codes) to service_role;
grant execute on function public.new_post_match_offer_code() to service_role;
grant execute on function public.open_post_match_offer_for(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.post_match_offer_code_for_staff(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.check_offer_code_for(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.redeem_offer_code_for(uuid, text, uuid, timestamptz) to service_role;

revoke all on function public.post_match_offers(uuid) from public, anon;
revoke all on function public.open_post_match_offer(uuid, uuid) from public, anon;
revoke all on function public.check_offer_code(uuid, text) from public, anon;
revoke all on function public.redeem_offer_code(uuid, text) from public, anon;
grant execute on function public.post_match_offers(uuid) to authenticated, service_role;
grant execute on function public.open_post_match_offer(uuid, uuid) to authenticated, service_role;
grant execute on function public.check_offer_code(uuid, text) to authenticated, service_role;
grant execute on function public.redeem_offer_code(uuid, text) to authenticated, service_role;
