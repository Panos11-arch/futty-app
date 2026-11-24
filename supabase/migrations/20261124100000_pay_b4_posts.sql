-- B4 (Booking v2, spec 13 "Publish game" and "Invites, after payment"): the
-- posts section ("Find a game") for Booking v2 posts. No money moves here.
--   * booking_post_quotes(p_post_ids): for each Booking v2 post, what it
--     costs, from the server: a players post's price for its side (nothing
--     when that side paid for everyone, the joiner's own share when it pays
--     for myself; the same maths as the share joining creates), side B's
--     price on an opposition post (as my_opposition_invites), when it closes
--     (kickoff; 24 hours before kickoff for opposition), whether it's still
--     open, and whether it's the caller's to unpublish (unpublish_post's own
--     check). Posts made before Booking v2 have no row: squad_post_price
--     still prices them.
--   * opposition_post_detail(p_post_id): side B's accept screen for a public
--     opposition post, the same columns as my_opposition_invites.
--   * my_publishable_bookings(): the caller's Booking v2 games he captains,
--     with his side's open spots, his open posts and what he can publish
--     (publish_booking's own checks).
--   * booking_no_opponent_due also closes the booking's open opposition post:
--     opposition posts close 24 hours before kickoff. Re-created from
--     20261123183000_pay_b1c_no_opponent.sql with only that line added.

create function public.booking_post_quotes(p_post_ids uuid[])
returns table (
  post_id uuid,
  kind text,
  side text,
  mine boolean,
  open boolean,
  closes_at timestamptz,
  join_cents integer,
  join_pitch_cents integer,
  join_fee_cents integer,
  pay_all_cents integer,
  each_pays_cents integer,
  guarantee_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_premium boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if cardinality(p_post_ids) > 50 then
    raise exception 'too_many_posts';
  end if;
  v_premium := coalesce((select pr.is_premium from public.profiles pr where pr.id = auth.uid()), false);

  return query
    select
      p.id,
      p.type,
      p.side,
      -- As unpublish_post: the post's author or that side's captain.
      (p.posted_by is not distinct from auth.uid()
       or exists (select 1 from public.booking_sides s
                  where s.booking_id = b.id and s.captain_id = auth.uid() and s.side = coalesce(p.side, 'a'))),
      case
        when p.type = 'players'
          then p.status = 'open' and b.status <> 'cancelled' and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
        else p.status = 'open' and public.opposition_open_error(b) is null
             and not exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b')
      end,
      case
        when p.type = 'players' then public.booking_kickoff_at(b.booking_day, b.start_time)
        else public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_gipedo_opponent_lead()
      end,
      j.card_cents,
      j.pitch_cents,
      j.fee_cents,
      o.pay_all_cents,
      o.each_pays_cents,
      o.guarantee_cents
    from public.squad_posts p
    join public.venue_bookings b on b.id = p.venue_booking_id
    left join public.booking_sides sd
      on b.booking_kind = 'half' and sd.booking_id = b.id and sd.side = coalesce(p.side, 'a')
    -- A players post: the joiner pays as his side pays.
    left join lateral (
      select
        case when m.mode = 'pay_all' then 0 else x.card_cents end as card_cents,
        case when m.mode = 'pay_all' then 0 else x.pitch_cents end as pitch_cents,
        case when m.mode = 'pay_all' then 0 else x.fee_cents end as fee_cents
      from (select coalesce(sd.payment_mode, b.payment_mode) as mode,
                   coalesce(sd.pitch_cents, b.amount_cents) as pitch,
                   coalesce(sd.players, b.capacity) as players) m
      left join lateral public.money_share(m.pitch, m.players, m.mode, false, v_premium, 'card') x
        on m.mode = 'each_pays_responsible'
      where p.type = 'players' and m.mode in ('pay_all', 'each_pays_responsible')
        and (b.booking_kind = 'whole' or sd.booking_id is not null)
    ) j on true
    -- An opposition post: side B's price, as my_opposition_invites.
    left join lateral (
      select
        (select x.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'pay_all', true, v_premium, 'card') x)
          as pay_all_cents,
        (select x.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'each_pays_responsible', true, v_premium, 'card') x)
          as each_pays_cents,
        b.amount_cents / 2 as guarantee_cents
      where p.type = 'opposition' and b.booking_kind = 'half'
    ) o on true
    where p.id = any (coalesce(p_post_ids, '{}')) and b.booking_kind is not null;
end;
$$;

create function public.opposition_post_detail(p_post_id uuid)
returns table (
  post_id uuid,
  booking_id uuid,
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
  found boolean,
  open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, b.id, v.name, b.booking_day, b.start_time, b.end_time, b.format,
         public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp where bp.booking_id = b.id)),
         b.amount_cents / 2, b.capacity / 2,
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'pay_all', true, me.is_premium, 'card') m),
         (select m.card_cents from public.money_share(b.amount_cents / 2, b.capacity / 2, 'each_pays_responsible', true, me.is_premium, 'card') m),
         b.amount_cents / 2,
         exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b'),
         p.status = 'open' and public.opposition_open_error(b) is null
  from public.squad_posts p
  join public.venue_bookings b on b.id = p.venue_booking_id
  join public.venues v on v.id = b.venue_id
  cross join (select coalesce((select pr.is_premium from public.profiles pr where pr.id = auth.uid()), false) as is_premium) me
  where auth.uid() is not null
    and p.id = p_post_id and p.type = 'opposition' and b.booking_kind = 'half'
    and b.status <> 'cancelled'
    and public.booking_kickoff_at(b.booking_day, b.start_time) > now();
$$;

create function public.my_publishable_bookings()
returns table (
  booking_id uuid,
  venue_name text,
  booking_day date,
  start_time time,
  end_time time,
  format text,
  pitch_label text,
  kind text,
  side text,
  open_spots integer,
  players_post_id uuid,
  opposition_post_id uuid,
  can_publish_players boolean,
  can_publish_opposition boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, v.name, g.booking_day, g.start_time, g.end_time, g.format,
         public.pitch_choice_label(array(select bp.pitch_id from public.booking_pitches bp where bp.booking_id = g.id)),
         g.booking_kind, g.side, g.open_spots,
         (select sp.id from public.squad_posts sp
          where sp.venue_booking_id = g.id and sp.type = 'players' and sp.status = 'open'
            and sp.side is not distinct from g.side limit 1),
         (select sp.id from public.squad_posts sp
          where sp.venue_booking_id = g.id and sp.type = 'opposition' and sp.status = 'open' and g.side = 'a' limit 1),
         -- As publish_booking('players').
         g.status = 'confirmed' and g.open_spots > 0 and (g.side is distinct from 'b' or g.side_paid),
         -- As publish_booking('opposition').
         g.side = 'a' and public.opposition_open_error(g.b) is null and not g.has_side_b
  from (
    select b.id, b.venue_id, b.booking_day, b.start_time, b.end_time, b.format, b.booking_kind, b.status, b,
           s.side, s.paid_at is not null as side_paid,
           exists (select 1 from public.booking_sides o where o.booking_id = b.id and o.side = 'b') as has_side_b,
           coalesce(s.players, b.capacity)
             - (select count(*)::integer from public.booking_payment_shares bs
                where bs.booking_id = b.id and (s.side is null or bs.side = s.side)
                  and bs.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) as open_spots
    from public.venue_bookings b
    left join public.booking_sides s
      on b.booking_kind = 'half' and s.booking_id = b.id and s.captain_id = auth.uid() and s.left_at is null
    where auth.uid() is not null
      and b.booking_kind is not null
      and b.status <> 'cancelled'
      and public.booking_kickoff_at(b.booking_day, b.start_time) > now()
      and ((b.booking_kind = 'half' and s.booking_id is not null)
           or (b.booking_kind = 'whole' and b.created_by = auth.uid()))
  ) g
  join public.venues v on v.id = g.venue_id
  order by g.booking_day, g.start_time;
$$;

-- As in 20261123183000_pay_b1c_no_opponent.sql, plus B4: the booking's open
-- opposition post closes (opposition posts close 24 hours before kickoff).
create or replace function public.booking_no_opponent_due()
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
    where b.booking_kind = 'half' and b.status = 'confirmed' and b.no_opponent_at is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_gipedo_opponent_lead()
      and not exists (select 1 from public.booking_sides s where s.booking_id = b.id and s.side = 'b')
    for update of b
  loop
    -- B4: opposition posts close 24 hours before kickoff.
    update public.squad_posts set status = 'closed'
    where venue_booking_id = v_booking.id and type = 'opposition' and status = 'open';
    v_side := public.half_pitch_lone_side(v_booking.id);
    if v_side.booking_id is null then
      continue;
    end if;
    update public.venue_bookings set no_opponent_at = now() where id = v_booking.id;
    select * into v_money from public.no_opponent_amounts(v_booking, v_side);
    perform public.send_notification(v_side.captain_id, 'no_opponent', jsonb_build_object(
      'title', 'No opponent yet',
      'body', format('Nobody has taken on your game at %s. Pay the whole pitch and play for %s more, or cancel free and '
                     || 'everyone gets their money back. If you don''t choose by %s before kickoff, it''s cancelled free.',
                     public.booking_label(v_booking), public.money_format_euros(v_money.amount_cents),
                     public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', v_booking.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.booking_post_quotes(uuid[]) from public, anon;
grant execute on function public.booking_post_quotes(uuid[]) to authenticated, service_role;
revoke all on function public.opposition_post_detail(uuid) from public, anon;
grant execute on function public.opposition_post_detail(uuid) to authenticated, service_role;
revoke all on function public.my_publishable_bookings() from public, anon;
grant execute on function public.my_publishable_bookings() to authenticated, service_role;
revoke all on function public.booking_no_opponent_due() from public, anon, authenticated;
grant execute on function public.booking_no_opponent_due() to service_role;
