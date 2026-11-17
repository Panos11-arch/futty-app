-- Pay my share can offer cash again, and Pay what I owe can use spec 13's
-- own cash sentence ("Cash at the venue"). Server only; the app shows what
-- these return.
--
--   booking_detail (20261116124400_pay_switching) adds:
--     cash_allowed  whether the caller may pay their own share in cash now
--     me.cash       { cash_cents, card_cents }: the pitch part paid in cash
--                   and the fee paid by card, or null
--   Both come from share_payment_plan itself (what create-share-payment
--   plans with, via plan_share_payment), asked "cash?" with the non-refundable
--   notice accepted and no credit: the same rules and amounts as the real
--   payment (pending share, booking not cancelled, collection not started,
--   not in debt, payment window open, never pay_all or a Gipedo hold). Cash
--   is only ever in the two each-pays modes (spec 13: "offered by the
--   server's rules only, in the two each-pays modes"), so a booking with no
--   mode gets none. Only the caller's own share; the roster is unchanged.
--
--   my_owed (20261112090000_pay_booking_screens) adds to each cash_unpaid
--   item: payment_mode, booker_name (profile_display_name of the booker)
--   and is_booker (the caller is the booker). Nothing else changes.

-- booking_detail, from 20261116124400_pay_switching.sql
create or replace function public.booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  -- P12: what switching 5 v 5 / 6 v 6 would do, on every booking.
  v_detail jsonb := public.booking_detail_modes(p_booking_id)
                    || jsonb_build_object('switch', public.booking_switch_info(p_booking_id, auth.uid()));
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_mine public.booking_payment_shares;
  v_opponent public.booking_payment_shares;
  v_booker_hold public.booking_payment_shares;
  v_settlement public.gipedo_settlements;
  v_pull jsonb;
  v_roster jsonb;
  v_cash_share public.booking_payment_shares;
  v_cash_plan jsonb;
  v_cash jsonb;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;

  -- Could the caller pay their own share in cash now, and for how much?
  -- Only the planner's refusals (raise exception) mean "no"; any other
  -- error still fails the call.
  select * into v_cash_share from public.booking_payment_shares
  where id = (v_detail -> 'me' ->> 'share_id')::uuid;
  if v_cash_share.id is not null and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') then
    begin
      v_cash_plan := public.share_payment_plan(v_cash_share, v_uid, 'cash', true, false);
      v_cash := jsonb_build_object('cash_cents', (v_cash_plan ->> 'cash_cents')::integer,
                                   'card_cents', (v_cash_plan ->> 'amount_cents')::integer);
    exception when raise_exception then
      v_cash := null;
    end;
  end if;
  v_detail := v_detail || jsonb_build_object('cash_allowed', v_cash is not null);
  if jsonb_typeof(v_detail -> 'me') = 'object' then
    v_detail := jsonb_set(v_detail, '{me,cash}', coalesce(v_cash, 'null'::jsonb));
  end if;

  if not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.gipedo_side is not null) then
    return v_detail || jsonb_build_object('gipedo', null);
  end if;
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1;
  select * into v_mine from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid and gipedo_side is not null;
  select * into v_opponent from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.gipedo_side = 'b' and s.status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.reason = 'pull_out_fee');
  select * into v_booker_hold from public.booking_payment_shares
  where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
  select * into v_settlement from public.gipedo_settlements where share_id = v_mine.id;
  v_pull := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  -- A captain's card that is only held shows as held, not paid; one whose
  -- hold expired as unpaid.
  select coalesce(jsonb_agg(case when s.gipedo_side is not null and s.status = 'authorized'
                                 then r.e || jsonb_build_object('state', 'held')
                                 when s.gipedo_side is not null and s.status = 'expired'
                                 then r.e || jsonb_build_object('state', 'unpaid')
                                 else r.e end order by r.ord), '[]'::jsonb)
    into v_roster
  from jsonb_array_elements(v_detail -> 'roster') with ordinality as r(e, ord)
  left join public.booking_payment_shares s on s.id = (r.e ->> 'share_id')::uuid;

  return v_detail
    || jsonb_build_object('roster', v_roster)
    || jsonb_build_object('can_cancel', case when v_mine.id is not null and v_booking.payment_mode = 'gipedo_pano'
                                             then jsonb_build_object('my_spot', false, 'whole_team', false)
                                             else v_detail -> 'can_cancel' end)
    || jsonb_build_object('gipedo', jsonb_build_object(
      'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = v_booking.team_id),
      'opponent', jsonb_build_object(
        'state', case when v_opponent.status = 'authorized' then 'held' when v_opponent.id is not null then 'offered' else 'none' end,
        'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t
                 where t.id = v_post.matched_team_id and v_opponent.id is not null)),
      'my_side', v_mine.gipedo_side,
      'pull_out', v_pull - 'share_id' - 'side',
      'choice_due', v_booking.created_by = v_uid and v_booking.payment_mode = 'gipedo_pano'
                    and v_booking.status = 'confirmed' and v_booking.gipedo_no_opponent_at is not null
                    and v_booking.gipedo_choice is null
                    and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff(),
      'choice', v_booking.gipedo_choice,
      'play_normal_cents', case when v_booking.created_by = v_uid then v_booker_hold.amount_cents end,
      'settlement', case when v_settlement.id is null then null else jsonb_build_object(
        'reason', v_settlement.reason, 'capture_cents', v_settlement.capture_cents, 'status', v_settlement.status) end));
end;
$$;

-- my_owed, from 20261112090000_pay_booking_screens.sql
create or replace function public.my_owed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  return jsonb_build_object(
    'blocked', public.profile_has_debt(v_uid),
    'debt_cents', coalesce((select sum(d.amount_cents) from public.venue_debts d
                            where d.profile_id = v_uid and d.settled_at is null), 0),
    'debts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'debt_id', d.id, 'owed_to', d.owed_to, 'venue_id', d.venue_id, 'venue_name', v.name,
               'booking_id', d.booking_id, 'amount_cents', d.amount_cents, 'reason', d.reason,
               'created_at', d.created_at)
             order by d.created_at, d.id)
      from public.venue_debts d
      left join public.venues v on v.id = d.venue_id
      where d.profile_id = v_uid and d.settled_at is null), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(x.item order by x.kickoff, x.kind)
      from (
        select 'card_failed' as kind, public.booking_kickoff_at(b.booking_day, b.start_time) as kickoff,
               jsonb_build_object('kind', 'card_failed', 'booking_id', b.id, 'share_id', null,
                                  'venue_name', v.name, 'booking_day', b.booking_day, 'start_time', b.start_time,
                                  'amount_cents', g.amount_cents) as item
        from public.booking_guarantees g
        join public.venue_bookings b on b.id = g.booking_id
        join public.venues v on v.id = b.venue_id
        where g.profile_id = v_uid and g.status = 'failed' and b.status <> 'cancelled'
          and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
        union all
        select 'payment_due', public.booking_kickoff_at(b.booking_day, b.start_time),
               jsonb_build_object('kind', 'payment_due', 'booking_id', b.id, 'share_id', s.id,
                                  'venue_name', v.name, 'booking_day', b.booking_day, 'start_time', b.start_time,
                                  'amount_cents', s.amount_cents)
        from public.booking_payment_shares s
        join public.venue_bookings b on b.id = s.booking_id
        join public.venues v on v.id = b.venue_id
        where s.profile_id = v_uid and s.status = 'pending' and b.payment_mode is not null
          and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
          and (b.status = 'confirmed'
               or (b.status = 'pending_payment' and s.is_booker and now() <= public.booking_payment_window_ends_at(b)))
        union all
        select 'cash_unpaid', public.booking_kickoff_at(b.booking_day, b.start_time),
               jsonb_build_object('kind', 'cash_unpaid', 'booking_id', b.id, 'share_id', s.id,
                                  'venue_name', v.name, 'booking_day', b.booking_day, 'start_time', b.start_time,
                                  'amount_cents', (select a.due_pitch_cents from public.collection_amounts(b.id) a
                                                   where a.share_id = s.id),
                                  'payment_mode', b.payment_mode,
                                  'booker_name', public.profile_display_name(b.created_by),
                                  'is_booker', b.created_by = v_uid)
        from public.booking_payment_shares s
        join public.venue_bookings b on b.id = s.booking_id
        join public.venues v on v.id = b.venue_id
        where s.profile_id = v_uid and s.payment_method = 'cash' and s.status in ('authorized', 'paid')
          and s.cash_received_at is null and b.status <> 'cancelled'
          and now() >= public.booking_ends_at(b.booking_day, b.end_time)
          and not public.collection_is_due(b)
          and not exists (select 1 from public.booking_collections c where c.booking_id = b.id)
      ) x), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.booking_detail(uuid) from public, anon;
grant execute on function public.booking_detail(uuid) to authenticated, service_role;
revoke all on function public.my_owed() from public, anon;
grant execute on function public.my_owed() to authenticated, service_role;
