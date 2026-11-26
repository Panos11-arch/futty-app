-- S9: the Leagues screen (docs/specs/15-design.md, image 12).
--
-- competition_pins: the competitions a player pins on the Leagues screen
--    (the Pin on LEAGUES and the star on MATCHES are the same row). A league
--    pin names the competition by its normalised scope (lower case, trimmed:
--    'island-wide' or a city) and format, never a season or division row, so
--    it survives into the next season. target_type is 'league' for now; S10A
--    widens the check and adds tournament_id for tournaments.

-- ---- 1. Pins ----------------------------------------------------------------

create table public.competition_pins (
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_type text not null constraint competition_pins_target_type_check check (target_type in ('league')),
  scope text not null constraint competition_pins_scope_check check (scope = lower(btrim(scope)) and scope <> ''),
  format text not null constraint competition_pins_format_check
    check (format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  created_at timestamptz not null default now(),
  primary key (profile_id, target_type, scope, format)
);

comment on table public.competition_pins is
  'S9: competitions a player pinned on the Leagues screen, by (scope, format) so a pin outlives a season. S10A adds tournaments.';

alter table public.competition_pins enable row level security;

create policy "Players read their own pins" on public.competition_pins
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Players add their own pins" on public.competition_pins
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "Players remove their own pins" on public.competition_pins
  for delete to authenticated using (profile_id = (select auth.uid()));

revoke all on public.competition_pins from public, anon, authenticated;
grant select, insert, delete on public.competition_pins to authenticated;
grant all on public.competition_pins to service_role;
