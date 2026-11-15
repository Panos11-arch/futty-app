-- P8 (Gap A): offering to be a post's opposition creates the friendly
-- match, so the booking's match gets its second team and captain
-- (create_match_for_booking, via the booking_match_on_friendly trigger).
-- For a Gipedo Pano booking (payment_mode 'gipedo_pano') the offering
-- captain also gets their hold share (gipedo_side 'b'): the pitch price plus
-- 55 cents per player, card only, to place within 15 minutes or the offer
-- lapses and the post reopens (decided 13 November). The post closes 24
-- hours before kickoff.
--
-- A withdrawn or lapsed offer cancels the friendly instead of deleting it
-- (a match may point at it) and turns the booking's match back into one
-- waiting for an opponent. Posts and bookings from before this keep working.

-- The booking's match loses its opponent: back to a pickup with an empty
-- side b, while it's still scheduled and nobody has entered a result; then
-- re-synced (spec 13, "Bookings and their match": a failure never blocks).
create or replace function public.booking_match_drop_friendly(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where booking_id = p_booking_id for update;
  if v_match.id is not null and v_match.kind = 'named' and v_match.status = 'scheduled'
     and not exists (select 1 from public.match_result_submissions r where r.match_id = v_match.id) then
    update public.matches set kind = 'pickup', friendly_match_id = null where id = v_match.id;
    update public.match_sides set team_id = null, label = 'Non-bibs', captain_profile_id = null
    where match_id = v_match.id and side = 'b';
  end if;
  perform public.sync_booking_match(p_booking_id);
end;
$$;

-- A Gipedo Pano offer that hasn't been held is withdrawn (by its captain,
-- or because 15 minutes passed): the opponent's hold share is cancelled,
-- the friendly cancelled, and the post reopens, or stays closed from 24
-- hours before kickoff. The booking captain is told. A payment that
-- completes afterwards is released by its webhook (the share is cancelled).
create or replace function public.gipedo_withdraw_offer(p_post_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_team text;
begin
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null or v_post.status <> 'matched' then
    return false;
  end if;
  select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id for update;
  select * into v_share from public.booking_payment_shares
  where booking_id = v_booking.id and gipedo_side = 'b' and status = 'pending' for update;
  if v_share.id is null then
    return false;
  end if;

  update public.booking_payment_shares set status = 'cancelled' where id = v_share.id;
  update public.friendly_matches set status = 'cancelled'
  where squad_post_id = p_post_id and coalesce(status, '') <> 'cancelled';
  select name into v_team from public.teams where id = v_post.matched_team_id;
  update public.squad_posts
  set status = case when now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '24 hours'
                    then 'closed' else 'open' end,
      matched_team_id = null
  where id = p_post_id;
  perform public.booking_match_drop_friendly(v_booking.id);

  perform public.send_notification(v_booking.created_by, 'gipedo_opponent_left', jsonb_build_object(
    'title', 'Your opponent didn''t confirm',
    'body', format('%s didn''t place their hold for your Gipedo Pano game at %s, so your post is open again.',
                   coalesce(v_team, 'The other team'), public.booking_label(v_booking)),
    'bookingId', v_booking.id,
    'reason', p_reason
  ));
  return true;
end;
$$;

-- Job: Gipedo Pano offers whose hold wasn't placed within 15 minutes.
create or replace function public.gipedo_lapse_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post uuid;
  v_count integer := 0;
begin
  for v_post in
    select sp.id
    from public.booking_payment_shares s
    join public.venue_bookings b on b.id = s.booking_id
    join public.squad_posts sp on sp.venue_booking_id = b.id and sp.type = 'opposition' and sp.status = 'matched'
    where s.gipedo_side = 'b' and s.status = 'pending' and b.payment_mode = 'gipedo_pano'
      and now() > public.money_payment_window_ends_at(s.created_at)
  loop
    if public.gipedo_withdraw_offer(v_post, 'lapsed') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- As in 20261108235702_pay_guards_live_venues, plus the friendly match and,
-- for a Gipedo Pano booking, the offering captain's hold.
create or replace function public.offer_opposition(p_post_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_hold record;
begin
  if not exists (select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain') then
    raise exception 'not_captain';
  end if;
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then raise exception 'post_not_found'; end if;
  if v_post.type <> 'opposition' then raise exception 'not_an_opposition_post'; end if;
  if v_post.status <> 'open' then raise exception 'post_closed'; end if;
  if v_post.team_id = p_team_id then raise exception 'cannot_offer_own_post'; end if;
  perform public.assert_venue_live(public.squad_post_venue_id(v_post));

  if v_post.venue_booking_id is not null then
    select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id for update;
  end if;

  if v_booking.payment_mode = 'gipedo_pano' then
    if v_booking.status <> 'confirmed'
       or now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '24 hours' then
      raise exception 'post_closed';
    end if;
    if exists (select 1 from public.booking_payment_shares s
               where s.booking_id = v_booking.id and s.profile_id = auth.uid()
                 and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) then
      raise exception 'already_in_booking';
    end if;
    -- A captain who pulled out can't come back (one spot per player per
    -- booking, as for a player who cancels).
    if exists (select 1 from public.booking_payment_shares s
               where s.booking_id = v_booking.id and s.profile_id = auth.uid() and s.gipedo_side is not null
                 and s.status <> 'cancelled') then
      raise exception 'cannot_rejoin';
    end if;
    -- The same hold as the booking captain's, with this captain's own
    -- Premium spot fee-free (decided 12 November).
    select * into v_hold from public.money_share(v_booking.amount_cents, v_booking.capacity, 'gipedo_pano', true,
      exists (select 1 from public.profiles where id = auth.uid() and is_premium), 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, gipedo_side)
    values
      (v_booking.id, auth.uid(), v_hold.card_cents, v_hold.pitch_cents, v_hold.fee_cents, 0, false, 'pending', 'b')
    on conflict (booking_id, profile_id) do update
      set amount_cents = excluded.amount_cents, pitch_cents = excluded.pitch_cents, fee_cents = excluded.fee_cents,
          cash_cents = 0, status = 'pending', gipedo_side = 'b', created_at = now(),
          stripe_payment_intent_id = null, stripe_setup_intent_id = null, payment_method = 'card',
          credit_cents = 0, held_at = null, capture_due_at = null;
  end if;

  update public.squad_posts set status = 'matched', matched_team_id = p_team_id where id = p_post_id;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
  values (p_post_id, v_post.team_id, p_team_id, 'pending_score', 0);
end;
$$;

-- As in the baseline, except: the friendly is cancelled, not deleted, and
-- the booking's match goes back to waiting for an opponent. On a Gipedo
-- Pano booking only the offering captain withdraws, and only before their
-- hold is placed; after that they pull out (gipedo_pull_out).
create or replace function public.cancel_opposition_offer(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;
  if v_post.status <> 'matched' then
    raise exception 'not_matched';
  end if;

  select payment_mode into v_mode from public.venue_bookings where id = v_post.venue_booking_id;
  if v_mode = 'gipedo_pano' then
    if not public.is_team_captain(v_post.matched_team_id, auth.uid()) then
      raise exception 'not_captain';
    end if;
    if not exists (select 1 from public.booking_payment_shares s
                   where s.booking_id = v_post.venue_booking_id and s.gipedo_side = 'b' and s.status = 'pending') then
      raise exception 'use_gipedo_pull_out';
    end if;
    perform public.gipedo_withdraw_offer(p_post_id, 'withdrawn');
    return;
  end if;

  if not exists (
    select 1 from public.team_members
    where profile_id = auth.uid()
      and role = 'captain'
      and team_id in (v_post.team_id, v_post.matched_team_id)
  ) then
    raise exception 'not_captain';
  end if;

  if v_post.scheduled_at is null or now() >= v_post.scheduled_at - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  update public.friendly_matches set status = 'cancelled'
  where squad_post_id = p_post_id and coalesce(status, '') <> 'cancelled';

  update public.squad_posts
  set status = 'open', matched_team_id = null
  where id = p_post_id;

  if v_post.venue_booking_id is not null then
    perform public.booking_match_drop_friendly(v_post.venue_booking_id);
  end if;
end;
$$;

-- As in the baseline, plus: a Gipedo Pano game is left by pulling out, and
-- the booking's match goes back to waiting for an opponent.
create or replace function public.cancel_opposition_match(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_match public.friendly_matches;
  v_my_team uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' or v_post.status <> 'matched' then
    raise exception 'not_matched';
  end if;

  if exists (select 1 from public.venue_bookings b where b.id = v_post.venue_booking_id and b.payment_mode = 'gipedo_pano') then
    raise exception 'use_gipedo_pull_out';
  end if;

  select tm.team_id into v_my_team
  from public.team_members tm
  where tm.profile_id = auth.uid()
    and tm.role = 'captain'
    and tm.team_id in (v_post.team_id, v_post.matched_team_id)
  limit 1;
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if v_post.scheduled_at is not null and now() >= v_post.scheduled_at - interval '30 minutes' then
    raise exception 'too_close_to_start';
  end if;

  select * into v_match from public.friendly_matches where squad_post_id = p_post_id for update;
  if v_match.id is not null then
    if v_match.score_attempts > 0 then
      raise exception 'score_already_submitted';
    end if;
    update public.friendly_matches set status = 'cancelled' where id = v_match.id;
  end if;

  update public.squad_posts
  set status = 'open', matched_team_id = null
  where id = p_post_id;

  if v_post.venue_booking_id is not null then
    perform public.booking_match_drop_friendly(v_post.venue_booking_id);
  end if;
end;
$$;

insert into public.notification_types (type, always_sent) values
  ('gipedo_opponent_left', true),
  ('gipedo_no_opponent', true),
  ('gipedo_pulled_out', true),
  ('gipedo_settled', true);

revoke all on function public.booking_match_drop_friendly(uuid) from public, anon, authenticated;
grant execute on function public.booking_match_drop_friendly(uuid) to service_role;
revoke all on function public.gipedo_withdraw_offer(uuid, text) from public, anon, authenticated;
grant execute on function public.gipedo_withdraw_offer(uuid, text) to service_role;
revoke all on function public.gipedo_lapse_offers() from public, anon, authenticated;
grant execute on function public.gipedo_lapse_offers() to service_role;
revoke all on function public.offer_opposition(uuid, uuid) from public, anon;
grant execute on function public.offer_opposition(uuid, uuid) to authenticated, service_role;
revoke all on function public.cancel_opposition_offer(uuid) from public, anon;
grant execute on function public.cancel_opposition_offer(uuid) to authenticated, service_role;
revoke all on function public.cancel_opposition_match(uuid) from public, anon;
grant execute on function public.cancel_opposition_match(uuid) to authenticated, service_role;
