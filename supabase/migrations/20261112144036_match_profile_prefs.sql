-- A3b-2b: a player's preferred days and times (docs/specs/05-product.md
-- section 3, match-record.md decision 1d.3). Position and preferred foot
-- already exist on profiles.
--
--   preferred_days   weekdays, mon .. sun
--   preferred_times  parts of the day: morning, afternoon, evening
--
-- Owner only, for now. profiles' select policy already shows a player only
-- their own row, and get_public_profile / get_public_profiles name their
-- columns, so these stay private; later matching reads them server-side.
-- authenticated has column-level UPDATE on profiles (no table-wide UPDATE),
-- so the two new columns get their own grant; the existing owner-only
-- update policy applies.

alter table public.profiles
  add column preferred_days text[] not null default '{}',
  add column preferred_times text[] not null default '{}',
  add constraint profiles_preferred_days_check
    check (preferred_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  add constraint profiles_preferred_times_check
    check (preferred_times <@ array['morning', 'afternoon', 'evening']);

grant update (preferred_days, preferred_times) on public.profiles to authenticated;
