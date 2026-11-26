-- One top-level league per city and format (Panos, 26 November).
--
-- leagues_format_scope_key (baseline) made (format, scope) unique across every
-- row, but end_season_to_divisions and form_new_division insert division rows
-- with their hub's format and scope (parent_league_id = the hub), so a split
-- into divisions was refused. The uniqueness now covers top-level rows only:
-- one league per city (or 'Island-wide') and format, any number of divisions
-- under it.
--
-- An upsert against it needs the same predicate:
--   on conflict (format, scope) where parent_league_id is null

alter table public.leagues drop constraint leagues_format_scope_key;

create unique index leagues_format_scope_top_level_key
  on public.leagues (format, scope)
  where parent_league_id is null;
