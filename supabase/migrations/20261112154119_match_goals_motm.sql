-- A4a: goals and man of the match (docs/specs/match-record.md sections 4.6,
-- 4.7, 5.3, decisions 1b.2 and 1e; 05-product section 3).
--
-- Goals: each side's captain enters their own side's scorers, for 24 hours
-- after the result is confirmed; the number of goals equals the side's
-- score; scorers and assisters are players on that side (guests allowed,
-- but guests never get stats). In a pickup game the booker enters both
-- sides (decision 1e.1). Forfeits and disputed matches have no goals.
--
-- Man of the match: checked-in players vote once, not for themselves, for a
-- player who checked in, until 24 hours after confirmation; never for a
-- forfeit (decision 1e.2). Individual votes stay hidden; the result (ties
-- shared) is on the match page once voting closes (get_match_page,
-- decision 1e.3). motm_vote_open goes to checked-in players once each.

-- 4.6 One row per goal, in the order the captain entered them.
create table public.match_goals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  sort integer not null,
  scorer_player_id uuid references public.match_players (id) on delete set null,
  assist_player_id uuid references public.match_players (id) on delete set null,
  entered_by uuid not null,
  created_at timestamptz not null default now()
);
create index match_goals_match_idx on public.match_goals (match_id, side, sort);

-- 4.7 One vote per checked-in player.
create table public.motm_votes (
  match_id uuid not null references public.matches (id) on delete cascade,
  voter_profile_id uuid not null references public.profiles (id) on delete cascade,
  nominee_player_id uuid not null references public.match_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, voter_profile_id)
);
create index motm_votes_nominee_idx on public.motm_votes (match_id, nominee_player_id);

-- Who can see the match page: its members (can_view_match), and everyone
-- signed in once the match is confirmed (sections 4.6 and 4.9).
create or replace function public.match_page_visible(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'confirmed')
          or public.can_view_match(p_match_id));
$$;

-- The sides p_profile_id may write goals and lineups for, or null: in a
-- named game the side they captain (match_captain_side); in a pickup the
-- booker (side a's captain) writes both sides (decision 1e.1).
create or replace function public.match_side_writer(p_match_id uuid, p_profile_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.kind = 'pickup' then
      case when exists (select 1 from public.match_sides s
                        where s.match_id = m.id and s.side = 'a' and s.captain_profile_id = p_profile_id)
           then array['a', 'b'] end
    else
      (select array_agg(s.side order by s.side) from public.match_sides s
       where s.match_id = m.id and p_profile_id is not null
         and (s.captain_profile_id = p_profile_id
              or (s.team_id is not null and exists (
                    select 1 from public.team_members tm
                    where tm.team_id = s.team_id and tm.profile_id = p_profile_id and tm.role = 'captain'))))
  end
  from public.matches m
  where m.id = p_match_id;
$$;

-- The side the caller writes: p_side if they may write it, or their only
-- side when p_side is null. not_in_match for someone outside the match,
-- not_captain for a member who can't write that side, invalid_side for a
-- side other than a/b, or none given when they may write both.
create or replace function public.match_writer_side(p_match_id uuid, p_profile_id uuid, p_side text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sides text[] := public.match_side_writer(p_match_id, p_profile_id);
begin
  if v_sides is null then
    if public.match_is_member(p_match_id, p_profile_id) then
      raise exception 'not_captain';
    end if;
    raise exception 'not_in_match';
  end if;
  if p_side is null then
    if cardinality(v_sides) = 1 then
      return v_sides[1];
    end if;
    raise exception 'invalid_side';
  end if;
  if p_side not in ('a', 'b') then
    raise exception 'invalid_side';
  end if;
  if not p_side = any (v_sides) then
    raise exception 'not_captain';
  end if;
  return p_side;
end;
$$;

-- p_player_id is a player on p_side of the match who hasn't left (a
-- profile or a guest).
create or replace function public.match_player_on_side(p_match_id uuid, p_player_id uuid, p_side text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.match_players mp
                 where mp.id = p_player_id and mp.match_id = p_match_id and mp.side = p_side and mp.left_at is null);
$$;

-- p_profile_id played: a player who hasn't left, with a check-in (1b.2).
create or replace function public.match_played(p_match_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.match_players mp
                 join public.match_attendance a on a.match_id = mp.match_id and a.profile_id = mp.profile_id
                 where mp.match_id = p_match_id and mp.profile_id = p_profile_id and mp.left_at is null);
$$;

-- Replaces the caller's side's goals. p_goals:
--   [{"scorerPlayerId": uuid | null, "assistPlayerId": uuid | null}, ...]
-- A null scorer is an own goal or an unknown scorer. p_side is needed only
-- by a pickup booker, who writes both sides.
create or replace function public.set_match_goals(p_match_id uuid, p_goals jsonb, p_side text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_side text;
  v_goal jsonb;
  v_scorer uuid;
  v_assist uuid;
  v_scorers uuid[] := '{}';
  v_assists uuid[] := '{}';
  i integer;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  v_side := public.match_writer_side(p_match_id, v_uid, p_side);

  if v_match.status <> 'confirmed' or v_match.forfeit_side is not null then
    raise exception 'match_not_confirmed';
  end if;
  if now() >= v_match.confirmed_at + interval '24 hours' then
    raise exception 'scorers_window_closed';
  end if;
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' then
    raise exception 'invalid_goals';
  end if;
  if jsonb_array_length(p_goals) <> (case v_side when 'a' then v_match.side_a_score else v_match.side_b_score end) then
    raise exception 'score_mismatch';
  end if;

  for v_goal in select e from jsonb_array_elements(p_goals) e loop
    if jsonb_typeof(v_goal) <> 'object' then
      raise exception 'invalid_goals';
    end if;
    begin
      v_scorer := (v_goal ->> 'scorerPlayerId')::uuid;
      v_assist := (v_goal ->> 'assistPlayerId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_goals';
    end;
    if v_assist is not null and (v_scorer is null or v_assist = v_scorer) then
      raise exception 'invalid_goals';
    end if;
    if (v_scorer is not null and not public.match_player_on_side(p_match_id, v_scorer, v_side))
       or (v_assist is not null and not public.match_player_on_side(p_match_id, v_assist, v_side)) then
      raise exception 'not_in_match';
    end if;
    v_scorers := array_append(v_scorers, v_scorer);
    v_assists := array_append(v_assists, v_assist);
  end loop;

  delete from public.match_goals where match_id = p_match_id and side = v_side;
  for i in 1 .. coalesce(array_length(v_scorers, 1), 0) loop
    insert into public.match_goals (match_id, side, sort, scorer_player_id, assist_player_id, entered_by)
    values (p_match_id, v_side, i, v_scorers[i], v_assists[i], v_uid);
  end loop;
end;
$$;

create or replace function public.cast_motm_vote(p_match_id uuid, p_nominee_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_nominee public.match_players;
  v_voted integer;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if not public.match_played(p_match_id, v_uid) then
    raise exception 'not_checked_in';
  end if;
  if v_match.status <> 'confirmed' or v_match.forfeit_side is not null then
    raise exception 'match_not_confirmed';
  end if;
  if now() >= v_match.confirmed_at + interval '24 hours' then
    raise exception 'voting_closed';
  end if;

  select * into v_nominee from public.match_players where id = p_nominee_player_id and match_id = p_match_id;
  if v_nominee.profile_id = v_uid then
    raise exception 'cannot_vote_for_self';
  end if;
  if v_nominee.id is null or v_nominee.profile_id is null or not public.match_played(p_match_id, v_nominee.profile_id) then
    raise exception 'nominee_not_eligible';
  end if;

  insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
  values (p_match_id, v_uid, p_nominee_player_id)
  on conflict do nothing;
  get diagnostics v_voted = row_count;
  if v_voted = 0 then
    raise exception 'already_voted';
  end if;
end;
$$;

-- Sends motm_vote_open to every player who played (or only p_profile_id),
-- if the match is confirmed, not a forfeit and voting is open. Once per
-- player per match (match_notify_once).
create or replace function public.match_motm_notify(p_match_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_closes timestamptz;
  v_body text;
  v_profile uuid;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or v_match.status <> 'confirmed' or v_match.forfeit_side is not null then
    return;
  end if;
  v_closes := v_match.confirmed_at + interval '24 hours';
  if now() >= v_closes then
    return;
  end if;
  v_body := format('%s. Who was man of the match? Voting closes %s at %s.',
                   public.match_score_line(p_match_id, v_match.side_a_score, v_match.side_b_score),
                   public.match_day_word(v_closes, now()),
                   to_char(v_closes at time zone 'Asia/Nicosia', 'HH24:MI'));
  for v_profile in
    select mp.profile_id from public.match_players mp
    join public.match_attendance a on a.match_id = mp.match_id and a.profile_id = mp.profile_id
    where mp.match_id = p_match_id and mp.left_at is null
      and (p_profile_id is null or mp.profile_id = p_profile_id)
  loop
    perform public.match_notify_once(p_match_id, v_profile, 'motm_vote_open',
      jsonb_build_object('title', 'Man of the match', 'body', v_body, 'matchId', p_match_id));
  end loop;
end;
$$;

create or replace function public.notify_motm_vote_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.match_motm_notify(new.id, null);
  return null;
end;
$$;

create trigger matches_motm_vote_open
  after update of status on public.matches
  for each row
  when (new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.forfeit_side is null)
  execute function public.notify_motm_vote_open();

-- A player ticked in by their captain after confirmation, while voting is open.
create or replace function public.notify_motm_vote_open_late_check_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.match_motm_notify(new.match_id, new.profile_id);
  return null;
end;
$$;

create trigger match_attendance_motm_vote_open
  after insert on public.match_attendance
  for each row
  execute function public.notify_motm_vote_open_late_check_in();

alter table public.match_goals enable row level security;
alter table public.motm_votes enable row level security;

create policy "Everyone who can see the match page reads its goals" on public.match_goals
  for select to authenticated using (public.match_page_visible(match_id));
create policy "A voter reads their own vote" on public.motm_votes
  for select to authenticated using (voter_profile_id = auth.uid());

revoke all on public.match_goals, public.motm_votes from public, anon, authenticated;
grant select on public.match_goals, public.motm_votes to authenticated;
grant all on public.match_goals, public.motm_votes to service_role;

revoke all on function public.match_page_visible(uuid) from public, anon;
grant execute on function public.match_page_visible(uuid) to authenticated, service_role;

revoke all on function public.match_side_writer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_side_writer(uuid, uuid) to service_role;
revoke all on function public.match_writer_side(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.match_writer_side(uuid, uuid, text) to service_role;
revoke all on function public.match_player_on_side(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.match_player_on_side(uuid, uuid, text) to service_role;
revoke all on function public.match_played(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_played(uuid, uuid) to service_role;
revoke all on function public.match_motm_notify(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_motm_notify(uuid, uuid) to service_role;
revoke all on function public.notify_motm_vote_open() from public, anon, authenticated;
revoke all on function public.notify_motm_vote_open_late_check_in() from public, anon, authenticated;

-- What the app may call: they check the caller themselves.
revoke all on function public.set_match_goals(uuid, jsonb, text) from public, anon;
grant execute on function public.set_match_goals(uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.cast_motm_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_motm_vote(uuid, uuid) to authenticated, service_role;
