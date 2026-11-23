-- B1e (Booking v2, spec 13 "Publish game" and "Invites, after payment",
-- decided 20 November):
--   * publish_booking(booking, 'players'): the booker (on a half pitch, a
--     side's captain, side B's once side B has paid) makes his open spots
--     joinable by anyone in the posts section (squad posts). The slot stays
--     booked. Joiners join that side and pay as it pays: nothing when it paid
--     for everyone, their own share when it pays for myself. The post closes
--     when full; unpublish_post closes it any time.
--   * publish_booking(booking, 'opposition'): on a half pitch with no side B,
--     a public opposition post. The first player to accept
--     (accept_opposition_post) becomes side B's captain exactly as with an
--     invite (accept_opposition_internal). It closes 24 hours before kickoff
--     (opposition_open_error), and reopens if side B lapses or leaves before
--     then (reopen_opposition_post).
-- Re-created with only the B1e changes: accept_opposition and
-- booking_side_b_lapse_due (20261123180000_pay_b1c_opposition.sql),
-- booking_side_left (20261123200000_pay_b1c_cancel_per_side.sql) and the
-- joiner trigger auto_add_booking_share_on_join (20261108230317_baseline.sql).

alter table public.squad_posts add column side text check (side in ('a', 'b'));

-- A Booking v2 booking's open opposition post opens again, while there's
-- still time (until 24 hours before kickoff).
create or replace function public.reopen_opposition_post(p_booking_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.squad_posts sp set status = 'open', matched_team_id = null
  from public.venue_bookings b
  where sp.venue_booking_id = p_booking_id and sp.type = 'opposition' and sp.status = 'matched'
    and b.id = p_booking_id and b.booking_kind = 'half' and public.opposition_open_error(b) is null;
$$;

-- Publish a Booking v2 booking: its open spots ('players') or, on a half
-- pitch, a public opposition post ('opposition'). Publishing again returns
-- the open post (with its open spots brought up to date).
create or replace function public.publish_booking(p_booking_id uuid, p_kind text)
returns public.squad_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_error text;
  v_needed integer;
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_kind is null or p_kind not in ('players', 'opposition') then
    raise exception 'invalid_kind';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.booking_kind is null then
    raise exception 'not_found';
  end if;
  if v_booking.booking_kind = 'half' then
    select * into v_side from public.booking_sides
    where booking_id = p_booking_id and captain_id = auth.uid() and left_at is null
    order by side limit 1;
    if v_side.booking_id is null or (p_kind = 'opposition' and v_side.side <> 'a') then
      raise exception 'not_your_booking';
    end if;
  elsif v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  if p_kind = 'opposition' then
    v_error := public.opposition_open_error(v_booking);
    if v_error is not null then
      raise exception '%', v_error;
    end if;
    if exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'b') then
      raise exception 'opposition_found';
    end if;
    select * into v_post from public.squad_posts
    where venue_booking_id = p_booking_id and type = 'opposition' and status = 'open';
    if v_post.id is null then
      insert into public.squad_posts (type, venue_id, scheduled_at, format, status, posted_by, venue_booking_id,
                                      players_needed, total, filled, side)
      values ('opposition', v_booking.venue_id, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time),
              v_booking.format, 'open', auth.uid(), p_booking_id, v_booking.capacity / 2, v_booking.capacity / 2, 0, 'b')
      returning * into v_post;
    end if;
    return v_post;
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  if v_side.side = 'b' and v_side.paid_at is null then
    raise exception 'side_not_paid';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'booking_started';
  end if;
  v_needed := coalesce(v_side.players, v_booking.capacity)
    - (select count(*) from public.booking_payment_shares s
       where s.booking_id = p_booking_id and (v_side.side is null or s.side = v_side.side)
         and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'));
  if v_needed <= 0 then
    raise exception 'booking_full';
  end if;

  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'players' and status = 'open' and side is not distinct from v_side.side;
  if v_post.id is not null then
    update public.squad_posts set players_needed = v_needed, total = v_needed where id = v_post.id returning * into v_post;
    return v_post;
  end if;
  insert into public.squad_posts (type, venue_id, scheduled_at, format, status, posted_by, venue_booking_id,
                                  players_needed, total, filled, side)
  values ('players', v_booking.venue_id, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time),
          v_booking.format, 'open', auth.uid(), p_booking_id, v_needed, v_needed, 0, v_side.side)
  returning * into v_post;
  return v_post;
end;
$$;

-- Unpublish: the post's author (or the booking's side captain) closes it.
create or replace function public.unpublish_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null or v_post.venue_booking_id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.posted_by is distinct from auth.uid()
     and not exists (select 1 from public.booking_sides s
                     where s.booking_id = v_post.venue_booking_id and s.captain_id = auth.uid()
                       and s.side = coalesce(v_post.side, 'a')) then
    raise exception 'not_your_post';
  end if;
  update public.squad_posts set status = 'closed' where id = p_post_id and status in ('open', 'matched');
end;
$$;

-- A public opposition post: the first player to accept becomes side B's captain.
create or replace function public.accept_opposition_post(p_post_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_post from public.squad_posts where id = p_post_id;
  if v_post.id is null or v_post.type <> 'opposition' or v_post.venue_booking_id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.status = 'closed' then
    raise exception 'post_closed';
  end if;
  return public.accept_opposition_internal(v_post.venue_booking_id, null, p_mode);
end;
$$;

-- As in 20261108230317_baseline.sql, plus B1e: a Booking v2 booking's
-- joiner takes a spot on the post's side (or is refused when it's full), and
-- the post closes once it has all the players it asked for.
create or replace function public.auto_add_booking_share_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_side text;
  v_room integer;
begin
  if new.profile_id is null then
    return new; -- house player — no account to attach a payment share to
  end if;

  select * into v_post from public.squad_posts where id = new.post_id;

  if v_post.id is not null and v_post.venue_booking_id is not null and v_post.type = 'players' then
    select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id;
    if v_booking.booking_kind is null then
      perform public.add_booking_share_internal(v_post.venue_booking_id, new.profile_id);
      return new;
    end if;
    -- B1e: Booking v2.
    v_side := case when v_booking.booking_kind = 'half' then coalesce(v_post.side, 'a') end;
    v_room := coalesce((select s.players from public.booking_sides s where s.booking_id = v_booking.id and s.side = v_side),
                       v_booking.capacity)
      - (select count(*) from public.booking_payment_shares s
         where s.booking_id = v_booking.id and (v_side is null or s.side = v_side)
           and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'));
    if v_room <= 0 then
      raise exception 'squad_full';
    end if;
    if v_side is null then
      perform public.add_booking_share_internal(v_booking.id, new.profile_id);
    else
      perform public.add_booking_side_share_internal(v_booking.id, new.profile_id, v_side);
    end if;
    if (select count(*) from public.squad_post_joiners j where j.post_id = v_post.id) >= v_post.players_needed then
      update public.squad_posts set status = 'closed' where id = v_post.id and status = 'open';
    end if;
  end if;

  return new;
end;
$$;

-- The first captain to accept becomes side B's captain: from an invite
-- (accept_opposition) or a public opposition post (accept_opposition_post).
-- As accept_opposition was (20261123180000_pay_b1c_opposition.sql) from its
-- way-to-pay checks on, plus B1e: the booking's open opposition post is
-- matched.
create or replace function public.accept_opposition_internal(p_booking_id uuid, p_team_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_error text;
  v_premium boolean;
  v_half integer;
  v_players integer;
  v_money record;
  v_share_id uuid;
  v_name text;
begin
  if p_mode = 'cash' then
    raise exception 'cash_whole_pitch_only';
  elsif p_mode = 'each_pays_own_spot' then
    raise exception 'just_my_spot_removed';
  elsif p_mode = 'gipedo_pano' then
    raise exception 'losers_pay_not_available';  -- B1d
  elsif p_mode is null or p_mode not in ('pay_all', 'each_pays_responsible') then
    raise exception 'invalid_payment_mode';
  end if;

  -- The booking's row lock: of two captains accepting at once, the second
  -- waits here and then finds side B taken.
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_error := public.opposition_open_error(v_booking);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if exists (select 1 from public.booking_sides s where s.booking_id = v_booking.id and s.side = 'b') then
    raise exception 'opposition_found';
  end if;
  if exists (select 1 from public.booking_payment_shares s
             where s.booking_id = v_booking.id and s.profile_id = auth.uid()
               and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) then
    raise exception 'already_in_booking';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  v_premium := exists (select 1 from public.profiles where id = auth.uid() and is_premium);
  v_half := v_booking.amount_cents / 2;   -- rounded down: Futty absorbs an odd cent
  v_players := v_booking.capacity / 2;
  insert into public.booking_sides (booking_id, side, captain_id, payment_mode, pitch_cents, players, accepted_at, team_id, paid_at)
  values (v_booking.id, 'b', auth.uid(), p_mode, v_half, v_players, now(), p_team_id,
          case when v_half = 0 then now() end);

  if v_half > 0 then
    select * into v_money from public.money_share(v_half, v_players, p_mode, true, v_premium, 'card');
    -- A captain whose earlier acceptance lapsed has a cancelled share here:
    -- it starts again, keeping the intent it replaced (as offer_opposition).
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, side)
    values
      (v_booking.id, auth.uid(), v_money.card_cents, v_money.pitch_cents, v_money.fee_cents, 0, false, 'pending', 'b')
    on conflict (booking_id, profile_id) do update
      set amount_cents = excluded.amount_cents, pitch_cents = excluded.pitch_cents, fee_cents = excluded.fee_cents,
          cash_cents = 0, status = 'pending', side = 'b', created_at = now(),
          replaced_intent_ids = case
            when public.booking_payment_shares.stripe_payment_intent_id is null then public.booking_payment_shares.replaced_intent_ids
            else array_append(public.booking_payment_shares.replaced_intent_ids,
                              public.booking_payment_shares.stripe_payment_intent_id) end,
          stripe_payment_intent_id = null, stripe_setup_intent_id = null, payment_method = 'card',
          credit_cents = 0, held_at = null, capture_due_at = null
    returning id into v_share_id;

    -- Pay for myself: he covers his side's unpaid spots, his side's half
    -- (decided 23 November).
    if p_mode = 'each_pays_responsible' then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (v_booking.id, auth.uid(), v_half,
              public.money_guarantee_hold_due_at(now(), public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)))
      on conflict (booking_id, profile_id) do update
        set amount_cents = excluded.amount_cents, hold_due_at = excluded.hold_due_at, status = 'awaiting_card',
            stripe_customer_id = null, stripe_payment_method_id = null, stripe_payment_intent_id = null,
            attempts = 0, next_attempt_at = null, last_error = null, failure_notified_at = null, held_at = null;
    end if;
  end if;

  -- B1e: a public opposition post for this booking is matched.
  update public.squad_posts set status = 'matched'
  where venue_booking_id = v_booking.id and type = 'opposition' and status = 'open';

  select coalesce(username, full_name, 'A captain') into v_name from public.profiles where id = auth.uid();
  perform public.send_notification(v_booking.created_by, 'opposition_found', jsonb_build_object(
    'title', 'Opposition found',
    'body', format('%s accepted your invite for %s.', v_name, public.booking_label(v_booking)),
    'bookingId', v_booking.id));

  return jsonb_build_object(
    'booking_id', v_booking.id, 'side', 'b', 'share_id', v_share_id, 'payment_mode', p_mode,
    'amount_cents', coalesce(v_money.card_cents, 0),
    'pay_by', public.money_payment_window_ends_at(now()));
end;
$$;

-- As in 20261123180000_pay_b1c_opposition.sql; the rest is accept_opposition_internal (B1e).
create or replace function public.accept_opposition(p_invite_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.booking_opposition_invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_invite from public.booking_opposition_invites where id = p_invite_id;
  if v_invite.id is null or v_invite.invited_profile_id is distinct from auth.uid() and v_invite.invited_team_id is null then
    raise exception 'not_invited';
  end if;
  if v_invite.invited_team_id is not null and not public.is_team_captain(v_invite.invited_team_id, auth.uid()) then
    if exists (select 1 from public.team_members tm where tm.team_id = v_invite.invited_team_id and tm.profile_id = auth.uid()) then
      raise exception 'not_captain';
    end if;
    raise exception 'not_invited';
  end if;

  return public.accept_opposition_internal(v_invite.booking_id, v_invite.invited_team_id, p_mode);
end;
$$;

-- As in 20261123180000_pay_b1c_opposition.sql, plus B1e: the opposition post reopens.
create or replace function public.booking_side_b_lapse_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due record;
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_share public.booking_payment_shares;
  v_name text;
  v_count integer := 0;
begin
  for v_due in
    select s.booking_id from public.booking_sides s
    where s.side = 'b' and s.paid_at is null and now() > public.money_payment_window_ends_at(s.accepted_at)
  loop
    select * into v_booking from public.venue_bookings where id = v_due.booking_id for update;
    select * into v_side from public.booking_sides where booking_id = v_due.booking_id and side = 'b' for update;
    if v_side.booking_id is null or v_side.paid_at is not null then
      continue;
    end if;

    select * into v_share from public.booking_payment_shares
    where booking_id = v_booking.id and profile_id = v_side.captain_id and side = 'b' and status = 'pending' for update;
    if v_share.id is not null then
      update public.booking_payment_shares set status = 'cancelled' where id = v_share.id;
      if v_share.stripe_payment_intent_id is not null then
        insert into public.money_releases (booking_id, share_id, stripe_intent_id, reason)
        values (v_booking.id, v_share.id, v_share.stripe_payment_intent_id, 'side_b_lapsed')
        on conflict (stripe_intent_id) where status = 'pending' do nothing;
      end if;
    end if;
    update public.booking_guarantees set status = 'cancelled', next_attempt_at = null
    where booking_id = v_booking.id and profile_id = v_side.captain_id and status in ('awaiting_card', 'scheduled', 'failed');
    delete from public.booking_sides where booking_id = v_booking.id and side = 'b';
    perform public.reopen_opposition_post(v_booking.id);  -- B1e

    select coalesce(username, full_name, 'Your opponent') into v_name from public.profiles where id = v_side.captain_id;
    perform public.send_notification(v_booking.created_by, 'opposition_lapsed', jsonb_build_object(
      'title', 'Your opponent didn''t pay',
      'body', format('%s didn''t pay within %s for %s, so your invite is open again.',
                     v_name, public.rule_duration_words(public.rule_payment_window()), public.booking_label(v_booking)),
      'bookingId', v_booking.id));
    perform public.send_notification(v_side.captain_id, 'opposition_lapsed', jsonb_build_object(
      'title', 'Your place was released',
      'body', format('You didn''t pay within %s for %s, so the place went back to the invite.',
                     public.rule_duration_words(public.rule_payment_window()), public.booking_label(v_booking)),
      'bookingId', v_booking.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- As in 20261123200000_pay_b1c_cancel_per_side.sql, plus B1e: the opposition post reopens.
create or replace function public.booking_side_left(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_left public.booking_sides;
  v_stays public.booking_sides;
  v_kickoff timestamptz;
  v_name text;
  v_money record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  select * into v_left from public.booking_sides
  where booking_id = p_booking_id and captain_id = p_profile_id and left_at is null order by side limit 1;
  select * into v_stays from public.booking_sides
  where booking_id = p_booking_id and side <> v_left.side and left_at is null;
  if v_left.booking_id is null or v_stays.booking_id is null then
    return;
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  select coalesce(username, full_name, 'The other captain') into v_name from public.profiles where id = p_profile_id;

  -- Under 6 hours: nothing comes back and nothing reopens; the game goes ahead.
  if now() >= v_kickoff - public.rule_refund_cutoff() then
    update public.booking_sides set left_at = now() where booking_id = p_booking_id and side = v_left.side;
    perform public.send_notification(v_stays.captain_id, 'opposition_left', jsonb_build_object(
      'title', 'The other side cancelled',
      'body', format('%s cancelled their side of %s less than %s before kickoff. Your game goes ahead.',
                     v_name, public.booking_label(v_booking), public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', p_booking_id));
    return;
  end if;

  delete from public.booking_sides where booking_id = p_booking_id and side = v_left.side;
  if v_left.side = 'a' then
    -- Side B keeps the slot: it becomes side A, its captain the booker.
    update public.booking_sides set side = 'a' where booking_id = p_booking_id and side = 'b';
    update public.booking_payment_shares set side = 'a' where booking_id = p_booking_id and side = 'b';
    update public.booking_payment_shares set is_booker = (profile_id = v_stays.captain_id)
    where booking_id = p_booking_id and (is_booker or profile_id = v_stays.captain_id);
    update public.venue_bookings set created_by = v_stays.captain_id where id = p_booking_id;
    v_stays.side := 'a';
  end if;
  perform public.reopen_opposition_post(p_booking_id);  -- B1e

  if now() >= v_kickoff - public.rule_gipedo_opponent_lead() then
    -- Within 24 hours: the 24-hour choice applies again.
    update public.venue_bookings set no_opponent_at = now(), no_opponent_choice = null where id = p_booking_id;
    select * into v_booking from public.venue_bookings where id = p_booking_id;
    select * into v_money from public.no_opponent_amounts(v_booking, v_stays);
    perform public.send_notification(v_stays.captain_id, 'no_opponent', jsonb_build_object(
      'title', 'No opponent any more',
      'body', format('%s cancelled their side of %s. Pay the whole pitch and play for %s more, or cancel free and '
                     || 'everyone gets their money back. If you don''t choose by %s before kickoff, it''s cancelled free.',
                     v_name, public.booking_label(v_booking), public.money_format_euros(v_money.amount_cents),
                     public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', p_booking_id));
  else
    update public.venue_bookings set no_opponent_at = null, no_opponent_choice = null where id = p_booking_id;
  end if;

  perform public.send_notification(v_stays.captain_id, 'opposition_left', jsonb_build_object(
    'title', case when v_left.side = 'a' then 'The slot is yours' else 'Your opponent cancelled' end,
    'body', case when v_left.side = 'a'
                 then format('%s cancelled their half of %s. The slot is yours: invite an opponent.', v_name, public.booking_label(v_booking))
                 else format('%s cancelled their side of %s, so your invite is open again.', v_name, public.booking_label(v_booking)) end,
    'bookingId', p_booking_id));
end;
$$;

revoke all on function public.reopen_opposition_post(uuid) from public, anon, authenticated;
grant execute on function public.reopen_opposition_post(uuid) to service_role;
revoke all on function public.accept_opposition_internal(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_opposition_internal(uuid, uuid, text) to service_role;
revoke all on function public.publish_booking(uuid, text) from public, anon;
grant execute on function public.publish_booking(uuid, text) to authenticated, service_role;
revoke all on function public.unpublish_post(uuid) from public, anon;
grant execute on function public.unpublish_post(uuid) to authenticated, service_role;
revoke all on function public.accept_opposition_post(uuid, text) from public, anon;
grant execute on function public.accept_opposition_post(uuid, text) to authenticated, service_role;
