-- B1c race (Booking v2): two invited captains accept the opposition at the
-- same moment. Exactly one becomes side B's captain; the other is told the
-- opposition was found.
--
-- A race needs two real connections, so this file uses dblink, and its setup
-- is committed (another connection can't see an open transaction). Every
-- row it makes is tagged and deleted at the end, pass or fail, and half
-- pitches are switched off again.
create extension if not exists dblink with schema extensions;

create or replace function tests.b1c_conninfo()
returns text
language sql
stable
as $$
  select format('dbname=%s user=postgres password=postgres host=%s port=%s',
                current_database(), coalesce(host(inet_server_addr()), '127.0.0.1'), current_setting('port'));
$$;

-- Opens a transaction on p_conn acting as p_user, without committing.
create or replace function tests.b1c_race_begin(p_conn text, p_user uuid)
returns void
language plpgsql
as $$
begin
  perform extensions.dblink_exec(p_conn, 'begin');
  perform * from extensions.dblink(p_conn, format(
    'select set_config(''request.jwt.claim.sub'', %L, true), set_config(''request.jwt.claims'', %L, true), '
    'set_config(''role'', ''authenticated'', true)',
    p_user, jsonb_build_object('sub', p_user, 'role', 'authenticated')::text)) as t(a text, b text, c text);
end;
$$;

-- Setup, committed and tagged: a confirmed half pitch with two invited captains.
create table if not exists tests.b1c_race (key text primary key, id uuid);
truncate tests.b1c_race;
update public.booking_v2_settings set half_pitch_enabled = true;
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_booker uuid := tests.create_user('b1c-race-a-' || gen_random_uuid() || '@futty.test');
  v_one uuid := tests.create_user('b1c-race-b-' || gen_random_uuid() || '@futty.test');
  v_two uuid := tests.create_user('b1c-race-c-' || gen_random_uuid() || '@futty.test');
  v public.venue_bookings;
begin
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(v_booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all', p_kind => 'half');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v.id;
  perform tests.act_as(v_booker);
  perform public.invite_opposition(v.id, array[v_one, v_two]);
  perform tests.act_as_postgres();
  insert into tests.b1c_race values
    ('venue', v_venue), ('booking', v.id), ('booker', v_booker), ('one', v_one), ('two', v_two),
    ('invite_one', (select id from public.booking_opposition_invites where booking_id = v.id and invited_profile_id = v_one)),
    ('invite_two', (select id from public.booking_opposition_invites where booking_id = v.id and invited_profile_id = v_two));
end $$;

create or replace function tests.b1c_id(p_key text) returns uuid language sql stable as $$
  select id from tests.b1c_race where key = p_key $$;

do $$
declare
  v_won text;
  v_lost text;
  v_ok boolean := false;
begin
  begin
    perform extensions.dblink_connect('b1c_c1', tests.b1c_conninfo());
    perform extensions.dblink_connect('b1c_c2', tests.b1c_conninfo());

    -- The first captain's acceptance is open when the second's arrives: the
    -- second waits on the booking's lock, then finds side B taken.
    perform tests.b1c_race_begin('b1c_c1', tests.b1c_id('one'));
    select r into v_won from extensions.dblink('b1c_c1',
      format('select public.accept_opposition(%L, ''pay_all'')::text', tests.b1c_id('invite_one'))) as t(r text);
    perform tests.b1c_race_begin('b1c_c2', tests.b1c_id('two'));
    perform extensions.dblink_send_query('b1c_c2',
      format('select public.accept_opposition(%L, ''pay_all'')::text', tests.b1c_id('invite_two')));
    perform extensions.dblink_exec('b1c_c1', 'commit');
    perform * from extensions.dblink_get_result('b1c_c2', false) as t(r text);
    v_lost := extensions.dblink_error_message('b1c_c2');
    perform * from extensions.dblink_get_result('b1c_c2', false) as t(r text);
    perform extensions.dblink_exec('b1c_c2', 'rollback');

    assert v_won is not null, 'the first captain accepted';
    assert v_lost like '%opposition_found%', format('the second is told the opposition was found, got %s', v_lost);
    assert (select count(*) from public.booking_sides where booking_id = tests.b1c_id('booking') and side = 'b') = 1,
      'exactly one side B';
    assert (select captain_id from public.booking_sides where booking_id = tests.b1c_id('booking') and side = 'b')
           = tests.b1c_id('one'), 'and it''s the first captain''s';
    v_ok := true;
  exception when others then
    raise notice 'b1c race failed: %', sqlerrm;
  end;

  -- Clean up, pass or fail.
  perform extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c;
  update public.booking_v2_settings set half_pitch_enabled = false;
  delete from public.matches where venue_id = tests.b1c_id('venue');
  delete from public.notifications where profile_id in (tests.b1c_id('booker'), tests.b1c_id('one'), tests.b1c_id('two'));
  delete from public.booking_payment_shares where booking_id = tests.b1c_id('booking');
  delete from public.venue_bookings where venue_id = tests.b1c_id('venue');
  delete from public.matches where venue_id = tests.b1c_id('venue');  -- again: cancelling a booking's match can make one
  delete from public.price_rules where venue_id = tests.b1c_id('venue');
  delete from public.pitches where venue_id = tests.b1c_id('venue');
  delete from public.opening_hours where venue_id = tests.b1c_id('venue');
  delete from public.venues where id = tests.b1c_id('venue');
  delete from public.profiles where id in (tests.b1c_id('booker'), tests.b1c_id('one'), tests.b1c_id('two'));
  delete from auth.users where id in (tests.b1c_id('booker'), tests.b1c_id('one'), tests.b1c_id('two'));
  drop table tests.b1c_race;
  assert v_ok, 'the B1c race (see the notice above)';
end $$;

select 'pay b1c race passed' as result;
