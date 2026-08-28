-- Personal result logging for a plain pitch booking with no opponent team.
-- Run AFTER supabase/booking-actions.sql (needs venue_bookings.created_by).
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Unlike friendly_matches/league_fixtures, a plain booking has no second team
-- to agree or dispute the score with — so this is deliberately self-reported
-- by whoever made the booking, applied immediately, no 3-tries mechanic.
-- won/drawn/lost is derived from the two scores (same as
-- apply_friendly_match_result/submit_fixture_score), not asked separately,
-- so the two can't be entered inconsistently with each other.

alter table public.venue_bookings add column if not exists result text check (result in ('won', 'drawn', 'lost'));
alter table public.venue_bookings add column if not exists result_goals_for integer;
alter table public.venue_bookings add column if not exists result_goals_against integer;
alter table public.venue_bookings add column if not exists result_logged_at timestamptz;

create or replace function public.log_booking_result(
  p_booking_id uuid,
  p_goals_for integer,
  p_goals_against integer
)
returns public.venue_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_result text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_goals_for < 0 or p_goals_against < 0 then
    raise exception 'invalid_score';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;

  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;

  if v_booking.result is not null then
    raise exception 'already_logged';
  end if;

  -- booking_day/end_time are plain date/time (Cyprus wall-clock, no zone
  -- attached) — same reasoning as book_slot's slot_in_past check and
  -- submit_fixture_score's too_early check: compare in Cyprus local time
  -- explicitly rather than relying on the database session's timezone.
  if now() < (v_booking.booking_day + v_booking.end_time) at time zone 'Asia/Nicosia' then
    raise exception 'too_early';
  end if;

  v_result := case
    when p_goals_for > p_goals_against then 'won'
    when p_goals_for < p_goals_against then 'lost'
    else 'drawn'
  end;

  update public.venue_bookings
  set result = v_result,
      result_goals_for = p_goals_for,
      result_goals_against = p_goals_against,
      result_logged_at = now()
  where id = p_booking_id
  returning * into v_booking;

  update public.profiles
  set played = played + 1,
      won = won + case when v_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_result = 'lost' then 1 else 0 end,
      goals = goals + p_goals_for
  where id = auth.uid();

  return v_booking;
end;
$$;

grant execute on function public.log_booking_result(uuid, integer, integer) to authenticated;
