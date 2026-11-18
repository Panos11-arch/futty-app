-- U7 leftovers (doc 28): what joining a squad post costs, entirely from the
-- server. No money moves.
--
-- 1. squad_post_price also returns pitch_cents, the pitch part of the share,
--    so the join screen shows "Pitch" and "Service fee" as the server works
--    them out instead of subtracting. share_cents and fee_cents are
--    unchanged. pitch_cents + fee_cents = share_cents, except for the oldest
--    bookings, whose fee was folded into the price: there pitch_cents is
--    null, as fee_cents already is, and only the share is shown.
--    Re-created from its latest definition (20261109131700_pay_modes_booking.sql;
--    diff in the PR for Panos). Its return type changes, so it is dropped and
--    created again, with the same grants.
-- 2. squad_post_prices(p_post_ids): the same for up to 50 posts at once, for
--    the price on each "Need players" card. Security invoker: it reads
--    squad_posts as the caller, so their RLS decides which posts they see,
--    and any post they can't see, or that has no price, is left out.

drop function public.squad_post_price(uuid);

create function public.squad_post_price(p_post_id uuid)
returns table (share_cents integer, fee_cents integer, pitch_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when b.payment_mode is not null then m.card_cents
      when b.service_fee_cents_per_player is not null
        then b.amount_cents / public.booking_total_shares_needed(b.id) + b.service_fee_cents_per_player
      -- Older bookings had the fee folded into amount_cents.
      else round(b.amount_cents::numeric / public.format_player_count(b.format))::integer
    end,
    case when b.payment_mode is not null then m.fee_cents else b.service_fee_cents_per_player end,
    -- U7: the pitch part, as the server works it out (unknown for the oldest
    -- bookings, whose fee is folded in).
    case
      when b.payment_mode is not null then m.pitch_cents
      when b.service_fee_cents_per_player is not null
        then b.amount_cents / public.booking_total_shares_needed(b.id)
    end
  from public.squad_posts p
  join public.venue_bookings b on b.id = p.venue_booking_id
  left join lateral public.money_share(
    b.amount_cents, b.capacity, coalesce(b.payment_mode, 'each_pays_own_spot'), false,
    exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_premium), 'card'
  ) m on b.payment_mode is not null
  where p.id = p_post_id and b.status <> 'cancelled' and b.amount_cents > 0;
$$;

revoke all on function public.squad_post_price(uuid) from public, anon;
grant execute on function public.squad_post_price(uuid) to authenticated, service_role;

create function public.squad_post_prices(p_post_ids uuid[])
returns table (post_id uuid, share_cents integer, fee_cents integer, pitch_cents integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if cardinality(p_post_ids) > 50 then
    raise exception 'too_many_posts';
  end if;
  return query
    select p.id, x.share_cents, x.fee_cents, x.pitch_cents
    from public.squad_posts p
    cross join lateral public.squad_post_price(p.id) x
    where p.id = any (coalesce(p_post_ids, '{}'));
end;
$$;

revoke all on function public.squad_post_prices(uuid[]) from public, anon;
grant execute on function public.squad_post_prices(uuid[]) to authenticated, service_role;
