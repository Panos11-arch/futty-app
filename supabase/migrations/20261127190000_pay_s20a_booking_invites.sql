-- S20A (b): player invites (docs/specs/13-payments-bookings.md, "Player
-- invites (S20A, decided 27 November)", with #245's Losers pay line).
--
--   1. Player invites stay open until kickoff (Panos, 27 November; his spec 13
--      change is coming): while the side is full, accepting says "This game
--      is full" (booking_full) and the invite stays pending, so a lapse
--      reopens the spot to everyone already invited. At kickoff
--      booking_invites_expire_due expires what's left
--      (booking_invite_closes_at, the one place the time lives).
--   2. The spot is taken when the player accepts (under the booking's lock).
--      Before, accept_invite marked the invite accepted and made no share
--      when the side was full. add_booking_share_internal and
--      add_booking_side_share_internal are unchanged.
--   3. A card player who accepts has 15 minutes (app_rules.payment_window_minutes)
--      to pay or hold his share, ending at kickoff if that comes first
--      (pay_by). Otherwise booking_player_lapse_due cancels the share, queues
--      any started payment for release ('player_lapsed') and the spot reopens.
--      Losers pay too: every player there is a card player (#245).
--   4. Cash (decided by Panos, 27 November; his spec 13 text isn't on master
--      yet): on a whole pitch in Pay for myself, accepting asks Card or Cash
--      (accept_invite's p_method). Cash is hidden for a player in debt
--      (cashOk) and refused (player_in_debt); it's never combined with credit
--      (share_payment_plan: credit_needs_card). Both have the 15 minutes:
--      card pays or holds his share, cash pays the €0.80 by card and saves
--      his card (Premium: saves the card, €0). pay_by clears once the share
--      leaves pending (the €0.80 held: authorized; a Premium card saved:
--      paid), and a cash spot never lapses after that; unticked cash is
--      covered by the booker's guarantee (start_collection,
--      20261123210000_pay_b1c_collection_odd_cent.sql:135-143). Pay for
--      everyone: nothing to pay, accepting is joining.
--   5. A lapsed player can be invited again. His share row is reused, as a
--      Gipedo Pano re-offer (20261113130016_pay_gipedo_review_fixes.sql:234-250):
--      offer_attempt + 1 and the old intent kept in replaced_intent_ids, so
--      the new payment has a new Stripe key (create-share-payment) and a late
--      payment on the old intent answers 'replaced_intent' and gives back
--      only itself.
--   6. Invite a team (every other member of a team the caller is in) and
--      invite all friends. Blocked, adult-minor, deleted, already in and
--      already invited players are skipped.
--
-- Late money after a lapse needs no change here: a cancelled share of a live
-- booking answers 'share_cancelled' (held: 20261113130016; taken: #244,
-- 20261127170000_pay_captured_share_cancelled.sql), so the webhook gives back
-- that payment only.

-- ---- 0. Columns, statuses, notification type ----------------------------------------------

alter table public.booking_payment_shares add column pay_by timestamptz;
comment on column public.booking_payment_shares.pay_by is
  'S20A: a card player who accepted an invite must pay or hold by then (15 minutes, or kickoff), or his spot reopens.';
create index booking_payment_shares_pay_by_idx on public.booking_payment_shares (pay_by)
  where pay_by is not null and status = 'pending';

alter table public.invites drop constraint invites_status_check;
alter table public.invites add constraint invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'lapsed'));

insert into public.notification_types (type, always_sent) values ('booking_spot_lapsed', true)
on conflict (type) do nothing;

-- ---- 1. Helpers (internal) --------------------------------------------------------------------

-- Rule 1's time limit: player invites close at kickoff (Cyprus time).
create function public.booking_invite_closes_at(p_booking public.venue_bookings)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time);
$$;

-- Free spots on a side (p_side null: a whole pitch), counted as the share
-- helpers count them: active shares, and on a whole pitch accepted venue players.
create function public.booking_side_room(p_booking_id uuid, p_side text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_side is not null then
      coalesce((select s.players from public.booking_sides s where s.booking_id = p_booking_id and s.side = p_side), 0)
      - (select count(*)::integer from public.booking_payment_shares sh
         where sh.booking_id = p_booking_id and sh.side = p_side
           and sh.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'))
    else
      public.booking_total_shares_needed(p_booking_id)
      - (select count(*)::integer from public.booking_payment_shares sh
         where sh.booking_id = p_booking_id
           and sh.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'))
      - (select count(*)::integer from public.booking_venue_players vp
         where vp.booking_id = p_booking_id and vp.status = 'accepted')
  end;
$$;

-- The side an invite from p_inviter fills: on a half pitch the inviting
-- captain's side (invite_side), on a whole pitch none.
create function public.booking_invite_side_of(p_booking public.venue_bookings, p_inviter uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_booking.booking_kind = 'half' then public.invite_side(p_booking.id, p_inviter) end;
$$;

-- When a card acceptance lapses: the payment window from p_at, or kickoff
-- if that comes first (Anghelo, 27 November).
create function public.booking_player_pay_by(p_booking public.venue_bookings, p_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select least(public.money_payment_window_ends_at(p_at), public.booking_invite_closes_at(p_booking));
$$;

-- pay_by is only for a share still waiting: once it's held, paid or saved
-- (cash: the €0.80 held, or a Premium card saved), or cancelled, it clears.
create function public.booking_shares_clear_pay_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'pending' and new.pay_by is not null then
    new.pay_by := null;
  end if;
  return new;
end;
$$;

create trigger booking_shares_clear_pay_by
before update of status on public.booking_payment_shares
for each row execute function public.booking_shares_clear_pay_by();

-- Why p_inviter can't invite players to p_booking now, or null. As
-- add_booking_player checked (20261123180000_pay_b1c_opposition.sql:558), plus
-- rule 1 (closed at kickoff). A full side still takes invites: they wait.
create function public.booking_invite_refusal(p_booking public.venue_bookings, p_inviter uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_side_b public.booking_sides;
begin
  if p_booking.id is null then
    return 'not_found';
  end if;
  -- B1c: side B's captain is the booker of his half: he invites his own
  -- players once side B is paid.
  if p_booking.created_by is distinct from p_inviter then
    select * into v_side_b from public.booking_sides where booking_id = p_booking.id and side = 'b';
    if v_side_b.captain_id is distinct from p_inviter then
      return 'not_your_booking';
    end if;
    if v_side_b.paid_at is null then
      return 'side_not_paid';
    end if;
  end if;
  -- A walk-in or phone booking is never an app booking.
  if p_booking.booking_type = 'counter' then
    return 'counter_booking';
  end if;
  if p_booking.status = 'cancelled' then
    return 'booking_cancelled';
  end if;
  if now() >= public.booking_invite_closes_at(p_booking) then
    return 'invites_closed';
  end if;
  return null;
end;
$$;

-- Why p_profile can't be invited to p_booking (already in, already invited),
-- or null. Only an ACTIVE share counts: a lapsed player can be invited again.
create function public.booking_invitee_refusal(p_booking_id uuid, p_inviter uuid, p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_profile = p_inviter
         or exists (select 1 from public.booking_payment_shares s
                    where s.booking_id = p_booking_id and s.profile_id = p_profile
                      and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'))
      then 'already_in_booking'
    when exists (select 1 from public.invites i
                 where i.kind = 'booking' and i.booking_id = p_booking_id and i.invited_profile_id = p_profile
                   and i.status = 'pending')
      then 'already_invited'
  end;
$$;

-- Section 1 (Panos, 27 November): a whole pitch in Pay for myself, not
-- Losers pay, is where an invited player may choose cash.
create function public.booking_cash_allowed(p_booking public.venue_bookings)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_booking.booking_kind = 'whole' and not coalesce(p_booking.losers_pay, false)
         and coalesce(p_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot'), false);
$$;

-- One invite, checked by the callers, with its push (cashOk: the accept
-- offers cash).
create function public.booking_invite_send(p_booking public.venue_bookings, p_inviter uuid, p_profile uuid)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter text;
  v_venue_name text;
  v_invite public.invites;
begin
  select coalesce(username, full_name, 'A player') into v_inviter from public.profiles where id = p_inviter;
  select name into v_venue_name from public.venues where id = p_booking.venue_id;
  insert into public.invites (kind, booking_id, invited_profile_id, invited_by)
  values ('booking', p_booking.id, p_profile, p_inviter)
  returning * into v_invite;
  perform public.send_notification(p_profile, 'booking_invite', jsonb_build_object(
    'title', 'Game invite',
    'body', format('%s invited you to play at %s on %s at %s.', v_inviter, v_venue_name,
                   to_char(p_booking.booking_day, 'Dy DD Mon'), to_char(p_booking.start_time, 'HH24:MI')),
    'inviteId', v_invite.id, 'bookingId', p_booking.id,
    -- Cash is hidden for a player in debt.
    'cashOk', public.booking_cash_allowed(p_booking) and not public.profile_has_debt(p_profile)));
  return v_invite;
end;
$$;

-- A lapsed player's cancelled share, back for a new acceptance on p_side
-- (null: a whole pitch), priced as add_booking_share_internal /
-- add_booking_side_share_internal price a new one. As a Gipedo Pano re-offer
-- (20261113130016_pay_gipedo_review_fixes.sql:234-250): a new attempt, the
-- old intent kept in replaced_intent_ids, nothing of the old payment left on
-- the row. Returns false when there's no cancelled share to bring back.
create function public.booking_invite_revive_share(p_booking_id uuid, p_profile_id uuid, p_side text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_share public.booking_payment_shares;
  v_premium boolean := exists (select 1 from public.profiles where id = p_profile_id and is_premium);
  v_money record;
  v_status text;
  v_gipedo_side text;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  select * into v_share from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = p_profile_id for update;
  if v_share.id is null or v_share.status <> 'cancelled' then
    return false;
  end if;

  if p_side is null then
    select * into v_money from public.money_share(
      v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, false, v_premium, 'card');
    v_status := case when v_booking.payment_mode in ('pay_all', 'gipedo_pano') then 'covered' else 'pending' end;
  else
    select * into v_side from public.booking_sides where booking_id = p_booking_id and side = p_side;
    if v_booking.losers_pay_pulled_out_at is not null then
      select 0 as card_cents, 0 as pitch_cents, 0 as fee_cents, 0 as cash_cents into v_money;
      v_status := 'covered';
    elsif v_booking.losers_pay and v_side.payment_mode = 'each_pays_responsible' then
      select x.pitch_cents, x.fee_cents, x.card_cents, 0 as cash_cents into v_money
      from public.money_losers_pay_hold(v_booking.amount_cents, v_booking.capacity, 'each_pays_responsible', false,
                                        v_premium) x;
      v_status := 'pending';
      v_gipedo_side := p_side;
    else
      select * into v_money from public.money_share(
        v_side.pitch_cents, v_side.players, v_side.payment_mode, false, v_premium, 'card');
      v_status := case when v_side.payment_mode = 'pay_all' then 'covered' else 'pending' end;
    end if;
  end if;

  update public.booking_payment_shares
  set amount_cents = v_money.card_cents, pitch_cents = v_money.pitch_cents, fee_cents = v_money.fee_cents,
      cash_cents = v_money.cash_cents, status = v_status, side = p_side, gipedo_side = v_gipedo_side,
      offer_attempt = coalesce(offer_attempt, 1) + 1,
      replaced_intent_ids = case when stripe_payment_intent_id is null then replaced_intent_ids
                                 else array_append(replaced_intent_ids, stripe_payment_intent_id) end,
      stripe_payment_intent_id = null, stripe_setup_intent_id = null, stripe_payment_method_id = null,
      payment_method = 'card', capture_method = null, non_refundable_accepted_at = null,
      held_at = null, capture_due_at = null, paid_at = null, hold_expired_at = null,
      capture_attempts = 0, capture_next_attempt_at = null, capture_last_error = null, credit_cents = 0,
      cash_received_at = null, cash_received_by = null, cash_prompted_at = null, cash_intent_id = null,
      switch_credit_cents = 0, switch_credit_back_cents = 0, switch_credit_issued_at = null,
      pay_by = null, created_at = now()
  where id = v_share.id;
  return true;
end;
$$;

-- ---- 2. Inviting ------------------------------------------------------------------------------

-- As in 20261123180000_pay_b1c_opposition.sql, plus S20A (b): invites close
-- at kickoff; only an active share counts as already in (a lapsed player can
-- be invited again); the invite is a push.
CREATE OR REPLACE FUNCTION public.add_booking_player(p_booking_id uuid, p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_profile_id uuid;
  v_refusal text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_refusal := public.booking_invite_refusal(v_booking, auth.uid());
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  select id into v_profile_id from public.profiles where lower(username) = lower(trim(p_username));
  if v_profile_id is null then
    raise exception 'player_not_found';
  end if;
  v_refusal := public.booking_invitee_refusal(p_booking_id, auth.uid(), v_profile_id);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  perform public.booking_invite_send(v_booking, auth.uid(), v_profile_id);
end;
$function$;

-- Every other member of a team the caller is in (captain or not; Anghelo, 27
-- November). Friendship isn't needed; blocked, adult-minor, deleted, already
-- in and already invited members are skipped. Returns how many were invited.
create function public.invite_team_to_booking(p_booking_id uuid, p_team_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_booking public.venue_bookings;
  v_team public.teams;
  v_refusal text;
  v_member uuid;
  v_count integer := 0;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'team_not_found';
  end if;
  if v_team.deleted_at is not null then
    raise exception 'team_deleted';
  end if;
  if not exists (select 1 from public.team_members where team_id = p_team_id and profile_id = v_me) then
    raise exception 'not_member';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_refusal := public.booking_invite_refusal(v_booking, v_me);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  for v_member in
    select tm.profile_id from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id <> v_me
    order by tm.joined_at, tm.profile_id
  loop
    if public.blocked_between(v_me, v_member) or not public.age_pair_allowed(v_me, v_member)
       or public.profile_is_deleted(v_member)
       or public.booking_invitee_refusal(p_booking_id, v_me, v_member) is not null then
      continue;
    end if;
    perform public.booking_invite_send(v_booking, v_me, v_member);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Every friend the caller may play with (friend_allowed: friends, no block,
-- the adult-minor rules, not deleted), except those already in or invited.
create function public.invite_all_friends_to_booking(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_booking public.venue_bookings;
  v_refusal text;
  v_friend uuid;
  v_count integer := 0;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  v_refusal := public.booking_invite_refusal(v_booking, v_me);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  for v_friend in
    select case when f.requester_id = v_me then f.addressee_id else f.requester_id end
    from public.friendships f
    where f.status = 'accepted' and v_me in (f.requester_id, f.addressee_id)
    order by f.accepted_at, f.id
  loop
    if not public.friend_allowed(v_me, v_friend)
       or public.booking_invitee_refusal(p_booking_id, v_me, v_friend) is not null then
      continue;
    end if;
    perform public.booking_invite_send(v_booking, v_me, v_friend);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---- 3. Accepting -----------------------------------------------------------------------------

-- The 2-argument version (20261127140000_match_s20a_teams.sql:254) is
-- replaced by one with p_method (S20A (b), section 1: 'card' or 'cash'; the
-- app's existing call with no method is unchanged). The team branch is the
-- same, line for line. The booking branch adds: an expired invite
-- (invite_expired), closing at kickoff, the spot taken at accept or
-- booking_full, a lapsed player's share brought back, the cash choice, and
-- the card player's 15 minutes (pay_by).
drop function public.accept_invite(uuid);
CREATE FUNCTION public.accept_invite(p_invite_id uuid, p_method text DEFAULT NULL)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.invites;
  v_booking public.venue_bookings;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_team public.teams;
  v_side text;
  v_share public.booking_payment_shares;
  v_cash record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- S20A (b): a booking invite locks its booking first, so two players
  -- accepting the last spot at once queue on the booking.
  select * into v_invite from public.invites where id = p_invite_id;
  if v_invite.kind = 'booking' then
    perform 1 from public.venue_bookings where id = v_invite.booking_id for update;
  end if;
  select * into v_invite from public.invites where id = p_invite_id for update;
  if v_invite.id is null or v_invite.invited_profile_id <> auth.uid() then
    raise exception 'not_your_invite';
  end if;
  -- S20A (b): an invite that expired at kickoff.
  if v_invite.status = 'expired' then
    raise exception 'invite_expired';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;

  if v_invite.kind = 'team' then
    -- Lock the team so two acceptances can't both take its last place.
    select * into v_team from public.teams where id = v_invite.team_id for update;
    -- S20A: a deleted team, a block or an adult-minor pair (A4).
    if v_team.deleted_at is not null then
      raise exception 'team_deleted';
    end if;
    if public.blocked_between(auth.uid(), v_invite.invited_by) then
      raise exception 'blocked';
    end if;
    if not public.age_pair_allowed(auth.uid(), v_invite.invited_by) then
      raise exception 'age_pair_refused';
    end if;
    if not public.team_has_room(v_invite.team_id, v_invite.team_role, v_invite.id) then
      raise exception 'team_full';
    end if;
    insert into public.team_members (team_id, profile_id, role)
    values (v_invite.team_id, auth.uid(), v_invite.team_role)
    on conflict (team_id, profile_id) do nothing;
  else
    if p_method is not null and p_method not in ('card', 'cash') then
      raise exception 'invalid_method';
    end if;
    select * into v_booking from public.venue_bookings where id = v_invite.booking_id for update;
    -- A walk-in or phone booking is never an app booking.
    if v_booking.booking_type = 'counter' then
      raise exception 'counter_booking';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    -- S20A (b): player invites close at kickoff.
    -- (booking_invites_expire_due marks it expired; here the caller is told.)
    if v_booking.booking_kind is not null and now() >= public.booking_invite_closes_at(v_booking) then
      raise exception 'invite_expired';
    end if;
    if v_booking.booking_day < v_now::date
       or (v_booking.booking_day = v_now::date and v_booking.start_time <= v_now::time) then
      raise exception 'slot_in_past';
    end if;
    perform public.assert_venue_live(v_booking.venue_id);

    -- B1c: on a half pitch a player joins the side of the captain who
    -- invited him (a captain of both sides fills side A first).
    v_side := public.booking_invite_side_of(v_booking, v_invite.invited_by);
    -- S20A (b): the spot is taken now, or "This game is full" and the
    -- invite stays pending (nothing here is saved).
    if v_booking.booking_kind is not null and public.booking_side_room(v_booking.id, v_side) <= 0 then
      raise exception 'booking_full';
    end if;
    -- A lapsed player invited again: his old share comes back (section 5).
    if not public.booking_invite_revive_share(v_booking.id, auth.uid(), v_side) then
      if v_booking.booking_kind = 'half' then
        perform public.add_booking_side_share_internal(v_invite.booking_id, auth.uid(), v_side);
      else
        perform public.add_booking_share_internal(v_invite.booking_id, auth.uid());
      end if;
    end if;

    select * into v_share from public.booking_payment_shares
    where booking_id = v_booking.id and profile_id = auth.uid() for update;
    if v_booking.booking_kind is not null
       and (v_share.id is null or v_share.status in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) then
      raise exception 'booking_full';
    end if;

    if v_booking.booking_kind is not null and v_share.status = 'pending' then
      if p_method = 'cash' then
        -- Section 1 (Panos, 27 November): cash on a whole pitch in Pay for
        -- myself, with the same 15 minutes for his €0.80 step.
        if not public.booking_cash_allowed(v_booking) then
          raise exception 'cash_whole_pitch_only';
        end if;
        if public.profile_has_debt(auth.uid()) then
          raise exception 'player_in_debt';
        end if;
        select * into v_cash from public.money_share(v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode,
          false, exists (select 1 from public.profiles where id = auth.uid() and is_premium), 'cash');
        update public.booking_payment_shares
        set payment_method = 'cash', amount_cents = v_cash.card_cents, pitch_cents = v_cash.pitch_cents,
            fee_cents = v_cash.fee_cents, cash_cents = v_cash.cash_cents
        where id = v_share.id;
      end if;
      -- Card or cash: 15 minutes, or kickoff if that comes first.
      update public.booking_payment_shares set pay_by = public.booking_player_pay_by(v_booking, now())
      where id = v_share.id;
    end if;
  end if;

  update public.invites set status = 'accepted', responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$function$;

-- ---- 4. Jobs ----------------------------------------------------------------------------------

-- A card player who accepted and didn't pay or hold by pay_by: his
-- acceptance lapses, his share is cancelled, any payment he started is
-- released, and the spot reopens. As booking_side_b_lapse_due
-- (20261123220000_pay_b1e_publish.sql:361): the booking, then the share, are
-- locked and the share re-checked, so a hold that arrived first never lapses.
-- Losers pay: a spot that never held is already counted in the captain's
-- guarantee (spec 13 example 16), so nothing more changes.
create function public.booking_player_lapse_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due record;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_captain uuid;
  v_name text;
  v_count integer := 0;
begin
  for v_due in
    select s.id, s.booking_id from public.booking_payment_shares s
    where s.status = 'pending' and s.pay_by is not null and now() >= s.pay_by
    order by s.pay_by, s.id
  loop
    select * into v_booking from public.venue_bookings where id = v_due.booking_id for update;
    select * into v_share from public.booking_payment_shares where id = v_due.id for update;
    if v_share.status <> 'pending' or v_share.pay_by is null or now() < v_share.pay_by then
      continue;
    end if;

    update public.booking_payment_shares set status = 'cancelled', pay_by = null where id = v_share.id;
    if v_share.stripe_payment_intent_id is not null then
      insert into public.money_releases (booking_id, share_id, stripe_intent_id, reason)
      values (v_booking.id, v_share.id, v_share.stripe_payment_intent_id, 'player_lapsed')
      on conflict (stripe_intent_id) where status = 'pending' do nothing;
    end if;
    update public.invites set status = 'lapsed', responded_at = now()
    where kind = 'booking' and booking_id = v_booking.id and invited_profile_id = v_share.profile_id
      and status = 'accepted';

    perform public.send_notification(v_share.profile_id, 'booking_spot_lapsed', jsonb_build_object(
      'title', 'Your spot was released',
      'body', format('You didn''t pay within %s for %s, so your spot went back to the game.',
                     public.rule_duration_words(public.rule_payment_window()), public.booking_label(v_booking)),
      'bookingId', v_booking.id));
    v_captain := coalesce((select s.captain_id from public.booking_sides s
                           where s.booking_id = v_booking.id and s.side = v_share.side), v_booking.created_by);
    select coalesce(username, full_name, 'A player') into v_name from public.profiles where id = v_share.profile_id;
    if v_captain is not null and v_captain <> v_share.profile_id then
      perform public.send_notification(v_captain, 'booking_spot_released', jsonb_build_object(
        'title', 'A spot opened up',
        'body', format('%s didn''t pay in time for %s, so a spot is free again.', v_name, public.booking_label(v_booking)),
        'bookingId', v_booking.id));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Rule 1 at kickoff: pending player invites expire.
create function public.booking_invites_expire_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.invites i set status = 'expired', responded_at = now()
  from public.venue_bookings b
  where i.kind = 'booking' and i.status = 'pending' and b.id = i.booking_id and b.booking_kind is not null
    and now() >= public.booking_invite_closes_at(b);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---- 5. Grants --------------------------------------------------------------------------------

revoke all on function public.booking_invite_closes_at(public.venue_bookings) from public, anon, authenticated;
revoke all on function public.booking_side_room(uuid, text) from public, anon, authenticated;
revoke all on function public.booking_invite_side_of(public.venue_bookings, uuid) from public, anon, authenticated;
revoke all on function public.booking_player_pay_by(public.venue_bookings, timestamptz) from public, anon, authenticated;
revoke all on function public.booking_shares_clear_pay_by() from public, anon, authenticated;
revoke all on function public.booking_invite_refusal(public.venue_bookings, uuid) from public, anon, authenticated;
revoke all on function public.booking_invitee_refusal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.booking_invite_send(public.venue_bookings, uuid, uuid) from public, anon, authenticated;
revoke all on function public.booking_cash_allowed(public.venue_bookings) from public, anon, authenticated;
revoke all on function public.booking_invite_revive_share(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.booking_player_lapse_due() from public, anon, authenticated;
revoke all on function public.booking_invites_expire_due() from public, anon, authenticated;
grant execute on function public.booking_invite_closes_at(public.venue_bookings) to service_role;
grant execute on function public.booking_side_room(uuid, text) to service_role;
grant execute on function public.booking_invite_side_of(public.venue_bookings, uuid) to service_role;
grant execute on function public.booking_player_pay_by(public.venue_bookings, timestamptz) to service_role;
grant execute on function public.booking_shares_clear_pay_by() to service_role;
grant execute on function public.booking_invite_refusal(public.venue_bookings, uuid) to service_role;
grant execute on function public.booking_invitee_refusal(uuid, uuid, uuid) to service_role;
grant execute on function public.booking_invite_send(public.venue_bookings, uuid, uuid) to service_role;
grant execute on function public.booking_cash_allowed(public.venue_bookings) to service_role;
grant execute on function public.booking_invite_revive_share(uuid, uuid, text) to service_role;
grant execute on function public.booking_player_lapse_due() to service_role;
grant execute on function public.booking_invites_expire_due() to service_role;

revoke all on function public.accept_invite(uuid, text) from public, anon;
grant execute on function public.accept_invite(uuid, text) to authenticated, service_role;
revoke all on function public.add_booking_player(uuid, text) from public, anon;
grant execute on function public.add_booking_player(uuid, text) to authenticated, service_role;
revoke all on function public.invite_team_to_booking(uuid, uuid) from public, anon;
grant execute on function public.invite_team_to_booking(uuid, uuid) to authenticated, service_role;
revoke all on function public.invite_all_friends_to_booking(uuid) from public, anon;
grant execute on function public.invite_all_friends_to_booking(uuid) to authenticated, service_role;
