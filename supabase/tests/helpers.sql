-- Helpers for the SQL tests. run.sh loads this before the tests; it is not a
-- migration and lives in its own `tests` schema, so it never reaches
-- production.
--
-- Role switches are transaction-scoped, so wrap each test in begin ... rollback:
--
--   begin;
--   do $$
--   declare v_user uuid := tests.create_user('someone@futty.test');
--   begin
--     perform tests.act_as(v_user);           -- signed in: auth.uid() = v_user, role authenticated
--     ...                                     -- RLS and grants apply as in the app
--     perform tests.act_as_service_role();    -- Edge Function with the service role key
--     perform tests.act_as_anon();            -- signed out
--     perform tests.act_as_postgres();        -- back to the superuser
--   end $$;
--   rollback;
--
-- An exception block rolls back role switches made inside it, so switch
-- roles outside `begin ... exception ... end` blocks.

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- A new auth user (the on_auth_user_created trigger also creates the
-- profile). Security definer so it works whatever role is active.
create or replace function tests.create_user(p_email text, p_metadata jsonb default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
          '{"provider":"email","providers":["email"]}', p_metadata, now(), now());
  return v_id;
end;
$$;

-- Sets the request's JWT claims the way PostgREST does, then the role.
create or replace function tests.set_claims(p_role text, p_sub uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_sub, 'role', p_role))::text, true);
  perform set_config('role', p_role, true);
end;
$$;

create or replace function tests.act_as(p_user_id uuid)
returns void language sql as $$ select tests.set_claims('authenticated', p_user_id) $$;

create or replace function tests.act_as_anon()
returns void language sql as $$ select tests.set_claims('anon', null) $$;

create or replace function tests.act_as_service_role()
returns void language sql as $$ select tests.set_claims('service_role', null) $$;

-- Back to the connection's own user (postgres), with no JWT.
create or replace function tests.act_as_postgres()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

revoke all on function tests.create_user(text, jsonb) from public;
grant execute on all functions in schema tests to anon, authenticated, service_role;
