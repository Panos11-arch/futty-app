-- G4a: my_ad_settings() tells the app, for the signed-in player only,
--   ads_allowed: false on Premium Plus (P1's ads_allowed), true on Basic and Premium
--   under_age:   under 18 on today's Cyprus date (A3), or no date of birth yet,
--                so AdMob's under-age setting is never left off by mistake.
-- The app never sends an age, a tier or a profile id.
begin;

-- 1. Basic, Premium and Premium Plus adults.
do $$
declare
  v_basic uuid := tests.create_user('g4a-basic@futty.test');
  v_premium uuid := tests.create_user('g4a-premium@futty.test');
  v_plus uuid := tests.create_user('g4a-plus@futty.test');
begin
  update public.profiles set date_of_birth = '1990-01-01' where id in (v_basic, v_premium, v_plus);
  update public.profiles set premium_tier = 'premium' where id = v_premium;
  update public.profiles set premium_tier = 'premium_plus' where id = v_plus;

  perform tests.act_as(v_basic);
  assert public.my_ad_settings() = '{"ads_allowed": true, "under_age": false}'::jsonb, 'Basic adult: ads, not under age';
  perform tests.act_as(v_premium);
  assert public.my_ad_settings() = '{"ads_allowed": true, "under_age": false}'::jsonb, 'Premium does not remove ads';
  perform tests.act_as(v_plus);
  assert public.my_ad_settings() = '{"ads_allowed": false, "under_age": false}'::jsonb, 'Premium Plus: no ads at all';
  perform tests.act_as_postgres();
end $$;

-- 2. Under 18 on today's Cyprus date: the under-age setting; 18 today: not.
do $$
declare
  v_minor uuid := tests.create_user('g4a-minor@futty.test');
  v_minor_plus uuid := tests.create_user('g4a-minor-plus@futty.test');
  v_eighteen uuid := tests.create_user('g4a-eighteen@futty.test');
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
begin
  update public.profiles set date_of_birth = (v_today - interval '18 years' + interval '1 day')::date where id = v_minor;
  update public.profiles set date_of_birth = (v_today - interval '15 years')::date, premium_tier = 'premium_plus' where id = v_minor_plus;
  update public.profiles set date_of_birth = (v_today - interval '18 years')::date where id = v_eighteen;

  perform tests.act_as(v_minor);
  assert public.my_ad_settings() = '{"ads_allowed": true, "under_age": true}'::jsonb, 'a day short of 18: under age';
  perform tests.act_as(v_minor_plus);
  assert public.my_ad_settings() = '{"ads_allowed": false, "under_age": true}'::jsonb, 'a minor on Premium Plus: no ads';
  perform tests.act_as(v_eighteen);
  assert public.my_ad_settings() = '{"ads_allowed": true, "under_age": false}'::jsonb, '18 today in Cyprus: not under age';
  perform tests.act_as_postgres();
end $$;

-- 3. No date of birth yet: treated as under age (never personalised by mistake).
do $$
declare
  v_new uuid := tests.create_user('g4a-no-dob@futty.test');
begin
  perform tests.act_as(v_new);
  assert public.my_ad_settings() = '{"ads_allowed": true, "under_age": true}'::jsonb, 'no date of birth: under age';
  perform tests.act_as_postgres();
end $$;

-- 4. Refused: signed out. Only the caller's own settings exist (no argument).
do $$
begin
  perform tests.act_as_anon();
  assert tests.error_of('select public.my_ad_settings()') is not null, 'signed out: refused';
  perform tests.act_as_postgres();
  assert not has_function_privilege('anon', 'public.my_ad_settings()', 'execute'), 'anon has no execute';
  assert not has_function_privilege('public', 'public.my_ad_settings()', 'execute'), 'public has no execute';
  assert has_function_privilege('authenticated', 'public.my_ad_settings()', 'execute'), 'players may read their own';
  assert (select prosecdef and proconfig @> array['search_path=""']
            from pg_proc where oid = 'public.my_ad_settings()'::regprocedure),
    'security definer with an empty search_path';
end $$;

select 'G4a ad settings passed' as result;

rollback;
