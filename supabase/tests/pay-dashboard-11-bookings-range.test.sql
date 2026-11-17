-- The bookings list's longest range (docs/specs/13-payments-bookings.md
-- "Venue dashboard", Bookings list; decided 14 November, Dimitris): at most
-- 31 days, both ends counted. The server refuses a longer range with
-- range_too_long, as the app does before asking.
begin;

do $$
declare
  v_owner uuid := tests.create_user('range-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_from date := tests.cyprus_today();
begin
  perform tests.act_as(v_owner);

  assert public.venue_bookings_list(v_venue, v_from, v_from + 30) = '[]', '31 days, both ends counted: allowed';
  assert public.venue_bookings_list(v_venue, v_from, v_from) = '[]', 'one day: allowed';
  assert tests.error_of(format('select public.venue_bookings_list(%L, %L, %L)', v_venue, v_from, v_from + 31))
         = 'range_too_long', '32 days: refused';
  assert tests.error_of(format($q$ select public.venue_bookings_list(%L, %L, %L, 'app', 'confirmed') $q$,
                               v_venue, v_from, v_from + 365))
         = 'range_too_long', 'a year, with filters: refused';
  -- A backwards range is still invalid_range.
  assert tests.error_of(format('select public.venue_bookings_list(%L, %L, %L)', v_venue, v_from + 1, v_from))
         = 'invalid_range', 'backwards: invalid_range';
end $$;

rollback;
