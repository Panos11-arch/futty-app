-- B3, Booking v2 (spec 13 "Two kinds of booking", "Invites, after payment",
-- decided 20 and 23 November; the reminder decided by Panos on 23 November):
-- what the screens after paying need from the server.
--
--   * booking_v2_detail: a Booking v2 booking's kind, pitch name, both
--     sides (captain, team, way to pay, paid or held), which side each
--     player is on, whether the opposition is still open, the booking's
--     open posts and, for the lone captain of a half pitch, the no-opponent
--     choice with its amount. booking_detail returns it as 'v2' (null for
--     bookings made before Booking v2).
--   * my_no_opponent_choices: the caller's half pitches waiting for the
--     24-hour choice, for the card on Home.
--   * The reminder before the 6-hour cut-off (Panos, 23 November): 2 hours
--     before it (app_rules.no_opponent_reminder_hours), a captain who hasn't
--     chosen is reminded once (booking_no_opponent_reminder_due, run by
--     run-payment-jobs).
--
-- booking_detail is re-created from its latest definition
-- (20261117153008_pay_venue_player.sql) with only the 'v2' key added to its
-- two returns.

-- ---- The reminder's rule ------------------------------------------------------

alter table public.app_rules
  add column no_opponent_reminder_hours integer not null default 2
    check (no_opponent_reminder_hours between 0 and 18);

create or replace function public.rule_no_opponent_reminder_lead()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(hours => no_opponent_reminder_hours) from public.app_rules where id $$;

alter table public.venue_bookings add column no_opponent_reminded_at timestamptz;

insert into public.notification_types (type, always_sent) values ('no_opponent_reminder', true)
on conflict (type) do nothing;

-- run-payment-jobs: the no-opponent choice is still open and the cut-off (6
-- hours before kickoff) is under no_opponent_reminder_hours away: the lone
-- captain is reminded, once.
create or replace function public.booking_no_opponent_reminder_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_side public.booking_sides;
  v_money record;
  v_count integer := 0;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.booking_kind = 'half' and b.status = 'confirmed'
      and b.no_opponent_at is not null and b.no_opponent_choice is null and b.no_opponent_reminded_at is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
                   - public.rule_no_opponent_reminder_lead()
      and now() < public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
    for update of b
  loop
    v_side := public.half_pitch_lone_side(v_booking.id);
    if v_side.booking_id is null then
      continue;
    end if;
    update public.venue_bookings set no_opponent_reminded_at = now() where id = v_booking.id;
    select * into v_money from public.no_opponent_amounts(v_booking, v_side);
    perform public.send_notification(v_side.captain_id, 'no_opponent_reminder', jsonb_build_object(
      'title', 'Choose for your game',
      'body', format('Still no opponent for your game at %s. Pay the whole pitch and play for %s more, or cancel free. '
                     || 'If you don''t choose by %s before kickoff, it''s cancelled free.',
                     public.booking_label(v_booking), public.money_format_euros(v_money.amount_cents),
                     public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', v_booking.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---- What the booking screens show ---------------------------------------------

-- A Booking v2 booking as p_uid may see it; null for older bookings.
-- Callers check p_uid is in the booking (booking_detail does, through
-- booking_detail_modes). Amounts are the server's (no_opponent_amounts).
create or replace function public.booking_v2_detail(p_booking_id uuid, p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_lone public.booking_sides;
  v_money record;
  v_captain_of text;
  v_my_side text;
  v_cutoff timestamptz;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.booking_kind is null then
    return null;
  end if;
  v_cutoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff();

  select s.side into v_captain_of from public.booking_sides s
  where s.booking_id = p_booking_id and s.captain_id = p_uid and s.left_at is null
  order by s.side limit 1;
  select s.side into v_my_side from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.profile_id = p_uid
    and s.status in ('pending', 'authorized', 'paid', 'covered');

  select null::integer as pitch_cents, null::integer as fee_cents, null::integer as amount_cents into v_money;
  if v_booking.booking_kind = 'half' then
    v_lone := public.half_pitch_lone_side(p_booking_id);
    if v_lone.captain_id = p_uid then
      select * into v_money from public.no_opponent_amounts(v_booking, v_lone);
    end if;
  end if;

  return jsonb_build_object(
    'kind', v_booking.booking_kind,
    'pitch_label', public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp
                                                   where bp.booking_id = p_booking_id)),
    'captain_of', v_captain_of,
    'my_side', coalesce(v_my_side, v_captain_of),
    -- Each side: its captain, his team, its way to pay and whether the
    -- captain's own payment is held (not yet taken) or paid.
    'sides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'side', s.side,
               'captain', jsonb_build_object('id', p.id, 'name', coalesce(p.full_name, p.username)),
               'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = s.team_id),
               'payment_mode', s.payment_mode,
               'players', s.players,
               'state', case
                          when s.left_at is not null then 'left'
                          when cs.status = 'paid' then 'paid'
                          when cs.status = 'authorized' then 'held'
                          when s.paid_at is not null then 'paid'
                          else 'unpaid' end)
             order by s.side)
      from public.booking_sides s
      join public.profiles p on p.id = s.captain_id
      left join public.booking_payment_shares cs
        on cs.booking_id = s.booking_id and cs.profile_id = s.captain_id and cs.side = s.side
      where s.booking_id = p_booking_id), '[]'::jsonb),
    -- Which side each player in the roster is on (by share id).
    'roster_sides', coalesce((
      select jsonb_object_agg(s.id, s.side) from public.booking_payment_shares s
      where s.booking_id = p_booking_id and s.side is not null), '{}'::jsonb),
    'opposition', case when v_booking.booking_kind = 'half' then jsonb_build_object(
      'found', exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'b'
                       and s.left_at is null),
      'open', public.opposition_open_error(v_booking) is null
              and not exists (select 1 from public.booking_sides s where s.booking_id = p_booking_id and s.side = 'b'),
      'invited', (select count(*) from public.booking_opposition_invites i where i.booking_id = p_booking_id)) end,
    -- The open posts the caller can unpublish: his side's players post and,
    -- for side A's captain, the opposition post.
    'posts', jsonb_build_object(
      'players', (select sp.id from public.squad_posts sp
                  where sp.venue_booking_id = p_booking_id and sp.type = 'players' and sp.status = 'open'
                    and sp.side is not distinct from (case when v_booking.booking_kind = 'half' then v_captain_of end)
                    and (v_captain_of is not null or v_booking.created_by = p_uid)
                  limit 1),
      'opposition', (select sp.id from public.squad_posts sp
                     where sp.venue_booking_id = p_booking_id and sp.type = 'opposition' and sp.status = 'open'
                       and v_captain_of = 'a'
                     limit 1)),
    'no_opponent', case when v_money.amount_cents is not null then jsonb_build_object(
      'due', v_booking.status = 'confirmed' and v_booking.no_opponent_at is not null
             and v_booking.no_opponent_choice is null and now() < v_cutoff,
      'choice', v_booking.no_opponent_choice,
      'pitch_cents', v_money.pitch_cents,
      'fee_cents', v_money.fee_cents,
      'amount_cents', v_money.amount_cents,
      'choose_by', v_cutoff) end
  );
end;
$$;

-- Home: the caller's half pitches waiting for the 24-hour choice.
create or replace function public.my_no_opponent_choices()
returns table (
  booking_id uuid,
  venue_name text,
  booking_day date,
  start_time time,
  end_time time,
  pitch_label text,
  amount_cents integer,
  choose_by timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, v.name, b.booking_day, b.start_time, b.end_time,
         public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp where bp.booking_id = b.id)),
         (public.no_opponent_amounts(b, l)).amount_cents,
         public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
  from public.venue_bookings b
  join public.venues v on v.id = b.venue_id
  cross join lateral public.half_pitch_lone_side(b.id) l
  where b.booking_kind = 'half' and b.status = 'confirmed'
    and b.no_opponent_at is not null and b.no_opponent_choice is null
    and l.captain_id = auth.uid()
    and now() < public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
  order by b.booking_day, b.start_time;
$$;

-- booking_detail, from 20261117153008_pay_venue_player.sql. B3: 'v2'.
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
  -- P6e: the players the venue offered, as the caller may see them (the
  -- booker: open and accepted, with what they can do; another player:
  -- accepted names). booking_detail_modes above already refused anyone not
  -- in the booking.
  v_detail := v_detail || jsonb_build_object('venue_players',
                public.booking_venue_players_json(p_booking_id, v_uid, false));
  -- B3: Booking v2's sides, opposition, posts and no-opponent choice.
  v_detail := v_detail || jsonb_build_object('v2', public.booking_v2_detail(p_booking_id, v_uid));

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

revoke all on function public.rule_no_opponent_reminder_lead() from public, anon, authenticated;
grant execute on function public.rule_no_opponent_reminder_lead() to service_role;
revoke all on function public.booking_no_opponent_reminder_due() from public, anon, authenticated;
grant execute on function public.booking_no_opponent_reminder_due() to service_role;
revoke all on function public.booking_v2_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.booking_v2_detail(uuid, uuid) to service_role;
revoke all on function public.my_no_opponent_choices() from public, anon;
grant execute on function public.my_no_opponent_choices() to authenticated, service_role;
