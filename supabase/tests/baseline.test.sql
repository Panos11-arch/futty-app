-- Guards on the migrated schema. Any failed check raises an error, which
-- fails CI.

-- 1. Row level security is on for every table in public. A new table without
--    it is readable and writable by anyone holding the anon key.
do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  assert v_missing is null,
    format('row level security is off on public tables: %s', v_missing);
end $$;

-- 2. Signed-out users (anon) can call only the functions on this list. Each
--    entry needs a reason; anything else must be revoked from public and
--    anon (see supabase/legacy/security-hardening.sql).
create temporary table anon_function_allow_list (signature text primary key, reason text not null);
insert into anon_function_allow_list values
  ('format_player_count(text)', 'immutable format-to-player-count lookup, reads no data'),
  ('is_username_available(text)', 'sign-up checks a username before the account exists (lib/auth.tsx)'),
  ('service_fee_rate()', 'immutable constant, reads no data');

do $$
declare
  v_unexpected text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.oid::regprocedure::text not in (select signature from anon_function_allow_list);

  assert v_unexpected is null,
    format('anon can execute functions not on the allow-list: %s', v_unexpected);
end $$;

-- 3. Spot checks that the security-hardening grants survived the baseline
--    (a fresh Supabase database grants everything to anon and authenticated
--    by default, which the top of the baseline migration undoes).
do $$
begin
  assert not has_table_privilege('anon', 'public.stripe_webhook_events', 'select'),
    'anon must not read stripe_webhook_events';
  assert not has_table_privilege('authenticated', 'public.stripe_webhook_events', 'select'),
    'authenticated must not read stripe_webhook_events';
  assert not has_table_privilege('authenticated', 'public.ai_chat_usage', 'insert'),
    'authenticated must not write ai_chat_usage';
  assert not has_function_privilege('authenticated', 'public.cancel_booking_for(uuid, uuid)', 'execute'),
    'cancel_booking_for is service_role only';
  assert not has_column_privilege('authenticated', 'public.profiles', 'xp', 'update'),
    'authenticated must not update profiles.xp';
  assert not has_column_privilege('authenticated', 'public.profiles', 'is_premium', 'update'),
    'authenticated must not update profiles.is_premium';
  assert has_column_privilege('authenticated', 'public.profiles', 'bio', 'update'),
    'authenticated should be able to update profiles.bio';
end $$;

select 'baseline tests passed' as result;
