-- A block stops new bookings only: players can still join a game that was
-- booked before it (docs/specs/13-payments-bookings.md, "Blocking
-- pitches", decided 9 November). accept_invite and join_squad_post already
-- allow that; supabase/tests/pay-venue-model-11-join-blocked.test.sql keeps
-- it so.
--
-- The join screen (app/join-squad-post.tsx) shows the venue's notice that it
-- has closed new bookings when a block covers the post's game: the same
-- pitch (or the whole venue), that day, overlapping the game's time. It
-- returns the venue's name only, never who blocked it or why. No row = no
-- notice.
create or replace function public.squad_post_block_notice(p_post_id uuid)
returns table (venue_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.name
  from public.squad_posts p
  join public.venue_bookings b on b.id = p.venue_booking_id
  join public.venues v on v.id = b.venue_id
  where p.id = p_post_id
    and b.status <> 'cancelled'
    and exists (
      select 1
      from public.venue_blocks k
      where k.venue_id = b.venue_id
        and k.block_day = b.booking_day
        and (k.starts_at is null or (k.starts_at < b.end_time and k.ends_at > b.start_time))
        and (k.pitch_id is null
             or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = k.pitch_id))
    );
$$;

revoke all on function public.squad_post_block_notice(uuid) from public, anon;
grant execute on function public.squad_post_block_notice(uuid) to authenticated, service_role;
