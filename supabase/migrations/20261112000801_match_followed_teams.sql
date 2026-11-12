-- A3b-1: followed-team notifications (docs/specs/05-product.md section 2,
-- match-record.md section 6.3 and decision 1c), through send_notification,
-- to followers of a team (user_follows, target_type 'team') only.
-- followed_team_match ("X play Y tonight") is sent by match_reminders_tick
-- (20261112000758_match_reminders.sql).
--
--   followed_team_result           "Result: X 5–3 Y", when a named match
--                                  becomes confirmed (agreed, at the
--                                  deadline, or a forfeit), once;
--   followed_team_opponent_wanted  "X want an opponent on Thursday", when a
--                                  team posts "Need opposition".
--
-- People in the match already get its own notifications, so they're left
-- out; a follower of both teams gets one; the poster isn't told about their
-- own post.
--
-- The trigger on squad_posts replaces the push the notify-squad-post Edge
-- Function sent straight to Expo for team followers on an opposition post;
-- that function no longer does so (deploy both together, or followers get
-- two pushes).

create or replace function public.notify_followed_team_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.match_sides;
  v_b public.match_sides;
  v_body text;
  v_row record;
begin
  select * into v_a from public.match_sides where match_id = new.id and side = 'a';
  select * into v_b from public.match_sides where match_id = new.id and side = 'b';
  if new.forfeit_side is not null then
    v_body := format('Result: %s v %s · Forfeit, %s %s', v_a.label, v_b.label,
                     case new.forfeit_side when 'a' then v_a.label else v_b.label end,
                     case new.forfeit_reason when 'pulled_out' then 'pulled out' else 'didn''t show' end);
  else
    v_body := 'Result: ' || public.match_score_line(new.id, new.side_a_score, new.side_b_score);
  end if;

  for v_row in
    select distinct on (f.follower_id) f.follower_id, s.team_id, s.label
    from public.match_sides s
    join public.user_follows f on f.target_type = 'team' and f.target_id = s.team_id
    where s.match_id = new.id and s.team_id is not null
      and not public.match_is_member(new.id, f.follower_id)
    order by f.follower_id, s.side
  loop
    perform public.match_notify_once(new.id, v_row.follower_id, 'followed_team_result', jsonb_build_object(
      'title', v_row.label, 'body', v_body, 'matchId', new.id, 'teamId', v_row.team_id));
  end loop;
  return null;
end;
$$;

create trigger matches_followed_team_result
  after update of status on public.matches
  for each row
  when (new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.kind = 'named')
  execute function public.notify_followed_team_result();

create or replace function public.notify_followed_team_opponent_wanted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team text;
  v_follower uuid;
begin
  select name into v_team from public.teams where id = new.team_id;
  for v_follower in
    select distinct f.follower_id from public.user_follows f
    where f.target_type = 'team' and f.target_id = new.team_id
      and f.follower_id is distinct from new.posted_by
  loop
    perform public.send_notification(v_follower, 'followed_team_opponent_wanted', jsonb_build_object(
      'title', v_team,
      'body', v_team || ' want an opponent'
              || coalesce(' on ' || to_char(new.scheduled_at at time zone 'Asia/Nicosia', 'FMDay'), '') || '.',
      'postId', new.id, 'teamId', new.team_id));
  end loop;
  return null;
end;
$$;

create trigger squad_posts_followed_team_opponent_wanted
  after insert on public.squad_posts
  for each row
  when (new.type = 'opposition' and new.team_id is not null)
  execute function public.notify_followed_team_opponent_wanted();

revoke all on function public.notify_followed_team_result() from public, anon, authenticated;
revoke all on function public.notify_followed_team_opponent_wanted() from public, anon, authenticated;
