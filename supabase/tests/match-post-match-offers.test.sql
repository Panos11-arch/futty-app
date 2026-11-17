-- A8: post-match food and drink offers (spec 05, "Food and drink after the
-- game"; spec 13, "Post-match offers", decided 17 November). Once a score
-- is in (submitted, even if rejected, or confirmed), every player in the
-- match sees the venue's active post-match offers available at that moment
-- in Cyprus time, until 2 hours after the end or midnight on the match day,
-- whichever is first. Anyone else sees none. Opening one gives a
-- 6-character code (one per player, offer and match), valid until midnight
-- on the match day, and records one view per code. Only that venue's staff
-- redeem it, once, and never their own code. Codes and redemptions outlive
-- a deleted profile or menu item.
--
-- The *_for functions take the time, so these tests set it; the app calls
-- the wrappers, which pass auth.uid() and now().
begin;

-- A Cyprus wall-clock time on Wednesday 2 December 2026.
create function tests.pmo_at(p_local text)
returns timestamptz
language sql
immutable
as $$ select (('2026-12-02 ' || p_local)::timestamp) at time zone 'Asia/Nicosia' $$;

create function tests.pmo_item(
  p_venue uuid,
  p_name text,
  p_from time default null,
  p_to time default null,
  p_days smallint[] default null,
  p_active boolean default true,
  p_offer boolean default true
)
returns uuid
language sql
as $$
  insert into public.venue_menu_items (venue_id, name, price_cents, offer_text, offer_price_cents,
                                       available_from, available_to, available_weekdays, is_post_match_offer, active)
  values (p_venue, p_name, 400, p_name || ' after your match', 300, p_from, p_to, p_days, p_offer, p_active)
  returning id;
$$;

-- A score submitted for p_match an hour after its kickoff (p_response:
-- null while unanswered, or 'accepted' / 'rejected').
create function tests.pmo_score(p_match uuid, p_response text default null)
returns void
language sql
as $$
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by, submitted_at,
                                               response, responded_by, responded_at)
  select m.id, 'a', 3, 2, gen_random_uuid(), m.kickoff_at + interval '1 hour',
         p_response, case when p_response is not null then gen_random_uuid() end,
         case when p_response is not null then m.kickoff_at + interval '70 minutes' end
  from public.matches m where m.id = p_match;
$$;

-- A one-hour pickup match at p_venue kicking off at p_kickoff (Cyprus wall
-- clock on 2 December), with a score submitted when p_scored.
create function tests.pmo_match(p_venue uuid, p_kickoff text, p_scored boolean default true)
returns uuid
language plpgsql
as $$
declare
  v_match uuid := tests.form_match(tests.pmo_at(p_kickoff), 'played', p_venue => p_venue);
begin
  if p_scored then
    perform tests.pmo_score(v_match);
  end if;
  return v_match;
end;
$$;

create function tests.pmo_names(p_match uuid, p_profile uuid, p_now timestamptz)
returns text
language sql
as $$
  select coalesce(string_agg(o ->> 'name', ',' order by o ->> 'name'), '')
  from jsonb_array_elements(public.post_match_offers_for(p_match, p_profile, p_now)) o;
$$;

create function tests.pmo_code(p_match uuid, p_item uuid, p_profile uuid, p_now timestamptz)
returns text
language sql
as $$ select public.open_post_match_offer_for(p_match, p_item, p_profile, p_now) ->> 'code' $$;

create function tests.pmo_views(p_code text)
returns bigint
language sql
as $$
  select count(*) from public.post_match_offer_views w join public.post_match_offer_codes c on c.id = w.code_id
  where c.code = p_code;
$$;

-- Can p_user open the match screen (matches RLS)?
create function tests.pmo_can_view(p_user uuid, p_match uuid)
returns boolean
language plpgsql
as $$
declare
  v_can boolean;
begin
  perform tests.act_as(p_user);
  v_can := public.can_view_match(p_match);
  perform tests.act_as_postgres();
  return v_can;
end;
$$;

do $$
declare
  v_owner_a uuid := tests.create_user('pmo-owner-a@futty.test');
  v_owner_b uuid := tests.create_user('pmo-owner-b@futty.test');
  v_player uuid := tests.create_user('pmo-player@futty.test');
  v_other uuid := tests.create_user('pmo-other@futty.test');
  v_left uuid := tests.create_user('pmo-left@futty.test');
  v_stranger uuid := tests.create_user('pmo-stranger@futty.test');
  v_venue_a uuid := tests.create_venue(v_owner_a);
  v_venue_b uuid := tests.create_venue(v_owner_b);
  v_lunch uuid := tests.pmo_item(v_venue_a, 'Lunch wrap', '11:00', '16:00');
  v_evening uuid := tests.pmo_item(v_venue_a, 'Evening beer', '18:00', '23:59:59');
  v_all_day uuid := tests.pmo_item(v_venue_a, 'Lemonade');
  v_weekend uuid := tests.pmo_item(v_venue_a, 'Weekend brunch', p_days => array[6, 7]::smallint[]);
  v_inactive uuid := tests.pmo_item(v_venue_a, 'Old pie', p_active => false);
  v_not_offer uuid := tests.pmo_item(v_venue_a, 'Plain water', p_offer => false);
  v_b_item uuid := tests.pmo_item(v_venue_b, 'B lemonade');
  v_noon uuid := tests.pmo_match(v_venue_a, '12:30');          -- ends 13:30
  v_night uuid := tests.pmo_match(v_venue_a, '20:30');         -- ends 21:30
  v_late uuid := tests.pmo_match(v_venue_a, '22:00');          -- ends 23:00
  v_unscored uuid := tests.pmo_match(v_venue_a, '12:30', false);
  v_rejected uuid := tests.pmo_match(v_venue_a, '12:30', false);
  v_void uuid := tests.pmo_match(v_venue_a, '12:30');
  v_no_venue uuid := tests.form_match(tests.pmo_at('12:30'), 'played');
  v_at_b uuid := tests.pmo_match(v_venue_b, '12:30');
  v_owner_plays uuid := tests.pmo_match(v_venue_a, '12:30');
  v_code text;
  v_again text;
  v_result jsonb;
  v_offer jsonb;
  v_item uuid;
begin
  perform tests.form_player(m, v_player, 'a', false, false)
  from unnest(array[v_noon, v_night, v_late, v_unscored, v_rejected, v_void, v_no_venue, v_at_b]) m;
  perform tests.form_player(v_noon, v_other, 'b', false, false);
  perform tests.form_player(v_noon, v_left, 'b', false, false, true);
  perform tests.form_player(v_owner_plays, v_owner_a, 'a', false, false);

  -- Which offers show at 14:00 vs 22:00 Cyprus time (Wednesday). Inactive
  -- items, items that aren't post-match offers, weekend-only items and other
  -- venues' items never show.
  assert tests.pmo_names(v_noon, v_player, tests.pmo_at('14:00')) = 'Lemonade,Lunch wrap',
    '14:00: ' || tests.pmo_names(v_noon, v_player, tests.pmo_at('14:00'));
  assert tests.pmo_names(v_night, v_player, tests.pmo_at('22:00')) = 'Evening beer,Lemonade',
    '22:00: ' || tests.pmo_names(v_night, v_player, tests.pmo_at('22:00'));
  assert public.menu_item_available_at((select i from public.venue_menu_items i where id = v_lunch), tests.pmo_at('14:00'));
  assert not public.menu_item_available_at((select i from public.venue_menu_items i where id = v_lunch), tests.pmo_at('22:00'));
  assert not public.menu_item_available_at((select i from public.venue_menu_items i where id = v_lunch), tests.pmo_at('16:00')),
    'the window ends at available_to';
  assert public.menu_item_available_at((select i from public.venue_menu_items i where id = v_weekend),
                                       tests.pmo_at('14:00') + interval '3 days'), 'Saturday is a weekend day';

  -- Every player in the match sees them. Anyone else sees none (an empty
  -- list, not an error): a player who left, the venue's staff, a stranger.
  assert tests.pmo_names(v_noon, v_other, tests.pmo_at('14:00')) = 'Lemonade,Lunch wrap', 'the other side sees them too';
  assert tests.pmo_names(v_noon, v_left, tests.pmo_at('14:00')) = '', 'a player who left';
  assert tests.pmo_can_view(v_owner_a, v_noon), 'the venue''s staff can open the match screen';
  assert tests.pmo_names(v_noon, v_owner_a, tests.pmo_at('14:00')) = '', 'the venue''s staff, not playing';
  assert tests.pmo_names(v_noon, v_stranger, tests.pmo_at('14:00')) = '', 'a stranger';
  assert tests.pmo_names(gen_random_uuid(), v_player, tests.pmo_at('14:00')) = '', 'no such match';
  -- Opening one still needs a player in the match.
  assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_noon, v_lunch, v_owner_a,
                               tests.pmo_at('14:00'))) = 'not_in_match', 'staff can''t open a code';

  -- Only once a score is in: none before a submission, and a confirmed match shows them.
  assert tests.pmo_names(v_unscored, v_player, tests.pmo_at('14:00')) = '', 'no score yet';
  assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_unscored, v_all_day, v_player,
                               tests.pmo_at('14:00'))) = 'offer_not_available', 'no code before a score';
  update public.matches set status = 'confirmed', confirmed_at = tests.pmo_at('13:45'), confirmed_via = 'agreed',
                            side_a_score = 1, side_b_score = 1
  where id = v_unscored;
  assert tests.pmo_names(v_unscored, v_player, tests.pmo_at('14:00')) = 'Lemonade,Lunch wrap', 'confirmed';

  -- A rejected score still counts as entered (decided 17 November): the
  -- players are still at the venue.
  perform tests.pmo_score(v_rejected, 'rejected');
  update public.matches set status = 'disputed' where id = v_rejected;
  assert tests.pmo_names(v_rejected, v_player, tests.pmo_at('14:00')) = 'Lemonade,Lunch wrap', 'rejected and disputed';
  assert tests.pmo_code(v_rejected, v_all_day, v_player, tests.pmo_at('14:00')) is not null, 'a code after a rejected score';

  -- A void match, or one with no venue, has no offers.
  update public.matches set status = 'void' where id = v_void;
  assert tests.pmo_names(v_void, v_player, tests.pmo_at('14:00')) = '', 'void';
  assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_void, v_all_day, v_player,
                               tests.pmo_at('14:00'))) = 'offer_not_available', 'no code for a void match';
  perform tests.pmo_score(v_no_venue);
  assert tests.pmo_names(v_no_venue, v_player, tests.pmo_at('14:00')) = '', 'no venue';
  assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_no_venue, v_all_day, v_player,
                               tests.pmo_at('14:00'))) = 'offer_not_available', 'no code without a venue';

  -- Until 2 hours after the end: shown at end + 1h59, gone at end + 2h01.
  assert tests.pmo_names(v_noon, v_player, tests.pmo_at('15:29')) = 'Lemonade,Lunch wrap', 'end + 1h59';
  assert tests.pmo_names(v_noon, v_player, tests.pmo_at('15:31')) = '', 'end + 2h01';
  assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_noon, v_all_day, v_player,
                               tests.pmo_at('15:31'))) = 'offer_not_available', 'no new code after the window';

  -- ...or midnight on the match day, whichever is first (decided 17 November).
  assert tests.pmo_names(v_late, v_player, tests.pmo_at('23:30')) = 'Evening beer,Lemonade', '23:30 after a 22:00 game';
  assert tests.pmo_names(v_late, v_player, tests.pmo_at('23:30') + interval '1 hour') = '', '00:30: past midnight';

  -- Opening an offer gives a 6-character code with no look-alikes and records a view.
  v_result := public.open_post_match_offer_for(v_noon, v_lunch, v_player, tests.pmo_at('15:30') - interval '2 minutes');
  v_code := v_result ->> 'code';
  assert v_code ~ '^[A-HJ-NP-Z2-9]{6}$', 'code format: ' || v_code;
  assert (v_result ->> 'expires_at')::timestamptz = tests.pmo_at('00:00') + interval '1 day', 'valid until midnight';
  v_offer := v_result -> 'offer';
  assert v_offer ->> 'name' = 'Lunch wrap' and (v_offer ->> 'price_cents')::int = 400
         and (v_offer ->> 'offer_price_cents')::int = 300 and v_offer ->> 'offer_text' = 'Lunch wrap after your match',
    'the offer comes with the code: ' || v_offer::text;
  assert tests.pmo_views(v_code) = 1, 'one view';

  -- One code per player, offer and match: opening it again gives the same
  -- code and no second view; another offer or player gets another code.
  v_again := tests.pmo_code(v_noon, v_lunch, v_player, tests.pmo_at('15:29'));
  assert v_again = v_code, 'same code again';
  assert (select count(*) from public.post_match_offer_codes where match_id = v_noon and profile_id = v_player) = 1;
  assert tests.pmo_views(v_code) = 1, 'reopening adds no view';
  assert tests.pmo_code(v_noon, v_all_day, v_player, tests.pmo_at('14:00')) <> v_code, 'another offer';
  assert tests.pmo_code(v_noon, v_lunch, v_other, tests.pmo_at('14:00')) <> v_code, 'another player';

  -- Only offers the list shows can be opened.
  foreach v_item in array array[v_evening, v_weekend, v_inactive, v_not_offer, v_b_item] loop
    assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_noon, v_item, v_player,
                                 tests.pmo_at('14:00'))) = 'offer_not_available', 'not openable: ' || v_item;
  end loop;
  assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_noon, v_lunch, v_stranger,
                               tests.pmo_at('14:00'))) = 'not_in_match';

  -- Staff check a code before redeeming it.
  v_result := public.check_offer_code_for(v_venue_a, lower(' ' || v_code || ' '), v_owner_a, tests.pmo_at('16:30'));
  assert v_result -> 'offer' ->> 'name' = 'Lunch wrap', 'check: ' || v_result::text;
  assert not exists (select 1 from public.post_match_offer_codes where code = v_code and redeemed_at is not null),
    'checking does not redeem';

  -- Venue A's staff can't redeem venue B's code; someone who isn't staff can't redeem at all.
  v_again := tests.pmo_code(v_at_b, v_b_item, v_player, tests.pmo_at('14:00'));
  assert tests.error_of(format('select public.redeem_offer_code_for(%L, %L, %L, %L)', v_venue_a, v_again, v_owner_a,
                               tests.pmo_at('14:00'))) = 'code_not_found', 'B''s code at A';
  assert tests.error_of(format('select public.redeem_offer_code_for(%L, %L, %L, %L)', v_venue_b, v_again, v_owner_a,
                               tests.pmo_at('14:00'))) = 'not_venue_staff', 'A''s owner at B';
  assert tests.error_of(format('select public.redeem_offer_code_for(%L, %L, %L, %L)', v_venue_a, v_code, v_player,
                               tests.pmo_at('14:00'))) = 'not_venue_staff', 'a player';
  assert tests.error_of(format('select public.redeem_offer_code_for(%L, %L, %L, %L)', v_venue_a, 'ZZZZZZ', v_owner_a,
                               tests.pmo_at('14:00'))) = 'code_not_found', 'no such code';

  -- A player can't redeem their own code, even as the venue's staff.
  v_again := tests.pmo_code(v_owner_plays, v_all_day, v_owner_a, tests.pmo_at('14:00'));
  assert tests.error_of(format('select public.redeem_offer_code_for(%L, %L, %L, %L)', v_venue_a, v_again, v_owner_a,
                               tests.pmo_at('14:00'))) = 'own_code', 'own code';

  -- Honoured after the item's window has closed (16:00), before midnight; redeemed once, and recorded.
  v_result := public.redeem_offer_code_for(v_venue_a, v_code, v_owner_a, tests.pmo_at('17:00'));
  assert v_result -> 'offer' ->> 'name' = 'Lunch wrap';
  assert (select redeemed_at = tests.pmo_at('17:00') and redeemed_by = v_owner_a
          from public.post_match_offer_codes where code = v_code), 'redemption recorded';
  assert tests.error_of(format('select public.redeem_offer_code_for(%L, %L, %L, %L)', v_venue_a, v_code, v_owner_a,
                               tests.pmo_at('17:01'))) = 'code_already_redeemed', 'redeemed once';
  assert tests.error_of(format('select public.check_offer_code_for(%L, %L, %L, %L)', v_venue_a, v_code, v_owner_a,
                               tests.pmo_at('17:01'))) = 'code_already_redeemed', 'check says so too';
  -- Reopening a redeemed code says it was redeemed.
  assert public.open_post_match_offer_for(v_noon, v_lunch, v_player, tests.pmo_at('15:00')) ->> 'redeemed_at' is not null;

  -- Refused after midnight on the match day, and the player's own code
  -- can't be reopened then either.
  v_again := tests.pmo_code(v_night, v_evening, v_player, tests.pmo_at('22:00'));
  assert tests.error_of(format('select public.redeem_offer_code_for(%L, %L, %L, %L)', v_venue_a, v_again, v_owner_a,
                               tests.pmo_at('00:01') + interval '1 day')) = 'code_expired', 'after midnight';
  assert tests.error_of(format('select public.open_post_match_offer_for(%L, %L, %L, %L)', v_night, v_evening, v_player,
                               tests.pmo_at('00:01') + interval '1 day')) = 'code_expired', 'reopened after midnight';
  assert public.redeem_offer_code_for(v_venue_a, v_again, v_owner_a, tests.pmo_at('23:59')) ->> 'code' = v_again,
    'just before midnight';
end $$;

-- Other people who can open the match screen without playing: the booker
-- who isn't playing, and a team's captain who isn't on the roster. They
-- see no offers.
do $$
declare
  v_owner uuid := tests.create_user('pmo-v-owner@futty.test');
  v_booker uuid := tests.create_user('pmo-v-booker@futty.test');
  v_captain uuid := tests.create_user('pmo-v-captain@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_item uuid := tests.pmo_item(v_venue, 'Lemonade');
  v_booking public.venue_bookings;
  v_match public.matches;
  v_team_a uuid := tests.create_team('PMO home');
  v_team_b uuid := tests.create_team('PMO away');
  v_named uuid;
  v_player uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 2,
                                          '12:00', '13:00', 'pmo-v');
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  v_match := tests.match_of(v_booking.id);
  assert v_match.id is not null, 'the booking has its match';
  v_player := (tests.player(v_booking.id, 1)).profile_id;
  update public.match_players set left_at = v_match.kickoff_at - interval '1 day'
  where match_id = v_match.id and profile_id = v_booker;
  perform tests.pmo_score(v_match.id);
  assert tests.pmo_can_view(v_booker, v_match.id), 'the booker can open the match screen';
  assert tests.pmo_names(v_match.id, v_booker, v_match.ends_at + interval '1 hour') = '', 'the booker, not playing';
  assert tests.pmo_names(v_match.id, v_player, v_match.ends_at + interval '1 hour') = 'Lemonade', 'a player';

  perform tests.join_team(v_team_a, v_captain, 'captain');
  v_named := tests.form_match(v_match.kickoff_at, 'played', p_team_a => v_team_a, p_team_b => v_team_b, p_venue => v_venue);
  perform tests.pmo_score(v_named);
  assert tests.pmo_can_view(v_captain, v_named), 'the captain can open the match screen';
  assert tests.pmo_names(v_named, v_captain, v_match.ends_at + interval '1 hour') = '', 'the captain, not on the roster';
end $$;

-- Codes and redemptions are the venue's history: deleting the player or
-- the menu item keeps them (and the counts).
do $$
declare
  v_owner uuid := tests.create_user('pmo-d-owner@futty.test');
  v_holder uuid := tests.create_user('pmo-d-holder@futty.test');
  v_venue uuid := tests.create_venue(v_owner);
  v_item uuid := tests.pmo_item(v_venue, 'Lemonade');
  v_other_item uuid := tests.pmo_item(v_venue, 'Iced tea');
  v_match uuid := tests.pmo_match(v_venue, '12:30');
  v_code text;
  v_unused text;
begin
  perform tests.form_player(v_match, v_holder, 'a', false, false);
  v_code := tests.pmo_code(v_match, v_item, v_holder, tests.pmo_at('14:00'));
  v_unused := tests.pmo_code(v_match, v_other_item, v_holder, tests.pmo_at('14:00'));
  perform public.redeem_offer_code_for(v_venue, v_code, v_owner, tests.pmo_at('14:30'));

  delete from public.venue_menu_items where id = v_item;
  delete from public.profiles where id = v_holder;

  assert (select count(*) from public.post_match_offer_codes where venue_id = v_venue) = 2, 'both codes kept';
  assert (select count(*) from public.post_match_offer_codes where venue_id = v_venue and redeemed_at is not null) = 1,
    'the redemption kept';
  assert (select count(*) from public.post_match_offer_views w join public.post_match_offer_codes c on c.id = w.code_id
          where c.venue_id = v_venue) = 2, 'the views kept';
  assert (select item_id is null and profile_id is null and redeemed_by = v_owner
          from public.post_match_offer_codes where code = v_code), 'item and holder cleared, staff kept';
  -- A code whose holder has gone can't be redeemed any more.
  assert tests.error_of(format('select public.check_offer_code_for(%L, %L, %L, %L)', v_venue, v_unused, v_owner,
                               tests.pmo_at('15:00'))) = 'offer_not_available', 'holder deleted';
end $$;

-- The app's wrappers: players and staff act as themselves at now(); the
-- tables and the *_for functions are closed to the app. The match kicks
-- off within the last 90 minutes but never before midnight today (Cyprus),
-- so the offers are on now at any time of day.
do $$
declare
  v_owner uuid := tests.create_user('pmo-w-owner@futty.test');
  v_player uuid := tests.create_user('pmo-w-player@futty.test');
  v_venue uuid := tests.create_venue(v_owner);
  v_item uuid := tests.pmo_item(v_venue, 'Any time lemonade');
  v_match uuid := tests.form_match(
    greatest(now() - interval '90 minutes',
             ((now() at time zone 'Asia/Nicosia')::date)::timestamp at time zone 'Asia/Nicosia'),
    'played', p_venue => v_venue);
  v_code text;
begin
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
  values (v_match, 'a', 1, 0, v_player);
  perform tests.form_player(v_match, v_player, 'a', false, false);

  perform tests.act_as(v_player);
  assert jsonb_array_length(public.post_match_offers(v_match)) = 1, 'the player sees the offer';
  v_code := public.open_post_match_offer(v_match, v_item) ->> 'code';
  perform tests.act_as(v_owner);
  assert jsonb_array_length(public.post_match_offers(v_match)) = 0, 'the venue''s staff see none';
  assert public.check_offer_code(v_venue, v_code) ->> 'code' = v_code;
  assert public.redeem_offer_code(v_venue, v_code) ->> 'code' = v_code;
  perform tests.act_as_postgres();
  assert (select redeemed_by from public.post_match_offer_codes where code = v_code) = v_owner;

  assert tests.error_as(v_player, 'select count(*) from public.post_match_offer_codes') like 'permission denied%';
  assert tests.error_as(v_player, 'select count(*) from public.post_match_offer_views') like 'permission denied%';
  assert tests.error_as(v_player, format('select public.post_match_offers_for(%L, %L, now())', v_match, v_player))
    like 'permission denied%';
  assert tests.error_as(v_owner, format('select public.redeem_offer_code_for(%L, %L, %L, now())', v_venue, 'ABCDEF', v_owner))
    like 'permission denied%';
  assert tests.error_as(v_owner, format('select public.menu_item_available_at(i, now()) from public.venue_menu_items i where id = %L', v_item))
    like 'permission denied%';
  assert tests.error_as(v_owner, format('select public.post_match_offer_player(%L, %L)', v_match, v_owner))
    like 'permission denied%';
end $$;

rollback;
