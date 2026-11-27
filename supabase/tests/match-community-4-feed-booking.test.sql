-- S7 Community, part 4 (bug 27 Nov): the feed gives each of my own posts its
-- booking (booking_id), so "Open post" opens that game. Nobody else's post
-- carries a booking id, and match results never do.
begin;

create function tests.cfb_adult(p_full_name text)
returns uuid
language sql
as $$
  select tests.create_user('cfb-' || gen_random_uuid() || '@futty.test', jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - interval '30 years')::date, 'full_name', p_full_name));
$$;

-- A post two days ahead, on this booking (or none).
create function tests.cfb_post(p_poster uuid, p_venue uuid, p_booking uuid, p_type text default 'players',
                               p_status text default 'open')
returns uuid
language sql
as $$
  insert into public.squad_posts (type, venue_id, scheduled_at, format, players_needed, status, posted_by, venue_booking_id)
  values (p_type, p_venue, now() + interval '2 days', '5-a-side', 3, p_status, p_poster, p_booking)
  returning id;
$$;

create function tests.cfb_feed(p_as uuid, p_scope text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_as);
  select coalesce(jsonb_agg(to_jsonb(f)), '[]') into v from public.community_feed(p_scope, null, null, 50) f;
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.cfb_item(p_feed jsonb, p_item uuid)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(p_feed) e where e ->> 'item_id' = p_item::text;
$$;

do $$
declare
  v_me uuid := tests.cfb_adult('Me Player');
  v_stranger uuid := tests.cfb_adult('Stelios Stranger');
  v_team uuid := tests.create_team('Kato United');
  v_rivals uuid := tests.create_team('Limassol Lions');
  v_venue uuid := tests.create_venue();
  v_my_booking uuid;
  v_their_booking uuid;
  v_my_players uuid;
  v_my_opposition uuid;
  v_my_bookingless uuid;
  v_their_post uuid;
  v_match uuid;
  v_feed jsonb;
  v_row jsonb;
begin
  update public.venues set is_live = true where id = v_venue;
  v_my_booking := (tests.booking_with_players(v_me, v_venue, 'each_pays_own_spot', 0, tests.next_weekday(3))).id;
  v_their_booking := (tests.booking_with_players(v_stranger, v_venue, 'each_pays_own_spot', 0, tests.next_weekday(4))).id;

  v_my_players := tests.cfb_post(v_me, v_venue, v_my_booking);
  v_my_opposition := tests.cfb_post(v_me, v_venue, v_my_booking, 'opposition', 'matched');
  v_my_bookingless := tests.cfb_post(v_me, v_venue, null);
  v_their_post := tests.cfb_post(v_stranger, v_venue, v_their_booking);

  -- Mine: each of my posts with its booking, or none.
  v_feed := tests.cfb_feed(v_me, 'mine');
  assert tests.cfb_item(v_feed, v_my_players) ->> 'booking_id' = v_my_booking::text,
    'my players post carries its booking, got ' || coalesce(tests.cfb_item(v_feed, v_my_players)::text, 'nothing');
  assert tests.cfb_item(v_feed, v_my_opposition) ->> 'booking_id' = v_my_booking::text,
    'my opposition post carries its booking';
  assert tests.cfb_item(v_feed, v_my_bookingless) ? 'booking_id', 'the column is there';
  assert tests.cfb_item(v_feed, v_my_bookingless) ->> 'booking_id' is null, 'a post with no booking has none';

  -- For you: someone else's open post never carries their booking id.
  v_feed := tests.cfb_feed(v_me, 'for_you');
  assert tests.cfb_item(v_feed, v_their_post) is not null, 'their open post is listed';
  assert tests.cfb_item(v_feed, v_their_post) ->> 'booking_id' is null, 'no booking id on their post';
  assert tests.cfb_item(v_feed, v_my_players) ->> 'booking_id' = v_my_booking::text, 'mine still has it here';

  -- A match result never carries one.
  perform tests.follow_team(v_me, v_team);
  v_match := tests.form_match(now() - interval '1 day', 'confirmed', 2, 1, v_team, v_rivals);
  v_feed := tests.cfb_feed(v_me, 'for_you');
  v_row := tests.cfb_item(v_feed, v_match);
  assert v_row ->> 'kind' = 'match_result', 'the result is listed';
  assert v_row ? 'booking_id' and v_row ->> 'booking_id' is null, 'no booking id on a result';
end;
$$;

rollback;
