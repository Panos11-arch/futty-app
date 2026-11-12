-- A4a: lineups (docs/specs/match-record.md section 4.9, decision 1e; 05-product
-- section 5). Before kickoff, a side's captain (the booker for both sides of
-- a pickup, decision 1e.1) picks a formation preset for the match's
-- players_per_side and puts that side's players in its positions; empty
-- positions are allowed ("Need players"). match_players.position is set
-- from the lineup. When players_per_side changes (5 v 5 to 6 v 6, P12) the
-- saved lineups no longer fit, so they are cleared (decision 1e.5).

-- Formation presets (decision 1e.4): outfield lines back to front; the
-- goalkeeper is always added. Readable by everyone signed in; written only
-- by migrations.
create table public.match_formation_presets (
  players_per_side integer not null,
  formation text not null check (formation ~ '^[1-9](-[1-9])+$'),
  sort integer not null,
  primary key (players_per_side, formation)
);

insert into public.match_formation_presets (players_per_side, formation, sort) values
  (5, '1-2-1', 1), (5, '2-1-1', 2), (5, '2-2', 3), (5, '1-1-2', 4),
  (6, '2-2-1', 1), (6, '3-1-1', 2), (6, '2-1-2', 3), (6, '1-2-2', 4),
  (7, '2-3-1', 1), (7, '3-2-1', 2), (7, '3-3', 3), (7, '2-2-2', 4),
  (9, '3-3-2', 1), (9, '3-2-3', 2), (9, '4-3-1', 3), (9, '3-4-1', 4),
  (11, '4-4-2', 1), (11, '4-3-3', 2), (11, '4-2-3-1', 3), (11, '3-5-2', 4),
  (11, '5-3-2', 5), (11, '4-5-1', 6), (11, '3-4-3', 7);

-- The position keys of a formation, in order: gk, then d1.. for the first
-- line, f1.. for the last, m1.. for every line between ("4-2-3-1": gk,
-- d1-d4, m1-m5, f1).
create or replace function public.match_formation_positions(p_formation text)
returns text[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_lines integer[] := string_to_array(p_formation, '-')::integer[];
  v_n integer := cardinality(v_lines);
  v_keys text[] := array['gk'];
  v_d integer := 0;
  v_m integer := 0;
  v_f integer := 0;
  i integer;
  j integer;
begin
  for i in 1 .. v_n loop
    for j in 1 .. v_lines[i] loop
      if i = 1 then
        v_d := v_d + 1;
        v_keys := v_keys || ('d' || v_d);
      elsif i = v_n then
        v_f := v_f + 1;
        v_keys := v_keys || ('f' || v_f);
      else
        v_m := v_m + 1;
        v_keys := v_keys || ('m' || v_m);
      end if;
    end loop;
  end loop;
  return v_keys;
end;
$$;

-- 4.9 One lineup per side: position key → match_players.id.
create table public.match_lineups (
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  formation text not null,
  positions jsonb not null default '{}' check (jsonb_typeof(positions) = 'object'),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (match_id, side)
);

create or replace function public.set_match_lineup(p_match_id uuid, p_side text, p_formation text, p_positions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_keys text[];
  v_entry record;
  v_player uuid;
  v_players uuid[] := '{}';
  v_clean jsonb := '{}';
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if p_side is null or p_side not in ('a', 'b') then
    raise exception 'invalid_side';
  end if;
  perform public.match_writer_side(p_match_id, v_uid, p_side);

  if v_match.status <> 'scheduled' or now() >= v_match.kickoff_at then
    raise exception 'lineup_locked';
  end if;
  if not exists (select 1 from public.match_formation_presets f
                 where f.players_per_side = v_match.players_per_side and f.formation = p_formation) then
    raise exception 'unknown_formation';
  end if;
  if p_positions is null or jsonb_typeof(p_positions) <> 'object' then
    raise exception 'invalid_position';
  end if;

  v_keys := public.match_formation_positions(p_formation);
  for v_entry in select e.key, e.value from jsonb_each(p_positions) e loop
    if not v_entry.key = any (v_keys) then
      raise exception 'invalid_position';
    end if;
    continue when jsonb_typeof(v_entry.value) = 'null';
    if jsonb_typeof(v_entry.value) <> 'string' then
      raise exception 'invalid_position';
    end if;
    begin
      v_player := (v_entry.value #>> '{}')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_position';
    end;
    if v_player = any (v_players) then
      raise exception 'duplicate_player';
    end if;
    if not public.match_player_on_side(p_match_id, v_player, p_side) then
      raise exception 'not_in_match';
    end if;
    v_players := v_players || v_player;
    v_clean := v_clean || jsonb_build_object(v_entry.key, v_player);
  end loop;

  insert into public.match_lineups (match_id, side, formation, positions, updated_by, updated_at)
  values (p_match_id, p_side, p_formation, v_clean, v_uid, now())
  on conflict (match_id, side) do update
  set formation = excluded.formation, positions = excluded.positions,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  update public.match_players set position = null
  where match_id = p_match_id and side = p_side and position is not null;
  update public.match_players mp set position = e.key
  from jsonb_each_text(v_clean) e
  where mp.id = e.value::uuid and mp.match_id = p_match_id;
end;
$$;

-- players_per_side changed (create_match_for_booking re-syncs it from the
-- booking's capacity, e.g. a 5 v 5 switched to 6 v 6 by P12): the saved
-- lineups no longer fit the presets, so they and the positions go.
create or replace function public.match_lineups_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.match_lineups where match_id = new.id;
  update public.match_players set position = null where match_id = new.id and position is not null;
  return null;
end;
$$;

create trigger matches_players_per_side_lineups
  after update of players_per_side on public.matches
  for each row
  when (new.players_per_side is distinct from old.players_per_side)
  execute function public.match_lineups_reset();

alter table public.match_formation_presets enable row level security;
alter table public.match_lineups enable row level security;

create policy "Everyone signed in reads the formation presets" on public.match_formation_presets
  for select to authenticated using (true);
create policy "Everyone who can see the match page reads its lineups" on public.match_lineups
  for select to authenticated using (public.match_page_visible(match_id));

revoke all on public.match_formation_presets, public.match_lineups from public, anon, authenticated;
grant select on public.match_formation_presets, public.match_lineups to authenticated;
grant all on public.match_formation_presets, public.match_lineups to service_role;

revoke all on function public.match_formation_positions(text) from public, anon;
grant execute on function public.match_formation_positions(text) to authenticated, service_role;
revoke all on function public.match_lineups_reset() from public, anon, authenticated;

revoke all on function public.set_match_lineup(uuid, text, text, jsonb) from public, anon;
grant execute on function public.set_match_lineup(uuid, text, text, jsonb) to authenticated, service_role;
