-- S5: a venue's phone and website (the venue page's Call and Website
-- buttons), editable by that venue's own staff only (set_venue_contact).
-- Blank clears a field; a phone is digits with an optional +, spaces,
-- brackets and dashes; a website is an http(s) address ("futty.app" gets
-- https:// in front). venue_page returns what was saved.
begin;

do $$
declare
  v_owner uuid := tests.create_user('contact-owner@futty.test');
  v_other_owner uuid := tests.create_user('contact-other@futty.test');
  v_player uuid := tests.create_user('contact-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  r jsonb;
  v_bad text;
begin
  update public.venues set is_live = true, phone = null, website = null where id in (v_venue, v_other);

  -- The allowed case: the venue's own staff.
  perform tests.act_as(v_owner);
  r := public.set_venue_contact(v_venue, ' +357 25 123456 ', 'futty.app/arena');
  assert r = jsonb_build_object('phone', '+357 25 123456', 'website', 'https://futty.app/arena'),
    format('saved and returned (%s)', r);
  r := public.venue_page(v_venue) -> 'venue';
  assert (r ->> 'phone', r ->> 'website') = ('+357 25 123456', 'https://futty.app/arena'), 'the venue page shows them';

  r := public.set_venue_contact(v_venue, '(25) 123-456', 'http://arena.example.com');
  assert r = jsonb_build_object('phone', '(25) 123-456', 'website', 'http://arena.example.com'), 'brackets, dashes, http';

  -- Blank clears.
  r := public.set_venue_contact(v_venue, '  ', null);
  assert r = jsonb_build_object('phone', null, 'website', null), 'blank clears both';
  assert (select (phone, website) from public.venues where id = v_venue) is not distinct from (null::text, null::text),
    'cleared in the table';

  -- Refused: a bad phone or website.
  foreach v_bad in array array['abc', '12', '+357 99 12 34 56 78 90 12 34', '99-12-ab', '++357 99123456'] loop
    assert tests.error_of(format('select public.set_venue_contact(%L, %L, null)', v_venue, v_bad)) = 'invalid_phone',
      format('phone %s', v_bad);
  end loop;
  foreach v_bad in array array['ftp://arena.example.com', 'not a site', 'https://', 'javascript:alert(1)',
                               'https://' || repeat('a', 200) || '.com'] loop
    assert tests.error_of(format('select public.set_venue_contact(%L, null, %L)', v_venue, v_bad)) = 'invalid_website',
      format('website %s', v_bad);
  end loop;

  -- Refused: staff of another venue, a player, signed out.
  perform tests.act_as(v_other_owner);
  assert tests.error_of(format('select public.set_venue_contact(%L, %L, null)', v_venue, '+357 99000000')) = 'not_venue_staff',
    'another venue''s staff';
  perform tests.act_as(v_player);
  assert tests.error_of(format('select public.set_venue_contact(%L, %L, null)', v_venue, '+357 99000000')) = 'not_venue_staff',
    'a player';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.set_venue_contact(%L, %L, null)', v_venue, '+357 99000000')) is not null,
    'signed out';

  perform tests.act_as_postgres();
  assert (select phone from public.venues where id = v_venue) is null, 'nothing changed by the refused calls';
  assert not has_function_privilege('anon', 'public.set_venue_contact(uuid, text, text)', 'execute'), 'anon can''t call it';

  -- Players still can't write the venues table directly.
  perform tests.act_as(v_player);
  perform tests.error_of(format('update public.venues set phone = ''+357 99999999'' where id = %L', v_venue));
  perform tests.act_as_postgres();
  assert (select phone from public.venues where id = v_venue) is null, 'no direct write';
end $$;

rollback;
