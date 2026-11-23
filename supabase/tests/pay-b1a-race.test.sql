-- B1a races (Booking v2): two players booking the same pitch at the same
-- moment, and two players booking the last free pitch. Exactly one wins;
-- the other is told the pitch is no longer free (or the slot is full).
--
-- A race needs two real connections, so this file uses dblink, and its setup
-- is committed (another connection can't see an open transaction). Every
-- row it makes is tagged and deleted at the end, pass or fail.
create extension if not exists dblink with schema extensions;

-- The server's own address as this connection sees it: inside Supabase's
-- container that's the container's address, where Postgres asks for the
-- password (dblink needs one for a role that isn't a superuser); 127.0.0.1
-- would be trusted without one and refused.
create or replace function tests.b1a_conninfo()
returns text
language sql
stable
as $$
  select format('dbname=%s user=postgres password=postgres host=%s port=%s',
                current_database(), coalesce(host(inet_server_addr()), '127.0.0.1'), current_setting('port'));
$$;

-- Runs book_slot as p_user on connection p_conn inside an open transaction
-- (begin, act as the user, book), without committing.
create or replace function tests.b1a_race_begin(p_conn text, p_user uuid, p_venue uuid, p_day date, p_pitches uuid[])
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

create or replace function tests.b1a_book_sql(p_venue uuid, p_day date, p_pitches uuid[])
returns text
language sql
stable
as $$
  select format('select (public.book_slot(%L, %L, ''12:00'', ''13:00'', 1, ''5-a-side'', 5, ''pay_all'', '
                'p_pitch_ids => %L::uuid[], p_kind => %L)).id::text',
                p_venue, p_day, p_pitches, case when p_pitches is null then null else 'whole' end);
$$;

-- Setup, committed and tagged.
create table if not exists tests.b1a_race (key text primary key, id uuid);
truncate tests.b1a_race;
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
begin
  insert into tests.b1a_race values
    ('venue', v_venue),
    ('p1', tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1)),
    ('p2', tests.create_pitch(v_venue, 'Pitch 2', '5-a-side', null, 2)),
    ('a', tests.create_user('b1a-race-a-' || gen_random_uuid() || '@futty.test')),
    ('b', tests.create_user('b1a-race-b-' || gen_random_uuid() || '@futty.test')),
    ('c', tests.create_user('b1a-race-c-' || gen_random_uuid() || '@futty.test'));
  perform tests.set_price(v_venue, '5-a-side', 4000);
end $$;

create or replace function tests.b1a_id(p_key text) returns uuid language sql stable as $$
  select id from tests.b1a_race where key = p_key $$;

do $$
declare
  v_day date := tests.cyprus_today() + 2;
  v_won text;
  v_lost text;
  v_ok boolean := false;
begin
  begin
    perform extensions.dblink_connect('b1a_c1', tests.b1a_conninfo());
    perform extensions.dblink_connect('b1a_c2', tests.b1a_conninfo());

    -- 1. Same pitch, same moment: A's booking is open when B's arrives. B
    --    waits on the venue's lock, then is refused once A commits.
    perform tests.b1a_race_begin('b1a_c1', tests.b1a_id('a'), tests.b1a_id('venue'), v_day, null);
    select r into v_won from extensions.dblink('b1a_c1',
      tests.b1a_book_sql(tests.b1a_id('venue'), v_day, array[tests.b1a_id('p2')])) as t(r text);
    perform tests.b1a_race_begin('b1a_c2', tests.b1a_id('b'), tests.b1a_id('venue'), v_day, null);
    perform extensions.dblink_send_query('b1a_c2',
      tests.b1a_book_sql(tests.b1a_id('venue'), v_day, array[tests.b1a_id('p2')]));
    perform extensions.dblink_exec('b1a_c1', 'commit');
    perform * from extensions.dblink_get_result('b1a_c2', false) as t(r text);
    v_lost := extensions.dblink_error_message('b1a_c2');
    perform * from extensions.dblink_get_result('b1a_c2', false) as t(r text);
    perform extensions.dblink_exec('b1a_c2', 'rollback');
    assert v_won is not null, 'A got the pitch';
    assert v_lost like '%pitch_not_free%', format('B is told the pitch is no longer free, got %s', v_lost);
    assert (select count(*) from public.booking_pitches bp join public.venue_bookings b on b.id = bp.booking_id
            where bp.pitch_id = tests.b1a_id('p2') and b.booking_day = v_day) = 1, 'exactly one booking holds Pitch 2';

    -- 2. The last free pitch (Pitch 1), booked without choosing by B and C
    --    at the same moment: one gets it, the other is told the slot is full.
    perform tests.b1a_race_begin('b1a_c1', tests.b1a_id('b'), tests.b1a_id('venue'), v_day, null);
    select r into v_won from extensions.dblink('b1a_c1',
      tests.b1a_book_sql(tests.b1a_id('venue'), v_day, null)) as t(r text);
    perform tests.b1a_race_begin('b1a_c2', tests.b1a_id('c'), tests.b1a_id('venue'), v_day, null);
    perform extensions.dblink_send_query('b1a_c2', tests.b1a_book_sql(tests.b1a_id('venue'), v_day, null));
    perform extensions.dblink_exec('b1a_c1', 'commit');
    perform * from extensions.dblink_get_result('b1a_c2', false) as t(r text);
    v_lost := extensions.dblink_error_message('b1a_c2');
    perform * from extensions.dblink_get_result('b1a_c2', false) as t(r text);
    perform extensions.dblink_exec('b1a_c2', 'rollback');
    assert v_won is not null, 'B got the last pitch';
    assert v_lost like '%slot_full%', format('C is told the slot is full, got %s', v_lost);
    v_ok := true;
  exception when others then
    raise notice 'b1a race failed: %', sqlerrm;
  end;

  -- Clean up, pass or fail.
  perform extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) c;
  delete from public.booking_payment_shares where booking_id in
    (select id from public.venue_bookings where venue_id = tests.b1a_id('venue'));
  delete from public.venue_bookings where venue_id = tests.b1a_id('venue');
  delete from public.price_rules where venue_id = tests.b1a_id('venue');
  delete from public.pitches where venue_id = tests.b1a_id('venue');
  delete from public.opening_hours where venue_id = tests.b1a_id('venue');
  delete from public.venues where id = tests.b1a_id('venue');
  delete from public.profiles where id in (tests.b1a_id('a'), tests.b1a_id('b'), tests.b1a_id('c'));
  delete from auth.users where id in (tests.b1a_id('a'), tests.b1a_id('b'), tests.b1a_id('c'));
  drop table tests.b1a_race;
  assert v_ok, 'the B1a races (see the notice above)';
end $$;

select 'pay b1a race passed' as result;
