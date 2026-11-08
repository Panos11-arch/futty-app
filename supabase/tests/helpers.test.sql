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

select 'helpers tests passed' as result;

rollback;
