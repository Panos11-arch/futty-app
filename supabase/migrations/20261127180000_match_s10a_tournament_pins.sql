-- S10A page: tournament pins (match-record.md decision 1o; image 12).
--
-- A player pins a tournament on the Leagues screen (PINNED) or with the star
-- on its page. A new table beside S9's competition_pins, which is left exactly
-- as it is (league pins by scope and format). Owner only: a player reads,
-- adds and removes his own pins; nobody updates one. A pin goes with its
-- tournament and with its player.

create table public.tournament_pins (
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, tournament_id)
);

create index tournament_pins_tournament_idx on public.tournament_pins (tournament_id);

comment on table public.tournament_pins is
  'S10A: tournaments a player pinned on the Leagues screen or the tournament page. League pins stay in competition_pins.';

alter table public.tournament_pins enable row level security;

create policy "Players read their own tournament pins" on public.tournament_pins
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Players add their own tournament pins" on public.tournament_pins
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "Players remove their own tournament pins" on public.tournament_pins
  for delete to authenticated using (profile_id = (select auth.uid()));

revoke all on public.tournament_pins from public, anon, authenticated;
grant select, insert, delete on public.tournament_pins to authenticated;
grant all on public.tournament_pins to service_role;
