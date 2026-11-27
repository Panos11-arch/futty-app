-- S20A (b) race: two invited players accept the last spot at the same moment
-- (spec 13 "Player invites": the spot is taken at accept, under a row lock).
-- Exactly one gets the spot; the other is told his invite expired (filling
-- the side expired it), and no deadlock: accept_invite locks the booking
-- before the invite, as the expiry does.
--
-- A race needs two real connections, so this file uses dblink, and its setup
-- is committed (another connection can't see an open transaction). Every row
-- it makes is tagged and deleted at the end, pass or fail.
create extension if not exists dblink with schema extensions;

create or replace function tests.s20b_conninfo()
returns text
language sql
stable
as $$
  select format('dbname=%s user=postgres password=postgres host=%s port=%s',
                current_database(), coalesce(host(inet_server_addr()), '127.0.0.1'), current_setting('port'));
$$;

-- Opens a transaction on p_conn acting as p_user, without committing.
create or replace function tests.s20b_race_begin(p_conn text, p_user uuid)
returns void
language plpgsql
as $$
begin
  perform extensions.dblink_exec(p_conn, 'begin');
  perform * from extensions.dblink(p_conn, format(
    'select set_config(''request.jwt.claim.sub'', %L, true), set_config(''request.jwt.claims'', %L, true), '
    'set_config(''role'', ''authenticated'', true), set_config(''statement_timeout'', ''15s'', true)',
    p_user, jsonb_build_object('sub', p_user, 'role', 'authenticated')::text)) as t(a text, b text, c text, d text);
end;
$$;

-- Setup, committed and tagged: a whole pitch with 9 of 10 spots taken and two
-- invited players.
create table if not exists tests.s20b_race (key text primary key, id uuid);
truncate tests.s20b_race;
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_booker uuid := tests.create_user('s20b-race-a-' || gen_random_uuid() || '@futty.test');
  v_one uuid := tests.create_user('s20b-race-b-' || gen_random_uuid() || '@futty.test');
  v_two uuid := tests.create_user('s20b-race-c-' || gen_random_uuid() || '@futty.test');
  v public.venue_bookings;
  v_filler uuid;
  v_names text[];
  i integer;
begin
  insert into tests.s20b_race values ('venue', v_venue), ('booker', v_booker), ('one', v_one), ('two', v_two);
  update public.profiles set username = 's20brace' || left(replace(id::text, '-', ''), 12) where id in (v_one, v_two);
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 4000);
  perform tests.act_as(v_booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible',
                        p_kind => 'whole');
  perform tests.act_as_postgres();
  insert into tests.s20b_race values ('booking', v.id);
  for i in 1 .. 8 loop
    v_filler := tests.create_user('s20b-race-f-' || gen_random_uuid() || '@futty.test');
    insert into tests.s20b_race values ('filler' || i, v_filler);
    perform public.add_booking_share_internal(v.id, v_filler);
  end loop;
  v_names := array[(select username from public.profiles where id = v_one),
                   (select username from public.profiles where id = v_two)];
  perform tests.act_as(v_booker);
  perform public.add_booking_player(v.id, v_names[1]);
  perform public.add_booking_player(v.id, v_names[2]);
  perform tests.act_as_postgres();
  insert into tests.s20b_race values
    ('invite_one', (select id from public.invites where booking_id = v.id and invited_profile_id = v_one)),
    ('invite_two', (select id from public.invites where booking_id = v.id and invited_profile_id = v_two));
end $$;

create or replace function tests.s20b_id(p_key text) returns uuid language sql stable as $$
  select id from tests.s20b_race where key = p_key $$;

do $$
declare
  v_won text;
  v_lost text;
  v_ok boolean := false;
begin
  begin
    perform extensions.dblink_connect('s20b_c1', tests.s20b_conninfo());
    perform extensions.dblink_connect('s20b_c2', tests.s20b_conninfo());

    -- The worst order: the first player's acceptance holds the booking when
    -- the second's starts, and only then fills the last spot. With the
    -- invite locked before the booking, the second would hold his invite
    -- while the first's expiry waits for it: a deadlock. The booking is
    -- locked first, so the second waits on it and then finds his invite
    -- expired.
    -- c1 locks the booking as postgres (RLS would hide it from the player),
    -- then goes on as the player.
    perform extensions.dblink_exec('s20b_c1', 'begin');
    perform * from extensions.dblink('s20b_c1', format(
      'select 1 from public.venue_bookings where id = %L for update', tests.s20b_id('booking'))) as t(r int);
    perform * from extensions.dblink('s20b_c1', format(
      'select set_config(''request.jwt.claim.sub'', %L, true), set_config(''request.jwt.claims'', %L, true), '
      'set_config(''role'', ''authenticated'', true), set_config(''statement_timeout'', ''15s'', true)',
      tests.s20b_id('one'), jsonb_build_object('sub', tests.s20b_id('one'), 'role', 'authenticated')::text))
      as t(a text, b text, c text, d text);
    perform tests.s20b_race_begin('s20b_c2', tests.s20b_id('two'));
    perform extensions.dblink_send_query('s20b_c2',
      format('select (public.accept_invite(%L)).status', tests.s20b_id('invite_two')));
    perform pg_sleep(0.5);  -- the second is now waiting
    select r into v_won from extensions.dblink('s20b_c1',
      format('select (public.accept_invite(%L)).status', tests.s20b_id('invite_one'))) as t(r text);
    perform extensions.dblink_exec('s20b_c1', 'commit');
    perform * from extensions.dblink_get_result('s20b_c2', false) as t(r text);
    v_lost := extensions.dblink_error_message('s20b_c2');
    perform * from extensions.dblink_get_result('s20b_c2', false) as t(r text);
    perform extensions.dblink_exec('s20b_c2', 'rollback');

    assert v_won = 'accepted', 'the first player accepted, got ' || coalesce(v_won, 'nothing');
    assert v_lost like '%invite_expired%', format('the second is told his invite expired, got %s', v_lost);
    assert v_lost not like '%deadlock%', 'no deadlock';
    assert (select count(*) from public.booking_payment_shares where booking_id = tests.s20b_id('booking')
              and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) = 10,
      'exactly ten spots taken';
    assert exists (select 1 from public.booking_payment_shares
                   where booking_id = tests.s20b_id('booking') and profile_id = tests.s20b_id('one')),
      'the last spot is the first player''s';
    assert not exists (select 1 from public.booking_payment_shares
                       where booking_id = tests.s20b_id('booking') and profile_id = tests.s20b_id('two')),
      'and the second has none';
    v_ok := true;
  exception when others then
    raise notice 's20b race failed: %', sqlerrm;
  end;

  -- Clean up, pass or fail.
  perform extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c;
  delete from public.notifications where profile_id in (select id from tests.s20b_race);
  delete from public.invites where booking_id = tests.s20b_id('booking');
  delete from public.matches where venue_id = tests.s20b_id('venue');
  delete from public.booking_payment_shares where booking_id = tests.s20b_id('booking');
  delete from public.booking_guarantees where booking_id = tests.s20b_id('booking');
  delete from public.venue_bookings where venue_id = tests.s20b_id('venue');
  delete from public.matches where venue_id = tests.s20b_id('venue');
  delete from public.price_rules where venue_id = tests.s20b_id('venue');
  delete from public.pitches where venue_id = tests.s20b_id('venue');
  delete from public.opening_hours where venue_id = tests.s20b_id('venue');
  delete from public.venues where id = tests.s20b_id('venue');
  delete from public.profiles where id in (select id from tests.s20b_race where key not in ('venue', 'booking',
                                                                                          'invite_one', 'invite_two'));
  delete from auth.users where id in (select id from tests.s20b_race where key not in ('venue', 'booking',
                                                                                      'invite_one', 'invite_two'));
  drop table tests.s20b_race;
  assert v_ok, 'the S20A (b) race (see the notice above)';
end $$;

select 'pay s20a booking invites race passed' as result;
