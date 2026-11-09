-- P2: venue switches the server checks. Neither is writable from the app
-- (venues has no UPDATE grant for anon/authenticated); Futty sets them.

-- 6 v 6 on a 5-a-side pitch (12 players) only where the venue allows it.
alter table public.venues add column if not exists allows_6v6_on_5s boolean not null default false;

-- The live/not-live switch: a venue that isn't live (not signed, paused)
-- can't be booked or joined. Existing venues stay live.
alter table public.venues add column if not exists is_live boolean not null default true;
