-- B1c, part 1 (Booking v2, spec 13 "Invites, after payment", decided 20 and
-- 23 November): the opposition on a half pitch.
--   * Side A's captain invites friends or teams (invite_opposition). The
--     first captain to accept becomes side B's captain: an invited friend,
--     or an invited team's captain (decided 23 November). The booking's row
--     lock decides; everyone else sees "Opposition found".
--   * He chooses how side B pays (pay for everyone or pay for myself; cash
--     is whole pitch only, "Just my spot" is removed, Losers pay is B1d) and
--     pays or holds his part within the 15-minute payment window, or his
--     acceptance lapses and the invite reopens (decided 23 November,
--     booking_side_b_lapse_due, run by run-payment-jobs).
--   * Each captain is the booker of his own half (Panos, 23 November): side
--     B's captain has his own guarantee (his side's half) and, once paid,
--     invites his own players to side B.
--   * Invites close 24 hours before kickoff ("No side B by 24 hours before
--     kickoff", the same timing as Gipedo Pano's decision 1). The booker's
--     24-hour choice, cancelling per side and the odd cent are part 2.
--
-- booking_guarantees was one per booking; it is now one per captain per
-- booking. Every function that read it by booking alone is re-created here
-- to read the captain's: guarantee_for_card_update
-- (20261109131704_pay_modes_timing.sql) and start_collection
-- (20261116134544_pay_cash_top_ups.sql), which keeps side A's captain's
-- guarantee until collection is per side (part 2). Also re-created from
-- their latest definitions, with only the B1c changes: booker_share_settled
-- (20261113115749_pay_gipedo_mode.sql), add_booking_player and accept_invite
-- (20261113223420_pay_dashboard_guards.sql).

alter table public.booking_guarantees drop constraint booking_guarantees_booking_id_key;
alter table public.booking_guarantees
  add constraint booking_guarantees_booking_profile_key unique (booking_id, profile_id);

alter table public.booking_sides
  add column team_id uuid references public.teams (id) on delete set null,
  add column paid_at timestamptz;

-- The invite can be muted like other invites; finding the opposition and its
-- lapse are about money and deadlines, so they're always sent.
insert into public.notification_types (type, always_sent) values
  ('opposition_invite', false),
  ('opposition_found', true),
  ('opposition_lapsed', true)
on conflict (type) do nothing;

create table public.booking_opposition_invites (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.venue_bookings (id) on delete cascade,
  invited_profile_id uuid references public.profiles (id) on delete cascade,
  invited_team_id uuid references public.teams (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint booking_opposition_invites_one_target check (num_nonnulls(invited_profile_id, invited_team_id) = 1)
);
create unique index booking_opposition_invites_profile_idx
  on public.booking_opposition_invites (booking_id, invited_profile_id) where invited_profile_id is not null;
create unique index booking_opposition_invites_team_idx
  on public.booking_opposition_invites (booking_id, invited_team_id) where invited_team_id is not null;
alter table public.booking_opposition_invites enable row level security;
revoke all on public.booking_opposition_invites from public, anon, authenticated;
grant select on public.booking_opposition_invites to authenticated;
grant select, insert, update, delete on public.booking_opposition_invites to service_role;
create policy "Invitees and the booking's people read opposition invites" on public.booking_opposition_invites
  for select to authenticated
  using (invited_profile_id = auth.uid()
         or exists (select 1 from public.team_members tm
                    where tm.team_id = invited_team_id and tm.profile_id = auth.uid() and tm.role = 'captain')
         or public.can_view_booking(booking_id));

-- Why the opposition can't be invited or accepted on this booking now, or
-- null if it can.
create or replace function public.opposition_open_error(p_booking public.venue_bookings)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_booking.id is null then 'not_found'
    when p_booking.status = 'cancelled' then 'booking_cancelled'
    when p_booking.booking_kind is distinct from 'half' then 'not_half_pitch'
    when p_booking.status <> 'confirmed' then 'booking_not_confirmed'
    when now() >= public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) - public.rule_gipedo_opponent_lead()
      then 'opposition_closed'
  end;
$$;

-- Side A's captain invites friends and teams to be the opposition. Returns
-- how many new invites were sent (the booker himself, people already in the
-- booking and anyone already invited are skipped).
create or replace function public.invite_opposition(
  p_booking_id uuid,
  p_profile_ids uuid[] default '{}',
  p_team_ids uuid[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_error text;
  v_inviter text;
  v_invite public.booking_opposition_invites;
  v_captain uuid;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.created_by is distinct from auth.uid()
     and not exists (select 1 from public.booking_sides s
                     where s.booking_id = p_booking_id and s.side = 'a' and s.captain_id = auth.uid()) then
    raise exception 'not_your_booking';
  end if;
  v_error := public.opposition_open_error(v_booking);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'b') then
    raise exception 'opposition_found';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);
  select coalesce(username, full_name, 'A player') into v_inviter from public.profiles where id = auth.uid();

  for v_invite in
    insert into public.booking_opposition_invites (booking_id, invited_profile_id, invited_by)
    select p_booking_id, p.id, auth.uid()
    from (select distinct unnest(coalesce(p_profile_ids, '{}')) as id) x
    join public.profiles p on p.id = x.id
    where p.id <> auth.uid()
      and not exists (select 1 from public.booking_payment_shares s
                      where s.booking_id = p_booking_id and s.profile_id = p.id
                        and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due'))
    on conflict (booking_id, invited_profile_id) where invited_profile_id is not null do nothing
    returning *
  loop
    perform public.send_notification(v_invite.invited_profile_id, 'opposition_invite', jsonb_build_object(
      'title', 'Play against us?',
      'body', format('%s invited you to bring a team and play against them at %s.', v_inviter, public.booking_label(v_booking)),
      'bookingId', p_booking_id, 'inviteId', v_invite.id));
    v_count := v_count + 1;
  end loop;

  for v_invite in
    insert into public.booking_opposition_invites (booking_id, invited_team_id, invited_by)
    select p_booking_id, t.id, auth.uid()
    from (select distinct unnest(coalesce(p_team_ids, '{}')) as id) x
    join public.teams t on t.id = x.id
    on conflict (booking_id, invited_team_id) where invited_team_id is not null do nothing
    returning *
  loop
    for v_captain in
      select tm.profile_id from public.team_members tm
      where tm.team_id = v_invite.invited_team_id and tm.role = 'captain' and tm.profile_id <> auth.uid()
    loop
      perform public.send_notification(v_captain, 'opposition_invite', jsonb_build_object(
        'title', 'Play against us?',
        'body', format('%s invited your team to play against them at %s.', v_inviter, public.booking_label(v_booking)),
        'bookingId', p_booking_id, 'inviteId', v_invite.id, 'teamId', v_invite.invited_team_id));
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The opposition invites the caller can accept (his own, and his teams' as
-- their captain), with what side B pays, from the server: its half of the
-- pitch, its players, a captain paying for everyone, his own share paying
-- for myself and the guarantee he'd hold. "found" = another captain was
-- first ("Opposition found").
create or replace function public.my_opposition_invites()
returns table (
  invite_id uuid,
  booking_id uuid,
  team_id uuid,
  venue_name text,
  booking_day date,
  start_time time,
  end_time time,
  format text,
  pitch_label text,
  side_pitch_cents integer,
  side_players integer,
  pay_all_cents integer,
  each_pays_cents integer,
  guarantee_cents integer,
  found boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, b.id, i.invited_team_id, v.name, b.booking_day, b.start_time, b.end_time, b.format,
         public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp where bp.booking_id = b.id)),
         b.amount_cents / 2, b.capacity / 2,
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'pay_all', true, me.is_premium, 'card') m),
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'each_pays_responsible', true, me.is_premium, 'card') m),
         b.amount_cents / 2,
         exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b')
  from public.booking_opposition_invites i
  join public.venue_bookings b on b.id = i.booking_id
  join public.venues v on v.id = b.venue_id
  cross join (select coalesce(p.is_premium, false) as is_premium from public.profiles p where p.id = auth.uid()) me
  where (i.invited_profile_id = auth.uid() or public.is_team_captain(i.invited_team_id, auth.uid()))
    and b.status <> 'cancelled'
    and public.booking_kickoff_at(b.booking_day, b.start_time) > now()
  order by b.booking_day, b.start_time;
$$;

-- The first captain to accept becomes side B's captain. Returns his share
-- to pay (or hold) within the payment window.
create or replace function public.accept_opposition(p_invite_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.booking_opposition_invites;
  v_booking public.venue_bookings;
  v_error text;
  v_premium boolean;
  v_half integer;
  v_players integer;
  v_money record;
  v_share_id uuid;
  v_name text;
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
  select * into v_booking from public.venue_bookings where id = v_invite.booking_id for update;
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
  values (v_booking.id, 'b', auth.uid(), p_mode, v_half, v_players, now(), v_invite.invited_team_id,
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

-- run-payment-jobs: side B's captain didn't pay or hold within the payment
-- window. His share and guarantee are cancelled (any payment he started is
-- released at Stripe by the release step), side B is free again and side
-- A's captain is told the invite is open again.
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

-- As in 20261113115749_pay_gipedo_mode.sql, plus B1c: side B's captain's
-- payment (or hold) marks side B paid and saves his card for his guarantee.
create or replace function public.booker_share_settled(p_share public.booking_payment_shares, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  if p_share.side = 'b' then
    update public.booking_sides set paid_at = coalesce(paid_at, now())
    where booking_id = p_share.booking_id and side = 'b' and captain_id = p_share.profile_id;
    if found then
      return public.guarantee_card_saved(p_share.booking_id, p_share.profile_id, p_payment_method_id);
    end if;
  end if;
  if not p_share.is_booker then
    return jsonb_build_object('guarantee_id', null, 'guarantee_due', false);
  end if;
  select * into v_booking from public.venue_bookings where id = p_share.booking_id;
  if v_booking.payment_mode in ('pay_all', 'gipedo_pano') or p_payment_method_id is not null then
    update public.venue_bookings set status = 'confirmed' where id = p_share.booking_id and status = 'pending_payment';
  end if;
  if v_booking.payment_mode = 'gipedo_pano' then
    perform public.gipedo_open_post(p_share.booking_id);
  end if;
  return public.guarantee_card_saved(p_share.booking_id, p_share.profile_id, p_payment_method_id);
end;
$$;

-- As in 20261109131704_pay_modes_timing.sql, but a booking can have a
-- guarantee per captain (B1c): the caller's own, as the booker or as a side's
-- captain.
create or replace function public.guarantee_for_card_update(p_booking_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
  v_booking public.venue_bookings;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.created_by is distinct from p_profile_id
     and not exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.captain_id = p_profile_id) then
    raise exception 'not_your_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  select * into v_guarantee from public.booking_guarantees where booking_id = p_booking_id and profile_id = p_profile_id;
  if v_guarantee.id is null or v_guarantee.status not in ('scheduled', 'failed') then
    raise exception 'no_guarantee_to_update';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'guarantee_closed';
  end if;
  return jsonb_build_object(
    'guarantee_id', v_guarantee.id,
    'stripe_customer_id', (select stripe_customer_id from public.profiles where id = p_profile_id),
    'stripe_payment_method_id', v_guarantee.stripe_payment_method_id
  );
end;
$$;

-- As in 20261116134544_pay_cash_top_ups.sql, but the guarantee is the
-- booker's (side A's captain's): a half pitch can have one per side (B1c).
-- Collection per side comes in B1c part 2.
create or replace function public.start_collection(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_collection public.booking_collections;
  v_row record;
  v_pitch integer;
  v_joined integer := 0;
  v_due integer := 0;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  select * into v_collection from public.booking_collections where booking_id = p_booking_id;
  if v_collection.id is not null then
    return public.collection_summary(v_collection);
  end if;
  if v_booking.payment_mode is null or v_booking.payment_mode not in ('each_pays_responsible', 'each_pays_own_spot') then
    raise exception 'nothing_to_collect';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  if not public.collection_is_due(v_booking) then
    raise exception 'collection_not_due';
  end if;
  perform 1 from public.booking_payment_shares where booking_id = p_booking_id for update;

  insert into public.booking_collections (booking_id, venue_id, payment_mode, joined_players, pitch_due_cents, guarantee_id)
  values (p_booking_id, v_booking.venue_id, v_booking.payment_mode, 0, 0,
          (select g.id from public.booking_guarantees g where g.booking_id = p_booking_id and g.profile_id = v_booking.created_by))
  returning * into v_collection;

  for v_row in select * from public.collection_amounts(p_booking_id) loop
    v_joined := v_joined + 1;
    v_due := v_due + v_row.due_pitch_cents;
    if v_row.share_status = 'pending' then
      -- Never paid: the pitch part (unless the venue ticked it as paid in
      -- cash) and the service fee.
      v_pitch := case when v_row.payment_method = 'cash' and v_row.cash_received then 0 else v_row.due_pitch_cents end;
      if v_pitch + v_row.fee_cents > 0 then
        insert into public.booking_collection_items
          (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status)
        values (v_collection.id, p_booking_id, v_row.share_id, v_row.profile_id, 'unpaid_share',
                v_pitch + v_row.fee_cents, v_pitch, v_row.fee_cents, 'unpaid');
      end if;
    elsif v_row.payment_method = 'cash' and not v_row.cash_received then
      -- The fee was paid by card; the pitch part is paid at the venue.
      if v_row.due_pitch_cents > 0 then
        insert into public.booking_collection_items
          (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status)
        values (v_collection.id, p_booking_id, v_row.share_id, v_row.profile_id, 'unpaid_cash',
                v_row.due_pitch_cents, v_row.due_pitch_cents, 0, 'unpaid');
      end if;
    elsif v_row.due_pitch_cents > v_row.paid_pitch_cents then
      -- A short game, or a switch to fewer players: the difference, charged
      -- to their saved card, no fee. Decided 16 November: a ticked cash
      -- player too, against the cash they paid.
      insert into public.booking_collection_items
        (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status, next_attempt_at)
      values (v_collection.id, p_booking_id, v_row.share_id, v_row.profile_id, 'top_up',
              v_row.due_pitch_cents - v_row.paid_pitch_cents, v_row.due_pitch_cents - v_row.paid_pitch_cents, 0,
              'pending', now());
    end if;
  end loop;

  -- Late cancellations whose card part never arrived: counted as kept
  -- toward the pitch price (collection_amounts), so collected here. Any
  -- credit that paid for the share was kept already; only the card part
  -- (its pitch money and fee) is owed.
  insert into public.booking_collection_items
    (collection_id, booking_id, share_id, profile_id, kind, amount_cents, pitch_cents, fee_cents, status)
  select v_collection.id, p_booking_id, s.id, s.profile_id, 'unpaid_share',
         s.amount_cents, s.amount_cents - least(coalesce(s.fee_cents, 0), s.amount_cents),
         least(coalesce(s.fee_cents, 0), s.amount_cents), 'unpaid'
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status = 'forfeited' and s.amount_cents > 0
    and exists (select 1 from public.booking_cancellation_lines l
                where l.share_id = s.id and l.action = 'keep' and l.outcome = 'not_taken');

  update public.booking_collections set joined_players = v_joined, pitch_due_cents = v_due
  where id = v_collection.id
  returning * into v_collection;
  return public.collection_summary(v_collection);
end;
$$;

-- As in 20261113223420_pay_dashboard_guards.sql, plus B1c: side B's captain
-- invites his own players once side B is paid.
CREATE OR REPLACE FUNCTION public.add_booking_player(p_booking_id uuid, p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_profile_id uuid;
  v_inviter text;
  v_venue_name text;
  v_invite public.invites;
  v_side_b public.booking_sides;  -- B1c
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  -- B1c: side B's captain is the booker of his half: he invites his own
  -- players once side B is paid.
  if v_booking.created_by is distinct from auth.uid() then
    select * into v_side_b from public.booking_sides where booking_id = p_booking_id and side = 'b';
    if v_side_b.captain_id is distinct from auth.uid() then
      raise exception 'not_your_booking';
    end if;
    if v_side_b.paid_at is null then
      raise exception 'side_not_paid';
    end if;
  end if;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  select id into v_profile_id from public.profiles where lower(username) = lower(trim(p_username));
  if v_profile_id is null then
    raise exception 'player_not_found';
  end if;
  if v_profile_id = auth.uid()
     or exists (select 1 from public.booking_payment_shares where booking_id = p_booking_id and profile_id = v_profile_id) then
    raise exception 'already_in_booking';
  end if;
  if exists (
    select 1 from public.invites
    where kind = 'booking' and booking_id = p_booking_id and invited_profile_id = v_profile_id and status = 'pending'
  ) then
    raise exception 'already_invited';
  end if;

  select coalesce(username, full_name, 'A player') into v_inviter from public.profiles where id = auth.uid();
  select name into v_venue_name from public.venues where id = v_booking.venue_id;

  insert into public.invites (kind, booking_id, invited_profile_id, invited_by)
  values ('booking', p_booking_id, v_profile_id, auth.uid())
  returning * into v_invite;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    v_profile_id, 'booking_invite', 'Game invite',
    format('%s invited you to play at %s on %s at %s.', v_inviter, v_venue_name,
           to_char(v_booking.booking_day, 'Dy DD Mon'), to_char(v_booking.start_time, 'HH24:MI')),
    jsonb_build_object('inviteId', v_invite.id, 'bookingId', p_booking_id)
  );
end;
$function$;

-- As in 20261113223420_pay_dashboard_guards.sql, plus B1c: a player joins
-- the side of the captain who invited him.
CREATE OR REPLACE FUNCTION public.accept_invite(p_invite_id uuid)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.invites;
  v_booking public.venue_bookings;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite from public.invites where id = p_invite_id for update;
  if v_invite.id is null or v_invite.invited_profile_id <> auth.uid() then
    raise exception 'not_your_invite';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;

  if v_invite.kind = 'team' then
    -- Lock the team so two acceptances can't both take its last place.
    perform 1 from public.teams where id = v_invite.team_id for update;
    if not public.team_has_room(v_invite.team_id, v_invite.team_role, v_invite.id) then
      raise exception 'team_full';
    end if;
    insert into public.team_members (team_id, profile_id, role)
    values (v_invite.team_id, auth.uid(), v_invite.team_role)
    on conflict (team_id, profile_id) do nothing;
  else
    select * into v_booking from public.venue_bookings where id = v_invite.booking_id for update;
    -- A walk-in or phone booking is never an app booking.
    if v_booking.booking_type = 'counter' then
      raise exception 'counter_booking';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    if v_booking.booking_day < v_now::date
       or (v_booking.booking_day = v_now::date and v_booking.start_time <= v_now::time) then
      raise exception 'slot_in_past';
    end if;
    perform public.assert_venue_live(v_booking.venue_id);
    -- B1c: on a half pitch a player joins the side of the captain who
    -- invited him.
    if v_booking.booking_kind = 'half' then
      perform public.add_booking_side_share_internal(v_invite.booking_id, auth.uid(),
        case when exists (select 1 from public.booking_sides s
                          where s.booking_id = v_invite.booking_id and s.side = 'b' and s.captain_id = v_invite.invited_by)
             then 'b' else 'a' end);
    else
      perform public.add_booking_share_internal(v_invite.booking_id, auth.uid());
    end if;
  end if;

  update public.invites set status = 'accepted', responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$function$;

revoke all on function public.opposition_open_error(public.venue_bookings) from public, anon, authenticated;
grant execute on function public.opposition_open_error(public.venue_bookings) to service_role;
revoke all on function public.invite_opposition(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.invite_opposition(uuid, uuid[], uuid[]) to authenticated, service_role;
revoke all on function public.my_opposition_invites() from public, anon;
grant execute on function public.my_opposition_invites() to authenticated, service_role;
revoke all on function public.accept_opposition(uuid, text) from public, anon;
grant execute on function public.accept_opposition(uuid, text) to authenticated, service_role;
revoke all on function public.booking_side_b_lapse_due() from public, anon, authenticated;
grant execute on function public.booking_side_b_lapse_due() to service_role;
