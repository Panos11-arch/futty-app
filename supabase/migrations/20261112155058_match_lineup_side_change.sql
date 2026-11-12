-- A4a follow-up (docs/specs/match-record.md decisions 1e.4 and 1e.7): a
-- lineup position belongs to a side, and match_players.position is what
-- team of the week (A7) reads a keeper from. So:
--
--   a player who changes side (choose_match_side, set_match_player_side,
--   the named-game re-sync) or leaves the match loses their position and
--   is taken out of every lineup of the match; the rest stays;
--   a pickup that becomes a named game (decision 1b.1) has its sides
--   rebuilt, so all its lineups and positions are cleared (as when
--   players_per_side changes, match_lineups_reset).

create or replace function public.match_players_lineup_out()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.position := null;
  update public.match_lineups l
  set positions = (select coalesce(jsonb_object_agg(e.key, e.value), '{}')
                   from jsonb_each_text(l.positions) e
                   where e.value <> new.id::text)
  where l.match_id = new.match_id
    and exists (select 1 from jsonb_each_text(l.positions) e where e.value = new.id::text);
  return new;
end;
$$;

create trigger match_players_lineup_out
  before update of side, left_at on public.match_players
  for each row
  when (new.side is distinct from old.side or (new.left_at is not null and old.left_at is null))
  execute function public.match_players_lineup_out();

create trigger matches_kind_lineups
  after update of kind on public.matches
  for each row
  when (new.kind is distinct from old.kind)
  execute function public.match_lineups_reset();

revoke all on function public.match_players_lineup_out() from public, anon, authenticated;
