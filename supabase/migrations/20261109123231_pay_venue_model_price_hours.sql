-- Peak and weekend hours are per venue, stored with its price rules
-- (docs/specs/13-payments-bookings.md, "Prices and fees", decided 9
-- November). Until a venue's data says otherwise:
--   peak     Monday to Friday, 17:00 until closing;
--   weekend  Saturday and Sunday, all day;
--   off-peak every other hour.
-- P3 kept the peak window on venues (peak_starts / peak_ends) and hard-coded
-- the weekend as Saturday and Sunday. Both move onto price_rules here, and
-- the venues columns go: no app build reads them, and P3 isn't in
-- production yet.

-- ISO weekdays: 1 = Monday ... 7 = Sunday. peak_ends null = until closing.
alter table public.price_rules
  add column peak_weekdays smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  add column peak_starts time not null default '17:00',
  add column peak_ends time,
  add column weekend_weekdays smallint[] not null default array[6, 7]::smallint[],
  add constraint price_rules_weekdays_valid
    check (peak_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[] and weekend_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- A day is either a weekend day or a weekday with a peak window, not both.
  add constraint price_rules_peak_not_weekend check (not (peak_weekdays && weekend_weekdays)),
  add constraint price_rules_peak_window check (peak_ends is null or peak_ends > peak_starts);

-- Keep any peak window a venue already set in P3.
update public.price_rules r
set peak_starts = v.peak_starts, peak_ends = v.peak_ends
from public.venues v
where v.id = r.venue_id;

-- The pitch price for one game of the format, in cents: each half hour at
-- its own band, from the price rule's own days and hours. Weekend days are
-- the weekend price all day; on peak days, the peak window is peak; every
-- other half hour is off-peak. Null when the venue has no price for the
-- format. Slots are on the 30-minute grid (book_slot checks that first).
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
  v_weekend := v_weekday = any (v_rule.weekend_weekdays);
  v_peak_day := v_weekday = any (v_rule.peak_weekdays);

  for v_slice in
    select generate_series(p_day + p_start, p_day + p_end - interval '30 minutes', interval '30 minutes')
  loop
    v_total := v_total + case
      when v_weekend then v_rule.weekend_cents
      when v_peak_day and v_slice::time >= v_rule.peak_starts
           and (v_rule.peak_ends is null or v_slice::time < v_rule.peak_ends) then v_rule.peak_cents
      else v_rule.offpeak_cents
    end;
  end loop;

  -- Each half hour costs half the hourly price.
  return round(v_total / 2.0)::integer;
end;
$$;

revoke all on function public.slot_price_cents(uuid, date, time, time, text) from public, anon;
grant execute on function public.slot_price_cents(uuid, date, time, time, text) to authenticated, service_role;

alter table public.venues drop column peak_starts, drop column peak_ends;
