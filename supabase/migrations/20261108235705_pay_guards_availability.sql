-- P2 rule 7: other users see availability only, not who booked, their team
-- or the amounts.
--
-- Before: the policy "Signed-in users can read bookings" (using true) let
-- any signed-in user read every booking's created_by, team_id and
-- amount_cents. Availability already has its own function,
-- venue_day_availability(venue, day), returning only start, end and
-- pitches; the app's booking calendar now uses that.

-- Who may read a booking row: its booker, anyone with a payment share or an
-- invite in it, members of its team, the venue's owner, and people in a
-- squad post made from it. Security definer so the policy doesn't recurse
-- through booking_payment_shares' own policy (which reads venue_bookings).
create or replace function public.can_view_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.venue_bookings b
    where b.id = p_booking_id
      and (
        b.created_by = auth.uid()
        or exists (select 1 from public.booking_payment_shares s where s.booking_id = b.id and s.profile_id = auth.uid())
        or exists (select 1 from public.invites i where i.booking_id = b.id and i.invited_profile_id = auth.uid())
        or exists (select 1 from public.team_members m where m.team_id = b.team_id and m.profile_id = auth.uid())
        or exists (select 1 from public.venues v where v.id = b.venue_id and v.owner_profile_id = auth.uid())
        or exists (
          select 1 from public.squad_posts p
          where p.venue_booking_id = b.id
            and (
              p.posted_by = auth.uid()
              or exists (select 1 from public.squad_post_joiners j where j.post_id = p.id and j.profile_id = auth.uid())
              or exists (select 1 from public.team_members m where m.team_id = p.matched_team_id and m.profile_id = auth.uid())
            )
        )
      )
  );
$$;

revoke all on function public.can_view_booking(uuid) from public, anon;
grant execute on function public.can_view_booking(uuid) to authenticated, service_role;

drop policy if exists "Signed-in users can read bookings" on public.venue_bookings;
create policy "People in a booking can read it" on public.venue_bookings
  for select to authenticated
  using (public.can_view_booking(id));

-- What joining a squad post costs one player (share_cents, of which
-- fee_cents is the service fee), without exposing the booking's total. Same
-- maths as add_booking_share_internal. No row when the post has no paid
-- booking.
create or replace function public.squad_post_price(p_post_id uuid)
returns table (share_cents integer, fee_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when b.service_fee_cents_per_player is not null
        then b.amount_cents / public.booking_total_shares_needed(b.id) + b.service_fee_cents_per_player
      -- Older bookings had the fee folded into amount_cents.
      else round(b.amount_cents::numeric / public.format_player_count(b.format))::integer
    end,
    b.service_fee_cents_per_player
  from public.squad_posts p
  join public.venue_bookings b on b.id = p.venue_booking_id
  where p.id = p_post_id and b.status <> 'cancelled' and b.amount_cents > 0;
$$;

revoke all on function public.squad_post_price(uuid) from public, anon;
grant execute on function public.squad_post_price(uuid) to authenticated, service_role;
