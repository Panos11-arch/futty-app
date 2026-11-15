-- P10: one source for every number in docs/specs/13-payments-bookings.md.
--
-- public.app_rules holds each rule once. Every SQL function that used a
-- number from spec 13 now reads it from here (re-created below from its
-- latest definition, with only the numbers changed), as do the Edge
-- Functions (_shared/rules.ts), the app (lib/rules.ts) and the Futty AI's
-- system prompt.
--
-- A change applies at once (decided 15 November): rules are read when
-- they're used, so a new refund cutoff also applies to bookings already
-- made. Amounts a booking already stored (its pitch price and its service
-- fee per player) don't change. A quote the player was shown is checked
-- again when they confirm (quote_changed), so nobody is charged on an old
-- rule. Every change is kept in public.app_rules_history.
--
-- Readable by everyone (anon included: the app shows the rules before
-- sign-in); written only by service_role.

create table public.app_rules (
  -- One row.
  id boolean primary key default true check (id),

  -- Service fee per player, in cents ("Prices and fees").
  fee_each_pays_cents integer not null default 80 check (fee_each_pays_cents between 0 and 1000),
  fee_pay_all_cents integer not null default 55 check (fee_pay_all_cents between 0 and 1000),
  -- What a Premium player's own spot carries (no fee).
  fee_premium_cents integer not null default 0 check (fee_premium_cents between 0 and 1000),
  -- Gipedo Pano: the fee per player on each team's hold.
  gipedo_fee_cents integer not null default 55 check (gipedo_fee_cents between 0 and 1000),

  -- Booking windows: days after today in Cyprus.
  window_standard_days integer not null default 7 check (window_standard_days between 0 and 60),
  window_premium_days integer not null default 14 check (window_premium_days between 0 and 60),

  -- Cancellations ("Cancellations and refunds").
  free_cancel_minutes integer not null default 60 check (free_cancel_minutes between 0 and 1440),
  cancel_fee_cents integer not null default 100 check (cancel_fee_cents between 0 and 10000),
  refund_cutoff_hours integer not null default 6 check (refund_cutoff_hours between 0 and 72),
  -- When the booker or the venue cancels: a player whose payment was taken
  -- has this long to choose venue credit; with no choice it goes back to
  -- their card.
  refund_choice_hours integer not null default 48 check (refund_choice_hours between 1 and 168),

  -- When money is held and taken.
  capture_delay_minutes integer not null default 60 check (capture_delay_minutes between 0 and 1440),
  payment_window_minutes integer not null default 15 check (payment_window_minutes between 5 and 120),
  guarantee_hold_lead_hours integer not null default 72 check (guarantee_hold_lead_hours between 0 and 144),
  guarantee_retry_hours integer not null default 6 check (guarantee_retry_hours between 1 and 48),
  collection_delay_hours integer not null default 2 check (collection_delay_hours between 0 and 48),

  -- Venue credit.
  credit_expiry_months integer not null default 12 check (credit_expiry_months between 1 and 60),

  -- Gipedo Pano: booked at most this many days ahead (spec 13 decision 5:
  -- 5 days, 120 hours, to be confirmed), and at least this many hours
  -- before kickoff, when its opposition post also closes (decisions 1, 6).
  gipedo_max_days integer not null default 5 check (gipedo_max_days between 1 and 6),
  gipedo_opponent_hours integer not null default 24 check (gipedo_opponent_hours between 1 and 72),

  -- Premium, as shown before the App Store's own price has loaded.
  premium_price_label text not null default '€3.99' check (length(premium_price_label) between 1 and 20),

  -- Weather warnings ("Confirmed thresholds"), for P11.
  weather_rain_chance_pct integer not null default 60 check (weather_rain_chance_pct between 0 and 100),
  weather_heavy_rain boolean not null default true,
  weather_wind_kmh integer not null default 40 check (weather_wind_kmh between 0 and 200),
  weather_thunderstorms boolean not null default true,
  weather_heat_c integer not null default 38 check (weather_heat_c between 0 and 60),

  updated_at timestamptz not null default now(),

  -- Spec 13: the free hour ends when the share is taken.
  constraint app_rules_free_hour_is_capture check (free_cancel_minutes = capture_delay_minutes),
  constraint app_rules_premium_window check (window_premium_days >= window_standard_days)
);

insert into public.app_rules default values;

-- Every change, with what it was before.
create table public.app_rules_history (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by text not null default current_user,
  old_rules jsonb not null,
  new_rules jsonb not null
);

-- Not security definer: it runs as whoever changes the rules (service_role),
-- so changed_by says who.
create or replace function public.app_rules_record_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  insert into public.app_rules_history (old_rules, new_rules)
  values (to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  return new;
end;
$$;

create trigger app_rules_record_change
  before update on public.app_rules
  for each row execute function public.app_rules_record_change();

-- The row can't be removed or duplicated (the primary key allows one).
create or replace function public.app_rules_refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'app_rules_cannot_be_deleted';
end;
$$;

create trigger app_rules_refuse_delete
  before delete on public.app_rules
  for each statement execute function public.app_rules_refuse_delete();

alter table public.app_rules enable row level security;
alter table public.app_rules_history enable row level security;
create policy "Everyone reads the rules" on public.app_rules for select to anon, authenticated using (true);
revoke all on public.app_rules, public.app_rules_history from public, anon, authenticated;
grant select on public.app_rules to anon, authenticated;
grant all on public.app_rules, public.app_rules_history to service_role;

revoke all on function public.app_rules_record_change() from public, anon, authenticated;
revoke all on function public.app_rules_refuse_delete() from public, anon, authenticated;

-- ---- Reading the rules in SQL -----------------------------------------------
-- Internal: the functions below are called from the payment functions,
-- which are security definer, so they're for service_role only.

create or replace function public.app_rules_now()
returns public.app_rules
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.app_rules where id;
$$;

create or replace function public.rule_refund_cutoff()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(hours => refund_cutoff_hours) from public.app_rules where id $$;

create or replace function public.rule_capture_delay()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(mins => capture_delay_minutes) from public.app_rules where id $$;

create or replace function public.rule_payment_window()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(mins => payment_window_minutes) from public.app_rules where id $$;

create or replace function public.rule_guarantee_hold_lead()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(hours => guarantee_hold_lead_hours) from public.app_rules where id $$;

create or replace function public.rule_guarantee_retry()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(hours => guarantee_retry_hours) from public.app_rules where id $$;

create or replace function public.rule_collection_delay()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(hours => collection_delay_hours) from public.app_rules where id $$;

create or replace function public.rule_credit_expiry()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(months => credit_expiry_months) from public.app_rules where id $$;

create or replace function public.rule_gipedo_max_ahead()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(days => gipedo_max_days) from public.app_rules where id $$;

create or replace function public.rule_gipedo_opponent_lead()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(hours => gipedo_opponent_hours) from public.app_rules where id $$;

create or replace function public.rule_refund_choice()
returns interval language sql stable security definer set search_path = ''
as $$ select make_interval(hours => refund_choice_hours) from public.app_rules where id $$;

create or replace function public.rule_cancel_fee_cents()
returns integer language sql stable security definer set search_path = ''
as $$ select cancel_fee_cents from public.app_rules where id $$;

-- Days after today the account can book: standard or Premium.
create or replace function public.rule_window_days(p_premium boolean)
returns integer language sql stable security definer set search_path = ''
as $$ select case when coalesce(p_premium, false) then window_premium_days else window_standard_days end
      from public.app_rules where id $$;

-- A duration in the words players read: "6 hours", "1 hour", "15 minutes".
create or replace function public.rule_duration_words(p_duration interval)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_minutes integer := (extract(epoch from p_duration) / 60)::integer;
begin
  if v_minutes > 0 and v_minutes % 60 = 0 then
    return case when v_minutes = 60 then '1 hour' else (v_minutes / 60) || ' hours' end;
  end if;
  return case when v_minutes = 1 then '1 minute' else v_minutes || ' minutes' end;
end;
$$;

revoke all on function public.app_rules_now() from public, anon, authenticated;
revoke all on function public.rule_refund_cutoff() from public, anon, authenticated;
revoke all on function public.rule_capture_delay() from public, anon, authenticated;
revoke all on function public.rule_payment_window() from public, anon, authenticated;
revoke all on function public.rule_guarantee_hold_lead() from public, anon, authenticated;
revoke all on function public.rule_guarantee_retry() from public, anon, authenticated;
revoke all on function public.rule_collection_delay() from public, anon, authenticated;
revoke all on function public.rule_credit_expiry() from public, anon, authenticated;
revoke all on function public.rule_gipedo_max_ahead() from public, anon, authenticated;
revoke all on function public.rule_gipedo_opponent_lead() from public, anon, authenticated;
revoke all on function public.rule_refund_choice() from public, anon, authenticated;
revoke all on function public.rule_cancel_fee_cents() from public, anon, authenticated;
revoke all on function public.rule_window_days(boolean) from public, anon, authenticated;
revoke all on function public.rule_duration_words(interval) from public, anon, authenticated;
grant execute on function public.app_rules_now() to service_role;
grant execute on function public.rule_refund_cutoff() to service_role;
grant execute on function public.rule_capture_delay() to service_role;
grant execute on function public.rule_payment_window() to service_role;
grant execute on function public.rule_guarantee_hold_lead() to service_role;
grant execute on function public.rule_guarantee_retry() to service_role;
grant execute on function public.rule_collection_delay() to service_role;
grant execute on function public.rule_credit_expiry() to service_role;
grant execute on function public.rule_gipedo_max_ahead() to service_role;
grant execute on function public.rule_gipedo_opponent_lead() to service_role;
grant execute on function public.rule_refund_choice() to service_role;
grant execute on function public.rule_cancel_fee_cents() to service_role;
grant execute on function public.rule_window_days(boolean) to service_role;
grant execute on function public.rule_duration_words(interval) to service_role;

-- ---- The functions that used spec 13's numbers ------------------------------
-- Each is its latest definition (named in its comment) with only the numbers
-- swapped for the rules. Functions that were immutable become stable, as they
-- now read a table. Their grants are kept (create or replace).

-- book_slot, from 20261113115749_pay_gipedo_mode.sql
create or replace function public.book_slot(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitches integer,
  p_format text,
  p_players_per_side integer default 5,
  p_mode text default null,
  p_team_id uuid default null
)
returns public.venue_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_window_days integer;
  v_hours record;
  v_six_on_five boolean;
  v_capacity integer;
  v_pitch_ids uuid[];
  v_amount_cents integer;
  v_status text;
  v_booking public.venue_bookings;
  v_share record;
  v_premium boolean;
  v_gipedo boolean := p_mode = 'gipedo_pano';
  v_error text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not v_venue.is_live then
    raise exception 'venue_not_live';
  end if;

  if p_day < v_now::date or (p_day = v_now::date and p_start <= v_now::time) then
    raise exception 'slot_in_past';
  end if;

  v_premium := exists (select 1 from public.profiles where id = auth.uid() and is_premium);
  v_window_days := public.rule_window_days(v_premium);
  if p_day - v_now::date > v_window_days then
    raise exception 'beyond_booking_window';
  end if;

  if p_pitches is null or p_pitches < 1
     or p_pitches > (select count(*) from public.pitches where venue_id = p_venue_id) then
    raise exception 'invalid_pitches';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;

  if extract(minute from p_start) not in (0, 30) or extract(second from p_start) <> 0
     or extract(minute from p_end) not in (0, 30) or extract(second from p_end) <> 0 then
    raise exception 'slot_not_on_grid';
  end if;

  select * into v_hours from public.venue_hours_on(p_venue_id, p_day);
  if v_hours.closed then
    raise exception 'venue_closed';
  end if;
  if v_hours.opens is null or p_start < v_hours.opens or p_end > v_hours.closes then
    raise exception 'outside_opening_hours';
  end if;

  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
     or not (
       exists (select 1 from public.pitches where venue_id = p_venue_id and p_format = any (formats))
       or exists (select 1 from public.pitch_combinations where venue_id = p_venue_id and format = p_format)
     ) then
    raise exception 'invalid_format';
  end if;

  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    raise exception 'invalid_players_per_side';
  end if;
  v_six_on_five := p_players_per_side = 6 and p_format = '5-a-side';
  if p_players_per_side = 6 and p_format <> '6-a-side' and (p_format <> '5-a-side' or not v_venue.allows_6v6_on_5s) then
    raise exception 'six_a_side_not_allowed';
  end if;
  v_capacity := case when v_six_on_five then 12 else public.format_player_count(p_format) * 2 end;

  if p_mode is null then
    raise exception 'mode_required';
  end if;
  if p_mode not in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;

  -- Gipedo Pano: a captain, for their team, 24 to 144 hours ahead.
  if v_gipedo then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not public.is_team_captain(p_team_id, auth.uid()) then
      raise exception 'not_captain';
    end if;
    v_error := public.gipedo_window_error(public.booking_kickoff_at(p_day, p_start), now());
    if v_error is not null then
      raise exception '%', v_error;
    end if;
  end if;

  v_amount_cents := public.slot_price_cents(p_venue_id, p_day, p_start, p_end, p_format);
  if v_amount_cents is null then
    raise exception 'price_not_set';
  end if;

  v_pitch_ids := public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five);
  if v_pitch_ids is null then
    if public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five, p_ignore_blocks => true) is not null then
      raise exception 'slot_blocked';
    end if;
    raise exception 'slot_full';
  end if;

  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player, payment_mode, team_id)
    values
      (p_venue_id, p_day, p_start, p_end, cardinality(v_pitch_ids), v_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.money_fee_per_player_cents(p_mode) end, p_mode,
       case when v_gipedo then p_team_id end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select v_booking.id, unnest(v_pitch_ids), public.booking_slot_range(p_day, p_start, p_end);
  exception when exclusion_violation then
    raise exception 'slot_full';
  end;

  if v_amount_cents > 0 then
    select * into v_share from public.money_share(v_amount_cents, v_capacity, p_mode, true, v_premium, 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, gipedo_side)
    values
      (v_booking.id, auth.uid(), v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, true,
       'pending', case when v_gipedo then 'a' end);

    if p_mode = 'each_pays_responsible' then
      insert into public.booking_guarantees (booking_id, profile_id, amount_cents, hold_due_at)
      values (v_booking.id, auth.uid(), v_amount_cents,
              public.money_guarantee_hold_due_at(v_booking.created_at, public.booking_kickoff_at(p_day, p_start)));
    end if;
  end if;

  return v_booking;
end;
$$;

-- booking_search_options, from 20261112090000_pay_booking_screens.sql
create or replace function public.booking_search_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_premium boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_premium := coalesce((select is_premium from public.profiles where id = auth.uid()), false);
  return jsonb_build_object(
    'today', (now() at time zone 'Asia/Nicosia')::date,
    'window_days', public.rule_window_days(v_premium),
    'is_premium', v_premium,
    'six_on_five_available', exists (
      select 1 from public.venues v
      where v.is_live and v.allows_6v6_on_5s
        and (exists (select 1 from public.pitches p where p.venue_id = v.id and p.is_open and '5-a-side' = any (p.formats))
             or exists (select 1 from public.pitch_combinations c where c.venue_id = v.id and c.format = '5-a-side')))
  );
end;
$$;

-- booking_slot_checked, from 20261112090000_pay_booking_screens.sql
create or replace function public.booking_slot_checked(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_players_per_side integer,
  p_premium boolean
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_hours record;
  v_six_on_five boolean;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not v_venue.is_live then
    raise exception 'venue_not_live';
  end if;
  if p_day is null or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;
  if p_day < v_now::date or (p_day = v_now::date and p_start <= v_now::time) then
    raise exception 'slot_in_past';
  end if;
  if p_day - v_now::date > public.rule_window_days(p_premium) then
    raise exception 'beyond_booking_window';
  end if;
  if extract(minute from p_start) not in (0, 30) or extract(second from p_start) <> 0
     or extract(minute from p_end) not in (0, 30) or extract(second from p_end) <> 0 then
    raise exception 'slot_not_on_grid';
  end if;
  select * into v_hours from public.venue_hours_on(p_venue_id, p_day);
  if v_hours.closed then
    raise exception 'venue_closed';
  end if;
  if v_hours.opens is null or p_start < v_hours.opens or p_end > v_hours.closes then
    raise exception 'outside_opening_hours';
  end if;
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
     or not (
       exists (select 1 from public.pitches where venue_id = p_venue_id and p_format = any (formats))
       or exists (select 1 from public.pitch_combinations where venue_id = p_venue_id and format = p_format)
     ) then
    raise exception 'invalid_format';
  end if;
  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    raise exception 'invalid_players_per_side';
  end if;
  v_six_on_five := p_players_per_side = 6 and p_format = '5-a-side';
  if p_players_per_side = 6 and p_format <> '6-a-side' and (p_format <> '5-a-side' or not v_venue.allows_6v6_on_5s) then
    raise exception 'six_a_side_not_allowed';
  end if;
  return case when v_six_on_five then 12 else public.format_player_count(p_format) * 2 end;
end;
$$;

-- venues_free_at, from 20261112090000_pay_booking_screens.sql
create or replace function public.venues_free_at(
  p_day date,
  p_start time,
  p_minutes integer,
  p_format text,
  p_players_per_side integer default 5
)
returns table (
  venue_id uuid,
  name text,
  city text,
  address text,
  photo_path text,
  pitch_cents integer,
  player_cents integer,
  next_starts time[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_premium boolean;
  v_end_at timestamp;
  v_end time;
  v_six_on_five boolean := p_players_per_side = 6 and p_format = '5-a-side';
  v_venue record;
  v_players integer;
  v_price integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_minutes is null or p_minutes < 30 or p_minutes % 30 <> 0 or p_day is null or p_start is null then
    raise exception 'invalid_time_range';
  end if;
  v_premium := coalesce((select is_premium from public.profiles where id = auth.uid()), false);
  if p_day - v_now::date > public.rule_window_days(v_premium) then
    raise exception 'beyond_booking_window';
  end if;
  v_end_at := p_day + p_start + make_interval(mins => p_minutes);
  if v_end_at > p_day + 1 then
    return;
  end if;
  v_end := case when v_end_at = p_day + 1 then time '24:00' else v_end_at::time end;

  for v_venue in
    select v.id, v.name, v.city, v.address from public.venues v
    where v.is_live and (not v_six_on_five or v.allows_6v6_on_5s)
    order by v.name, v.id
  loop
    begin
      v_players := public.booking_slot_checked(v_venue.id, p_day, p_start, v_end, p_format, p_players_per_side, v_premium);
    exception when others then
      continue;
    end;
    v_price := public.slot_price_cents(v_venue.id, p_day, p_start, v_end, p_format);
    if v_price is null or public.pick_pitches(v_venue.id, p_day, p_start, v_end, p_format, v_six_on_five) is null then
      continue;
    end if;
    venue_id := v_venue.id;
    name := v_venue.name;
    city := v_venue.city;
    address := v_venue.address;
    photo_path := (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                   order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1);
    pitch_cents := v_price;
    player_cents := (select m.card_cents
                     from public.money_share(v_price, v_players, 'each_pays_own_spot', false, false, 'card') m);
    next_starts := array(select f.start_time
                         from public.venue_free_slots(v_venue.id, p_day, p_format, p_minutes, p_players_per_side) f
                         where f.start_time > p_start order by f.start_time limit 3);
    return next;
  end loop;
end;
$$;

-- booking_detail, from 20261115170000_pay_gipedo_dashboard_merge.sql
create or replace function public.booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_detail jsonb := public.booking_detail_modes(p_booking_id);
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_mine public.booking_payment_shares;
  v_opponent public.booking_payment_shares;
  v_booker_hold public.booking_payment_shares;
  v_settlement public.gipedo_settlements;
  v_pull jsonb;
  v_roster jsonb;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.gipedo_side is not null) then
    return v_detail || jsonb_build_object('gipedo', null);
  end if;
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1;
  select * into v_mine from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid and gipedo_side is not null;
  select * into v_opponent from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.gipedo_side = 'b' and s.status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.reason = 'pull_out_fee');
  select * into v_booker_hold from public.booking_payment_shares
  where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
  select * into v_settlement from public.gipedo_settlements where share_id = v_mine.id;
  v_pull := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  -- A captain's card that is only held shows as held, not paid; one whose
  -- hold expired as unpaid.
  select coalesce(jsonb_agg(case when s.gipedo_side is not null and s.status = 'authorized'
                                 then r.e || jsonb_build_object('state', 'held')
                                 when s.gipedo_side is not null and s.status = 'expired'
                                 then r.e || jsonb_build_object('state', 'unpaid')
                                 else r.e end order by r.ord), '[]'::jsonb)
    into v_roster
  from jsonb_array_elements(v_detail -> 'roster') with ordinality as r(e, ord)
  left join public.booking_payment_shares s on s.id = (r.e ->> 'share_id')::uuid;

  return v_detail
    || jsonb_build_object('roster', v_roster)
    || jsonb_build_object('can_cancel', case when v_mine.id is not null and v_booking.payment_mode = 'gipedo_pano'
                                             then jsonb_build_object('my_spot', false, 'whole_team', false)
                                             else v_detail -> 'can_cancel' end)
    || jsonb_build_object('gipedo', jsonb_build_object(
      'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = v_booking.team_id),
      'opponent', jsonb_build_object(
        'state', case when v_opponent.status = 'authorized' then 'held' when v_opponent.id is not null then 'offered' else 'none' end,
        'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t
                 where t.id = v_post.matched_team_id and v_opponent.id is not null)),
      'my_side', v_mine.gipedo_side,
      'pull_out', v_pull - 'share_id' - 'side',
      'choice_due', v_booking.created_by = v_uid and v_booking.payment_mode = 'gipedo_pano'
                    and v_booking.status = 'confirmed' and v_booking.gipedo_no_opponent_at is not null
                    and v_booking.gipedo_choice is null
                    and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff(),
      'choice', v_booking.gipedo_choice,
      'play_normal_cents', case when v_booking.created_by = v_uid then v_booker_hold.amount_cents end,
      'settlement', case when v_settlement.id is null then null else jsonb_build_object(
        'reason', v_settlement.reason, 'capture_cents', v_settlement.capture_cents, 'status', v_settlement.status) end));
end;
$$;

-- booking_detail_modes, from 20261115170000_pay_gipedo_dashboard_merge.sql
CREATE OR REPLACE FUNCTION public.booking_detail_modes(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_venue public.venues;
  v_me public.booking_payment_shares;
  v_is_booker boolean;
  v_kickoff timestamptz;
  v_refunds_stop timestamptz;
  v_active boolean;
  v_free_until timestamptz;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null
     or not (v_booking.created_by = v_uid
             or exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.profile_id = v_uid)) then
    raise exception 'booking_not_found';
  end if;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  select * into v_venue from public.venues where id = v_booking.venue_id;
  select * into v_me from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid
  order by (status not in ('cancelled', 'refunded')) desc, created_at desc
  limit 1;
  v_is_booker := v_booking.created_by = v_uid;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  v_refunds_stop := v_kickoff - public.rule_refund_cutoff();
  v_active := v_booking.status <> 'cancelled' and now() < v_kickoff;

  if v_me.status = 'authorized' and v_me.capture_due_at > now() then
    v_free_until := v_me.capture_due_at;
  end if;
  if v_active then
    if v_free_until is not null and v_free_until < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'free_hour_ends', 'at', v_free_until);
    elsif now() < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'refunds_stop', 'at', v_refunds_stop);
    end if;
  end if;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', v_booking.id, 'status', v_booking.status, 'booking_day', v_booking.booking_day,
      'start_time', v_booking.start_time, 'end_time', v_booking.end_time, 'format', v_booking.format,
      'capacity', v_booking.capacity,
      'players_per_side', v_booking.capacity / 2,
      'payment_mode', v_booking.payment_mode,
      'kickoff_at', v_kickoff,
      'ends_at', public.booking_ends_at(v_booking.booking_day, v_booking.end_time),
      'refunds_stop_at', v_refunds_stop,
      'payment_window_ends_at', case when v_booking.status = 'pending_payment'
                                     then public.booking_payment_window_ends_at(v_booking) end),
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address,
      'google_maps_link', v_venue.google_maps_link,
      'photo_path', (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                     order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1)),
    'is_booker', v_is_booker,
    'me', case when v_me.id is null then null else jsonb_build_object(
      'share_id', v_me.id, 'status', v_me.status, 'payment_method', v_me.payment_method,
      'amount_cents', v_me.amount_cents, 'pitch_cents', v_me.pitch_cents, 'fee_cents', v_me.fee_cents,
      'cash_cents', v_me.cash_cents, 'free_until', v_free_until) end,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'profile_id', s.profile_id,
               'name', public.profile_display_name(s.profile_id),
               'username', p.username,
               'is_booker', s.is_booker,
               'is_me', s.profile_id = v_uid,
               'state', case
                          when s.status = 'covered' then 'covered'
                          when s.status = 'pending' then 'unpaid'
                          when s.payment_method = 'cash' and s.cash_received_at is not null then 'cash_paid'
                          when s.payment_method = 'cash' then 'cash'
                          else 'in_app' end,
               'amount_cents', case when v_is_booker or s.profile_id = v_uid then s.amount_cents end,
               'cash_cents', case when v_is_booker or s.profile_id = v_uid then s.cash_cents end)
             order by s.is_booker desc, s.created_at, s.id)
      from public.booking_payment_shares s
      left join public.profiles p on p.id = s.profile_id
      where s.booking_id = p_booking_id and s.status not in ('cancelled', 'refunded')), '[]'::jsonb),
    'next_cutoff', v_next,
    'can_cancel', jsonb_build_object(
      'my_spot', v_active and v_me.id is not null and v_me.status not in ('cancelled', 'refunded')
                 and not (v_me.is_booker and v_booking.payment_mode = 'pay_all'),
      'whole_team', v_active and v_is_booker)
  );
end;
$function$;

-- cancellation_window, from 20261109180834_pay_cancellations_plan.sql
create or replace function public.cancellation_window(
  p_share public.booking_payment_shares,
  p_kickoff timestamptz,
  p_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paid_at timestamptz := coalesce(p_share.held_at, p_share.paid_at);
begin
  -- Paid less than 6 hours before kickoff: taken at once, no free hour, ever.
  if p_share.capture_method = 'immediate'
     or (v_paid_at is not null and public.money_is_non_refundable(v_paid_at, p_kickoff)) then
    return 'late';
  end if;
  if p_at > p_kickoff - public.rule_refund_cutoff() then
    return 'late';
  end if;
  if p_at < coalesce(p_share.capture_due_at, public.money_capture_due_at(v_paid_at, p_kickoff)) then
    return 'free';
  end if;
  return 'middle';
end;
$$;

-- send_short_game_warnings, from 20261110190001_pay_collection_collect.sql
create or replace function public.send_short_game_warnings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_joined integer;
  v_extra integer;
  v_profile uuid;
  v_count integer := 0;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
      and b.status = 'confirmed'
      and b.booking_type = 'user_booking'
      and b.short_game_warned_at is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
      and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
    for update skip locked
  loop
    update public.venue_bookings set short_game_warned_at = now() where id = v_booking.id;
    select count(*), coalesce(min(a.due_pitch_cents - a.normal_pitch_cents) filter (where not a.is_booker),
                              max(a.due_pitch_cents - a.normal_pitch_cents))
    into v_joined, v_extra
    from public.collection_amounts(v_booking.id) a;
    if v_joined = 0 or v_joined >= v_booking.capacity or v_extra <= 0 then
      continue;
    end if;
    for v_profile in select a.profile_id from public.collection_amounts(v_booking.id) a loop
      perform public.send_notification(v_profile, 'short_game_warning', jsonb_build_object(
        'title', format('You''re %s of %s', v_joined, v_booking.capacity),
        'body', format('If nobody else joins, each player pays %s extra after the match.',
                       public.money_format_euros(v_extra)),
        'bookingId', v_booking.id,
        'joined', v_joined,
        'players', v_booking.capacity,
        'extraCents', v_extra,
        'actions', jsonb_build_array('request_venue_player', 'post_public_request')
      ));
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- gipedo_no_opponent_choice, from 20261113115755_pay_gipedo_settle.sql
create or replace function public.gipedo_no_opponent_choice(p_booking_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_hold public.booking_payment_shares;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.created_by is distinct from auth.uid() then
    raise exception 'booking_not_found';
  end if;
  if v_booking.payment_mode is distinct from 'gipedo_pano' or v_booking.status <> 'confirmed' then
    raise exception 'not_gipedo';
  end if;
  if v_booking.gipedo_no_opponent_at is null then
    raise exception 'choice_not_due';
  end if;
  if v_booking.gipedo_choice is not null then
    raise exception 'already_chosen';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_refund_cutoff() then
    raise exception 'choice_closed';
  end if;
  if p_choice not in ('play_normal', 'cancel') then
    raise exception 'invalid_choice';
  end if;

  update public.venue_bookings set gipedo_choice = p_choice where id = p_booking_id;
  if p_choice = 'play_normal' then
    select * into v_hold from public.booking_payment_shares
    where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
    update public.venue_bookings set payment_mode = 'pay_all' where id = p_booking_id;
    perform public.gipedo_add_settlement(v_hold.id, 'play_normal');
    return jsonb_build_object('result', 'play_normal', 'capture_cents', v_hold.amount_cents);
  end if;
  perform public.gipedo_cancel_booking(p_booking_id, 'Nobody took it on, so it was cancelled free and the hold released.');
  return jsonb_build_object('result', 'cancelled');
end;
$$;

-- gipedo_pull_out_quote, from 20261113185144_pay_gipedo_followups.sql
create or replace function public.gipedo_pull_out_quote(p_booking_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_hold public.booking_payment_shares;
  v_kickoff timestamptz;
  v_kind text;
  v_cents integer;
  v_per_player integer;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.payment_mode is distinct from 'gipedo_pano' or v_booking.status <> 'confirmed' then
    return null;
  end if;
  select * into v_hold from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.profile_id = p_profile_id and s.gipedo_side is not null
    and s.status = 'authorized'
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id);
  if v_hold.id is null then
    return null;
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if now() >= v_kickoff then
    return null;
  end if;
  if v_hold.gipedo_side = 'a' and not public.gipedo_has_opponent(p_booking_id, true) then
    v_kind := 'free';
    v_cents := 0;
  elsif now() > v_kickoff - public.rule_refund_cutoff() then
    v_kind := 'forfeit';
    v_cents := v_hold.amount_cents;
  else
    -- 100 cents per player in the booking, capped at the hold (decisions 2
    -- and 15), as gipedo_add_settlement takes it.
    v_kind := 'fee';
    v_per_player := public.rule_cancel_fee_cents();
    v_cents := least(v_per_player * v_booking.capacity, v_hold.amount_cents);
  end if;
  return jsonb_build_object('kind', v_kind, 'cents', v_cents, 'fee_per_player_cents', v_per_player,
                            'side', v_hold.gipedo_side, 'share_id', v_hold.id);
end;
$$;

-- gipedo_auto_cancel_due, from 20261113115755_pay_gipedo_settle.sql
create or replace function public.gipedo_auto_cancel_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_count integer := 0;
begin
  for v_booking in
    select b.id from public.venue_bookings b
    where b.payment_mode = 'gipedo_pano' and b.status = 'confirmed'
      and b.gipedo_no_opponent_at is not null and b.gipedo_choice is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_refund_cutoff()
  loop
    update public.venue_bookings set gipedo_choice = 'auto_cancel' where id = v_booking;
    perform public.gipedo_cancel_booking(v_booking,
      'Nobody took it on and no choice was made by ' || public.rule_duration_words(public.rule_refund_cutoff()) || ' before kickoff, so it was cancelled free and the hold released.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- gipedo_no_opponent_due, from 20261113115755_pay_gipedo_settle.sql
create or replace function public.gipedo_no_opponent_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_count integer := 0;
  v_hold record;
begin
  for v_booking in
    select b.* from public.venue_bookings b
    where b.payment_mode = 'gipedo_pano' and b.status = 'confirmed' and b.gipedo_no_opponent_at is null
      and now() >= public.booking_kickoff_at(b.booking_day, b.start_time) - public.rule_gipedo_opponent_lead()
      and not public.gipedo_has_opponent(b.id)
    for update of b
  loop
    update public.venue_bookings set gipedo_no_opponent_at = now() where id = v_booking.id;
    update public.squad_posts set status = 'closed'
    where venue_booking_id = v_booking.id and type = 'opposition' and status = 'open';
    select amount_cents into v_hold from public.booking_payment_shares
    where booking_id = v_booking.id and is_booker and gipedo_side = 'a';
    perform public.send_notification(v_booking.created_by, 'gipedo_no_opponent', jsonb_build_object(
      'title', 'No opponent yet',
      'body', format('Nobody has taken on your Gipedo Pano game at %s. Play it as a normal booking for %s, or cancel '
                     || 'free and your hold is released. If you don''t choose by ' || public.rule_duration_words(public.rule_refund_cutoff()) || ' before kickoff, it''s cancelled free.',
                     public.booking_label(v_booking), public.money_format_euros(v_hold.amount_cents)),
      'bookingId', v_booking.id
    ));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- gipedo_pull_out, from 20261113130016_pay_gipedo_review_fixes.sql
create or replace function public.gipedo_pull_out(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_quote jsonb;
  v_side text;
  v_match public.matches;
  v_post public.squad_posts;
  v_other uuid;
  v_team text;
  v_opponent_share public.booking_payment_shares;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  v_quote := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  if v_quote is null then
    raise exception 'cannot_pull_out';
  end if;
  v_side := v_quote ->> 'side';
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1 for update;
  select * into v_opponent_share from public.booking_payment_shares
  where booking_id = p_booking_id and gipedo_side = 'b' and status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = booking_payment_shares.id);

  if v_quote ->> 'kind' = 'free' then
    -- An offer not yet held goes with the booking.
    if v_opponent_share.id is not null then
      update public.booking_payment_shares set status = 'cancelled' where id = v_opponent_share.id;
    end if;
    perform public.gipedo_cancel_booking(p_booking_id, 'The booking team cancelled before anyone took it on; holds are released.');
    return jsonb_build_object('result', 'cancelled', 'cents', 0);
  end if;

  v_other := case when v_side = 'a' then v_opponent_share.profile_id else v_booking.created_by end;
  select name into v_team from public.teams
  where id = case when v_side = 'a' then v_booking.team_id else v_post.matched_team_id end;

  if v_quote ->> 'kind' = 'forfeit' then
    select * into v_match from public.matches where booking_id = p_booking_id;
    if v_match.id is null then
      perform public.create_match_for_booking(p_booking_id);
      select * into v_match from public.matches where booking_id = p_booking_id;
    end if;
    if v_match.id is null then
      raise exception 'match_not_ready';
    end if;
    perform public.record_match_forfeit(v_match.id, v_side, 'pulled_out');
    perform public.send_notification(v_other, 'gipedo_pulled_out', jsonb_build_object(
      'title', 'Your opponent pulled out',
      'body', format('%s pulled out of your Gipedo Pano game at %s less than ' || public.rule_duration_words(public.rule_refund_cutoff()) || ' before kickoff, so they pay the '
                     || 'pitch and your hold is released.', coalesce(v_team, 'The other team'), public.booking_label(v_booking)),
      'bookingId', p_booking_id
    ));
    return jsonb_build_object('result', 'forfeit', 'cents', (v_quote ->> 'cents')::integer);
  end if;

  perform public.gipedo_add_settlement((v_quote ->> 'share_id')::uuid, 'pull_out_fee');
  if v_side = 'a' then
    perform public.gipedo_cancel_booking(p_booking_id,
      'The booking team pulled out, so the slot is freed and the other team''s hold is released.');
  else
    update public.friendly_matches set status = 'cancelled'
    where squad_post_id = v_post.id and coalesce(status, '') <> 'cancelled';
    update public.squad_posts
    set status = case when now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_gipedo_opponent_lead()
                      then 'closed' else 'open' end,
        matched_team_id = null
    where id = v_post.id;
    perform public.booking_match_drop_friendly(p_booking_id);
    perform public.send_notification(v_other, 'gipedo_pulled_out', jsonb_build_object(
      'title', 'Your opponent pulled out',
      'body', format('%s pulled out of your Gipedo Pano game at %s. Your hold stays and your post is open again.',
                     coalesce(v_team, 'The other team'), public.booking_label(v_booking)),
      'bookingId', p_booking_id
    ));
  end if;
  return jsonb_build_object('result', 'pulled_out', 'cents', (v_quote ->> 'cents')::integer);
end;
$$;

-- gipedo_withdraw_offer, from 20261113130016_pay_gipedo_review_fixes.sql
create or replace function public.gipedo_withdraw_offer(p_post_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_team text;
  v_reopened boolean;
  v_next text;
begin
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null or v_post.status <> 'matched' then
    return false;
  end if;
  select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id for update;
  select * into v_share from public.booking_payment_shares
  where booking_id = v_booking.id and gipedo_side = 'b' and status = 'pending' for update;
  if v_share.id is null then
    return false;
  end if;

  update public.booking_payment_shares set status = 'cancelled' where id = v_share.id;
  if v_share.stripe_payment_intent_id is not null then
    insert into public.money_releases (booking_id, share_id, stripe_intent_id, reason)
    values (v_booking.id, v_share.id, v_share.stripe_payment_intent_id, 'gipedo_offer_' || p_reason)
    on conflict (stripe_intent_id) where status = 'pending' do nothing;
  end if;
  update public.friendly_matches set status = 'cancelled'
  where squad_post_id = p_post_id and coalesce(status, '') <> 'cancelled';
  select name into v_team from public.teams where id = v_post.matched_team_id;
  v_reopened := now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_gipedo_opponent_lead();
  update public.squad_posts
  set status = case when v_reopened then 'open' else 'closed' end,
      matched_team_id = null
  where id = p_post_id;
  perform public.booking_match_drop_friendly(v_booking.id);

  v_next := case when v_reopened then 'so your post is open again.'
                 else 'It''s less than 24 hours to kickoff, so the post stays closed and you''ll be asked how to play it.' end;
  perform public.send_notification(v_booking.created_by, 'gipedo_opponent_left', jsonb_build_object(
    'title', case when p_reason = 'withdrawn' then 'Your opponent withdrew' else 'Your opponent didn''t confirm' end,
    'body', case when p_reason = 'withdrawn'
                 then format('%s withdrew their offer for your Gipedo Pano game at %s, %s',
                             coalesce(v_team, 'The other team'), public.booking_label(v_booking), v_next)
                 else format('%s didn''t place their hold within ' || public.rule_duration_words(public.rule_payment_window()) || ' for your Gipedo Pano game at %s, %s',
                             coalesce(v_team, 'The other team'), public.booking_label(v_booking), v_next) end,
    'bookingId', v_booking.id,
    'reason', p_reason
  ));
  return true;
end;
$$;

-- offer_opposition, from 20261113130016_pay_gipedo_review_fixes.sql
create or replace function public.offer_opposition(p_post_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_booking public.venue_bookings;
  v_hold record;
begin
  if not exists (select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain') then
    raise exception 'not_captain';
  end if;
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then raise exception 'post_not_found'; end if;
  if v_post.type <> 'opposition' then raise exception 'not_an_opposition_post'; end if;
  if v_post.status <> 'open' then raise exception 'post_closed'; end if;
  if v_post.team_id = p_team_id then raise exception 'cannot_offer_own_post'; end if;
  perform public.assert_venue_live(public.squad_post_venue_id(v_post));

  if v_post.venue_booking_id is not null then
    select * into v_booking from public.venue_bookings where id = v_post.venue_booking_id for update;
  end if;

  if v_booking.payment_mode = 'gipedo_pano' then
    if v_booking.status <> 'confirmed'
       or now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - public.rule_gipedo_opponent_lead() then
      raise exception 'post_closed';
    end if;
    if exists (select 1 from public.booking_payment_shares s
               where s.booking_id = v_booking.id and s.profile_id = auth.uid()
                 and s.status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due')) then
      raise exception 'already_in_booking';
    end if;
    -- A captain who pulled out can't come back (one spot per player per
    -- booking, as for a player who cancels).
    if exists (select 1 from public.booking_payment_shares s
               where s.booking_id = v_booking.id and s.profile_id = auth.uid() and s.gipedo_side is not null
                 and s.status <> 'cancelled') then
      raise exception 'cannot_rejoin';
    end if;
    select * into v_hold from public.money_share(v_booking.amount_cents, v_booking.capacity, 'gipedo_pano', true,
      exists (select 1 from public.profiles where id = auth.uid() and is_premium), 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status, gipedo_side,
       offer_attempt)
    values
      (v_booking.id, auth.uid(), v_hold.card_cents, v_hold.pitch_cents, v_hold.fee_cents, 0, false, 'pending', 'b', 1)
    on conflict (booking_id, profile_id) do update
      set amount_cents = excluded.amount_cents, pitch_cents = excluded.pitch_cents, fee_cents = excluded.fee_cents,
          cash_cents = 0, status = 'pending', gipedo_side = 'b', created_at = now(),
          offer_attempt = coalesce(public.booking_payment_shares.offer_attempt, 1) + 1,
          replaced_intent_ids = case
            when public.booking_payment_shares.stripe_payment_intent_id is null then public.booking_payment_shares.replaced_intent_ids
            else array_append(public.booking_payment_shares.replaced_intent_ids,
                              public.booking_payment_shares.stripe_payment_intent_id) end,
          stripe_payment_intent_id = null, stripe_setup_intent_id = null, payment_method = 'card',
          credit_cents = 0, held_at = null, capture_due_at = null;
  end if;

  update public.squad_posts set status = 'matched', matched_team_id = p_team_id where id = p_post_id;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
  values (p_post_id, v_post.team_id, p_team_id, 'pending_score', 0);
end;
$$;

-- gipedo_window_error, from 20261113185144_pay_gipedo_followups.sql
create or replace function public.gipedo_window_error(p_kickoff timestamptz, p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_kickoff > p_at + public.rule_gipedo_max_ahead() then 'gipedo_too_far_ahead'
    when p_kickoff < p_at + public.rule_gipedo_opponent_lead() then 'gipedo_too_soon'
  end;
$$;

-- gipedo_add_settlement, from 20261113130016_pay_gipedo_review_fixes.sql
create or replace function public.gipedo_add_settlement(p_share_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_other public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_half record;
  v_split record;
  v_pitch integer;
  v_fee integer;
  v_inserted integer;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id;
  if v_share.id is null or v_share.gipedo_side is null then
    raise exception 'not_a_gipedo_hold';
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;

  if p_reason in ('lost', 'play_normal') then
    v_pitch := v_share.pitch_cents;
    v_fee := v_share.fee_cents;
  elsif p_reason = 'won' then
    v_pitch := 0;
    v_fee := 0;
  elsif p_reason = 'split' then
    select * into v_half from public.money_gipedo_half(v_share.pitch_cents, v_share.fee_cents, v_share.gipedo_side = 'a');
    v_pitch := v_half.pitch_cents;
    v_fee := v_half.fee_cents;
    -- The other team's hold in this match (not one that pulled out).
    select * into v_other from public.booking_payment_shares o
    where o.booking_id = v_share.booking_id and o.gipedo_side is not null and o.gipedo_side <> v_share.gipedo_side
      and (o.status in ('authorized', 'expired')
           or exists (select 1 from public.gipedo_settlements g where g.share_id = o.id and g.reason = 'split'))
    order by o.created_at desc
    limit 1;
    if v_other.id is not null then
      select * into v_split from public.money_gipedo_split_fee(
        case when v_share.gipedo_side = 'a' then v_share.fee_cents else v_other.fee_cents end,
        case when v_share.gipedo_side = 'a' then v_other.fee_cents else v_share.fee_cents end);
      v_fee := case when v_share.gipedo_side = 'a' then v_split.a_fee_cents else v_split.b_fee_cents end;
    end if;
  elsif p_reason = 'pull_out_fee' then
    -- 100 cents per player in the booking, to Futty (decided 12 November).
    v_pitch := 0;
    v_fee := least(public.rule_cancel_fee_cents() * v_booking.capacity, v_share.pitch_cents + v_share.fee_cents);
  else
    raise exception 'invalid_reason';
  end if;

  insert into public.gipedo_settlements
    (booking_id, share_id, profile_id, side, reason, capture_cents, venue_cents, futty_cents)
  values
    (v_share.booking_id, v_share.id, v_share.profile_id, v_share.gipedo_side, p_reason, v_pitch + v_fee, v_pitch, v_fee)
  on conflict (share_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

-- cancellation_plan_modes, from 20261115170000_pay_gipedo_dashboard_merge.sql
CREATE OR REPLACE FUNCTION public.cancellation_plan_modes(p_booking_id uuid, p_scope text, p_profile_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_kickoff timestamptz;
  v_own public.booking_payment_shares;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_late_team boolean;
  v_lines jsonb := '[]'::jsonb;
  v_has_money boolean;
  v_value integer;
  v_paid integer;
  v_card_taken boolean;
  v_window text;
  v_action text;
  v_kept integer;
  v_credit integer;
  v_refund integer;
  v_capture boolean;
  v_keep_unit integer;
  v_taken integer;
  v_fee jsonb := null;
  v_cash integer;
  v_cash_back integer;
  v_cash_credit integer;
  v_cash_share public.booking_payment_shares;
  v_cash_window text;
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_scope is null or p_scope not in ('my_spot', 'whole_team', 'venue') then
    raise exception 'invalid_scope';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.payment_mode is null then
    raise exception 'legacy_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if p_at >= v_kickoff then
    raise exception 'booking_started';
  end if;

  if p_scope = 'whole_team' and v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;
  if p_scope = 'venue' and not exists (
    select 1 from public.venues where id = v_booking.venue_id and owner_profile_id = p_profile_id
  ) then
    raise exception 'not_your_venue';
  end if;
  if p_scope = 'my_spot' then
    select * into v_own from public.booking_payment_shares
    where booking_id = p_booking_id and profile_id = p_profile_id
      and status in ('pending', 'authorized', 'paid', 'covered');
    if v_own.id is null then
      raise exception 'not_in_booking';
    end if;
    if v_own.is_booker and v_booking.payment_mode = 'pay_all' then
      raise exception 'use_whole_team';
    end if;
  end if;

  v_late_team := p_at > v_kickoff - public.rule_refund_cutoff();
  v_keep_unit := public.rule_cancel_fee_cents();

  for v_share in
    select s.* from public.booking_payment_shares s
    where s.booking_id = p_booking_id
      and (s.status in ('pending', 'authorized', 'paid', 'covered')
           -- Q1: forfeited by a late cancellation of the player's own spot
           -- (not the €1 of a middle-window one).
           or (p_scope = 'venue' and s.status = 'forfeited'
               and exists (select 1 from public.booking_cancellation_lines l
                           where l.share_id = s.id and l."window" = 'late')))
      and (p_scope <> 'my_spot' or s.id = v_own.id)
    order by s.is_booker desc, s.created_at, s.id
  loop
    v_kept := 0;
    v_credit := 0;
    v_refund := 0;
    v_capture := false;
    v_window := null;

    if v_share.status = 'forfeited' then
      v_card_taken := v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null
        and exists (select 1 from public.money_ledger m
                    where m.kind = 'capture' and m.stripe_id = v_share.stripe_payment_intent_id);
      v_window := 'venue';
      if v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null and not v_card_taken then
        -- The card part was never taken: whatever hold is left is released.
        v_paid := v_share.amount_cents;
        v_value := v_paid + v_share.credit_cents;
        v_action := 'release';
      else
        v_paid := case when v_card_taken then v_share.amount_cents else 0 end;
        v_value := v_paid + v_share.credit_cents;
        v_action := case when v_value > 0 then 'refund_choice' else 'none' end;
        if v_value = 0 then
          v_window := null;
        end if;
      end if;
      v_refund := v_value;
      v_has_money := v_value > 0;
    else
      v_has_money := v_share.status in ('authorized', 'paid') and v_share.amount_cents + v_share.credit_cents > 0;
      v_value := case when v_has_money then v_share.amount_cents + v_share.credit_cents else 0 end;
      v_paid := case when v_has_money then v_share.amount_cents else 0 end;

      if not v_has_money then
        v_action := case when v_share.stripe_payment_intent_id is not null and v_share.status = 'pending'
                         then 'release' else 'none' end;
      elsif p_scope = 'venue' then
        v_window := 'venue';
        v_action := case when v_share.status = 'authorized' then 'release' else 'refund_choice' end;
        v_refund := v_value;
      elsif p_scope = 'my_spot' or v_share.is_booker then
        v_window := public.cancellation_window(v_share, v_kickoff, p_at);
        if v_window = 'free' then
          v_action := 'release';
          v_refund := v_value;
        elsif v_window = 'middle' then
          v_kept := least(v_value, v_keep_unit * case when v_booking.payment_mode = 'pay_all' then v_booking.capacity else 1 end);
          v_credit := v_value - v_kept;
          v_action := case when v_credit > 0 then 'keep_and_credit' else 'keep' end;
          v_capture := v_share.status = 'authorized';
        else
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        end if;
      else
        v_window := 'other';
        if v_late_team then
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        elsif v_share.status = 'authorized' then
          v_action := 'release';
          v_refund := v_value;
        else
          v_action := 'refund_choice';
          v_refund := v_value;
        end if;
      end if;
    end if;

    -- Ticked cash (decided 13 November, Dimitris; for Panos to confirm)
    -- follows the cancellation rules as if it had been paid by card, beside
    -- the card amounts above, which alone reach Stripe: it goes back where a
    -- card player gets money back (the venue cancelling, a cancel in the
    -- free hour, a whole-team cancel more than 6 hours before kickoff); in
    -- the middle window the €1 is kept over card and cash together and the
    -- rest of the cash becomes credit at the venue; a late cancel keeps it.
    v_cash := coalesce((select sum(m.venue_cents) from public.money_ledger m
                        where m.share_id = v_share.id and m.kind = 'cash_received'), 0);
    v_cash_back := 0;
    v_cash_credit := 0;
    if v_cash > 0 then
      if p_scope = 'venue' then
        v_cash_back := v_cash;
      elsif p_scope = 'my_spot' or v_share.is_booker then
        -- The window a card player who paid then would be in; with nothing
        -- paid in the app, the cash is the payment.
        v_cash_share := v_share;
        if v_cash_share.held_at is null and v_cash_share.paid_at is null then
          v_cash_share.held_at := v_cash_share.cash_received_at;
          v_cash_share.capture_due_at := null;
        end if;
        v_cash_window := public.cancellation_window(v_cash_share, v_kickoff, p_at);
        if v_cash_window = 'free' then
          v_cash_back := v_cash;
        elsif v_cash_window = 'middle' then
          v_cash_credit := v_cash - (least(v_value + v_cash,
                                           v_keep_unit * case when v_booking.payment_mode = 'pay_all'
                                                              then v_booking.capacity else 1 end)
                                     - v_kept);
          if v_cash_credit > 0 and v_action in ('keep', 'none') then
            v_action := 'keep_and_credit';
          end if;
        end if;
        v_window := coalesce(v_window, v_cash_window);
      elsif not v_late_team then
        v_cash_back := v_cash;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'share_id', v_share.id,
      'guarantee_id', null,
      'profile_id', v_share.profile_id,
      'is_booker', v_share.is_booker,
      'window', v_window,
      'action', v_action,
      'paid_cents', v_paid,
      'fee_cents', case when v_paid > 0 then coalesce(v_share.fee_cents, 0) else 0 end,
      'credit_used_cents', case when v_has_money then v_share.credit_cents else 0 end,
      'value_cents', v_value,
      'kept_cents', v_kept,
      'credit_cents', v_credit,
      'refund_cents', v_refund,
      'needs_capture', v_capture,
      'stripe_intent_id', v_share.stripe_payment_intent_id,
      'cash_cents', v_cash,
      'cash_back_cents', v_cash_back,
      'cash_credit_cents', v_cash_credit
    ));
  end loop;

  if p_scope <> 'my_spot' then
    select * into v_guarantee from public.booking_guarantees where booking_id = p_booking_id and status <> 'cancelled';
    if v_guarantee.id is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'share_id', null, 'guarantee_id', v_guarantee.id, 'profile_id', v_guarantee.profile_id, 'is_booker', true,
        'window', null, 'action', 'release', 'paid_cents', 0, 'fee_cents', 0, 'credit_used_cents', 0,
        'value_cents', 0, 'kept_cents', 0, 'credit_cents', 0, 'refund_cents', 0, 'needs_capture', false,
        'stripe_intent_id', v_guarantee.stripe_payment_intent_id,
        'cash_cents', 0, 'cash_back_cents', 0, 'cash_credit_cents', 0));
    end if;
  end if;

  if p_scope = 'whole_team' and v_booking.payment_mode <> 'pay_all' and not v_late_team then
    select count(*) into v_taken from public.booking_payment_shares
    where booking_id = p_booking_id and not is_booker and status = 'paid' and amount_cents > 0;
    if v_taken > 0 then
      v_fee := jsonb_build_object('profile_id', v_booking.created_by, 'players', v_taken, 'amount_cents', public.rule_cancel_fee_cents() * v_taken);
    end if;
  end if;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'scope', p_scope,
    'payment_mode', v_booking.payment_mode,
    'kickoff_at', v_kickoff,
    'refunds_stop_at', v_kickoff - public.rule_refund_cutoff(),
    'cancels_booking', p_scope <> 'my_spot',
    'lines', v_lines,
    'booker_fee', v_fee,
    'quote', md5(jsonb_build_object('booking_id', p_booking_id, 'scope', p_scope, 'lines', v_lines,
                                    'booker_fee', v_fee)::text)
  );
end;
$function$;

-- cancel_booking_internal_modes, from 20261115170000_pay_gipedo_dashboard_merge.sql
CREATE OR REPLACE FUNCTION public.cancel_booking_internal_modes(p_booking_id uuid, p_scope text, p_profile_id uuid, p_expected_quote text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.venue_bookings;
  v_venue_name text;
  v_plan jsonb;
  v_line jsonb;
  v_row public.booking_cancellation_lines;
  v_cancellation_id uuid;
  v_fee_id uuid;
  v_status text;
  v_work boolean;
  v_pm text;
  v_who text;
  v_body text;
  v_profile uuid;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  if v_booking.id is not null and v_booking.payment_mode is null then
    return jsonb_build_object('legacy', true);
  end if;
  perform 1 from public.booking_payment_shares where booking_id = p_booking_id for update;
  perform 1 from public.booking_guarantees where booking_id = p_booking_id for update;
  perform 1 from public.booking_cancellation_lines where booking_id = p_booking_id and work = 'pending' for update;

  v_plan := public.cancellation_plan(p_booking_id, p_scope, p_profile_id, now());
  if p_expected_quote is null then
    raise exception 'quote_required';
  end if;
  if v_plan ->> 'quote' is distinct from p_expected_quote then
    raise exception 'quote_changed';
  end if;

  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan)
  values (p_booking_id, p_scope, p_profile_id, v_plan ->> 'quote', v_plan)
  returning id into v_cancellation_id;

  for v_line in select * from jsonb_array_elements(v_plan -> 'lines') loop
    v_work := case v_line ->> 'action'
      when 'release' then v_line ->> 'stripe_intent_id' is not null
      when 'keep' then (v_line ->> 'needs_capture')::boolean
      when 'keep_and_credit' then (v_line ->> 'needs_capture')::boolean
      when 'refund_choice' then true
      else false end;

    if p_scope = 'venue' and v_line ->> 'share_id' is not null then
      update public.booking_cancellation_lines
      set work = 'done', outcome = 'superseded', done_at = now()
      where share_id = (v_line ->> 'share_id')::uuid and work = 'pending' and action in ('keep', 'keep_and_credit');
    end if;

    insert into public.booking_cancellation_lines (
      cancellation_id, booking_id, share_id, guarantee_id, profile_id, venue_id, is_booker, "window", action,
      paid_cents, fee_cents, credit_used_cents, value_cents, kept_cents, credit_cents, refund_cents, needs_capture,
      stripe_intent_id, reason, work, next_attempt_at, choose_by, cash_cents, cash_back_cents, cash_credit_cents)
    values (
      v_cancellation_id, p_booking_id, (v_line ->> 'share_id')::uuid, (v_line ->> 'guarantee_id')::uuid,
      (v_line ->> 'profile_id')::uuid, v_booking.venue_id, (v_line ->> 'is_booker')::boolean, v_line ->> 'window',
      v_line ->> 'action', (v_line ->> 'paid_cents')::integer, (v_line ->> 'fee_cents')::integer,
      (v_line ->> 'credit_used_cents')::integer, (v_line ->> 'value_cents')::integer, (v_line ->> 'kept_cents')::integer,
      (v_line ->> 'credit_cents')::integer, (v_line ->> 'refund_cents')::integer, (v_line ->> 'needs_capture')::boolean,
      v_line ->> 'stripe_intent_id', p_scope || '_' || (v_line ->> 'action'),
      case when v_work then 'pending' else 'none' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + public.rule_refund_choice()
           when v_work then now() + interval '2 minutes' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + public.rule_refund_choice() end,
      coalesce((v_line ->> 'cash_cents')::integer, 0), coalesce((v_line ->> 'cash_back_cents')::integer, 0),
      coalesce((v_line ->> 'cash_credit_cents')::integer, 0))
    returning * into v_row;

    if v_row.guarantee_id is not null then
      update public.booking_guarantees set status = 'cancelled', next_attempt_at = null where id = v_row.guarantee_id;
      continue;
    end if;

    v_status := case v_row.action
      when 'none' then 'cancelled' when 'release' then 'cancelled' when 'keep' then 'forfeited'
      when 'keep_and_credit' then 'credited' when 'refund_choice' then 'refund_due' end;
    update public.booking_payment_shares set status = v_status where id = v_row.share_id;
    if not v_row.needs_capture then
      perform public.cancellation_issue_credit(v_row, p_scope);
    end if;
    -- Ticked cash a card player would get back: the venue hands it back
    -- (once; a reversing cash_received row).
    if v_row.cash_back_cents > 0 then
      perform public.reverse_cash_received(v_row.share_id);
    end if;
  end loop;

  if p_scope <> 'my_spot' then
    update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  end if;

  if v_plan -> 'booker_fee' <> 'null'::jsonb then
    select coalesce(s.stripe_payment_method_id, g.stripe_payment_method_id) into v_pm
    from public.booking_payment_shares s
    left join public.booking_guarantees g on g.booking_id = s.booking_id
    where s.booking_id = p_booking_id and s.is_booker;
    insert into public.booking_cancellation_fees (cancellation_id, booking_id, profile_id, players, amount_cents,
      stripe_customer_id, stripe_payment_method_id, next_attempt_at, stop_at)
    values (v_cancellation_id, p_booking_id, v_booking.created_by, (v_plan -> 'booker_fee' ->> 'players')::integer,
      (v_plan -> 'booker_fee' ->> 'amount_cents')::integer,
      (select stripe_customer_id from public.profiles where id = v_booking.created_by), v_pm,
      now() + interval '2 minutes', (v_plan ->> 'kickoff_at')::timestamptz)
    returning id into v_fee_id;
  end if;

  select name into v_venue_name from public.venues where id = v_booking.venue_id;
  if p_scope = 'my_spot' then
    for v_profile in
      select distinct profile_id from public.booking_payment_shares
      where booking_id = p_booking_id and profile_id <> p_profile_id
        and status in ('pending', 'authorized', 'paid', 'covered')
    loop
      perform public.send_notification(v_profile, 'booking_spot_released', jsonb_build_object(
        'title', 'A spot opened up',
        'body', format('A player dropped out of your game at %s on %s at %s. Invite someone to fill the spot.',
                       v_venue_name, to_char(v_booking.booking_day, 'FMDay DD Mon'), to_char(v_booking.start_time, 'HH24:MI')),
        'bookingId', p_booking_id
      ));
    end loop;
  else
    v_who := case when p_scope = 'venue' then v_venue_name else 'The booker' end;
    for v_row in
      select * from public.booking_cancellation_lines
      where cancellation_id = v_cancellation_id and share_id is not null and profile_id <> p_profile_id
    loop
      v_body := format('%s cancelled your game at %s on %s at %s. ', v_who, v_venue_name,
                       to_char(v_booking.booking_day, 'FMDay DD Mon'), to_char(v_booking.start_time, 'HH24:MI'))
        || case v_row.action
             when 'refund_choice' then format('You get %s back. Choose venue credit within ' || public.rule_duration_words(public.rule_refund_choice()) || ', or it goes back to your card.',
                                              public.money_format_euros(v_row.refund_cents))
             when 'release' then case when v_row.refund_cents > 0 then 'Your payment hold was released, so you won''t be charged.'
                                      else 'You weren''t charged.' end
             when 'keep' then 'It was cancelled less than ' || public.rule_duration_words(public.rule_refund_cutoff()) || ' before kickoff, so no money goes back.'
             else 'You weren''t charged.'
           end;
      perform public.send_notification(v_row.profile_id, 'booking_cancelled', jsonb_build_object(
        'title', 'Game cancelled',
        'body', v_body,
        'bookingId', p_booking_id,
        'cancellationLineId', v_row.id,
        'action', v_row.action,
        'refundCents', v_row.refund_cents
      ));
    end loop;
  end if;

  return v_plan || jsonb_build_object('cancellation_id', v_cancellation_id, 'fee_id', v_fee_id);
end;
$function$;

-- share_card_saved, from 20261110165054_pay_cancellations_hold_cancelled.sql
create or replace function public.share_card_saved(
  p_share_id uuid,
  p_setup_intent_id text,
  p_payment_method_id text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
begin
  select * into v_booking from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  select * into v_share from public.booking_payment_shares
  where id = p_share_id and status = 'pending' and amount_cents = 0 and stripe_setup_intent_id = p_setup_intent_id
  for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.booking_payment_window_ends_at(v_booking) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  if v_share.credit_cents > 0 and v_share.non_refundable_accepted_at is null
     and public.money_is_non_refundable(p_at, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)) then
    perform public.share_drop_credit(v_share.id, 'non_refundable_not_accepted');
    perform public.send_notification(v_share.profile_id, 'match_payment_due', jsonb_build_object(
      'title', 'Pay again to keep your spot',
      'body', 'Your game starts in less than ' || public.rule_duration_words(public.rule_refund_cutoff()) || ', so it''s non-refundable. Your credit wasn''t used: '
              || 'accept the notice and pay again.',
      'bookingId', v_share.booking_id
    ));
    return jsonb_build_object('result', 'refused', 'reason', 'non_refundable_not_accepted', 'share_id', v_share.id);
  end if;

  update public.booking_payment_shares
  set status = 'paid', paid_at = p_at, stripe_payment_method_id = p_payment_method_id
  where id = v_share.id
  returning * into v_share;
  return jsonb_build_object('result', 'saved', 'share_id', v_share.id, 'setup_intent_id', p_setup_intent_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

-- flag_conditions, from 20261113220558_pay_dashboard_conditions.sql
create or replace function public.flag_conditions(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitch_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.venue_condition_flags;
  v_venue_name text;
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_day is null or p_day < (now() at time zone 'Asia/Nicosia')::date then
    raise exception 'day_in_past';
  end if;
  if (p_start is null) <> (p_end is null) or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;
  if p_pitch_id is not null
     and not exists (select 1 from public.pitches where id = p_pitch_id and venue_id = p_venue_id) then
    raise exception 'invalid_pitch';
  end if;

  insert into public.venue_condition_flags (venue_id, pitch_id, flag_day, starts_at, ends_at, note, created_by)
  values (p_venue_id, p_pitch_id, p_day, p_start, p_end, nullif(btrim(p_note), ''), auth.uid())
  returning * into v_flag;

  select name into v_venue_name from public.venues where id = p_venue_id;
  v_venue_name := coalesce(v_venue_name, 'The venue');

  -- Every player still in each game the flag covers that hasn't ended
  -- (Cyprus time), each once per game: a game already warned about by an
  -- earlier flag isn't warned again. Still in = a share pending, authorized,
  -- paid or covered (as cancellation_plan counts them), so a player who left
  -- with credit, by forfeit or for a refund isn't told; that includes the
  -- booker, who holds a share like everyone else. A free game has no shares
  -- at all: its booker can't have left, so they're told.
  for v_row in
    select distinct b.id as booking_id, b.booking_day, b.start_time, player.profile_id
    from public.venue_bookings b
    cross join lateral (
      select s.profile_id from public.booking_payment_shares s
      where s.booking_id = b.id and s.status in ('pending', 'authorized', 'paid', 'covered')
      union
      select b.created_by
      where not exists (select 1 from public.booking_payment_shares s where s.booking_id = b.id)
    ) as player
    where b.venue_id = p_venue_id
      and b.booking_day = p_day
      and b.booking_type = 'user_booking'
      and b.status <> 'cancelled'
      and b.booking_day + b.end_time > (now() at time zone 'Asia/Nicosia')
      and (p_start is null or (b.start_time < p_end and b.end_time > p_start))
      and (p_pitch_id is null
           or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = p_pitch_id))
      and player.profile_id is not null
  loop
    insert into public.venue_condition_warnings (booking_id, profile_id, venue_id, flag_id)
    values (v_row.booking_id, v_row.profile_id, p_venue_id, v_flag.id)
    on conflict (booking_id, profile_id) do nothing;
    if not found then
      continue;
    end if;
    perform public.send_notification(
      v_row.profile_id,
      'venue_condition_warning',
      jsonb_build_object(
        'title', 'Conditions may be unsuitable',
        'body', v_venue_name || ' says conditions may be unsuitable on '
                || to_char(v_row.booking_day, 'FMDay FMDD FMMonth') || ' at ' || to_char(v_row.start_time, 'HH24:MI')
                || '. Normal cancellation rules apply: cancel at least ' || public.rule_duration_words(public.rule_refund_cutoff()) || ' before kickoff to keep your money as '
                || 'credit at ' || v_venue_name || '.',
        'bookingId', v_row.booking_id,
        'venueId', p_venue_id,
        'flagId', v_flag.id
      )
    );
  end loop;

  return v_flag.id;
end;
$$;

-- expire_unpaid_booking, from 20261110131949_pay_cancellations_undo.sql
create or replace function public.expire_unpaid_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_share_id uuid;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.payment_mode is null or v_booking.status <> 'pending_payment'
     or now() <= public.booking_payment_window_ends_at(v_booking) then
    return false;
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and status in ('pending', 'covered') and stripe_payment_intent_id is null;
  update public.booking_guarantees set status = 'cancelled', next_attempt_at = null
  where booking_id = p_booking_id and status <> 'cancelled' and stripe_payment_intent_id is null;
  for v_share_id in
    select id from public.booking_payment_shares where booking_id = p_booking_id and status = 'pending'
  loop
    perform public.return_share_credit(v_share_id, 'booking_expired');
  end loop;

  perform public.send_notification(v_booking.created_by, 'booking_cancelled', jsonb_build_object(
    'title', 'Booking cancelled',
    'body', 'Payment wasn''t completed within ' || public.rule_duration_words(public.rule_payment_window()) || ', so the booking was cancelled and the pitch released.',
    'bookingId', p_booking_id
  ));
  return true;
end;
$$;

-- credit_reservations_to_release, from 20261110120916_pay_cancellations_reservations.sql
create or replace function public.credit_reservations_to_release()
returns table (share_id uuid, booking_id uuid, stripe_payment_intent_id text, stripe_setup_intent_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.booking_id, s.stripe_payment_intent_id, s.stripe_setup_intent_id
  from public.booking_payment_shares s
  where s.status = 'pending'
    and exists (select 1 from public.venue_credit_spends sp
                where sp.share_id = s.id and sp.status = 'reserved' and sp.created_at <= now() - public.rule_payment_window())
  order by s.id;
$$;

-- collection_is_due, from 20261110190001_pay_collection_collect.sql
create or replace function public.collection_is_due(p_booking public.venue_bookings)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot'), false)
     and p_booking.status = 'confirmed'
     and p_booking.booking_type = 'user_booking'
     and now() >= public.booking_ends_at(p_booking.booking_day, p_booking.end_time)
                  + case when p_booking.collection_requested_at is null then public.rule_collection_delay() else interval '0' end;
$$;

-- issue_venue_credit, from 20261110124905_pay_cancellations_fixes.sql
create or replace function public.issue_venue_credit(
  p_profile_id uuid,
  p_venue_id uuid,
  p_amount_cents integer,
  p_source text,
  p_booking_id uuid,
  p_share_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
begin
  if p_amount_cents is null or p_amount_cents < 1 then
    raise exception 'invalid_credit_amount';
  end if;
  select id into v_id from public.venue_credits where source_share_id = p_share_id and source = p_source;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.venue_credits (profile_id, venue_id, amount_cents, remaining_cents, source, source_booking_id,
                                    source_share_id, issued_at, expires_at)
  values (p_profile_id, p_venue_id, p_amount_cents, p_amount_cents, p_source, p_booking_id, p_share_id,
          v_now, v_now + public.rule_credit_expiry())
  returning id into v_id;
  perform public.record_ledger_entry(p_booking_id, p_share_id, v_id, 'credit_issued', p_amount_cents,
    'credit-issued-' || v_id, p_source, 0, 0, p_amount_cents);
  return v_id;
end;
$$;

-- money_capture_due_at, from 20261109131653_pay_modes_money.sql
create or replace function public.money_capture_due_at(p_held_at timestamptz, p_kickoff timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(p_held_at + public.rule_capture_delay(), p_kickoff - public.rule_refund_cutoff());
$$;

-- money_is_non_refundable, from 20261109131653_pay_modes_money.sql
create or replace function public.money_is_non_refundable(p_paid_at timestamptz, p_kickoff timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_paid_at > p_kickoff - public.rule_refund_cutoff();
$$;

-- money_payment_window_ends_at, from 20261109131653_pay_modes_money.sql
create or replace function public.money_payment_window_ends_at(p_booked_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select p_booked_at + public.rule_payment_window();
$$;

-- money_guarantee_hold_due_at, from 20261109131653_pay_modes_money.sql
create or replace function public.money_guarantee_hold_due_at(p_booked_at timestamptz, p_kickoff timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(p_kickoff - public.rule_guarantee_hold_lead(), p_booked_at);
$$;

-- money_guarantee_retry_at, from 20261109131653_pay_modes_money.sql
create or replace function public.money_guarantee_retry_at(p_failed_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select p_failed_at + public.rule_guarantee_retry();
$$;

-- money_fee_per_player_cents, from 20261113115749_pay_gipedo_mode.sql
create or replace function public.money_fee_per_player_cents(p_mode text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case p_mode when 'pay_all' then r.fee_pay_all_cents when 'gipedo_pano' then r.gipedo_fee_cents
                     when 'each_pays_responsible' then r.fee_each_pays_cents
                     when 'each_pays_own_spot' then r.fee_each_pays_cents end
  from public.app_rules r where r.id;
$$;

-- money_share, from 20261113115749_pay_gipedo_mode.sql
create or replace function public.money_share(
  p_pitch_cents integer,
  p_players integer,
  p_mode text,
  p_is_booker boolean,
  p_is_premium boolean,
  p_method text default 'card',
  out pitch_cents integer,
  out fee_cents integer,
  out card_cents integer,
  out cash_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rules public.app_rules := public.app_rules_now();
begin
  if p_pitch_cents is null or p_pitch_cents < 0 or p_players is null or p_players < 1
     or p_is_booker is null or p_is_premium is null then
    raise exception 'invalid_money_input';
  end if;
  if p_mode is null or p_mode not in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot', 'gipedo_pano') then
    raise exception 'invalid_payment_mode';
  end if;
  if p_method is null or p_method not in ('card', 'cash') then
    raise exception 'invalid_payment_method';
  end if;
  if p_mode in ('pay_all', 'gipedo_pano') and p_method = 'cash' then
    raise exception 'cash_not_allowed';
  end if;

  -- Gipedo Pano: p_is_booker means "a captain's hold" (either team's).
  if p_mode in ('pay_all', 'gipedo_pano') then
    if p_is_booker then
      pitch_cents := p_pitch_cents;
      -- Every spot carries the per-player fee, except a Premium booker's own.
      fee_cents := (case when p_mode = 'gipedo_pano' then v_rules.gipedo_fee_cents else v_rules.fee_pay_all_cents end)
                   * (p_players - case when p_is_premium then 1 else 0 end)
                   + case when p_is_premium then v_rules.fee_premium_cents else 0 end;
    else
      pitch_cents := 0;
      fee_cents := 0;
    end if;
  else
    pitch_cents := p_pitch_cents / p_players + case when p_is_booker then p_pitch_cents % p_players else 0 end;
    fee_cents := case when p_is_premium then v_rules.fee_premium_cents else v_rules.fee_each_pays_cents end;
  end if;

  if p_method = 'cash' then
    card_cents := fee_cents;
    cash_cents := pitch_cents;
  else
    card_cents := pitch_cents + fee_cents;
    cash_cents := 0;
  end if;
end;
$$;

-- cancellation_terms, from 20261111164706_pay_venue_pages.sql
create or replace function public.cancellation_terms()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('fee_cents', r.cancel_fee_cents, 'free_minutes', r.free_cancel_minutes,
                            'refund_cutoff_hours', r.refund_cutoff_hours)
  from public.app_rules r where r.id;
$$;
