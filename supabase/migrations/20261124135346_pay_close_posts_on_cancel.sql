-- QA 24 November (T3, second pass S1): a cancelled booking's open posts
-- close on the server at once, so the game leaves Home's "Need players" and
-- Find a game. Bookings are cancelled from many functions (the booker, cancel
-- free, a pull-out, the venue, the unpaid-booking job), so one trigger on the
-- status change closes them all, whichever path cancelled it.

create function public.close_posts_of_cancelled_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.squad_posts set status = 'closed'
  where venue_booking_id = new.id and status = 'open';
  return null;
end;
$$;

revoke all on function public.close_posts_of_cancelled_booking() from public, anon, authenticated;
grant execute on function public.close_posts_of_cancelled_booking() to service_role;

create trigger venue_bookings_close_posts_on_cancel
after update of status on public.venue_bookings
for each row
when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
execute function public.close_posts_of_cancelled_booking();

-- Posts left open on bookings cancelled before this migration close too.
update public.squad_posts p set status = 'closed'
from public.venue_bookings b
where b.id = p.venue_booking_id and b.status = 'cancelled' and p.status = 'open';
