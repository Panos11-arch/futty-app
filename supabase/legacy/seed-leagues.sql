-- Seeds the fixed set of leagues teams can join: one uncapped Island-wide
-- league per format, plus a capacity-20 Open League per format+city.
-- Run AFTER supabase/legacy/leagues.sql. Safe to re-run (guarded by name+scope+format).
--
-- capacity=0 means "uncapped" (see supabase/legacy/leagues.sql) — leagues.capacity is
-- NOT NULL in the table, so 0 is the sentinel rather than null.

insert into public.leagues (name, format, scope, stage, capacity)
select l.name, l.format, 'Island-wide', 'season', 0
from (values
  ('Cyprus 5-a-side League',  '5-a-side'),
  ('Cyprus 7-a-side League',  '7-a-side'),
  ('Cyprus 9-a-side League',  '9-a-side'),
  ('Cyprus 11-a-side League', '11-a-side')
) as l(name, format)
where not exists (
  select 1 from public.leagues existing
  where existing.format = l.format and existing.scope = 'Island-wide'
);

-- 9-a-side/11-a-side Open Leagues cap at 15 teams, not 20 — Team Premium
-- (supabase/legacy/team-premium.sql) formats have a smaller pyramid, per the prototype.
insert into public.leagues (name, format, scope, stage, capacity)
select
  city || ' ' || format || ' Open League', format, city, 'signup',
  case when format in ('9-a-side', '11-a-side') then 15 else 20 end
from (values ('5-a-side'), ('7-a-side'), ('9-a-side'), ('11-a-side')) as f(format)
cross join (values ('Nicosia'), ('Limassol'), ('Larnaca'), ('Paphos')) as c(city)
where not exists (
  select 1 from public.leagues existing
  where existing.format = f.format and existing.scope = c.city
);

-- Fixes capacity for rows already seeded before this change — the guard above
-- only stops duplicate inserts, it doesn't correct existing wrong values.
update public.leagues
set capacity = 15
where format in ('9-a-side', '11-a-side') and scope <> 'Island-wide' and capacity = 20;
