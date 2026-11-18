-- Saved searches: the rules on saving them (spec 13 "Saved searches",
-- decided 18 November) and who can see what.
--   - at most app_rules.saved_searches_max (5) per player;
--   - a dated search at most the player's own booking window ahead
--     (rule_window_days), never in the past;
--   - a city of a live venue, or one exact area, or anywhere;
--   - the game length fits in the time window;
--   - RLS: a player sees, saves and deletes only their own; nobody edits;
--     the queue and the send log are the server's only;
--   - deleting the account removes its searches.
begin;

create or replace function tests.try_save(
  p_profile uuid,
  p_day date,
  p_weekday integer,
  p_from time default '18:00',
  p_to time default '20:00',
  p_minutes integer default 60,
  p_city text default null,
  p_area text default null
)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  perform tests.act_as(p_profile);
  v_error := tests.error_of(format(
    'insert into public.saved_searches (day, weekday, from_local, to_local, minutes, city, area) values (%L, %L, %L, %L, %L, %L, %L)',
    p_day, p_weekday, p_from, p_to, p_minutes, p_city, p_area));
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

-- 1. At most saved_searches_max per player, from app_rules.
do $$
declare
  v_player uuid := tests.create_user('ssr-limit@futty.test');
  v_other uuid := tests.create_user('ssr-limit-other@futty.test');
  i integer;
begin
  assert (select saved_searches_max from public.app_rules) = 5, 'spec 13: 5';
  for i in 1 .. 5 loop
    assert tests.try_save(v_player, null, i) is null, format('search %s saved', i);
  end loop;
  assert tests.try_save(v_player, null, 6) = 'saved_search_limit', 'the sixth is refused';
  assert tests.try_save(v_other, null, 6) is null, 'per player';

  -- Deleting one makes room.
  perform tests.act_as(v_player);
  delete from public.saved_searches where id = (select id from public.saved_searches where weekday = 1);
  perform tests.act_as_postgres();
  assert tests.try_save(v_player, null, 6) is null, 'room again after deleting one';

  -- The limit follows the rules.
  update public.app_rules set saved_searches_max = 6;
  assert tests.try_save(v_player, null, 7) is null, 'a sixth with the rule at 6';
  assert tests.try_save(v_player, null, 1) = 'saved_search_limit', 'a seventh refused';
end $$;

-- 2. A dated search: from today to the player's own booking window.
do $$
declare
  v_standard uuid := tests.create_user('ssr-standard@futty.test');
  v_premium uuid := tests.create_user('ssr-premium@futty.test');
  v_today date := tests.cyprus_today();
  v_window integer := (select window_standard_days from public.app_rules);
  v_premium_window integer := (select window_premium_days from public.app_rules);
begin
  perform tests.make_premium(v_premium);
  assert tests.try_save(v_standard, v_today, null, '00:00', '24:00') is null, 'today';
  assert tests.try_save(v_standard, v_today + v_window, null) is null, 'the last day of the window';
  assert tests.try_save(v_standard, v_today + v_window + 1, null) = 'saved_search_too_far', 'past the window';
  assert tests.try_save(v_standard, v_today - 1, null) = 'saved_search_in_past', 'yesterday';
  assert tests.try_save(v_premium, v_today + v_premium_window, null) is null, 'Premium: its own window';
  assert tests.try_save(v_premium, v_today + v_premium_window + 1, null) = 'saved_search_too_far', 'Premium: past it';
  -- A weekday has no date to check.
  assert tests.try_save(v_standard, null, 3) is null, 'a weekday';
end $$;

-- 3. What a search must be.
do $$
declare
  v_player uuid := tests.create_user('ssr-shape@futty.test');
  v_owner uuid := tests.create_user('ssr-shape-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_hidden uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_today date := tests.cyprus_today();
begin
  update public.venues set city = 'Nicosia (Strovolos)' where id = v_venue;
  update public.venues set city = 'Kyrenia', is_live = false where id = v_hidden;

  assert tests.try_save(v_player, v_today + 1, 2) like '%saved_searches_one_day%', 'a date or a weekday, not both';
  assert tests.try_save(v_player, null, null) like '%saved_searches_one_day%', 'one of them';
  assert tests.try_save(v_player, null, 8) like '%check%', 'weekday 1-7';
  assert tests.try_save(v_player, null, 1, '20:00', '19:00') like '%saved_searches_fits%', 'from before to';
  assert tests.try_save(v_player, null, 1, '19:00', '20:00', 90) like '%saved_searches_fits%', 'the game fits in the window';
  assert tests.try_save(v_player, null, 1, '19:00', '20:00', 45) like '%saved_searches_minutes%', 'half hours';
  assert tests.try_save(v_player, null, 1, '19:00', '24:00', 60) is null, 'until midnight';

  assert tests.try_save(v_player, null, 1, p_city => 'Nicosia') is null, 'a city of a live venue';
  assert tests.try_save(v_player, null, 2, p_area => 'Nicosia (Strovolos)') is null, 'an exact area';
  assert tests.try_save(v_player, null, 3, p_city => 'Atlantis') = 'saved_search_unknown_place', 'an unknown city';
  assert tests.try_save(v_player, null, 3, p_area => 'Nicosia (Atlantis)') = 'saved_search_unknown_place', 'an unknown area';
  assert tests.try_save(v_player, null, 3, p_city => 'Kyrenia') = 'saved_search_unknown_place', 'only live venues count';
  assert tests.try_save(v_player, null, 3, p_city => 'Nicosia', p_area => 'Nicosia (Strovolos)') like '%saved_searches_one_place%',
    'a city or an area, not both';

  -- The places the app offers.
  perform tests.act_as(v_player);
  assert public.saved_search_places() @> '[{"city": "Nicosia", "areas": ["Nicosia (Strovolos)"]}]'::jsonb,
    format('places, got %s', public.saved_search_places());
  assert not public.saved_search_places() @> '[{"city": "Kyrenia"}]'::jsonb, 'no hidden venue';
  perform tests.act_as_postgres();
end $$;

-- 4. RLS: only your own; nobody edits; the server's tables stay hidden.
do $$
declare
  v_me uuid := tests.create_user('ssr-me@futty.test');
  v_you uuid := tests.create_user('ssr-you@futty.test');
  v_mine uuid;
  v_n integer;
begin
  assert tests.try_save(v_me, null, 4) is null, 'saved';
  v_mine := (select id from public.saved_searches where profile_id = v_me);

  perform tests.act_as(v_you);
  select count(*) into v_n from public.saved_searches where id = v_mine;
  assert v_n = 0, 'another player can''t see it';
  delete from public.saved_searches where id = v_mine;
  assert tests.error_of(format(
    'insert into public.saved_searches (profile_id, weekday, from_local, to_local, minutes) values (%L, 1, ''18:00'', ''20:00'', 60)',
    v_me)) is not null, 'nor save one for someone else';
  perform tests.act_as(v_me);
  assert tests.error_of(format('update public.saved_searches set minutes = 30 where id = %L', v_mine)) is not null,
    'nobody edits a search: delete it and save another';
  select count(*) into v_n from public.saved_searches;
  assert v_n = 1, 'the owner sees theirs';
  assert tests.error_of('select count(*) from public.saved_search_events') is not null, 'the queue is the server''s';
  assert tests.error_of('select count(*) from public.saved_search_sends') is not null, 'the send log is the server''s';
  perform tests.act_as_anon();
  assert tests.error_of('select count(*) from public.saved_searches') is not null, 'anonymous: nothing';
  perform tests.act_as_postgres();
  assert exists (select 1 from public.saved_searches where id = v_mine), 'still there: the other player''s delete did nothing';

  assert not has_function_privilege('authenticated', 'public.saved_searches_tick(timestamptz)', 'execute')
     and not has_function_privilege('anon', 'public.saved_searches_tick(timestamptz)', 'execute')
     and has_function_privilege('service_role', 'public.saved_searches_tick(timestamptz)', 'execute'),
    'the tick: service_role only';
  assert has_function_privilege('authenticated', 'public.saved_search_places()', 'execute')
     and not has_function_privilege('anon', 'public.saved_search_places()', 'execute'), 'places: signed in';
end $$;

-- 5. Deleting the account removes its searches; a dated search is removed
-- once its day has passed.
do $$
declare
  v_player uuid := tests.create_user('ssr-gone@futty.test');
  v_old uuid;
begin
  assert tests.try_save(v_player, null, 5) is null, 'saved';
  -- (delete-account also deletes them itself: it scrubs the profile rather
  -- than deleting the row; supabase/functions/delete-account/links.ts.)
  delete from public.profiles where id = v_player;
  assert not exists (select 1 from public.saved_searches where profile_id = v_player), 'gone with the profile';

  v_player := tests.create_user('ssr-old@futty.test');
  assert tests.try_save(v_player, tests.cyprus_today(), null) is null, 'today';
  v_old := (select id from public.saved_searches where profile_id = v_player);
  perform public.saved_searches_tick(now() + interval '1 day');
  assert not exists (select 1 from public.saved_searches where id = v_old), 'a dated search is removed once its day has passed';
end $$;

rollback;
