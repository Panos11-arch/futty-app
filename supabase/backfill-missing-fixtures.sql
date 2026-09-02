-- One-time backfill: any league or division already in 'season' or
-- 'divisions' stage with 2+ registered teams but zero league_fixtures rows
-- (e.g. one that reached that stage via the old start_league_season path,
-- which never called sync_league_fixtures until this fix) gets its full
-- round-robin generated now. A 1-team league is skipped on purpose — there's
-- no opponent to pair against yet, that's not a bug this can fix.
--
-- Safe to re-run: sync_league_fixtures itself is `on conflict do nothing`,
-- and the WHERE clause here only ever targets leagues that currently have
-- zero fixtures, so it never touches a league that already has any.
do $$
declare
  v_league record;
begin
  for v_league in
    select l.id, l.name
    from public.leagues l
    join public.league_teams lt on lt.league_id = l.id
    left join public.league_fixtures lf on lf.league_id = l.id
    where l.stage in ('season', 'divisions')
    group by l.id, l.name
    having count(distinct lt.team_id) >= 2 and count(lf.id) = 0
  loop
    raise notice 'Backfilling fixtures for league %', v_league.name;
    perform public.sync_league_fixtures(v_league.id);
  end loop;
end;
$$;
