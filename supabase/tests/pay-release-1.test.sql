-- P7: the release check (docs/specs/05-product.md section 12; 14, P7;
-- decided 16 November). It fails if any unsigned venue is live or the demo
-- account can't book (get checkout's server quote at a signed venue);
-- release_unlive_unsigned switches unsigned venues off; only service_role
-- sets signed_at.
begin;

do $$
declare
  v_owner uuid := tests.create_user('release-owner@futty.test');
  v_unsigned uuid;
  v_signed uuid;
  v_check jsonb;
  v_demo uuid;
  v_email text := 'review-release-test@futty.test';
begin
  -- Start from a clean slate: whatever the database already has is switched
  -- off, as the release script does.
  perform public.release_unlive_unsigned();

  v_unsigned := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_signed := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  perform tests.set_price(v_unsigned, '5-a-side', 6000);
  perform tests.set_price(v_signed, '5-a-side', 6000);
  update public.venues set signed_at = now() - interval '1 day' where id = v_signed;

  -- An unsigned venue live, and no demo account: both reported.
  v_check := public.release_check(v_email);
  assert not (v_check ->> 'ok')::boolean, format('not ok, got %s', v_check);
  assert v_check -> 'problems' @> jsonb_build_array(jsonb_build_object('problem', 'unsigned_venue_live', 'venue_id', v_unsigned)),
    format('the unsigned live venue, got %s', v_check);
  assert v_check -> 'problems' @> jsonb_build_array(jsonb_build_object('problem', 'demo_account_missing', 'email', v_email)),
    'no demo account';
  assert not (v_check -> 'problems' @> jsonb_build_array(jsonb_build_object('venue_id', v_signed))), 'the signed venue is fine';

  -- The release script switches the unsigned venue off; the signed one stays.
  assert public.release_unlive_unsigned() = 1, 'one venue switched off';
  assert not (select is_live from public.venues where id = v_unsigned), 'unsigned: off';
  assert (select is_live from public.venues where id = v_signed), 'signed: still live';
  assert public.release_unlive_unsigned() = 0, 'nothing more to switch off';

  -- The demo account exists: it gets checkout's quote at the signed venue.
  v_demo := tests.create_user(v_email);
  v_check := public.release_check(v_email);
  assert (v_check ->> 'ok')::boolean and v_check -> 'problems' = '[]'::jsonb, format('all well, got %s', v_check);
  assert v_check -> 'quote' ->> 'venue_id' = v_signed::text, format('a quote at the signed venue, got %s', v_check -> 'quote');
  assert (v_check -> 'quote' -> 'modes') is not null or (v_check -> 'quote') ? 'start_time', 'a real quote';
  assert coalesce(current_setting('request.jwt.claims', true), '') = '', 'the caller''s session is left as it was';

  -- The demo account can't book: reported.
  update public.venues set signed_at = null where id = v_signed;
  perform public.release_unlive_unsigned();
  v_check := public.release_check(v_email);
  assert v_check -> 'problems' @> '[{"problem": "no_signed_venue"}]'::jsonb
         and v_check -> 'problems' @> jsonb_build_array(jsonb_build_object('problem', 'demo_cannot_quote', 'email', v_email)),
    format('no signed venue to book at, got %s', v_check);
end $$;

-- Only service_role sets signed_at; the release functions are internal.
do $$
declare
  v_owner uuid := tests.create_user('release-guard-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
begin
  perform tests.act_as(v_owner);
  assert tests.error_of(format('update public.venues set signed_at = now() where id = %L', v_venue)) is not null,
    'the owner can''t write it';
  perform tests.act_as_postgres();
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  assert tests.error_of(format('update public.venues set signed_at = now() where id = %L', v_venue)) = 'signed_at_service_role_only',
    'refused for a signed-in session, whatever function makes the change';
  perform tests.act_as_service_role();
  update public.venues set signed_at = now() where id = v_venue;
  perform tests.act_as_postgres();
  assert (select signed_at from public.venues where id = v_venue) = now(), 'service_role can';

  assert has_function_privilege('service_role', 'public.release_check(text)', 'execute')
     and not has_function_privilege('authenticated', 'public.release_check(text)', 'execute')
     and not has_function_privilege('anon', 'public.release_check(text)', 'execute'), 'release_check: service_role only';
  assert has_function_privilege('service_role', 'public.release_unlive_unsigned()', 'execute')
     and not has_function_privilege('authenticated', 'public.release_unlive_unsigned()', 'execute')
     and not has_function_privilege('anon', 'public.release_unlive_unsigned()', 'execute'), 'release_unlive_unsigned: service_role only';
end $$;

rollback;
