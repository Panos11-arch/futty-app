-- A3b-2b: preferred days and times on profiles (match-record.md decision
-- 1d.3). The owner edits and reads them; nobody else reads them, through
-- the table or the public profile functions, and only known values save.
-- Quiet hours across midnight save and read back unchanged.
begin;

do $$
declare
  v_owner uuid := tests.create_user('mpp-owner@futty.test');
  v_other uuid := tests.create_user('mpp-other@futty.test');
  v_days text[];
  v_times text[];
  v_count int;
  v_public jsonb;
  v_error text;
begin
  -- A new profile has no preferences.
  perform tests.act_as(v_owner);
  select preferred_days, preferred_times into v_days, v_times from public.profiles where id = v_owner;
  assert v_days = '{}' and v_times = '{}', format('empty by default: %s %s', v_days, v_times);

  -- The owner saves and reads them back.
  update public.profiles set preferred_days = '{mon,thu}', preferred_times = '{evening}' where id = v_owner;
  select preferred_days, preferred_times into v_days, v_times from public.profiles where id = v_owner;
  assert v_days = '{mon,thu}' and v_times = '{evening}', format('saved: %s %s', v_days, v_times);

  -- Only known values save.
  v_error := tests.error_of(format('update public.profiles set preferred_days = %L where id = %L', '{funday}', v_owner));
  assert v_error like '%profiles_preferred_days_check%', format('unknown day refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set preferred_times = %L where id = %L', '{midnight}', v_owner));
  assert v_error like '%profiles_preferred_times_check%', format('unknown time refused: %s', v_error);

  -- Another player can't read them through the table...
  perform tests.act_as(v_other);
  select count(*) into v_count from public.profiles where id = v_owner;
  assert v_count = 0, 'another player reads no row of the owner''s profile';

  -- ...nor through the public profile functions.
  select to_jsonb(p) into v_public from public.get_public_profile(v_owner) p;
  assert v_public is not null, 'the public profile is still there';
  assert not (v_public ? 'preferred_days') and not (v_public ? 'preferred_times'),
    format('get_public_profile leaves preferences out: %s', v_public);
  select to_jsonb(p) into v_public from public.get_public_profiles(array[v_owner]) p;
  assert not (v_public ? 'preferred_days') and not (v_public ? 'preferred_times'),
    format('get_public_profiles leaves preferences out: %s', v_public);

  -- ...nor change them.
  update public.profiles set preferred_days = '{sun}' where id = v_owner;
  perform tests.act_as(v_owner);
  select preferred_days into v_days from public.profiles where id = v_owner;
  assert v_days = '{mon,thu}', format('another player''s update changed nothing: %s', v_days);

  -- Signed out: nothing.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('select preferred_days from public.profiles where id = %L', v_owner));
  assert v_error is not null or not exists (select 1 from public.profiles where id = v_owner),
    'signed out reads nothing';
end $$;

-- Quiet hours spanning midnight, as the settings screen saves them.
do $$
declare
  v_me uuid := tests.create_user('mpp-quiet@futty.test');
  v_row public.notification_quiet_hours;
begin
  perform tests.act_as(v_me);
  insert into public.notification_quiet_hours (profile_id, starts_local, ends_local) values (v_me, '23:00', '07:00')
  on conflict (profile_id) do update set starts_local = excluded.starts_local, ends_local = excluded.ends_local;
  select * into v_row from public.notification_quiet_hours where profile_id = v_me;
  assert v_row.starts_local = '23:00' and v_row.ends_local = '07:00', format('saved as given: %s', row_to_json(v_row));

  -- Saving again replaces the times.
  insert into public.notification_quiet_hours (profile_id, starts_local, ends_local) values (v_me, '22:30', '06:15')
  on conflict (profile_id) do update set starts_local = excluded.starts_local, ends_local = excluded.ends_local;
  select * into v_row from public.notification_quiet_hours where profile_id = v_me;
  assert v_row.starts_local = '22:30' and v_row.ends_local = '06:15', format('replaced: %s', row_to_json(v_row));

  -- Turning them off deletes the row: no row, no quiet hours.
  delete from public.notification_quiet_hours where profile_id = v_me;
  assert not exists (select 1 from public.notification_quiet_hours where profile_id = v_me), 'off';
end $$;

rollback;
