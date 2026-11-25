-- S6 Find a match: public.find_matches lists only public, open, not-full,
-- not-started games, filtered by format, place, Cyprus day and time, with
-- the organiser, players in / places, avatars and level range from the
-- server. Allowed and refused cases.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.fm_user(p_name text default null)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.create_user('fm-' || gen_random_uuid() || '@futty.test');
begin
  if p_name is not null then
    update public.profiles set full_name = p_name where id = v;
  end if;
  return v;
end;
$$;

create function tests.fm_venue(p_city text)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.create_venue(p_pitches => 0);
begin
  update public.venues set city = p_city, is_live = true where id = v;
  perform tests.create_pitch(v, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v, '5-a-side', 4000);
  return v;
end;
$$;

-- A paid Booking v2 booking 3 days ahead at 12:00 (Cyprus).
create function tests.fm_book(p_venue uuid, p_booker uuid, p_kind text, p_start time default '12:00')
returns uuid
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  perform tests.act_as(p_booker);
  v := public.book_slot(p_venue, tests.cyprus_today() + 3, p_start, p_start + interval '1 hour', 1, '5-a-side', 5,
                        'pay_all', p_kind => p_kind);
  perform tests.act_as_postgres();
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = v.id and profile_id = p_booker),
                           'pi_fm_' || gen_random_uuid());
  return v.id;
end;
$$;

create function tests.fm_publish(p_booking uuid, p_as uuid, p_kind text)
returns uuid
language plpgsql
as $$
declare
  v public.squad_posts;
begin
  perform tests.act_as(p_as);
  v := public.publish_booking(p_booking, p_kind);
  perform tests.act_as_postgres();
  return v.id;
end;
$$;

-- find_matches as p_as, with the filters given.
create function tests.fm_find(p_as uuid, p_format text default null, p_town text default null, p_venue uuid default null,
                              p_days date[] default null, p_from time default null, p_to time default null)
returns setof record
language plpgsql
as $$
begin
  perform tests.act_as(p_as);
  return query select f.post_id, f.kind, f.organiser_name, f.team_name, f.players_in, f.capacity,
                      f.level_min, f.level_max, f.people, f.venue_city
               from public.find_matches(p_format, p_town, p_venue, p_days, p_from, p_to) f;
  perform tests.act_as_postgres();
end;
$$;

create function tests.fm_row(p_as uuid, p_post uuid,
  out post_id uuid, out kind text, out organiser_name text, out team_name text, out players_in integer,
  out capacity integer, out level_min numeric, out level_max numeric, out people jsonb, out venue_city text)
language plpgsql
as $$
begin
  select * into post_id, kind, organiser_name, team_name, players_in, capacity, level_min, level_max, people, venue_city
  from tests.fm_find(p_as) as f(post_id uuid, kind text, organiser_name text, team_name text, players_in integer,
                                capacity integer, level_min numeric, level_max numeric, people jsonb, venue_city text)
  where f.post_id = p_post;
end;
$$;

create function tests.fm_listed(p_as uuid, p_post uuid, p_format text default null, p_town text default null,
                                 p_venue uuid default null, p_days date[] default null, p_from time default null,
                                 p_to time default null)
returns boolean
language sql
as $$
  select exists (
    select 1 from tests.fm_find(p_as, p_format, p_town, p_venue, p_days, p_from, p_to)
      as f(post_id uuid, kind text, organiser_name text, team_name text, players_in integer, capacity integer,
           level_min numeric, level_max numeric, people jsonb, venue_city text)
    where f.post_id = p_post);
$$;

-- 1. A published whole-pitch game: listed for anyone signed in, with the
--    organiser, 1/10, the booker's avatar and the level range.
do $$
declare
  v_venue uuid := tests.fm_venue('Limassol');
  v_booker uuid := tests.fm_user('Andreas Booker');
  v_joiner uuid := tests.fm_user('Maria Joiner');
  v_viewer uuid := tests.fm_user();
  v_booking uuid := tests.fm_book(v_venue, v_booker, 'whole');
  v_post uuid := tests.fm_publish(v_booking, v_booker, 'players');
  r record;
begin
  perform tests.set_level(v_booker, 4.2);
  perform tests.set_level(v_joiner, 6.0);
  r := tests.fm_row(v_viewer, v_post);
  assert r.post_id = v_post, 'a published game is listed';
  assert (r.kind, r.organiser_name, r.players_in, r.capacity, r.venue_city)
       = ('players'::text, 'Andreas Booker'::text, 1, 10, 'Limassol'::text), format('the card facts (%s)', r);
  assert r.people = jsonb_build_array(jsonb_build_object('id', v_booker, 'name', 'Andreas Booker')),
    format('the booker''s avatar (%s)', r.people);
  assert (r.level_min, r.level_max) = (4.2, 4.2), format('one player, one level (%s)', r);

  perform tests.act_as(v_joiner);
  perform public.join_squad_post(v_post);
  perform tests.act_as_postgres();
  r := tests.fm_row(v_viewer, v_post);
  assert (r.players_in, r.level_min, r.level_max) = (2, 4.2, 6.0), format('a joiner counts (%s)', r);
  assert r.people -> 0 ->> 'id' = v_booker::text, 'booker first';
end $$;

-- 2. Filters: format, town, venue, Cyprus day and the start-time window.
do $$
declare
  v_venue uuid := tests.fm_venue('Paphos');
  v_booker uuid := tests.fm_user();
  v_viewer uuid := tests.fm_user();
  v_post uuid := tests.fm_publish(tests.fm_book(v_venue, v_booker, 'whole', '19:00'), v_booker, 'players');
  v_day date := tests.cyprus_today() + 3;
begin
  assert tests.fm_listed(v_viewer, v_post, p_format => '5-a-side'), 'its format';
  assert not tests.fm_listed(v_viewer, v_post, p_format => '7-a-side'), 'another format';
  assert tests.fm_listed(v_viewer, v_post, p_town => 'paphos'), 'its town, any case';
  assert not tests.fm_listed(v_viewer, v_post, p_town => 'Nicosia'), 'another town';
  assert tests.fm_listed(v_viewer, v_post, p_venue => v_venue), 'its venue';
  assert not tests.fm_listed(v_viewer, v_post, p_venue => gen_random_uuid()), 'another venue';
  assert tests.fm_listed(v_viewer, v_post, p_days => array[v_day]), 'its Cyprus day';
  assert not tests.fm_listed(v_viewer, v_post, p_days => array[v_day + 1]), 'another day';
  assert tests.fm_listed(v_viewer, v_post, p_from => '18:00', p_to => '24:00'), 'evening, Cyprus time';
  assert tests.fm_listed(v_viewer, v_post, p_from => '19:00', p_to => '20:00'), 'from is inclusive';
  assert not tests.fm_listed(v_viewer, v_post, p_from => '12:00', p_to => '19:00'), 'to is exclusive';
  assert tests.fm_listed(v_viewer, v_post, p_days => '{}'), 'no days: every day';
end $$;

-- 3. Refused: unpublished, full, started, a cancelled booking, a venue not live.
do $$
declare
  v_venue uuid := tests.fm_venue('Larnaca');
  v_booker uuid := tests.fm_user();
  v_viewer uuid := tests.fm_user();
  v_booking uuid;
  v_post uuid;
  i integer;
begin
  -- Unpublished.
  v_booking := tests.fm_book(v_venue, v_booker, 'whole', '10:00');
  v_post := tests.fm_publish(v_booking, v_booker, 'players');
  perform tests.act_as(v_booker);
  perform public.unpublish_post(v_post);
  perform tests.act_as_postgres();
  assert not tests.fm_listed(v_viewer, v_post), 'an unpublished game';

  -- Full: ten live shares on a 10-player pitch.
  v_booking := tests.fm_book(v_venue, v_booker, 'whole', '14:00');
  v_post := tests.fm_publish(v_booking, v_booker, 'players');
  for i in 1..9 loop
    insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, status)
    values (v_booking, tests.fm_user(), 0, 'pending');
  end loop;
  assert not tests.fm_listed(v_viewer, v_post), 'a full game';

  -- Started.
  v_booking := tests.fm_book(v_venue, v_booker, 'whole', '16:00');
  v_post := tests.fm_publish(v_booking, v_booker, 'players');
  assert tests.fm_listed(v_viewer, v_post), 'listed before kickoff';
  update public.squad_posts set scheduled_at = now() - interval '1 minute' where id = v_post;
  assert not tests.fm_listed(v_viewer, v_post), 'a game that has started';

  -- A cancelled booking's post.
  v_booking := tests.fm_book(v_venue, v_booker, 'whole', '18:00');
  v_post := tests.fm_publish(v_booking, v_booker, 'players');
  update public.venue_bookings set status = 'cancelled' where id = v_booking;
  assert not tests.fm_listed(v_viewer, v_post), 'a cancelled booking';

  -- A venue that isn't live.
  v_booking := tests.fm_book(v_venue, v_booker, 'whole', '20:00');
  v_post := tests.fm_publish(v_booking, v_booker, 'players');
  update public.venues set is_live = false where id = v_venue;
  assert not tests.fm_listed(v_viewer, v_post), 'a venue not live';
end $$;

-- 4. An opposition post: listed with side A's players and their average
--    level, until side B is found.
do $$
declare
  v_venue uuid := tests.fm_venue('Limassol');
  v_booker uuid := tests.fm_user('Side A Captain');
  v_b uuid := tests.fm_user();
  v_viewer uuid := tests.fm_user();
  v_booking uuid := tests.fm_book(v_venue, v_booker, 'half');
  v_post uuid := tests.fm_publish(v_booking, v_booker, 'opposition');
  r record;
begin
  perform tests.set_level(v_booker, 6.12);
  r := tests.fm_row(v_viewer, v_post);
  assert (r.kind, r.organiser_name, r.level_min, r.level_max) = ('opposition'::text, 'Side A Captain'::text, 6.1, 6.1),
    format('opposition card (%s)', r);
  assert jsonb_array_length(r.people) = 1, 'side A''s players';

  perform tests.act_as(v_b);
  perform public.accept_opposition_post(v_post, 'each_pays_responsible');
  perform tests.act_as_postgres();
  assert not tests.fm_listed(v_viewer, v_post), 'opposition found: no longer listed';
end $$;

-- 5. Older posts: a "Need players" post counts its joiners (house players by
--    name) against players_needed; an older opposition post shows its team.
do $$
declare
  v_venue uuid := tests.fm_venue('Nicosia');
  v_poster uuid := tests.fm_user('Old Poster');
  v_joiner uuid := tests.fm_user('Old Joiner');
  v_viewer uuid := tests.fm_user();
  v_team uuid := tests.create_team('Nicosia Lions');
  v_players uuid;
  v_opp uuid;
  r record;
begin
  insert into public.squad_posts (type, venue_id, scheduled_at, format, status, posted_by, players_needed)
  values ('players', v_venue, now() + interval '2 days', '5-a-side', 'open', v_poster, 3)
  returning id into v_players;
  insert into public.squad_post_joiners (post_id, profile_id) values (v_players, v_joiner);
  insert into public.squad_post_joiners (post_id, display_name, is_house_player) values (v_players, 'Staff Sam', true);
  r := tests.fm_row(v_viewer, v_players);
  assert (r.organiser_name, r.players_in, r.capacity) = ('Old Poster'::text, 2, 3), format('older players post (%s)', r);
  assert r.people @> jsonb_build_array(jsonb_build_object('id', null, 'name', 'Staff Sam')), format('a house player by name (%s)', r.people);

  insert into public.squad_post_joiners (post_id, profile_id) values (v_players, tests.fm_user());
  assert not tests.fm_listed(v_viewer, v_players), 'an older post once full';

  perform tests.join_team(v_team, v_poster, 'captain');
  perform tests.set_level(v_poster, 5.0);
  insert into public.squad_posts (type, venue_id, scheduled_at, format, status, posted_by, team_id)
  values ('opposition', v_venue, now() + interval '2 days', '5-a-side', 'open', v_poster, v_team)
  returning id into v_opp;
  r := tests.fm_row(v_viewer, v_opp);
  assert (r.team_name, r.level_min) = ('Nicosia Lions'::text, 5.0) and r.players_in is null, format('older opposition (%s)', r);

  update public.squad_posts set status = 'matched' where id = v_opp;
  assert not tests.fm_listed(v_viewer, v_opp), 'a matched post is not open';
end $$;

-- 6. Who can call it: signed in only.
do $$
declare
  v_user uuid := tests.fm_user();
begin
  perform tests.act_as_anon();
  assert tests.error_of('select * from public.find_matches()') like '%permission denied%', 'signed out: refused';
  perform tests.act_as_service_role();
  assert tests.error_of('select * from public.find_matches()') like '%permission denied%', 'service role: refused';
  perform tests.act_as(v_user);
  assert tests.error_of('select * from public.find_matches()') is null, 'signed in: allowed';
  assert tests.error_of(format('select * from public.find_matches(p_days => %L::date[])',
                               (select array_agg(d)::text from generate_series(current_date, current_date + 40, '1 day') d)))
         = 'too_many_days', 'too many days';
  perform tests.act_as_postgres();
  assert (select prosecdef from pg_proc where oid = 'public.find_matches(text, text, uuid, date[], time, time)'::regprocedure),
    'security definer';
  assert (select proconfig from pg_proc where oid = 'public.find_matches(text, text, uuid, date[], time, time)'::regprocedure)
         = array['search_path=""'], 'search_path is empty';
end $$;

rollback;
