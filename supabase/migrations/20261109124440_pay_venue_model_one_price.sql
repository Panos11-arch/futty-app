-- One price per format by default (docs/specs/13-payments-bookings.md,
-- "Prices and fees", decided 9 November).
--
-- By default a venue has one price per format, the same at every hour. Peak
-- and weekend prices are optional and apply only when the venue's data
-- provides them; without them every slot uses the one price. When a venue
-- has them, its peak and weekend hours are the ones on the price rule
-- (pay_venue_model_price_hours), every other hour is off-peak at the one
-- price, and a game is priced half hour by half hour.
--
-- P3 made every rule carry all three prices. Now:
--   price_cents   the venue's one price (was offpeak_cents);
--   peak_cents    optional, null = no peak price;
--   weekend_cents optional, null = no weekend price.

alter table public.price_rules rename column offpeak_cents to price_cents;
alter table public.price_rules alter column peak_cents drop not null;
alter table public.price_rules alter column weekend_cents drop not null;

-- Rules converted from the old single price (init_venue_model_from_legacy)
-- carry the same price three times. That's one price, not a peak or weekend
-- price.
update public.price_rules set peak_cents = null where peak_cents = price_cents;
update public.price_rules set weekend_cents = null where weekend_cents = price_cents;

-- The pitch price for one game of the format, in cents, half hour by half
-- hour: on a weekend day, the weekend price if the venue has one; on a peak
-- day inside the peak window, the peak price if it has one; otherwise the
-- one price. Null when the venue has no price for the format. Slots are on
-- the 30-minute grid (book_slot checks that first).
create or replace function public.slot_price_cents(p_venue_id uuid, p_day date, p_start time, p_end time, p_format text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.price_rules;
  v_weekday smallint := extract(isodow from p_day)::smallint;
  v_weekend boolean;
  v_peak_day boolean;
  v_slice timestamp;
  v_total bigint := 0;
begin
  select * into v_rule from public.price_rules where venue_id = p_venue_id and format = p_format;
  if v_rule.venue_id is null then
    return null;
  end if;
  v_weekend := v_rule.weekend_cents is not null and v_weekday = any (v_rule.weekend_weekdays);
  v_peak_day := v_rule.peak_cents is not null and v_weekday = any (v_rule.peak_weekdays);

  for v_slice in
    select generate_series(p_day + p_start, p_day + p_end - interval '30 minutes', interval '30 minutes')
  loop
    v_total := v_total + case
      when v_weekend then v_rule.weekend_cents
      when v_peak_day and v_slice::time >= v_rule.peak_starts
           and (v_rule.peak_ends is null or v_slice::time < v_rule.peak_ends) then v_rule.peak_cents
      else v_rule.price_cents
    end;
  end loop;

  -- Each half hour costs half the hourly price.
  return round(v_total / 2.0)::integer;
end;
$$;

revoke all on function public.slot_price_cents(uuid, date, time, time, text) from public, anon;
grant execute on function public.slot_price_cents(uuid, date, time, time, text) to authenticated, service_role;

-- As in P3, with the old single price becoming the venue's one price (no
-- peak or weekend price).
create or replace function public.init_venue_model_from_legacy(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_size record;
  v_closes time;
  i integer;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null or exists (select 1 from public.pitches where venue_id = p_venue_id) then
    return;
  end if;

  for i in 1 .. coalesce(v_venue.base_pitches, 0) loop
    insert into public.pitches (venue_id, name, size, formats, surface, sort_order)
    values (p_venue_id, 'Pitch ' || i, '5-a-side', array['5-a-side'], v_venue.surface, i);
  end loop;

  for v_size in select * from (values (1, '5-a-side'), (2, '7-a-side'), (3, '9-a-side'), (4, '11-a-side')) as s (pitches, format)
  loop
    continue when v_size.pitches > coalesce(v_venue.base_pitches, 0);

    if v_size.pitches > 1 then
      for i in 1 .. v_venue.base_pitches - v_size.pitches + 1 loop
        insert into public.pitch_combinations (venue_id, format, pitch_ids)
        select p_venue_id, v_size.format, array_agg(p.id order by p.sort_order)
        from public.pitches p
        where p.venue_id = p_venue_id and p.sort_order between i and i + v_size.pitches - 1;
      end loop;
    end if;

    insert into public.price_rules (venue_id, format, price_cents)
    values (p_venue_id, v_size.format,
            round(coalesce(v_venue.price_per_pitch_hour, 0) * v_size.pitches * 100)::integer);
  end loop;

  -- A close at or before opening, or 23:59, means midnight.
  v_closes := case
    when v_venue.close_time is null or v_venue.close_time <= v_venue.open_time or v_venue.close_time >= time '23:59'
      then time '24:00'
    else v_venue.close_time
  end;
  if v_venue.open_time is not null then
    insert into public.opening_hours (venue_id, weekday, opens, closes)
    select p_venue_id, d, v_venue.open_time, v_closes from generate_series(1, 7) as d;
  end if;
end;
$$;

revoke all on function public.init_venue_model_from_legacy(uuid) from public, anon, authenticated;
grant execute on function public.init_venue_model_from_legacy(uuid) to service_role;
