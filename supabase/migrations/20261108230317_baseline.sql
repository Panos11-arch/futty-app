


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


-- Added by hand (the only edit to the dump): pg_dump writes each object's
-- grants relative to an empty starting point, but a fresh Supabase database
-- grants ALL on every new table, sequence and function in public to anon and
-- authenticated. Without this, a local copy would silently undo
-- supabase/legacy/security-hardening.sql (anon could read
-- stripe_webhook_events, call cancel_booking_for, etc.). Clearing the
-- defaults first makes the GRANTs below rebuild production's ACLs exactly;
-- the ALTER DEFAULT PRIVILEGES at the end of this file restores production's
-- defaults for later migrations. Production never runs this file (it is
-- marked applied with `supabase migration repair`).
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."add_booking_player"("p_booking_id" "uuid", "p_username" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_booking public.venue_bookings;
  v_profile_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;

  select id into v_profile_id from public.profiles where lower(username) = lower(p_username);
  if v_profile_id is null then
    raise exception 'player_not_found';
  end if;

  perform public.add_booking_share_internal(p_booking_id, v_profile_id);
end;
$$;


ALTER FUNCTION "public"."add_booking_player"("p_booking_id" "uuid", "p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_booking_share_internal"("p_booking_id" "uuid", "p_profile_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
  v_current_count integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  v_total_needed := public.booking_total_shares_needed(p_booking_id);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id;

  if v_current_count >= v_total_needed then
    return; -- booking already has a share for every slot
  end if;

  v_share_cents := v_booking.amount_cents / v_total_needed
                   + coalesce(v_booking.service_fee_cents_per_player, 0);

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$$;


ALTER FUNCTION "public"."add_booking_share_internal"("p_booking_id" "uuid", "p_profile_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."squad_post_joiners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "profile_id" "uuid",
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" "text",
    "is_house_player" boolean DEFAULT false NOT NULL,
    CONSTRAINT "squad_post_joiners_house_player_shape_check" CHECK (((("is_house_player" = false) AND ("profile_id" IS NOT NULL) AND ("display_name" IS NULL)) OR (("is_house_player" = true) AND ("profile_id" IS NULL) AND ("display_name" IS NOT NULL))))
);


ALTER TABLE "public"."squad_post_joiners" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_house_player"("p_post_id" "uuid", "p_name" "text") RETURNS "public"."squad_post_joiners"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
  v_is_owner boolean;
  v_joined_count integer;
  v_name text;
  v_row public.squad_post_joiners;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'venue_owner') then
    raise exception 'not_venue_owner';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'name_required';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'players' then
    raise exception 'not_a_players_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  if v_post.venue_booking_id is null then
    raise exception 'not_linked_to_booking';
  end if;

  select exists (
    select 1
    from public.venue_bookings b
    join public.venues v on v.id = b.venue_id
    where b.id = v_post.venue_booking_id and v.owner_profile_id = auth.uid()
  ) into v_is_owner;
  if not v_is_owner then
    raise exception 'not_your_venue';
  end if;

  select count(*) into v_joined_count from public.squad_post_joiners where post_id = p_post_id;
  if v_joined_count >= v_post.players_needed then
    raise exception 'squad_full';
  end if;

  insert into public.squad_post_joiners (post_id, profile_id, display_name, is_house_player)
  values (p_post_id, null, v_name, true)
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."add_house_player"("p_post_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_fixture_forfeit_stats"("p_league_id" "uuid", "p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_home_result text;
  v_away_result text;
begin
  if p_result = 'home_forfeited' then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'won'; v_away_result := 'lost';
  end if;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end
  where league_id = p_league_id and team_id = p_home_team_id;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end
  where league_id = p_league_id and team_id = p_away_team_id;

  perform public.apply_personal_match_stats(p_home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(p_away_team_id, v_away_result, 0);
end;
$$;


ALTER FUNCTION "public"."apply_fixture_forfeit_stats"("p_league_id" "uuid", "p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_friendly_forfeit_stats"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_home_result text;
  v_away_result text;
begin
  if p_result = 'home_forfeited' then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'won'; v_away_result := 'lost';
  end if;

  update public.teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end
  where id = p_home_team_id;

  update public.teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end
  where id = p_away_team_id;

  perform public.apply_personal_match_stats(p_home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(p_away_team_id, v_away_result, 0);
end;
$$;


ALTER FUNCTION "public"."apply_friendly_forfeit_stats"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_friendly_match_result"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_home_score" integer, "p_away_score" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_home_result text;
  v_away_result text;
begin
  if p_home_score > p_away_score then
    v_home_result := 'won'; v_away_result := 'lost';
  elsif p_away_score > p_home_score then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'drawn'; v_away_result := 'drawn';
  end if;

  update public.teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_home_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end,
      goals = goals + p_home_score
  where id = p_home_team_id;

  update public.teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_away_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end,
      goals = goals + p_away_score
  where id = p_away_team_id;

  perform public.apply_personal_match_stats(p_home_team_id, v_home_result, p_home_score);
  perform public.apply_personal_match_stats(p_away_team_id, v_away_result, p_away_score);
end;
$$;


ALTER FUNCTION "public"."apply_friendly_match_result"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_home_score" integer, "p_away_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_personal_match_stats"("p_team_id" "uuid", "p_result" "text", "p_goals" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.profiles
  set played = played + 1,
      won = won + case when p_result = 'won' then 1 else 0 end,
      drawn = drawn + case when p_result = 'drawn' then 1 else 0 end,
      lost = lost + case when p_result = 'lost' then 1 else 0 end,
      goals = goals + p_goals
  where id in (select profile_id from public.team_members where team_id = p_team_id);
end;
$$;


ALTER FUNCTION "public"."apply_personal_match_stats"("p_team_id" "uuid", "p_result" "text", "p_goals" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_promotion_relegation"("p_hub_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_hub public.leagues;
  v_div1 public.leagues;
  v_div2 public.leagues;
  v_promoted uuid[];
  v_relegated uuid[];
  v_weeks integer;
begin
  if not public.is_captain_in_league_tree(p_hub_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_hub from public.leagues where id = p_hub_league_id;
  if v_hub.id is null or v_hub.stage <> 'divisions' then
    raise exception 'not_an_open_league_pyramid';
  end if;

  select * into v_div1 from public.leagues where parent_league_id = p_hub_league_id and name = 'Division 1';
  select * into v_div2 from public.leagues where parent_league_id = p_hub_league_id and name = 'Division 2';
  if v_div1.id is null or v_div2.id is null then
    raise exception 'divisions_not_found';
  end if;

  -- Bottom 2 of Division 1 go down.
  select array_agg(team_id) into v_relegated from (
    select team_id from public.league_teams where league_id = v_div1.id
    order by won * 3 + drawn + coalesce(pts_adjustment, 0) asc, goals_for - goals_against asc
    limit 2
  ) t;

  -- Top 2 of Division 2 go up.
  select array_agg(team_id) into v_promoted from (
    select team_id from public.league_teams where league_id = v_div2.id
    order by won * 3 + drawn + coalesce(pts_adjustment, 0) desc, goals_for - goals_against desc
    limit 2
  ) t;

  -- Division 3+ (if any) are left completely untouched, matching the
  -- prototype: only the top two divisions cycle each promotion round.

  select count(*) into v_weeks from public.league_teams where league_id = v_div1.id;
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  -- Move the swapped teams, then reset every Division 1/2 team's season stats
  -- — matches the prototype resetting p/w/d/l/gf/ga to 0 for the new season.
  update public.league_teams
  set league_id = v_div1.id
  where league_id = v_div2.id and team_id = any (v_promoted);

  update public.league_teams
  set league_id = v_div2.id
  where league_id = v_div1.id and team_id = any (v_relegated);

  update public.league_teams
  set played = 0, won = 0, drawn = 0, lost = 0,
      goals_for = 0, goals_against = 0, pts_adjustment = 0
  where league_id in (v_div1.id, v_div2.id);

  update public.leagues
  set start_date = current_date, season_weeks = v_weeks
  where id in (v_div1.id, v_div2.id);

  -- Fresh season, fresh fixture list — last season's pairings no longer
  -- match who's actually in each division after the swap above.
  delete from public.league_fixtures where league_id in (v_div1.id, v_div2.id);
  perform public.sync_league_fixtures(v_div1.id);
  perform public.sync_league_fixtures(v_div2.id);
end;
$$;


ALTER FUNCTION "public"."apply_promotion_relegation"("p_hub_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_add_booking_share_on_join"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
begin
  if new.profile_id is null then
    return new; -- house player — no account to attach a payment share to
  end if;

  select * into v_post from public.squad_posts where id = new.post_id;

  if v_post.id is not null and v_post.venue_booking_id is not null and v_post.type = 'players' then
    perform public.add_booking_share_internal(v_post.venue_booking_id, new.profile_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."auto_add_booking_share_on_join"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "team_id" "uuid",
    "booking_day" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "pitches" integer NOT NULL,
    "capacity" integer NOT NULL,
    "format" "text" NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "result" "text",
    "result_goals_for" integer,
    "result_goals_against" integer,
    "result_logged_at" timestamp with time zone,
    "stripe_payment_intent_id" "text",
    "amount_cents" integer DEFAULT 0 NOT NULL,
    "booking_type" "text" DEFAULT 'user_booking'::"text" NOT NULL,
    "note" "text",
    "service_fee_cents_per_player" integer,
    CONSTRAINT "venue_bookings_booking_type_check" CHECK (("booking_type" = ANY (ARRAY['user_booking'::"text", 'owner_block'::"text"]))),
    CONSTRAINT "venue_bookings_result_check" CHECK (("result" = ANY (ARRAY['won'::"text", 'drawn'::"text", 'lost'::"text"])))
);


ALTER TABLE "public"."venue_bookings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."book_slot"("p_venue_id" "uuid", "p_day" "date", "p_start" time without time zone, "p_end" time without time zone, "p_pitches" integer, "p_capacity" integer, "p_format" "text") RETURNS "public"."venue_bookings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_base_pitches integer;
  v_price numeric;
  v_used integer;
  v_amount_cents integer;
  v_status text;
  v_booking public.venue_bookings;
  v_players integer;
  v_share_cents integer;
  v_booker_share_cents integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Cyprus time, not the server's UTC (see supabase/cyprus-time.sql).
  if p_day < (now() at time zone 'Asia/Nicosia')::date
     or (p_day = (now() at time zone 'Asia/Nicosia')::date
         and p_start <= (now() at time zone 'Asia/Nicosia')::time) then
    raise exception 'slot_in_past';
  end if;

  select base_pitches, price_per_pitch_hour into v_base_pitches, v_price
  from public.venues
  where id = p_venue_id
  for update;

  if v_base_pitches is null then
    raise exception 'venue_not_found';
  end if;

  select coalesce(sum(pitches), 0) into v_used
  from public.venue_bookings
  where venue_id = p_venue_id
    and booking_day = p_day
    and status <> 'cancelled'
    and start_time < p_end
    and end_time > p_start;

  if v_base_pitches - v_used < p_pitches then
    raise exception 'slot_full';
  end if;

  -- Venue price only. The service fee is added per player below.
  v_amount_cents := case
    when v_price is null or v_price = 0 then 0
    else round(v_price * p_pitches * (extract(epoch from (p_end - p_start)) / 3600.0) * 100)::integer
  end;
  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player)
    values
      (p_venue_id, p_day, p_start, p_end, p_pitches, p_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.service_fee_cents() end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  -- Split the venue price evenly across everyone on the pitch (the
  -- booking's capacity: 10 for 5 v 5, and so on); the leftover cents from
  -- integer division go to the booker, per spec. Every player, booker
  -- included, then adds the service fee.
  if v_amount_cents > 0 then
    v_players := coalesce(p_capacity, public.format_player_count(p_format) * 2);
    v_share_cents := v_amount_cents / v_players;
    v_booker_share_cents := v_amount_cents - v_share_cents * (v_players - 1)
                            + public.service_fee_cents();

    insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
    values (v_booking.id, auth.uid(), v_booker_share_cents, true, 'pending');
  end if;

  return v_booking;
end;
$$;


ALTER FUNCTION "public"."book_slot"("p_venue_id" "uuid", "p_day" "date", "p_start" time without time zone, "p_end" time without time zone, "p_pitches" integer, "p_capacity" integer, "p_format" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."booking_total_shares_needed"("p_booking_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select case
    when b.service_fee_cents_per_player is not null
      then coalesce(b.capacity, public.format_player_count(b.format) * 2)
    else public.format_player_count(b.format) * (
      case when exists (
        select 1 from public.squad_posts sp
        where sp.venue_booking_id = p_booking_id and sp.type = 'opposition' and sp.status = 'matched'
      ) then 2 else 1 end
    )
  end
  from public.venue_bookings b
  where b.id = p_booking_id;
$$;


ALTER FUNCTION "public"."booking_total_shares_needed"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bookings_needing_share_cancellation"() RETURNS TABLE("booking_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select b.id
  from public.venue_bookings b
  where b.status = 'confirmed'
    -- amount_cents > 0 guard: a free venue or an owner_block never gets any
    -- booking_payment_shares rows at all (add_booking_share_internal skips
    -- them outright), so without this a free/owner-block booking would
    -- read as "0 of N shares authorized" and be wrongly flagged — the
    -- original version never hit this because its inner join to
    -- booking_payment_shares naturally excluded a booking with zero share
    -- rows.
    and b.amount_cents > 0
    and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' <= now() + interval '3 hours'
    and (
      select count(*) from public.booking_payment_shares s
      where s.booking_id = b.id and s.status in ('authorized', 'paid')
    ) < public.booking_total_shares_needed(b.id);
$$;


ALTER FUNCTION "public"."bookings_needing_share_cancellation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_booking public.venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;

  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;

  -- The 30-minute cutoff is about not backing out of a game you (and your
  -- opponent) already committed to right before kickoff — it doesn't apply
  -- to a 'pending_payment' reservation, since nothing was ever paid or
  -- promised. Releasing an unpaid hold on a near-term slot should always be
  -- allowed, immediately — otherwise abandoning payment on a slot starting
  -- soon would leave it stuck reserved with no way to free it up. Same
  -- Cyprus-local-time reasoning as book_slot's slot_in_past and
  -- log_booking_result's too_early checks for the cutoff itself.
  if v_booking.status = 'confirmed'
     and now() >= ((v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia') - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  update public.venue_bookings
  set status = 'cancelled'
  where id = p_booking_id;
end;
$$;


ALTER FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking_for"("p_booking_id" "uuid", "p_profile_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_booking public.venue_bookings;
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;

  if v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;

  if v_booking.status = 'confirmed'
     and now() >= ((v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia') - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;

  -- Returned so the Edge Function knows what it was before (no separate,
  -- racy pre-read needed).
  return v_booking.status;
end;
$$;


ALTER FUNCTION "public"."cancel_booking_for"("p_booking_id" "uuid", "p_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_opposition_match"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
  v_match public.friendly_matches;
  v_my_team uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' or v_post.status <> 'matched' then
    raise exception 'not_matched';
  end if;

  select tm.team_id into v_my_team
  from public.team_members tm
  where tm.profile_id = auth.uid()
    and tm.role = 'captain'
    and tm.team_id in (v_post.team_id, v_post.matched_team_id)
  limit 1;
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if v_post.scheduled_at is not null and now() >= v_post.scheduled_at - interval '30 minutes' then
    raise exception 'too_close_to_start';
  end if;

  select * into v_match from public.friendly_matches where squad_post_id = p_post_id for update;
  if v_match.id is not null then
    if v_match.score_attempts > 0 then
      raise exception 'score_already_submitted';
    end if;
    update public.friendly_matches set status = 'cancelled' where id = v_match.id;
  end if;

  update public.squad_posts
  set status = 'open', matched_team_id = null
  where id = p_post_id;
end;
$$;


ALTER FUNCTION "public"."cancel_opposition_match"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_opposition_offer"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;

  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;

  if v_post.status <> 'matched' then
    raise exception 'not_matched';
  end if;

  if not exists (
    select 1 from public.team_members
    where profile_id = auth.uid()
      and role = 'captain'
      and team_id in (v_post.team_id, v_post.matched_team_id)
  ) then
    raise exception 'not_captain';
  end if;

  if v_post.scheduled_at is null or now() >= v_post.scheduled_at - interval '30 minutes' then
    raise exception 'too_late_to_cancel';
  end if;

  delete from public.friendly_matches where squad_post_id = p_post_id;

  update public.squad_posts
  set status = 'open', matched_team_id = null
  where id = p_post_id;
end;
$$;


ALTER FUNCTION "public"."cancel_opposition_offer"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_pending_share"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.booking_payment_shares
  where booking_id = p_booking_id
    and profile_id = auth.uid()
    and status = 'pending';
end;
$$;


ALTER FUNCTION "public"."cancel_pending_share"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_squad_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;

  -- `is distinct from`, not `<>`: posted_by is null on any post created
  -- before that column existed, and `null <> auth.uid()` is null (neither
  -- true nor false), which would silently skip this check instead of
  -- blocking the cancel.
  if v_post.posted_by is distinct from auth.uid() then
    raise exception 'not_your_post';
  end if;

  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;

  update public.squad_posts set status = 'cancelled' where id = p_post_id;
end;
$$;


ALTER FUNCTION "public"."cancel_squad_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."league_fixtures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid",
    "division_name" "text",
    "home_team_id" "uuid",
    "away_team_id" "uuid",
    "venue_id" "uuid",
    "scheduled_day" "date",
    "scheduled_time" time without time zone,
    "status" "text" DEFAULT 'unscheduled'::"text",
    "score_attempts" integer DEFAULT 0,
    "score_locked" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "home_score" integer,
    "away_score" integer,
    "forfeit_result" "text",
    CONSTRAINT "league_fixtures_forfeit_result_check" CHECK ((("forfeit_result" IS NULL) OR ("forfeit_result" = ANY (ARRAY['home_forfeited'::"text", 'away_forfeited'::"text", 'void'::"text"]))))
);


ALTER TABLE "public"."league_fixtures" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."captain_team_for_fixture"("p_fixture" "public"."league_fixtures") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select tm.team_id
  from public.team_members tm
  where tm.profile_id = auth.uid()
    and tm.role = 'captain'
    and tm.team_id in (p_fixture.home_team_id, p_fixture.away_team_id)
  limit 1;
$$;


ALTER FUNCTION "public"."captain_team_for_fixture"("p_fixture" "public"."league_fixtures") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_fixture_score_match"("p_fixture_id" "uuid") RETURNS "public"."league_fixtures"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_fixture public.league_fixtures;
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.fixture_score_submissions;
  v_away_last public.fixture_score_submissions;
  v_home_result text;
  v_away_result text;
  v_home_dispute_count integer;
  v_away_dispute_count integer;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  select * into v_home_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    if v_home_last.home_score > v_home_last.away_score then
      v_home_result := 'won'; v_away_result := 'lost';
    elsif v_home_last.away_score > v_home_last.home_score then
      v_home_result := 'lost'; v_away_result := 'won';
    else
      v_home_result := 'drawn'; v_away_result := 'drawn';
    end if;

    update public.league_fixtures set status = 'completed' where id = p_fixture_id;

    update public.league_teams
    set played = played + 1,
        won = won + case when v_home_result = 'won' then 1 else 0 end,
        drawn = drawn + case when v_home_result = 'drawn' then 1 else 0 end,
        lost = lost + case when v_home_result = 'lost' then 1 else 0 end,
        goals_for = goals_for + v_home_last.home_score,
        goals_against = goals_against + v_home_last.away_score
    where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;

    update public.league_teams
    set played = played + 1,
        won = won + case when v_away_result = 'won' then 1 else 0 end,
        drawn = drawn + case when v_away_result = 'drawn' then 1 else 0 end,
        lost = lost + case when v_away_result = 'lost' then 1 else 0 end,
        goals_for = goals_for + v_home_last.away_score,
        goals_against = goals_against + v_home_last.home_score
    where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;

    perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home_result, v_home_last.home_score);
    perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away_result, v_home_last.away_score);

  elsif v_fixture.score_attempts >= 3 then
    update public.league_fixtures set score_locked = true where id = p_fixture_id;

    select count(distinct (home_score, away_score)) > 1 into v_home_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id;

    select count(distinct (home_score, away_score)) > 1 into v_away_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id;

    if v_home_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.home_team_id
      returning dispute_count into v_home_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.home_team_id and role = 'captain'
      );

      if v_home_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;
      end if;
    end if;
    if v_away_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.away_team_id
      returning dispute_count into v_away_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.away_team_id and role = 'captain'
      );

      if v_away_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;
      end if;
    end if;

    if v_home_changed and not v_away_changed then
      update public.league_fixtures set forfeit_result = 'home_forfeited' where id = p_fixture_id;
      perform public.apply_fixture_forfeit_stats(
        v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'home_forfeited'
      );
    elsif v_away_changed and not v_home_changed then
      update public.league_fixtures set forfeit_result = 'away_forfeited' where id = p_fixture_id;
      perform public.apply_fixture_forfeit_stats(
        v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'away_forfeited'
      );
    else
      update public.league_fixtures set forfeit_result = 'void' where id = p_fixture_id;
    end if;
  end if;

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;


ALTER FUNCTION "public"."check_fixture_score_match"("p_fixture_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friendly_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "squad_post_id" "uuid",
    "home_team_id" "uuid",
    "away_team_id" "uuid",
    "status" "text" DEFAULT 'pending_score'::"text",
    "score_attempts" integer DEFAULT 0,
    "home_score" integer,
    "away_score" integer,
    "forfeit_result" "text",
    "payment_settlement" "text",
    "payment_settled_at" timestamp with time zone,
    CONSTRAINT "friendly_matches_forfeit_result_check" CHECK ((("forfeit_result" IS NULL) OR ("forfeit_result" = ANY (ARRAY['home_forfeited'::"text", 'away_forfeited'::"text", 'void'::"text"])))),
    CONSTRAINT "friendly_matches_payment_settlement_check" CHECK ((("payment_settlement" IS NULL) OR ("payment_settlement" = ANY (ARRAY['home_wins'::"text", 'away_wins'::"text", 'draw'::"text", 'void'::"text"])))),
    CONSTRAINT "friendly_matches_status_check" CHECK (("status" = ANY (ARRAY['pending_score'::"text", 'confirmed'::"text", 'locked'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."friendly_matches" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_friendly_score_match"("p_match_id" "uuid") RETURNS "public"."friendly_matches"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_match public.friendly_matches;
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.friendly_match_scores;
  v_away_last public.friendly_match_scores;
  v_settlement text;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match_not_found';
  end if;

  select * into v_home_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.friendly_match_scores
  where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    update public.friendly_matches set status = 'confirmed' where id = p_match_id;

    perform public.apply_friendly_match_result(
      v_match.home_team_id, v_match.away_team_id, v_home_last.home_score, v_home_last.away_score
    );

    v_settlement := case
      when v_home_last.home_score > v_home_last.away_score then 'home_wins'
      when v_home_last.away_score > v_home_last.home_score then 'away_wins'
      else 'draw'
    end;
    perform public.record_gipedo_pano_settlement(p_match_id, v_settlement);

  elsif v_match.score_attempts >= 3 then
    update public.friendly_matches set status = 'locked' where id = p_match_id;

    select count(distinct (home_score, away_score)) > 1 into v_home_changed
    from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id;

    select count(distinct (home_score, away_score)) > 1 into v_away_changed
    from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id;

    if v_home_changed then
      update public.profiles set xp = xp - 20 where id = v_home_last.submitted_by_profile_id;
    end if;
    if v_away_changed then
      update public.profiles set xp = xp - 20 where id = v_away_last.submitted_by_profile_id;
    end if;

    -- Exactly one side at fault (kept changing its number) is now also a
    -- forfeit loss for that side — both/neither at fault stays ambiguous
    -- (void), same as before this file existed.
    if v_home_changed and not v_away_changed then
      update public.friendly_matches set forfeit_result = 'home_forfeited' where id = p_match_id;
      perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'home_forfeited');
      perform public.record_gipedo_pano_settlement(p_match_id, 'away_wins');
    elsif v_away_changed and not v_home_changed then
      update public.friendly_matches set forfeit_result = 'away_forfeited' where id = p_match_id;
      perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'away_forfeited');
      perform public.record_gipedo_pano_settlement(p_match_id, 'home_wins');
    else
      update public.friendly_matches set forfeit_result = 'void' where id = p_match_id;
      perform public.record_gipedo_pano_settlement(p_match_id, 'void');
    end if;
  end if;

  select * into v_match from public.friendly_matches where id = p_match_id;
  return v_match;
end;
$$;


ALTER FUNCTION "public"."check_friendly_score_match"("p_match_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_owner_block_capacity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_base_pitches integer;
  v_used integer;
begin
  if new.booking_type <> 'owner_block' then
    return new;
  end if;

  if new.booking_day < current_date or (new.booking_day = current_date and new.start_time <= current_time) then
    raise exception 'slot_in_past';
  end if;

  select base_pitches into v_base_pitches from public.venues where id = new.venue_id for update;

  select coalesce(sum(pitches), 0) into v_used
  from public.venue_bookings
  where venue_id = new.venue_id
    and booking_day = new.booking_day
    and status <> 'cancelled'
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and start_time < new.end_time
    and end_time > new.start_time;

  if v_base_pitches is null or v_base_pitches - v_used < new.pitches then
    raise exception 'slot_full';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."check_owner_block_capacity"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."squad_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text",
    "team_id" "uuid",
    "venue_id" "uuid",
    "scheduled_at" timestamp with time zone,
    "format" "text",
    "level" "text",
    "filled" integer DEFAULT 1,
    "total" integer,
    "status" "text" DEFAULT 'open'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "posted_by" "uuid",
    "matched_team_id" "uuid",
    "players_needed" integer,
    "venue_booking_id" "uuid",
    "position_needed" "text",
    "level_needed" "text",
    "payment_mode" "text" DEFAULT 'split'::"text" NOT NULL,
    "push_notified_at" timestamp with time zone,
    "match_notified_team_id" "uuid",
    CONSTRAINT "squad_posts_level_needed_check" CHECK ((("level_needed" IS NULL) OR ("level_needed" = ANY (ARRAY['Bronze'::"text", 'Silver'::"text", 'Gold'::"text", 'Platinum'::"text"])))),
    CONSTRAINT "squad_posts_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['split'::"text", 'gipedo_pano'::"text"]))),
    CONSTRAINT "squad_posts_position_needed_check" CHECK ((("position_needed" IS NULL) OR ("position_needed" = ANY (ARRAY['Goalkeeper'::"text", 'Defender'::"text", 'Midfielder'::"text", 'Striker'::"text"])))),
    CONSTRAINT "squad_posts_type_check" CHECK (("type" = ANY (ARRAY['players'::"text", 'opposition'::"text"])))
);


ALTER TABLE "public"."squad_posts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_squad_post"("p_booking_id" "uuid", "p_post_type" "text", "p_team_id" "uuid" DEFAULT NULL::"uuid", "p_target_count" integer DEFAULT NULL::integer) RETURNS "public"."squad_posts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
begin
  if not exists (
    select 1 from public.venue_bookings where id = p_booking_id and created_by = auth.uid()
  ) then
    raise exception 'not_your_booking';
  end if;

  if p_post_type = 'opposition' then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
    ) then
      raise exception 'not_captain';
    end if;
  elsif p_post_type = 'players' then
    if p_target_count is null or p_target_count < 1 then
      raise exception 'target_count_required';
    end if;
  else
    raise exception 'invalid_post_type';
  end if;

  insert into public.squad_posts (booking_id, post_type, posted_by, team_id, target_count)
  values (p_booking_id, p_post_type, auth.uid(), p_team_id, p_target_count)
  returning * into v_post;

  return v_post;
end;
$$;


ALTER FUNCTION "public"."create_squad_post"("p_booking_id" "uuid", "p_post_type" "text", "p_team_id" "uuid", "p_target_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text" DEFAULT NULL::"text", "p_team_id" "uuid" DEFAULT NULL::"uuid", "p_players_needed" integer DEFAULT NULL::integer, "p_venue_booking_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."squad_posts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_post_type = 'opposition' then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
    ) then
      raise exception 'not_captain';
    end if;
  elsif p_post_type = 'players' then
    if p_players_needed is null or p_players_needed < 1 then
      raise exception 'players_needed_required';
    end if;
  else
    raise exception 'invalid_post_type';
  end if;

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, level, team_id, players_needed, posted_by, status, venue_booking_id)
  values
    (p_venue_id, p_scheduled_at, p_format, p_post_type, p_level, p_team_id, p_players_needed, auth.uid(), 'open', p_venue_booking_id)
  returning * into v_post;

  return v_post;
end;
$$;


ALTER FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text" DEFAULT NULL::"text", "p_team_id" "uuid" DEFAULT NULL::"uuid", "p_players_needed" integer DEFAULT NULL::integer, "p_venue_booking_id" "uuid" DEFAULT NULL::"uuid", "p_position_needed" "text" DEFAULT NULL::"text", "p_level_needed" "text" DEFAULT NULL::"text", "p_payment_mode" "text" DEFAULT 'split'::"text") RETURNS "public"."squad_posts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_payment_mode not in ('split', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;

  if p_post_type = 'opposition' then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
    ) then
      raise exception 'not_captain';
    end if;
  elsif p_post_type = 'players' then
    if p_players_needed is null or p_players_needed < 1 then
      raise exception 'players_needed_required';
    end if;
    -- Gipedo Pano only makes sense once there are two full rosters with a
    -- winner and a loser — a "need players" post never gets there.
    if p_payment_mode <> 'split' then
      raise exception 'invalid_payment_mode';
    end if;
  else
    raise exception 'invalid_post_type';
  end if;

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, level, team_id, players_needed, posted_by, status,
     venue_booking_id, position_needed, level_needed, payment_mode)
  values
    (p_venue_id, p_scheduled_at, p_format, p_post_type, p_level, p_team_id, p_players_needed, auth.uid(), 'open',
     p_venue_booking_id, p_position_needed, p_level_needed, p_payment_mode)
  returning * into v_post;

  return v_post;
end;
$$;


ALTER FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid", "p_position_needed" "text", "p_level_needed" "text", "p_payment_mode" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "city" "text",
    "xp" integer DEFAULT 0,
    "played" integer DEFAULT 0,
    "won" integer DEFAULT 0,
    "drawn" integer DEFAULT 0,
    "lost" integer DEFAULT 0,
    "goals" integer DEFAULT 0,
    "dispute_count" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "roster_size" integer DEFAULT 11 NOT NULL,
    "substitute_slots" integer DEFAULT 0 NOT NULL,
    "premium_9aside" boolean DEFAULT false NOT NULL,
    "premium_11aside" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_team"("p_name" "text", "p_city" "text") RETURNS "public"."teams"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_team public.teams;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'name_required';
  end if;

  insert into public.teams (name, city, created_by)
  values (trim(p_name), nullif(trim(p_city), ''), auth.uid())
  returning * into v_team;

  insert into public.team_members (team_id, profile_id, role)
  values (v_team.id, auth.uid(), 'captain');

  return v_team;
end;
$$;


ALTER FUNCTION "public"."create_team"("p_name" "text", "p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_team"("p_name" "text", "p_city" "text", "p_roster_size" integer DEFAULT 11, "p_substitute_slots" integer DEFAULT 0) RETURNS "public"."teams"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_team public.teams;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'name_required';
  end if;

  if p_roster_size < 1 then
    raise exception 'roster_too_small';
  end if;
  if p_substitute_slots < 0 then
    raise exception 'invalid_substitute_slots';
  end if;

  insert into public.teams
    (name, city, created_by, xp, played, won, drawn, lost, goals, roster_size, substitute_slots)
  values
    (trim(p_name), nullif(trim(p_city), ''), auth.uid(), 0, 0, 0, 0, 0, 0, p_roster_size, p_substitute_slots)
  returning * into v_team;

  insert into public.team_members (team_id, profile_id, role)
  values (v_team.id, auth.uid(), 'captain');

  return v_team;
end;
$$;


ALTER FUNCTION "public"."create_team"("p_name" "text", "p_city" "text", "p_roster_size" integer, "p_substitute_slots" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."end_season_to_divisions"("p_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_league public.leagues;
  v_div1 public.leagues;
  v_div2 public.leagues;
  v_weeks integer;
begin
  if not public.is_captain_in_league_tree(p_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if v_league.id is null then
    raise exception 'league_not_found';
  end if;
  if v_league.capacity = 0 then
    raise exception 'not_an_open_league';
  end if;
  if v_league.stage <> 'season' then
    raise exception 'not_in_season';
  end if;

  with ranked as (
    select team_id,
      row_number() over (
        order by won * 3 + drawn + coalesce(pts_adjustment, 0) desc,
                 goals_for - goals_against desc
      ) as rank
    from public.league_teams
    where league_id = p_league_id
  )
  select count(*) into v_weeks from ranked where rank <= 10;
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity)
  values ('Division 1', v_league.format, v_league.scope, 'season', v_league.id, current_date, v_weeks, 0)
  returning * into v_div1;

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity)
  values ('Division 2', v_league.format, v_league.scope, 'season', v_league.id, current_date, v_weeks, 0)
  returning * into v_div2;

  with ranked as (
    select team_id,
      row_number() over (
        order by won * 3 + drawn + coalesce(pts_adjustment, 0) desc,
                 goals_for - goals_against desc
      ) as rank
    from public.league_teams
    where league_id = p_league_id
  )
  insert into public.league_teams
    (league_id, team_id, played, won, drawn, lost, goals_for, goals_against, pts_adjustment)
  select case when rank <= 10 then v_div1.id else v_div2.id end, team_id, 0, 0, 0, 0, 0, 0, 0
  from ranked
  where rank <= 20;

  delete from public.league_teams where league_id = p_league_id;

  update public.leagues set stage = 'divisions' where id = p_league_id;

  perform public.sync_league_fixtures(v_div1.id);
  perform public.sync_league_fixtures(v_div2.id);
end;
$$;


ALTER FUNCTION "public"."end_season_to_divisions"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_gipedo_pano_settlement"("p_match_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.friendly_matches set payment_settled_at = now() where id = p_match_id;
$$;


ALTER FUNCTION "public"."finalize_gipedo_pano_settlement"("p_match_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_profile_by_username"("p_username" "text") RETURNS TABLE("id" "uuid", "username" "text", "full_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.id, p.username, p.full_name
  from public.profiles p
  where lower(p.username) = lower(trim(p_username));
$$;


ALTER FUNCTION "public"."find_profile_by_username"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fixtures_needing_resolution"() RETURNS TABLE("fixture_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select f.id
  from public.league_fixtures f
  where f.status = 'agreed'
    and not f.score_locked
    and f.scheduled_day is not null
    and f.scheduled_time is not null
    and now() > ((f.scheduled_day + f.scheduled_time) at time zone 'Asia/Nicosia') + interval '24 hours';
$$;


ALTER FUNCTION "public"."fixtures_needing_resolution"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."form_new_division"("p_hub_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_hub public.leagues;
  v_new_division public.leagues;
  v_division_number integer;
  v_weeks integer;
begin
  if not public.is_captain_in_league_tree(p_hub_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_hub from public.leagues where id = p_hub_league_id;
  if v_hub.id is null or v_hub.stage <> 'divisions' then
    raise exception 'not_open_for_new_division';
  end if;

  select count(*) into v_division_number from public.leagues where parent_league_id = p_hub_league_id;
  v_division_number := v_division_number + 1;

  with pooled as (
    select lt.team_id, t.xp,
      -- Mirrors lib/premium.ts-style tier thresholds ported from the
      -- prototype's LEVEL_TIERS (Bronze 0 / Silver 100 / Gold 250 / Platinum 500).
      case
        when t.xp >= 500 then 3
        when t.xp >= 250 then 2
        when t.xp >= 100 then 1
        else 0
      end as tier_rank
    from public.league_teams lt
    join public.teams t on t.id = lt.team_id
    where lt.league_id = p_hub_league_id
    order by tier_rank desc, t.xp desc
    limit 10
  )
  select count(*) into v_weeks from pooled;

  if v_weeks = 0 then
    raise exception 'pool_empty';
  end if;
  if v_weeks < 4 then
    raise exception 'pool_too_small';
  end if;
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity)
  values (
    'Division ' || v_division_number, v_hub.format, v_hub.scope, 'season',
    v_hub.id, current_date, v_weeks, 0
  )
  returning * into v_new_division;

  with pooled as (
    select lt.team_id, t.xp,
      case
        when t.xp >= 500 then 3
        when t.xp >= 250 then 2
        when t.xp >= 100 then 1
        else 0
      end as tier_rank
    from public.league_teams lt
    join public.teams t on t.id = lt.team_id
    where lt.league_id = p_hub_league_id
    order by tier_rank desc, t.xp desc
    limit 10
  )
  update public.league_teams
  set league_id = v_new_division.id
  where (league_id, team_id) in (select p_hub_league_id, team_id from pooled);

  perform public.sync_league_fixtures(v_new_division.id);
end;
$$;


ALTER FUNCTION "public"."form_new_division"("p_hub_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."format_player_count"("p_format" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case p_format
    when '5-a-side' then 5
    when '7-a-side' then 7
    when '9-a-side' then 9
    when '11-a-side' then 11
    else 10 -- shouldn't happen; matches book_slot's own format/capacity pairing
  end;
$$;


ALTER FUNCTION "public"."format_player_count"("p_format" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."friendly_matches_needing_resolution"() RETURNS TABLE("match_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select fm.id
  from public.friendly_matches fm
  join public.squad_posts sp on sp.id = fm.squad_post_id
  where fm.status = 'pending_score'
    and sp.scheduled_at is not null
    and now() > sp.scheduled_at + interval '24 hours';
$$;


ALTER FUNCTION "public"."friendly_matches_needing_resolution"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_profile"("p_profile_id" "uuid") RETURNS TABLE("id" "uuid", "username" "text", "full_name" "text", "city" "text", "position" "text", "preferred_foot" "text", "xp" integer, "played" integer, "won" integer, "drawn" integer, "lost" integer, "goals" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select id, username, full_name, city, "position", preferred_foot, xp, played, won, drawn, lost, goals
  from public.profiles
  where id = p_profile_id;
$$;


ALTER FUNCTION "public"."get_public_profile"("p_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_profiles"("p_profile_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "username" "text", "full_name" "text", "xp" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select id, username, full_name, xp
  from public.profiles
  where id = any(p_profile_ids);
$$;


ALTER FUNCTION "public"."get_public_profiles"("p_profile_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_team_roster"("p_team_id" "uuid") RETURNS TABLE("profile_id" "uuid", "username" "text", "full_name" "text", "role" "text", "joined_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select tm.profile_id, p.username, p.full_name, tm.role, tm.joined_at
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
  order by tm.joined_at;
$$;


ALTER FUNCTION "public"."get_team_roster"("p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gipedo_pano_pending_settlement_shares"() RETURNS TABLE("match_id" "uuid", "share_id" "uuid", "stripe_payment_intent_id" "text", "action" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    fm.id as match_id,
    s.id as share_id,
    s.stripe_payment_intent_id,
    case
      when fm.payment_settlement = 'void' then 'void'
      when fm.payment_settlement = 'draw' then 'capture'
      when fm.payment_settlement = 'home_wins' and tm.team_id = fm.home_team_id then 'void'
      when fm.payment_settlement = 'home_wins' and tm.team_id = fm.away_team_id then 'capture'
      when fm.payment_settlement = 'away_wins' and tm.team_id = fm.away_team_id then 'void'
      when fm.payment_settlement = 'away_wins' and tm.team_id = fm.home_team_id then 'capture'
    end as action
  from public.friendly_matches fm
  join public.squad_posts sp on sp.id = fm.squad_post_id
  join public.booking_payment_shares s on s.booking_id = sp.venue_booking_id
  join public.team_members tm
    on tm.profile_id = s.profile_id and tm.team_id in (fm.home_team_id, fm.away_team_id)
  where fm.payment_settlement is not null
    and fm.payment_settled_at is null
    and s.status = 'authorized';
$$;


ALTER FUNCTION "public"."gipedo_pano_pending_settlement_shares"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  meta_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  meta_full_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  begin
    insert into public.profiles (id, email, username, full_name)
    values (new.id, new.email, meta_username, meta_full_name)
    on conflict (id) do nothing;
  exception when unique_violation then
    -- The username was claimed between the client's availability check and this
    -- insert. Losing a rare race is not a reason to fail account creation, so
    -- keep the account and leave username null for the user to set later.
    insert into public.profiles (id, email, username, full_name)
    values (new.id, new.email, null, meta_full_name)
    on conflict (id) do nothing;
  end;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_captain_in_league_tree"("p_league_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id
    where tm.profile_id = auth.uid()
      and tm.role = 'captain'
      and (
        lt.league_id = p_league_id
        or lt.league_id in (select id from public.leagues where parent_league_id = p_league_id)
      )
  );
$$;


ALTER FUNCTION "public"."is_captain_in_league_tree"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_username_available"("candidate" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select nullif(trim(candidate), '') is not null
     and not exists (
       select 1
       from public.profiles
       where lower(profiles.username) = lower(trim(candidate))
     );
$$;


ALTER FUNCTION "public"."is_username_available"("candidate" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_squad_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
  v_joined_count integer;
begin
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'players' then
    raise exception 'not_a_players_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;

  select count(*) into v_joined_count from public.squad_post_joiners where post_id = p_post_id;
  if v_joined_count >= v_post.players_needed then
    raise exception 'squad_full';
  end if;

  begin
    insert into public.squad_post_joiners (post_id, profile_id) values (p_post_id, auth.uid());
  exception when unique_violation then
    raise exception 'already_joined';
  end;
end;
$$;


ALTER FUNCTION "public"."join_squad_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_squad_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.squad_post_joiners
  where post_id = p_post_id and profile_id = auth.uid();

  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'not_joined';
  end if;
end;
$$;


ALTER FUNCTION "public"."leave_squad_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_booking_shares"("p_booking_id" "uuid") RETURNS TABLE("id" "uuid", "profile_id" "uuid", "username" "text", "amount_cents" integer, "is_booker" boolean, "status" "text", "paid_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (select 1 from public.venue_bookings b where b.id = p_booking_id and b.created_by = auth.uid())
     and not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.profile_id = auth.uid())
  then
    raise exception 'not_authorized';
  end if;

  return query
    select s.id, s.profile_id, p.username, s.amount_cents, s.is_booker, s.status, s.paid_at
    from public.booking_payment_shares s
    join public.profiles p on p.id = s.profile_id
    where s.booking_id = p_booking_id
    order by s.is_booker desc, p.username;
end;
$$;


ALTER FUNCTION "public"."list_booking_shares"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_my_fixture_chats"() RETURNS TABLE("fixture_id" "uuid", "home_team_id" "uuid", "home_team_name" "text", "away_team_id" "uuid", "away_team_name" "text", "last_message" "text", "last_message_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    lf.id,
    lf.home_team_id, ht.name,
    lf.away_team_id, at2.name,
    fm.message, fm.created_at
  from public.league_fixtures lf
  join public.teams ht on ht.id = lf.home_team_id
  join public.teams at2 on at2.id = lf.away_team_id
  left join lateral (
    select message, created_at
    from public.fixture_messages
    where fixture_id = lf.id
    order by created_at desc
    limit 1
  ) fm on true
  where exists (
    select 1 from public.team_members tm
    where tm.profile_id = auth.uid()
      and tm.role = 'captain'
      and tm.team_id in (lf.home_team_id, lf.away_team_id)
  )
  order by fm.created_at desc nulls last;
$$;


ALTER FUNCTION "public"."list_my_fixture_chats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_my_transactions"() RETURNS TABLE("id" "uuid", "booking_id" "uuid", "amount_cents" integer, "status" "text", "paid_at" timestamp with time zone, "is_booker" boolean, "venue_id" "uuid", "booking_day" "date", "start_time" time without time zone, "format" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.id, s.booking_id, s.amount_cents, s.status, s.paid_at, s.is_booker,
         b.venue_id, b.booking_day, b.start_time, b.format
  from public.booking_payment_shares s
  join public.venue_bookings b on b.id = s.booking_id
  where s.profile_id = auth.uid()
    and (
      s.status <> 'pending'
      or (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' > now()
    )
  order by s.paid_at desc nulls last, b.booking_day desc, b.start_time desc;
$$;


ALTER FUNCTION "public"."list_my_transactions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_players"() RETURNS TABLE("id" "uuid", "username" "text", "full_name" "text", "phone" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.id, p.username, p.full_name,
    case when p.show_phone_publicly then p.phone else null end as phone
  from public.profiles p
  where p.username is not null
    and p.id <> auth.uid()
  order by p.username
  limit 200;
$$;


ALTER FUNCTION "public"."list_players"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_booking_result"("p_booking_id" "uuid", "p_goals_for" integer, "p_goals_against" integer) RETURNS "public"."venue_bookings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_booking public.venue_bookings;
  v_result text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_goals_for < 0 or p_goals_against < 0 then
    raise exception 'invalid_score';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;

  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;

  if v_booking.result is not null then
    raise exception 'already_logged';
  end if;

  -- booking_day/end_time are plain date/time (Cyprus wall-clock, no zone
  -- attached) — same reasoning as book_slot's slot_in_past check and
  -- submit_fixture_score's too_early check: compare in Cyprus local time
  -- explicitly rather than relying on the database session's timezone.
  if now() < (v_booking.booking_day + v_booking.end_time) at time zone 'Asia/Nicosia' then
    raise exception 'too_early';
  end if;

  v_result := case
    when p_goals_for > p_goals_against then 'won'
    when p_goals_for < p_goals_against then 'lost'
    else 'drawn'
  end;

  update public.venue_bookings
  set result = v_result,
      result_goals_for = p_goals_for,
      result_goals_against = p_goals_against,
      result_logged_at = now()
  where id = p_booking_id
  returning * into v_booking;

  update public.profiles
  set played = played + 1,
      won = won + case when v_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_result = 'lost' then 1 else 0 end,
      goals = goals + p_goals_for
  where id = auth.uid();

  return v_booking;
end;
$$;


ALTER FUNCTION "public"."log_booking_result"("p_booking_id" "uuid", "p_goals_for" integer, "p_goals_against" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_gipedo_pano_share_settled"("p_share_id" "uuid", "p_new_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_new_status not in ('paid', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  update public.booking_payment_shares
  set status = p_new_status,
      paid_at = case when p_new_status = 'paid' then now() else paid_at end
  where id = p_share_id
    and status = 'authorized';
end;
$$;


ALTER FUNCTION "public"."mark_gipedo_pano_share_settled"("p_share_id" "uuid", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_contact_profiles"("normalized_phones" "text"[]) RETURNS TABLE("id" "uuid", "username" "text", "full_name" "text", "phone" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.id, p.username, p.full_name, p.phone
  from public.profiles p
  where p.phone is not null
    and p.id <> auth.uid()
    and right(regexp_replace(p.phone, '\D', '', 'g'), 9) = any(normalized_phones)
  limit 500;
$$;


ALTER FUNCTION "public"."match_contact_profiles"("normalized_phones" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_contacts_by_phone"("p_phone_numbers" "text"[]) RETURNS TABLE("phone_number" "text", "profile_id" "uuid", "username" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(array_length(p_phone_numbers, 1), 0) > 2000 then
    raise exception 'too_many_numbers';
  end if;

  return query
  with contacts as (
    select
      raw,
      right(regexp_replace(raw, '\D', '', 'g'), 9) as digits
    from unnest(p_phone_numbers) as raw
  )
  select distinct on (contacts.raw)
    contacts.raw as phone_number,
    p.id as profile_id,
    p.username
  from contacts
  join public.profiles p
    on right(regexp_replace(p.phone, '\D', '', 'g'), 9) = contacts.digits
  where p.phone is not null
    and length(contacts.digits) = 9
    and p.id <> auth.uid()
  order by contacts.raw, p.username;
end;
$$;


ALTER FUNCTION "public"."match_contacts_by_phone"("p_phone_numbers" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_booking_slot_freed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_recipient uuid;
  v_venue_name text;
begin
  if new.status <> 'cancelled' or old.status is not distinct from new.status then
    return new;
  end if;

  select name into v_venue_name from public.venues where id = new.venue_id;

  for v_recipient in
    select distinct posted_by from public.squad_posts
    where venue_id = new.venue_id
      and status = 'open'
      and posted_by is not null
      and scheduled_at::date = new.booking_day
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      v_recipient,
      'booking_slot',
      'A slot just opened up',
      coalesce(v_venue_name, 'A venue') || ' has a free slot on ' || new.booking_day::text,
      jsonb_build_object('venueId', new.venue_id, 'day', new.booking_day)
    );
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_booking_slot_freed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_fixture_agreed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_recipient uuid;
  v_home_name text;
  v_away_name text;
begin
  if new.status <> 'agreed' or old.status is not distinct from new.status then
    return new;
  end if;

  select name into v_home_name from public.teams where id = new.home_team_id;
  select name into v_away_name from public.teams where id = new.away_team_id;

  for v_recipient in
    select profile_id from public.team_members
    where team_id in (new.home_team_id, new.away_team_id) and role = 'captain'
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      v_recipient,
      'fixture_agreed',
      'Fixture confirmed',
      coalesce(v_home_name, 'Home') || ' vs ' || coalesce(v_away_name, 'Away') || ' is locked in.',
      jsonb_build_object('fixtureId', new.id)
    );
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_fixture_agreed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_fixture_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_home uuid;
  v_away uuid;
  v_other_team uuid;
  v_recipient uuid;
  v_sender_name text;
begin
  select home_team_id, away_team_id into v_home, v_away
  from public.league_fixtures where id = new.fixture_id;

  v_other_team := case when new.sender_team_id = v_home then v_away else v_home end;

  select profile_id into v_recipient
  from public.team_members
  where team_id = v_other_team and role = 'captain'
  limit 1;

  if v_recipient is null then
    return new;
  end if;

  select name into v_sender_name from public.teams where id = new.sender_team_id;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    v_recipient,
    'fixture_message',
    coalesce(v_sender_name, 'The other captain') || ' sent a message',
    left(new.message, 120),
    jsonb_build_object('fixtureId', new.fixture_id)
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_fixture_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_squad_post_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_venue_name text;
  v_poster_name text;
  v_team_name text;
  v_when text;
  v_title text;
  v_body text;
  v_recipient uuid;
begin
  select name into v_venue_name from public.venues where id = new.venue_id;
  -- "Sat 18:00" — Cyprus local time, same zone convention as
  -- supabase/scores.sql etc. Kept short: this also has to fit a push
  -- notification body alongside the subject/position/venue.
  v_when := to_char(new.scheduled_at at time zone 'Asia/Nicosia', 'Dy HH24:MI');

  if new.type = 'players' then
    select username into v_poster_name from public.profiles where id = new.posted_by;
    -- Items 2/5 — naming the specific position (when given) up front is what
    -- lets a recipient tell at a glance whether this post is relevant to
    -- them, instead of a generic "needs players" every time.
    v_title := case when new.position_needed is not null then 'Needs a ' || new.position_needed
      else 'Looking for players' end;
    v_body := coalesce(v_poster_name, 'Someone') ||
      (case when new.position_needed is not null then ' needs a ' || new.position_needed
        else ' needs players' end) ||
      ' — ' || new.format || ' at ' || coalesce(v_venue_name, 'a venue') || ', ' || v_when;
  else
    select name into v_team_name from public.teams where id = new.team_id;
    -- Item 3 — informational only, never a hard filter (see
    -- squad_post_notification_recipients — matching stays city+format only).
    v_title := case when new.level_needed is not null then 'Looking for a ' || new.level_needed || '-level opponent'
      else 'Looking for opposition' end;
    v_body := coalesce(v_team_name, 'A team') ||
      (case when new.level_needed is not null then ' is looking for a ' || new.level_needed || '-level opponent'
        else ' wants a match' end) ||
      ' — ' || new.format || ' at ' || coalesce(v_venue_name, 'a venue') || ', ' || v_when;
  end if;

  for v_recipient in select recipients.profile_id from public.squad_post_notification_recipients(new.id) as recipients
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (v_recipient, 'squad_post', v_title, v_body, jsonb_build_object('postId', new.id, 'postType', new.type));
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_squad_post_created"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_squad_post_joiner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
  v_joiner_name text;
begin
  select * into v_post from public.squad_posts where id = new.post_id;

  if v_post.posted_by is null or v_post.posted_by = new.profile_id then
    return new;
  end if;

  select username into v_joiner_name from public.profiles where id = new.profile_id;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    v_post.posted_by,
    'squad_post',
    'New player joined',
    coalesce(v_joiner_name, 'A player') || ' joined your "need players" post',
    jsonb_build_object('postId', v_post.id, 'postType', v_post.type)
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_squad_post_joiner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_squad_post_matched"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_recipient uuid;
begin
  if new.status <> 'matched' or old.status is not distinct from new.status then
    return new;
  end if;

  if new.posted_by is not null then
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      new.posted_by,
      'squad_post',
      'Your post was matched',
      'Your "' || new.type || '" post found a match.',
      jsonb_build_object('postId', new.id, 'postType', new.type)
    );
  end if;

  for v_recipient in
    select profile_id from public.squad_post_joiners where post_id = new.id
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      v_recipient,
      'squad_post',
      'Game confirmed',
      'A game you joined is now confirmed.',
      jsonb_build_object('postId', new.id, 'postType', new.type)
    );
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_squad_post_matched"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."offer_opposition"("p_post_id" "uuid", "p_team_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_post public.squad_posts;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  if v_post.team_id = p_team_id then
    raise exception 'cannot_offer_own_post';
  end if;

  update public.squad_posts
  set status = 'matched', matched_team_id = p_team_id
  where id = p_post_id;
end;
$$;


ALTER FUNCTION "public"."offer_opposition"("p_post_id" "uuid", "p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propose_fixture_schedule"("p_fixture_id" "uuid", "p_day" "date", "p_time" time without time zone, "p_venue_id" "uuid") RETURNS "public"."league_fixtures"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
  v_other_team uuid;
  v_other_latest public.fixture_schedule_proposals;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if p_day < current_date or p_day > current_date + 7 then
    raise exception 'date_out_of_range';
  end if;
  if not exists (select 1 from public.venues where id = p_venue_id) then
    raise exception 'venue_not_found';
  end if;

  insert into public.fixture_schedule_proposals
    (fixture_id, proposed_by_team_id, venue_id, proposed_day, proposed_time)
  values (p_fixture_id, v_my_team, p_venue_id, p_day, p_time);

  update public.league_fixtures
  set status = 'proposed'
  where id = p_fixture_id and status = 'unscheduled';

  v_other_team := case
    when v_my_team = v_fixture.home_team_id then v_fixture.away_team_id
    else v_fixture.home_team_id
  end;

  select * into v_other_latest
  from public.fixture_schedule_proposals
  where fixture_id = p_fixture_id and proposed_by_team_id = v_other_team
  order by created_at desc
  limit 1;

  if v_other_latest.id is not null
     and v_other_latest.proposed_day = p_day
     and v_other_latest.proposed_time = p_time
     and v_other_latest.venue_id = p_venue_id then
    update public.league_fixtures
    set scheduled_day = p_day, scheduled_time = p_time, venue_id = p_venue_id, status = 'agreed'
    where id = p_fixture_id;
  end if;

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;


ALTER FUNCTION "public"."propose_fixture_schedule"("p_fixture_id" "uuid", "p_day" "date", "p_time" time without time zone, "p_venue_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_gipedo_pano_settlement"("p_match_id" "uuid", "p_settlement" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_booking public.venue_bookings;
begin
  select * into v_match from public.friendly_matches where id = p_match_id;
  if v_match.id is null or v_match.squad_post_id is null then
    return;
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.id is null or v_post.payment_mode <> 'gipedo_pano' or v_post.venue_booking_id is null then
    return;
  end if;

  select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 then
    return;
  end if;

  update public.friendly_matches
  set payment_settlement = p_settlement
  where id = p_match_id;
end;
$$;


ALTER FUNCTION "public"."record_gipedo_pano_settlement"("p_match_id" "uuid", "p_settlement" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."league_teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid",
    "division_name" "text",
    "team_id" "uuid",
    "played" integer DEFAULT 0,
    "won" integer DEFAULT 0,
    "drawn" integer DEFAULT 0,
    "lost" integer DEFAULT 0,
    "goals_for" integer DEFAULT 0,
    "goals_against" integer DEFAULT 0,
    "pts_adjustment" integer DEFAULT 0,
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."league_teams" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_team_for_league"("p_league_id" "uuid", "p_team_id" "uuid") RETURNS "public"."league_teams"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_league public.leagues;
  v_count integer;
  v_row public.league_teams;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  -- Enforced here too, not just in the app's registration UI — a team must
  -- have its full main roster (roster_size, captain included) before it can
  -- take a league slot, so a match always has enough players to actually
  -- play. Substitutes aren't counted toward this — they're optional.
  if (
    select count(*) from public.team_members
    where team_id = p_team_id and role in ('captain', 'player')
  ) < (select roster_size from public.teams where id = p_team_id) then
    raise exception 'roster_incomplete';
  end if;

  -- A captain can't register a second team of theirs into a league they
  -- already have a team in — one captain, one team per league.
  if exists (
    select 1
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id
    where lt.league_id = p_league_id
      and tm.profile_id = auth.uid()
      and tm.role = 'captain'
      and lt.team_id <> p_team_id
  ) then
    raise exception 'already_have_team_in_league';
  end if;

  select * into v_league from public.leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'league_not_found';
  end if;

  -- Team Premium (supabase/team-premium.sql) gates 9-a-side/11-a-side only,
  -- and applies at every entry point into this format's leagues — the initial
  -- signup, a standard league's always-open join, and the post-split pool —
  -- since format is copied down through hubs, divisions and pool rows alike.
  if v_league.format in ('9-a-side', '11-a-side') then
    if not exists (
      select 1 from public.teams
      where id = p_team_id
        and (
          (v_league.format = '9-a-side' and premium_9aside)
          or (v_league.format = '11-a-side' and premium_11aside)
        )
    ) then
      raise exception 'team_premium_required';
    end if;
  end if;

  if v_league.stage = 'signup' then
    select count(*) into v_count from public.league_teams where league_id = p_league_id;
    if v_count >= v_league.capacity then
      raise exception 'league_full';
    end if;
  elsif v_league.stage = 'season' then
    -- Once an Open League's season has started, signup is closed — new teams
    -- join via the post-split pool instead. Standard leagues (capacity = 0)
    -- have no such cutoff and stay open indefinitely.
    if v_league.capacity > 0 then
      raise exception 'season_in_progress';
    end if;
  elsif v_league.stage <> 'divisions' then
    raise exception 'league_not_open';
  end if;
  -- stage = 'divisions': joining registers the team in the waiting pool
  -- (a league_teams row directly against this hub league), no capacity limit.

  begin
    insert into public.league_teams
      (league_id, team_id, played, won, drawn, lost, goals_for, goals_against, pts_adjustment)
    values (p_league_id, p_team_id, 0, 0, 0, 0, 0, 0, 0)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'already_joined';
  end;

  -- Item 4 (payment-auth batch) — an Open League filling up used to require
  -- a manual "Start season" trigger with no real production equivalent, so a
  -- full league could sit in 'signup' forever. Standard leagues (capacity =
  -- 0) are excluded — they have no fixed roster of teams to close signup on.
  if v_league.stage = 'signup' and v_league.capacity > 0 then
    select count(*) into v_count from public.league_teams where league_id = p_league_id;
    if v_count >= v_league.capacity then
      update public.leagues
      set stage = 'season', start_date = coalesce(start_date, current_date)
      where id = p_league_id;
    end if;
  end if;

  -- supabase/league-fixtures.sql — fills in this team's pairing against
  -- every other team already in the league. Must run after leagues.sql for
  -- this call to succeed at invocation time (fine either way at CREATE time),
  -- and after the stage flip above so a capacity-filling registration
  -- generates the whole round-robin the moment the season actually starts.
  perform public.sync_league_fixtures(p_league_id);

  return v_row;
end;
$$;


ALTER FUNCTION "public"."register_team_for_league"("p_league_id" "uuid", "p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_stale_fixture"("p_fixture_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_fixture public.league_fixtures;
  v_home_submitted boolean;
  v_away_submitted boolean;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null or v_fixture.status <> 'agreed' or v_fixture.score_locked then
    return;
  end if;

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() <= ((v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia') + interval '24 hours' then
    return;
  end if;

  select exists (
    select 1 from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id
  ) into v_home_submitted;

  select exists (
    select 1 from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id
  ) into v_away_submitted;

  update public.league_fixtures set score_locked = true where id = p_fixture_id;

  if v_home_submitted and not v_away_submitted then
    update public.league_fixtures set forfeit_result = 'away_forfeited' where id = p_fixture_id;
    perform public.apply_fixture_forfeit_stats(
      v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'away_forfeited'
    );
  elsif v_away_submitted and not v_home_submitted then
    update public.league_fixtures set forfeit_result = 'home_forfeited' where id = p_fixture_id;
    perform public.apply_fixture_forfeit_stats(
      v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'home_forfeited'
    );
  else
    update public.league_fixtures set forfeit_result = 'void' where id = p_fixture_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."resolve_stale_fixture"("p_fixture_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_stale_fixtures"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_row record;
begin
  for v_row in select fixture_id from public.fixtures_needing_resolution() loop
    perform public.resolve_stale_fixture(v_row.fixture_id);
  end loop;
end;
$$;


ALTER FUNCTION "public"."resolve_stale_fixtures"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_stale_friendly_match"("p_match_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_home_submitted boolean;
  v_away_submitted boolean;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null or v_match.status <> 'pending_score' then
    return;
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.scheduled_at is null or now() <= v_post.scheduled_at + interval '24 hours' then
    return;
  end if;

  select exists (
    select 1 from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.home_team_id
  ) into v_home_submitted;

  select exists (
    select 1 from public.friendly_match_scores
    where friendly_match_id = p_match_id and submitted_by_team_id = v_match.away_team_id
  ) into v_away_submitted;

  update public.friendly_matches set status = 'locked' where id = p_match_id;

  if v_home_submitted and not v_away_submitted then
    -- Away never engaged at all — treated as their no-show, home wins by
    -- forfeit.
    update public.friendly_matches set forfeit_result = 'away_forfeited' where id = p_match_id;
    perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'away_forfeited');
    perform public.record_gipedo_pano_settlement(p_match_id, 'home_wins');
  elsif v_away_submitted and not v_home_submitted then
    update public.friendly_matches set forfeit_result = 'home_forfeited' where id = p_match_id;
    perform public.apply_friendly_forfeit_stats(v_match.home_team_id, v_match.away_team_id, 'home_forfeited');
    perform public.record_gipedo_pano_settlement(p_match_id, 'away_wins');
  else
    -- Neither side ever submitted anything, or both did but never reached
    -- 3 attempts to trigger dispute lockout on their own — either way,
    -- there's no reliable signal for a winner. Void.
    update public.friendly_matches set forfeit_result = 'void' where id = p_match_id;
    perform public.record_gipedo_pano_settlement(p_match_id, 'void');
  end if;
end;
$$;


ALTER FUNCTION "public"."resolve_stale_friendly_match"("p_match_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_stale_friendly_matches"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_row record;
begin
  for v_row in select match_id from public.friendly_matches_needing_resolution() loop
    perform public.resolve_stale_friendly_match(v_row.match_id);
  end loop;
end;
$$;


ALTER FUNCTION "public"."resolve_stale_friendly_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_unscheduled_fixture"("p_fixture_id" "uuid") RETURNS "public"."league_fixtures"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_fixture public.league_fixtures;
  v_home_proposed boolean;
  v_away_proposed boolean;
  v_home_result text;
  v_away_result text;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  if public.captain_team_for_fixture(v_fixture) is null then
    raise exception 'not_captain';
  end if;

  if v_fixture.status in ('agreed', 'completed') then
    raise exception 'already_scheduled';
  end if;

  if now() < v_fixture.created_at + interval '7 days' then
    raise exception 'window_not_elapsed';
  end if;

  select exists (
    select 1 from public.fixture_schedule_proposals
    where fixture_id = p_fixture_id and proposed_by_team_id = v_fixture.home_team_id
  ) into v_home_proposed;

  select exists (
    select 1 from public.fixture_schedule_proposals
    where fixture_id = p_fixture_id and proposed_by_team_id = v_fixture.away_team_id
  ) into v_away_proposed;

  if v_home_proposed and not v_away_proposed then
    v_home_result := 'won'; v_away_result := 'lost';
  elsif v_away_proposed and not v_home_proposed then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'drawn'; v_away_result := 'drawn';
  end if;

  update public.league_fixtures set status = 'completed' where id = p_fixture_id;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_home_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_home_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_home_result = 'lost' then 1 else 0 end
  where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;

  update public.league_teams
  set played = played + 1,
      won = won + case when v_away_result = 'won' then 1 else 0 end,
      drawn = drawn + case when v_away_result = 'drawn' then 1 else 0 end,
      lost = lost + case when v_away_result = 'lost' then 1 else 0 end
  where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;

  perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away_result, 0);

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;


ALTER FUNCTION "public"."resolve_unscheduled_fixture"("p_fixture_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fixture_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fixture_id" "uuid",
    "sender_team_id" "uuid",
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fixture_messages" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_fixture_message"("p_fixture_id" "uuid", "p_message" "text") RETURNS "public"."fixture_messages"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
  v_row public.fixture_messages;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if nullif(trim(p_message), '') is null then
    raise exception 'message_required';
  end if;

  insert into public.fixture_messages (fixture_id, sender_team_id, message)
  values (p_fixture_id, v_my_team, trim(p_message))
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."send_fixture_message"("p_fixture_id" "uuid", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."service_fee_cents"() RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$ select 80 $$;


ALTER FUNCTION "public"."service_fee_cents"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."service_fee_rate"() RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$ select 0.089 $$;


ALTER FUNCTION "public"."service_fee_rate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_team_premium"("p_team_id" "uuid", "p_format" "text", "p_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  if p_format = '9-a-side' then
    update public.teams set premium_9aside = p_enabled where id = p_team_id;
  elsif p_format = '11-a-side' then
    update public.teams set premium_11aside = p_enabled where id = p_team_id;
  else
    raise exception 'not_a_premium_format';
  end if;
end;
$$;


ALTER FUNCTION "public"."set_team_premium"("p_team_id" "uuid", "p_format" "text", "p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."squad_post_notification_recipients"("p_post_id" "uuid") RETURNS TABLE("profile_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select distinct tm.profile_id
  from public.squad_posts sp
  join public.venues v on v.id = sp.venue_id
  join public.team_members tm on tm.role in ('captain', 'player', 'substitute')
  join public.teams t on t.id = tm.team_id
  join public.profiles p on p.id = tm.profile_id
  where sp.id = p_post_id
    and p.city = v.city
    and t.roster_size = case sp.format
      when '5-a-side' then 5
      when '7-a-side' then 7
      when '9-a-side' then 9
      when '11-a-side' then 11
      else -1 -- an unrecognised format never matches any real roster_size
    end
    -- Item 5 requirement — never notify the poster about their own post.
    and tm.profile_id is distinct from sp.posted_by;
$$;


ALTER FUNCTION "public"."squad_post_notification_recipients"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_league_season"("p_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_captain_in_league_tree(p_league_id) then
    raise exception 'not_a_participant';
  end if;

  update public.leagues
  set stage = 'season', start_date = coalesce(start_date, current_date)
  where id = p_league_id and stage = 'signup';

  if not found then
    raise exception 'not_in_signup';
  end if;

  -- This function only backs the dev-only "Start season" trigger now (see
  -- app/(tabs)/leagues.tsx), but a real production league can still reach
  -- 'season' via this path with 2+ teams already registered if a captain
  -- uses it before capacity fills — this call was missing here (unlike
  -- register_team_for_league's auto-start), which is exactly how the
  -- Nicosia 5-a-side Open League ended up in 'season' with zero fixtures.
  perform public.sync_league_fixtures(p_league_id);
end;
$$;


ALTER FUNCTION "public"."start_league_season"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_fixture_score"("p_fixture_id" "uuid", "p_home_score" integer, "p_away_score" integer) RETURNS "public"."league_fixtures"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;
  if v_fixture.status = 'completed' then
    raise exception 'already_completed';
  end if;
  if v_fixture.score_locked then
    raise exception 'score_locked';
  end if;
  if v_fixture.status <> 'agreed' then
    raise exception 'schedule_not_agreed';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() < ((v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia') + interval '2 hours' then
    raise exception 'too_early';
  end if;

  insert into public.fixture_score_submissions (fixture_id, submitted_by_team_id, home_score, away_score)
  values (p_fixture_id, v_my_team, p_home_score, p_away_score);

  update public.league_fixtures
  set score_attempts = score_attempts + 1
  where id = p_fixture_id;

  return public.check_fixture_score_match(p_fixture_id);
end;
$$;


ALTER FUNCTION "public"."submit_fixture_score"("p_fixture_id" "uuid", "p_home_score" integer, "p_away_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_friendly_score"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer) RETURNS "public"."friendly_matches"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_match public.friendly_matches;
  v_post public.squad_posts;
  v_my_team uuid;
begin
  select * into v_match from public.friendly_matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match_not_found';
  end if;
  if v_match.status <> 'pending_score' then
    raise exception 'score_not_open';
  end if;

  select tm.team_id into v_my_team
  from public.team_members tm
  where tm.profile_id = auth.uid()
    and tm.team_id in (v_match.home_team_id, v_match.away_team_id)
  limit 1;
  if v_my_team is null then
    raise exception 'not_on_team';
  end if;

  select * into v_post from public.squad_posts where id = v_match.squad_post_id;
  if v_post.scheduled_at is null or now() < v_post.scheduled_at + interval '2 hours' then
    raise exception 'too_early';
  end if;

  insert into public.friendly_match_scores
    (friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score)
  values (p_match_id, v_my_team, auth.uid(), p_home_score, p_away_score);

  update public.friendly_matches
  set score_attempts = score_attempts + 1
  where id = p_match_id;

  return public.check_friendly_score_match(p_match_id);
end;
$$;


ALTER FUNCTION "public"."submit_friendly_score"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_league_fixtures"("p_league_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  insert into public.league_fixtures (league_id, home_team_id, away_team_id, status)
  select t1.league_id, t1.team_id, t2.team_id, 'unscheduled'
  from public.league_teams t1
  join public.league_teams t2 on t1.league_id = t2.league_id and t1.team_id < t2.team_id
  where t1.league_id = p_league_id
  on conflict (league_id, home_team_id, away_team_id) do nothing;
$$;


ALTER FUNCTION "public"."sync_league_fixtures"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."venue_day_availability"("target_venue" "uuid", "target_day" "date") RETURNS TABLE("start_time" time without time zone, "end_time" time without time zone, "pitches" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select b.start_time, b.end_time, b.pitches
  from public.venue_bookings b
  where b.venue_id = target_venue
    and b.booking_day = target_day
    and coalesce(b.status, '') <> 'cancelled';
$$;


ALTER FUNCTION "public"."venue_day_availability"("target_venue" "uuid", "target_day" "date") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_chat_usage" (
    "id" bigint NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_chat_usage" OWNER TO "postgres";


ALTER TABLE "public"."ai_chat_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_chat_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."booking_payment_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL,
    "is_booker" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "stripe_payment_intent_id" "text",
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_payment_shares_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'authorized'::"text", 'paid'::"text", 'refunded'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."booking_payment_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fixture_schedule_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fixture_id" "uuid",
    "proposed_by_team_id" "uuid",
    "venue_id" "uuid",
    "proposed_day" "date",
    "proposed_time" time without time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fixture_schedule_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fixture_score_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fixture_id" "uuid",
    "submitted_by_team_id" "uuid",
    "home_score" integer,
    "away_score" integer,
    "submitted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fixture_score_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."follows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "follower_profile_id" "uuid",
    "followee_type" "text",
    "followee_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "follows_followee_type_check" CHECK (("followee_type" = ANY (ARRAY['profile'::"text", 'team'::"text"])))
);


ALTER TABLE "public"."follows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friendly_match_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "friendly_match_id" "uuid",
    "submitted_by_team_id" "uuid",
    "home_score" integer,
    "away_score" integer,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "submitted_by_profile_id" "uuid"
);


ALTER TABLE "public"."friendly_match_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leagues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "format" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "name" "text",
    "stage" "text" DEFAULT 'signup'::"text",
    "capacity" integer NOT NULL,
    "start_date" "date",
    "season_weeks" integer,
    "parent_league_id" "uuid"
);


ALTER TABLE "public"."leagues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."level_pool" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid",
    "team_id" "uuid",
    "level" "text",
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."level_pool" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['fixture_message'::"text", 'squad_post'::"text", 'booking_slot'::"text", 'booking_cancelled'::"text", 'fixture_agreed'::"text", 'match_payment_due'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "team_id" "uuid",
    "kind" "text",
    "reference_id" "uuid",
    "amount" numeric,
    "currency" "text" DEFAULT 'EUR'::"text",
    "method" "text",
    "stripe_payment_intent_id" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."premium_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "product_id" "text" NOT NULL,
    "original_transaction_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "premium_subscriptions_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text"]))),
    CONSTRAINT "premium_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'cancelled'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."premium_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "gender" "text",
    "date_of_birth" "date",
    "description" "text",
    "city" "text",
    "position" "text",
    "preferred_foot" "text",
    "xp" integer DEFAULT 0,
    "played" integer DEFAULT 0,
    "won" integer DEFAULT 0,
    "drawn" integer DEFAULT 0,
    "lost" integer DEFAULT 0,
    "goals" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "username" "text",
    "full_name" "text",
    "is_premium" boolean DEFAULT false NOT NULL,
    "bio" "text",
    "show_phone_publicly" boolean DEFAULT false NOT NULL,
    "role" "text" DEFAULT 'player'::"text",
    "stripe_customer_id" "text",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['player'::"text", 'venue_owner'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_tokens_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text"])))
);


ALTER TABLE "public"."push_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_webhook_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stripe_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "team_id" "uuid",
    "plan" "text",
    "status" "text" DEFAULT 'active'::"text",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "current_period_end" timestamp with time zone,
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['personal_premium'::"text", 'team_premium_9'::"text", 'team_premium_11'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid",
    "profile_id" "uuid",
    "role" "text" DEFAULT 'player'::"text",
    "joined_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "team_members_role_check" CHECK (("role" = ANY (ARRAY['captain'::"text", 'player'::"text", 'substitute'::"text"])))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_premium_purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "format" "text" NOT NULL,
    "product_id" "text" NOT NULL,
    "original_transaction_id" "text" NOT NULL,
    "purchased_by" "uuid",
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_premium_purchases_format_check" CHECK (("format" = ANY (ARRAY['9-a-side'::"text", '11-a-side'::"text"]))),
    CONSTRAINT "team_premium_purchases_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."team_premium_purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_follows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "follower_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_follows_target_type_check" CHECK (("target_type" = ANY (ARRAY['player'::"text", 'team'::"text"])))
);


ALTER TABLE "public"."user_follows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "city" "text",
    "surface" "text",
    "base_pitches" integer NOT NULL,
    "open_time" time without time zone NOT NULL,
    "close_time" time without time zone NOT NULL,
    "price_per_pitch_hour" numeric NOT NULL,
    "owner_profile_id" "uuid"
);


ALTER TABLE "public"."venues" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_chat_usage"
    ADD CONSTRAINT "ai_chat_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_payment_shares"
    ADD CONSTRAINT "booking_payment_shares_booking_id_profile_id_key" UNIQUE ("booking_id", "profile_id");



ALTER TABLE ONLY "public"."booking_payment_shares"
    ADD CONSTRAINT "booking_payment_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fixture_messages"
    ADD CONSTRAINT "fixture_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fixture_schedule_proposals"
    ADD CONSTRAINT "fixture_schedule_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fixture_score_submissions"
    ADD CONSTRAINT "fixture_score_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friendly_match_scores"
    ADD CONSTRAINT "friendly_match_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friendly_matches"
    ADD CONSTRAINT "friendly_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."league_fixtures"
    ADD CONSTRAINT "league_fixtures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."league_teams"
    ADD CONSTRAINT "league_teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_format_scope_key" UNIQUE ("format", "scope");



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."level_pool"
    ADD CONSTRAINT "level_pool_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."premium_subscriptions"
    ADD CONSTRAINT "premium_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."squad_post_joiners"
    ADD CONSTRAINT "squad_post_joiners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."squad_posts"
    ADD CONSTRAINT "squad_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_webhook_events"
    ADD CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_profile_id_key" UNIQUE ("team_id", "profile_id");



ALTER TABLE ONLY "public"."team_premium_purchases"
    ADD CONSTRAINT "team_premium_purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_follows"
    ADD CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_venue_id_booking_day_start_time_team_id_key" UNIQUE ("venue_id", "booking_day", "start_time", "team_id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_chat_usage_profile_time_idx" ON "public"."ai_chat_usage" USING "btree" ("profile_id", "created_at" DESC);



CREATE INDEX "booking_payment_shares_booking_idx" ON "public"."booking_payment_shares" USING "btree" ("booking_id");



CREATE UNIQUE INDEX "booking_payment_shares_intent_unique" ON "public"."booking_payment_shares" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "booking_payment_shares_profile_idx" ON "public"."booking_payment_shares" USING "btree" ("profile_id");



CREATE UNIQUE INDEX "league_fixtures_unique_pairing" ON "public"."league_fixtures" USING "btree" ("league_id", "home_team_id", "away_team_id");



CREATE UNIQUE INDEX "league_teams_unique_membership" ON "public"."league_teams" USING "btree" ("league_id", "team_id");



CREATE INDEX "notifications_profile_created_idx" ON "public"."notifications" USING "btree" ("profile_id", "created_at" DESC);



CREATE INDEX "premium_subscriptions_profile_idx" ON "public"."premium_subscriptions" USING "btree" ("profile_id");



CREATE UNIQUE INDEX "premium_subscriptions_transaction_unique" ON "public"."premium_subscriptions" USING "btree" ("platform", "original_transaction_id");



CREATE UNIQUE INDEX "profiles_stripe_customer_id_idx" ON "public"."profiles" USING "btree" ("stripe_customer_id") WHERE ("stripe_customer_id" IS NOT NULL);



CREATE UNIQUE INDEX "profiles_username_lower_key" ON "public"."profiles" USING "btree" ("lower"("username"));



CREATE UNIQUE INDEX "push_tokens_unique" ON "public"."push_tokens" USING "btree" ("profile_id", "token");



CREATE UNIQUE INDEX "squad_post_joiners_unique" ON "public"."squad_post_joiners" USING "btree" ("post_id", "profile_id");



CREATE UNIQUE INDEX "team_members_unique_membership" ON "public"."team_members" USING "btree" ("team_id", "profile_id");



CREATE INDEX "team_premium_purchases_team_idx" ON "public"."team_premium_purchases" USING "btree" ("team_id");



CREATE UNIQUE INDEX "team_premium_purchases_transaction_unique" ON "public"."team_premium_purchases" USING "btree" ("original_transaction_id");



CREATE UNIQUE INDEX "user_follows_unique" ON "public"."user_follows" USING "btree" ("follower_id", "target_type", "target_id");



CREATE UNIQUE INDEX "venue_bookings_active_slot_per_user" ON "public"."venue_bookings" USING "btree" ("venue_id", "booking_day", "start_time", "created_by") WHERE ("status" <> 'cancelled'::"text");



CREATE INDEX "venue_bookings_created_by_idx" ON "public"."venue_bookings" USING "btree" ("created_by");



CREATE UNIQUE INDEX "venue_bookings_payment_intent_unique" ON "public"."venue_bookings" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "venues_owner_profile_id_idx" ON "public"."venues" USING "btree" ("owner_profile_id");



CREATE INDEX "venues_owner_profile_idx" ON "public"."venues" USING "btree" ("owner_profile_id");



CREATE OR REPLACE TRIGGER "on_booking_slot_freed_notify" AFTER UPDATE ON "public"."venue_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."notify_booking_slot_freed"();



CREATE OR REPLACE TRIGGER "on_fixture_agreed_notify" AFTER UPDATE ON "public"."league_fixtures" FOR EACH ROW EXECUTE FUNCTION "public"."notify_fixture_agreed"();



CREATE OR REPLACE TRIGGER "on_fixture_message_notify" AFTER INSERT ON "public"."fixture_messages" FOR EACH ROW EXECUTE FUNCTION "public"."notify_fixture_message"();



CREATE OR REPLACE TRIGGER "on_owner_block_capacity_check" BEFORE INSERT ON "public"."venue_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."check_owner_block_capacity"();



CREATE OR REPLACE TRIGGER "on_squad_post_created_notify" AFTER INSERT ON "public"."squad_posts" FOR EACH ROW EXECUTE FUNCTION "public"."notify_squad_post_created"();



CREATE OR REPLACE TRIGGER "on_squad_post_joiner_add_share" AFTER INSERT ON "public"."squad_post_joiners" FOR EACH ROW EXECUTE FUNCTION "public"."auto_add_booking_share_on_join"();



CREATE OR REPLACE TRIGGER "on_squad_post_joiner_notify" AFTER INSERT ON "public"."squad_post_joiners" FOR EACH ROW EXECUTE FUNCTION "public"."notify_squad_post_joiner"();



CREATE OR REPLACE TRIGGER "on_squad_post_matched_notify" AFTER UPDATE ON "public"."squad_posts" FOR EACH ROW EXECUTE FUNCTION "public"."notify_squad_post_matched"();



ALTER TABLE ONLY "public"."ai_chat_usage"
    ADD CONSTRAINT "ai_chat_usage_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_payment_shares"
    ADD CONSTRAINT "booking_payment_shares_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."venue_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_payment_shares"
    ADD CONSTRAINT "booking_payment_shares_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fixture_messages"
    ADD CONSTRAINT "fixture_messages_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "public"."league_fixtures"("id");



ALTER TABLE ONLY "public"."fixture_messages"
    ADD CONSTRAINT "fixture_messages_sender_team_id_fkey" FOREIGN KEY ("sender_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."fixture_schedule_proposals"
    ADD CONSTRAINT "fixture_schedule_proposals_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "public"."league_fixtures"("id");



ALTER TABLE ONLY "public"."fixture_schedule_proposals"
    ADD CONSTRAINT "fixture_schedule_proposals_proposed_by_team_id_fkey" FOREIGN KEY ("proposed_by_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."fixture_schedule_proposals"
    ADD CONSTRAINT "fixture_schedule_proposals_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."fixture_score_submissions"
    ADD CONSTRAINT "fixture_score_submissions_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "public"."league_fixtures"("id");



ALTER TABLE ONLY "public"."fixture_score_submissions"
    ADD CONSTRAINT "fixture_score_submissions_submitted_by_team_id_fkey" FOREIGN KEY ("submitted_by_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_follower_profile_id_fkey" FOREIGN KEY ("follower_profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."friendly_match_scores"
    ADD CONSTRAINT "friendly_match_scores_friendly_match_id_fkey" FOREIGN KEY ("friendly_match_id") REFERENCES "public"."friendly_matches"("id");



ALTER TABLE ONLY "public"."friendly_match_scores"
    ADD CONSTRAINT "friendly_match_scores_submitted_by_profile_id_fkey" FOREIGN KEY ("submitted_by_profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."friendly_match_scores"
    ADD CONSTRAINT "friendly_match_scores_submitted_by_team_id_fkey" FOREIGN KEY ("submitted_by_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."friendly_matches"
    ADD CONSTRAINT "friendly_matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."friendly_matches"
    ADD CONSTRAINT "friendly_matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."friendly_matches"
    ADD CONSTRAINT "friendly_matches_squad_post_id_fkey" FOREIGN KEY ("squad_post_id") REFERENCES "public"."squad_posts"("id");



ALTER TABLE ONLY "public"."league_fixtures"
    ADD CONSTRAINT "league_fixtures_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."league_fixtures"
    ADD CONSTRAINT "league_fixtures_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."league_fixtures"
    ADD CONSTRAINT "league_fixtures_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id");



ALTER TABLE ONLY "public"."league_fixtures"
    ADD CONSTRAINT "league_fixtures_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."league_teams"
    ADD CONSTRAINT "league_teams_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id");



ALTER TABLE ONLY "public"."league_teams"
    ADD CONSTRAINT "league_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_parent_league_id_fkey" FOREIGN KEY ("parent_league_id") REFERENCES "public"."leagues"("id");



ALTER TABLE ONLY "public"."level_pool"
    ADD CONSTRAINT "level_pool_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id");



ALTER TABLE ONLY "public"."level_pool"
    ADD CONSTRAINT "level_pool_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."premium_subscriptions"
    ADD CONSTRAINT "premium_subscriptions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."squad_post_joiners"
    ADD CONSTRAINT "squad_post_joiners_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."squad_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."squad_post_joiners"
    ADD CONSTRAINT "squad_post_joiners_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."squad_posts"
    ADD CONSTRAINT "squad_posts_matched_team_id_fkey" FOREIGN KEY ("matched_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."squad_posts"
    ADD CONSTRAINT "squad_posts_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."squad_posts"
    ADD CONSTRAINT "squad_posts_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."squad_posts"
    ADD CONSTRAINT "squad_posts_venue_booking_id_fkey" FOREIGN KEY ("venue_booking_id") REFERENCES "public"."venue_bookings"("id");



ALTER TABLE ONLY "public"."squad_posts"
    ADD CONSTRAINT "squad_posts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_premium_purchases"
    ADD CONSTRAINT "team_premium_purchases_purchased_by_fkey" FOREIGN KEY ("purchased_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_premium_purchases"
    ADD CONSTRAINT "team_premium_purchases_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_follows"
    ADD CONSTRAINT "user_follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id");



CREATE POLICY "Authenticated users can read fixture score submissions" ON "public"."fixture_score_submissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read fixtures" ON "public"."league_fixtures" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read friendly match scores" ON "public"."friendly_match_scores" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read friendly matches" ON "public"."friendly_matches" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read league teams" ON "public"."league_teams" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read leagues" ON "public"."leagues" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read schedule proposals" ON "public"."fixture_schedule_proposals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read squad joiners" ON "public"."squad_post_joiners" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read squad posts" ON "public"."squad_posts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read team members" ON "public"."team_members" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read teams" ON "public"."teams" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Captains can add team members" ON "public"."team_members" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."team_members" "captain"
  WHERE (("captain"."team_id" = "team_members"."team_id") AND ("captain"."profile_id" = "auth"."uid"()) AND ("captain"."role" = 'captain'::"text")))));



CREATE POLICY "Captains can read their fixture chat" ON "public"."fixture_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."league_fixtures" "lf"
     JOIN "public"."team_members" "tm" ON ((("tm"."team_id" = "lf"."home_team_id") OR ("tm"."team_id" = "lf"."away_team_id"))))
  WHERE (("lf"."id" = "fixture_messages"."fixture_id") AND ("tm"."profile_id" = "auth"."uid"()) AND ("tm"."role" = 'captain'::"text")))));



CREATE POLICY "Owners can block their own venue" ON "public"."venue_bookings" FOR INSERT TO "authenticated" WITH CHECK ((("booking_type" = 'owner_block'::"text") AND ("created_by" = "auth"."uid"()) AND ("status" = 'confirmed'::"text") AND ("amount_cents" = 0) AND (EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "venue_bookings"."venue_id") AND ("venues"."owner_profile_id" = "auth"."uid"()))))));



CREATE POLICY "Owners can cancel their own blocks" ON "public"."venue_bookings" FOR UPDATE TO "authenticated" USING ((("booking_type" = 'owner_block'::"text") AND ("created_by" = "auth"."uid"()))) WITH CHECK ((("booking_type" = 'owner_block'::"text") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "Read own share or own booking's shares" ON "public"."booking_payment_shares" FOR SELECT TO "authenticated" USING ((("profile_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."venue_bookings" "b"
  WHERE (("b"."id" = "booking_payment_shares"."booking_id") AND ("b"."created_by" = "auth"."uid"()))))));



CREATE POLICY "Signed-in users can read bookings" ON "public"."venue_bookings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Signed-in users can read venues" ON "public"."venues" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Team members can read their team's purchases" ON "public"."team_premium_purchases" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."team_members"
  WHERE (("team_members"."team_id" = "team_premium_purchases"."team_id") AND ("team_members"."profile_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can read their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can read their own subscription" ON "public"."premium_subscriptions" FOR SELECT TO "authenticated" USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users manage their own follows" ON "public"."user_follows" TO "authenticated" USING (("follower_id" = "auth"."uid"())) WITH CHECK (("follower_id" = "auth"."uid"()));



CREATE POLICY "Users manage their own push tokens" ON "public"."push_tokens" TO "authenticated" USING (("profile_id" = "auth"."uid"())) WITH CHECK (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users mark their own notifications read" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("profile_id" = "auth"."uid"())) WITH CHECK (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users read their own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Venue owners can read their own venue bookings" ON "public"."venue_bookings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."venues"
  WHERE (("venues"."id" = "venue_bookings"."venue_id") AND ("venues"."owner_profile_id" = "auth"."uid"())))));



CREATE POLICY "Venue owners see only their own venue bookings" ON "public"."venue_bookings" FOR SELECT USING (("venue_id" IN ( SELECT "venues"."id"
   FROM "public"."venues"
  WHERE ("venues"."owner_profile_id" = "auth"."uid"()))));



ALTER TABLE "public"."ai_chat_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_payment_shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fixture_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fixture_schedule_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fixture_score_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."follows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."friendly_match_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."friendly_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."league_fixtures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."league_teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leagues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."level_pool" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."premium_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."squad_post_joiners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."squad_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_premium_purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_follows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venues" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_booking_player"("p_booking_id" "uuid", "p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_booking_player"("p_booking_id" "uuid", "p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_booking_player"("p_booking_id" "uuid", "p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_booking_share_internal"("p_booking_id" "uuid", "p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_booking_share_internal"("p_booking_id" "uuid", "p_profile_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."squad_post_joiners" TO "anon";
GRANT ALL ON TABLE "public"."squad_post_joiners" TO "authenticated";
GRANT ALL ON TABLE "public"."squad_post_joiners" TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_house_player"("p_post_id" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_house_player"("p_post_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_house_player"("p_post_id" "uuid", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_fixture_forfeit_stats"("p_league_id" "uuid", "p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_fixture_forfeit_stats"("p_league_id" "uuid", "p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_friendly_forfeit_stats"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_friendly_forfeit_stats"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_result" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_friendly_match_result"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_home_score" integer, "p_away_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_friendly_match_result"("p_home_team_id" "uuid", "p_away_team_id" "uuid", "p_home_score" integer, "p_away_score" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_personal_match_stats"("p_team_id" "uuid", "p_result" "text", "p_goals" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_personal_match_stats"("p_team_id" "uuid", "p_result" "text", "p_goals" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_promotion_relegation"("p_hub_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_promotion_relegation"("p_hub_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_promotion_relegation"("p_hub_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_add_booking_share_on_join"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_add_booking_share_on_join"() TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."venue_bookings" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."venue_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_bookings" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("venue_id") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("team_id") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("booking_day") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("start_time") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("end_time") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("pitches") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("capacity") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("format") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("created_by") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("result") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("result_goals_for") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("result_goals_against") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("result_logged_at") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("amount_cents") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("booking_type") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("note") ON TABLE "public"."venue_bookings" TO "authenticated";



GRANT SELECT("service_fee_cents_per_player") ON TABLE "public"."venue_bookings" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."book_slot"("p_venue_id" "uuid", "p_day" "date", "p_start" time without time zone, "p_end" time without time zone, "p_pitches" integer, "p_capacity" integer, "p_format" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."book_slot"("p_venue_id" "uuid", "p_day" "date", "p_start" time without time zone, "p_end" time without time zone, "p_pitches" integer, "p_capacity" integer, "p_format" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."book_slot"("p_venue_id" "uuid", "p_day" "date", "p_start" time without time zone, "p_end" time without time zone, "p_pitches" integer, "p_capacity" integer, "p_format" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."booking_total_shares_needed"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booking_total_shares_needed"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bookings_needing_share_cancellation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bookings_needing_share_cancellation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_booking_for"("p_booking_id" "uuid", "p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_booking_for"("p_booking_id" "uuid", "p_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_opposition_match"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_opposition_match"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_opposition_match"("p_post_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_opposition_offer"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_opposition_offer"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_opposition_offer"("p_post_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_pending_share"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_pending_share"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_pending_share"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_squad_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_squad_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_squad_post"("p_post_id" "uuid") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."league_fixtures" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."league_fixtures" TO "authenticated";
GRANT ALL ON TABLE "public"."league_fixtures" TO "service_role";



REVOKE ALL ON FUNCTION "public"."captain_team_for_fixture"("p_fixture" "public"."league_fixtures") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."captain_team_for_fixture"("p_fixture" "public"."league_fixtures") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_fixture_score_match"("p_fixture_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_fixture_score_match"("p_fixture_id" "uuid") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."friendly_matches" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."friendly_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."friendly_matches" TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_friendly_score_match"("p_match_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_friendly_score_match"("p_match_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_owner_block_capacity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_owner_block_capacity"() TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."squad_posts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."squad_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."squad_posts" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_squad_post"("p_booking_id" "uuid", "p_post_type" "text", "p_team_id" "uuid", "p_target_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_squad_post"("p_booking_id" "uuid", "p_post_type" "text", "p_team_id" "uuid", "p_target_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_squad_post"("p_booking_id" "uuid", "p_post_type" "text", "p_team_id" "uuid", "p_target_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid", "p_position_needed" "text", "p_level_needed" "text", "p_payment_mode" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid", "p_position_needed" "text", "p_level_needed" "text", "p_payment_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_squad_post"("p_venue_id" "uuid", "p_scheduled_at" timestamp with time zone, "p_format" "text", "p_post_type" "text", "p_level" "text", "p_team_id" "uuid", "p_players_needed" integer, "p_venue_booking_id" "uuid", "p_position_needed" "text", "p_level_needed" "text", "p_payment_mode" "text") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."teams" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_city" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_city" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_city" "text", "p_roster_size" integer, "p_substitute_slots" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_city" "text", "p_roster_size" integer, "p_substitute_slots" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_city" "text", "p_roster_size" integer, "p_substitute_slots" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."end_season_to_divisions"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."end_season_to_divisions"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."end_season_to_divisions"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_gipedo_pano_settlement"("p_match_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_gipedo_pano_settlement"("p_match_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_profile_by_username"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_profile_by_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_profile_by_username"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fixtures_needing_resolution"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fixtures_needing_resolution"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."form_new_division"("p_hub_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."form_new_division"("p_hub_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."form_new_division"("p_hub_league_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."format_player_count"("p_format" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."format_player_count"("p_format" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."format_player_count"("p_format" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."friendly_matches_needing_resolution"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."friendly_matches_needing_resolution"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_profile"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_profile"("p_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_profile"("p_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_profiles"("p_profile_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_profiles"("p_profile_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_profiles"("p_profile_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_team_roster"("p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_team_roster"("p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_team_roster"("p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."gipedo_pano_pending_settlement_shares"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."gipedo_pano_pending_settlement_shares"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_captain_in_league_tree"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_captain_in_league_tree"("p_league_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_username_available"("candidate" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_username_available"("candidate" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_username_available"("candidate" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_squad_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_squad_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_squad_post"("p_post_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."leave_squad_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leave_squad_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_squad_post"("p_post_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_booking_shares"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_booking_shares"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_booking_shares"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_my_fixture_chats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_my_fixture_chats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_my_fixture_chats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_my_transactions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_my_transactions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_my_transactions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_players"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_players"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_players"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_booking_result"("p_booking_id" "uuid", "p_goals_for" integer, "p_goals_against" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_booking_result"("p_booking_id" "uuid", "p_goals_for" integer, "p_goals_against" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_booking_result"("p_booking_id" "uuid", "p_goals_for" integer, "p_goals_against" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_gipedo_pano_share_settled"("p_share_id" "uuid", "p_new_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_gipedo_pano_share_settled"("p_share_id" "uuid", "p_new_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."match_contact_profiles"("normalized_phones" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."match_contact_profiles"("normalized_phones" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."match_contacts_by_phone"("p_phone_numbers" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."match_contacts_by_phone"("p_phone_numbers" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_contacts_by_phone"("p_phone_numbers" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_booking_slot_freed"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_booking_slot_freed"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_fixture_agreed"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_fixture_agreed"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_fixture_message"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_fixture_message"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_squad_post_created"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_squad_post_created"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_squad_post_joiner"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_squad_post_joiner"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_squad_post_matched"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_squad_post_matched"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."offer_opposition"("p_post_id" "uuid", "p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."offer_opposition"("p_post_id" "uuid", "p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."offer_opposition"("p_post_id" "uuid", "p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."propose_fixture_schedule"("p_fixture_id" "uuid", "p_day" "date", "p_time" time without time zone, "p_venue_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."propose_fixture_schedule"("p_fixture_id" "uuid", "p_day" "date", "p_time" time without time zone, "p_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."propose_fixture_schedule"("p_fixture_id" "uuid", "p_day" "date", "p_time" time without time zone, "p_venue_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_gipedo_pano_settlement"("p_match_id" "uuid", "p_settlement" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_gipedo_pano_settlement"("p_match_id" "uuid", "p_settlement" "text") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."league_teams" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."league_teams" TO "authenticated";
GRANT ALL ON TABLE "public"."league_teams" TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_team_for_league"("p_league_id" "uuid", "p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_team_for_league"("p_league_id" "uuid", "p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_team_for_league"("p_league_id" "uuid", "p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_stale_fixture"("p_fixture_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_stale_fixture"("p_fixture_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_stale_fixtures"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_stale_fixtures"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_stale_friendly_match"("p_match_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_stale_friendly_match"("p_match_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_stale_friendly_matches"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_stale_friendly_matches"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_unscheduled_fixture"("p_fixture_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_unscheduled_fixture"("p_fixture_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_unscheduled_fixture"("p_fixture_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."fixture_messages" TO "anon";
GRANT ALL ON TABLE "public"."fixture_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."fixture_messages" TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_fixture_message"("p_fixture_id" "uuid", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_fixture_message"("p_fixture_id" "uuid", "p_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_fixture_message"("p_fixture_id" "uuid", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."service_fee_cents"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."service_fee_cents"() TO "service_role";
GRANT ALL ON FUNCTION "public"."service_fee_cents"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."service_fee_rate"() TO "anon";
GRANT ALL ON FUNCTION "public"."service_fee_rate"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."service_fee_rate"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_team_premium"("p_team_id" "uuid", "p_format" "text", "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_team_premium"("p_team_id" "uuid", "p_format" "text", "p_enabled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."squad_post_notification_recipients"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."squad_post_notification_recipients"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."squad_post_notification_recipients"("p_post_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_league_season"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_league_season"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_league_season"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_fixture_score"("p_fixture_id" "uuid", "p_home_score" integer, "p_away_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_fixture_score"("p_fixture_id" "uuid", "p_home_score" integer, "p_away_score" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_fixture_score"("p_fixture_id" "uuid", "p_home_score" integer, "p_away_score" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_friendly_score"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_friendly_score"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_friendly_score"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_league_fixtures"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_league_fixtures"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."venue_day_availability"("target_venue" "uuid", "target_day" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."venue_day_availability"("target_venue" "uuid", "target_day" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."venue_day_availability"("target_venue" "uuid", "target_day" "date") TO "service_role";



GRANT ALL ON TABLE "public"."ai_chat_usage" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_chat_usage_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_chat_usage_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_chat_usage_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_payment_shares" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_payment_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_payment_shares" TO "service_role";



GRANT ALL ON TABLE "public"."fixture_schedule_proposals" TO "anon";
GRANT ALL ON TABLE "public"."fixture_schedule_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."fixture_schedule_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."fixture_score_submissions" TO "anon";
GRANT ALL ON TABLE "public"."fixture_score_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."fixture_score_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."follows" TO "anon";
GRANT ALL ON TABLE "public"."follows" TO "authenticated";
GRANT ALL ON TABLE "public"."follows" TO "service_role";



GRANT ALL ON TABLE "public"."friendly_match_scores" TO "anon";
GRANT ALL ON TABLE "public"."friendly_match_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."friendly_match_scores" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leagues" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leagues" TO "authenticated";
GRANT ALL ON TABLE "public"."leagues" TO "service_role";



GRANT ALL ON TABLE "public"."level_pool" TO "anon";
GRANT ALL ON TABLE "public"."level_pool" TO "authenticated";
GRANT ALL ON TABLE "public"."level_pool" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."premium_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."premium_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_subscriptions" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT INSERT("id"),UPDATE("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("email"),UPDATE("email") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("gender") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("date_of_birth") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("city") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("position") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("preferred_foot") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("username"),UPDATE("username") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("full_name"),UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("bio") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("show_phone_publicly") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_members" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."team_premium_purchases" TO "anon";
GRANT ALL ON TABLE "public"."team_premium_purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."team_premium_purchases" TO "service_role";



GRANT ALL ON TABLE "public"."user_follows" TO "anon";
GRANT ALL ON TABLE "public"."user_follows" TO "authenticated";
GRANT ALL ON TABLE "public"."user_follows" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."venues" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."venues" TO "authenticated";
GRANT ALL ON TABLE "public"."venues" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







