-- P3 follow-up (pay_venue_model_fixes).
--
-- 1. booking_slot_range is an internal helper: only security definer
--    functions call it, so it is service_role only (CLAUDE.md rule 4).
--    P3 had granted it to authenticated.
-- 2. A block stops new bookings only, and the players of every game it
--    covers are told (docs/specs/13-payments-bookings.md, "Blocking
--    pitches"). P3 told them only when the block was created; widening it
--    later (longer hours, or one pitch -> the whole venue) told nobody. Now
--    an update tells the players of games the block newly covers, and
--    nobody is told twice about the same block.

revoke all on function public.booking_slot_range(date, time, time) from public, anon, authenticated;
grant execute on function public.booking_slot_range(date, time, time) to service_role;

create or replace function public.notify_venue_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_name text;
  v_row record;
begin
  select name into v_venue_name from public.venues where id = new.venue_id;

  for v_row in
    select distinct on (b.id, player.profile_id) b.id as booking_id, b.booking_day, b.start_time, player.profile_id
    from public.venue_bookings b
    cross join lateral (
      select b.created_by as profile_id
      union
      select s.profile_id from public.booking_payment_shares s where s.booking_id = b.id
    ) as player
    where b.venue_id = new.venue_id
      and b.booking_day = new.block_day
      and b.booking_type = 'user_booking'
      and b.status <> 'cancelled'
      and (new.starts_at is null or (b.start_time < new.ends_at and b.end_time > new.starts_at))
      and (new.pitch_id is null
           or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = new.pitch_id))
      and player.profile_id is not null
      -- Already told about this block for this game.
      and not exists (
        select 1 from public.notifications n
        where n.profile_id = player.profile_id
          and n.type = 'venue_closed_new_bookings'
          and n.data ->> 'blockId' = new.id::text
          and n.data ->> 'bookingId' = b.id::text
      )
  loop
    perform public.send_notification(
      v_row.profile_id,
      'venue_closed_new_bookings',
      jsonb_build_object(
        'title', coalesce(v_venue_name, 'The venue') || ' has closed new bookings',
        'body', 'Your game on ' || to_char(v_row.booking_day, 'FMDay FMDD FMMonth') || ' at '
                || to_char(v_row.start_time, 'HH24:MI') || ' is still on.',
        'bookingId', v_row.booking_id,
        'venueId', new.venue_id,
        'blockId', new.id
      )
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.notify_venue_block() from public, anon, authenticated;

drop trigger if exists on_venue_block_notify on public.venue_blocks;
create trigger on_venue_block_notify
  after insert or update of venue_id, pitch_id, block_day, starts_at, ends_at on public.venue_blocks
  for each row execute function public.notify_venue_block();
