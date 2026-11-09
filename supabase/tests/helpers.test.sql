-- Proves supabase/tests/helpers.sql: each helper really changes who the
-- database thinks is asking, and RLS and grants apply accordingly.

begin;

do $$
declare
  v_user uuid := tests.create_user('helpers-test@futty.test', '{"username":"helperstest"}');
  v_other uuid := tests.create_user('helpers-other@futty.test');
  v_rows integer;
begin
  assert exists (select 1 from public.profiles where id = v_user and username = 'helperstest'),
    'create_user should create a profile through the sign-up trigger';

  -- Signed in.
  perform tests.act_as(v_user);
  assert current_user = 'authenticated', format('expected role authenticated, got %s', current_user);
  assert auth.uid() = v_user, 'auth.uid() should be the user acted as';
  assert auth.role() = 'authenticated', 'auth.role() should be authenticated';

  update public.profiles set bio = 'from helpers.test' where id = v_user;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'a user can update their own bio';

  update public.profiles set bio = 'not mine' where id = v_other;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'RLS should stop a user updating someone else''s profile';

  begin
    update public.profiles set xp = 1000 where id = v_user;
    raise exception 'a user could update their own xp';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.stripe_webhook_events;
    raise exception 'a user could read stripe_webhook_events';
  exception when insufficient_privilege then null;
  end;

  -- Signed out.
  perform tests.act_as_anon();
  assert current_user = 'anon', format('expected role anon, got %s', current_user);
  assert auth.uid() is null, 'auth.uid() should be null when signed out';

  -- Service role.
  perform tests.act_as_service_role();
  assert current_user = 'service_role', format('expected role service_role, got %s', current_user);
  perform 1 from public.stripe_webhook_events;
  update public.profiles set xp = 1000 where id = v_user;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'service_role can update xp';

  -- Back to postgres.
  perform tests.act_as_postgres();
  assert current_user = 'postgres', format('expected role postgres, got %s', current_user);
  assert auth.uid() is null, 'auth.uid() should be cleared';
end $$;

-- check_player_price checks every amount, then undoes its booking; a wrong
-- expectation fails.
do $$
declare
  v_player uuid := tests.create_user('helpers-price@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 1;
  v_error text;
begin
  perform tests.act_as(v_player);
  -- EUR 60: 6000 / 10 = 600 + 80 = 680.
  perform tests.check_player_price(v_venue, v_day, '12:00', '13:00', '5-a-side', 5, 6000, 600, 680, 'helper');
  assert not exists (select 1 from public.venue_bookings where venue_id = v_venue), 'the check''s booking is undone';
  -- So the same slot can be checked again.
  perform tests.check_player_price(v_venue, v_day, '12:00', '13:00', '5-a-side', 5, 6000, 600, 680, 'helper again');

  -- (A failed assert isn't caught by tests.error_of's "when others", so
  -- catch assert_failure here.)
  begin
    perform tests.check_player_price(v_venue, v_day, '12:00', '13:00', '5-a-side', 5, 6000, 600, 681, 'wrong');
    v_error := null;
  exception when assert_failure then
    get stacked diagnostics v_error = message_text;
  end;
  assert v_error like '%player pays should be 681, got 680%', format('a wrong total must fail: got %s', coalesce(v_error, 'success'));
  begin
    perform tests.check_player_price(v_venue, v_day, '12:00', '13:00', '5-a-side', 5, 6000, 601, 680, 'wrong');
    v_error := null;
  exception when assert_failure then
    get stacked diagnostics v_error = message_text;
  end;
  assert v_error like '%pitch share should be 601, got 600%', format('a wrong pitch share must fail: got %s', coalesce(v_error, 'success'));
end $$;

select 'helpers tests passed' as result;

rollback;
