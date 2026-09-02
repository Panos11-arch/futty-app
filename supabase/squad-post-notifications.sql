-- Item 5 (payment-auth batch) — notifies players when a NEW squad post
-- appears, not just when one is joined or matched (those already exist in
-- supabase/notifications.sql). "Relevant" is defined as: same city as the
-- venue (profiles.city) and a member of a team whose roster_size matches the
-- post's format — profiles have no stored "preferred format" of their own,
-- so this infers it from their actual teams instead (confirmed approach).
--
-- This only writes the in-app row (bell icon, app/notifications.tsx). The
-- actual Expo push send is a separate step — supabase/functions/notify-
-- squad-post-created, invoked directly by the client right after
-- create_squad_post succeeds (see lib/squads.ts) — this project has no
-- pg_net/Database Webhook support, so a plain SQL trigger can reach the
-- notifications table but can't call out to Expo's push API itself.
--
-- Run AFTER supabase/notifications.sql and supabase/squads.sql. Run in the
-- Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.

-- Shared between this trigger and the edge function below so the "who is
-- this relevant to" logic only lives in one place.
create or replace function public.squad_post_notification_recipients(p_post_id uuid)
returns table (profile_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select distinct tm.profile_id
  from public.squad_posts sp
  join public.venues v on v.id = sp.venue_id
  join public.team_members tm on tm.role in ('captain', 'player', 'substitute')
  join public.teams t on t.id = tm.team_id
  join public.profiles p on p.id = tm.profile_id
  where sp.id = p_post_id
    and p.city = v.city
    and t.roster_size = case sp.format
      when '5-a-side' then 5
      when '7-a-side' then 7
      when '9-a-side' then 9
      when '11-a-side' then 11
      else -1 -- an unrecognised format never matches any real roster_size
    end
    -- Item 5 requirement — never notify the poster about their own post.
    and tm.profile_id is distinct from sp.posted_by;
$$;

grant execute on function public.squad_post_notification_recipients(uuid) to authenticated, service_role;

create or replace function public.notify_squad_post_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_name text;
  v_poster_name text;
  v_team_name text;
  v_when text;
  v_title text;
  v_body text;
  v_recipient uuid;
begin
  select name into v_venue_name from public.venues where id = new.venue_id;
  -- "Sat 18:00" — Cyprus local time, same zone convention as
  -- supabase/scores.sql etc. Kept short: this also has to fit a push
  -- notification body alongside the subject/position/venue.
  v_when := to_char(new.scheduled_at at time zone 'Asia/Nicosia', 'Dy HH24:MI');

  if new.type = 'players' then
    select username into v_poster_name from public.profiles where id = new.posted_by;
    -- Items 2/5 — naming the specific position (when given) up front is what
    -- lets a recipient tell at a glance whether this post is relevant to
    -- them, instead of a generic "needs players" every time.
    v_title := case when new.position_needed is not null then 'Needs a ' || new.position_needed
      else 'Looking for players' end;
    v_body := coalesce(v_poster_name, 'Someone') ||
      (case when new.position_needed is not null then ' needs a ' || new.position_needed
        else ' needs players' end) ||
      ' — ' || new.format || ' at ' || coalesce(v_venue_name, 'a venue') || ', ' || v_when;
  else
    select name into v_team_name from public.teams where id = new.team_id;
    -- Item 3 — informational only, never a hard filter (see
    -- squad_post_notification_recipients — matching stays city+format only).
    v_title := case when new.level_needed is not null then 'Looking for a ' || new.level_needed || '-level opponent'
      else 'Looking for opposition' end;
    v_body := coalesce(v_team_name, 'A team') ||
      (case when new.level_needed is not null then ' is looking for a ' || new.level_needed || '-level opponent'
        else ' wants a match' end) ||
      ' — ' || new.format || ' at ' || coalesce(v_venue_name, 'a venue') || ', ' || v_when;
  end if;

  for v_recipient in select recipients.profile_id from public.squad_post_notification_recipients(new.id) as recipients
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (v_recipient, 'squad_post', v_title, v_body, jsonb_build_object('postId', new.id, 'postType', new.type));
  end loop;

  return new;
end;
$$;

drop trigger if exists on_squad_post_created_notify on public.squad_posts;
create trigger on_squad_post_created_notify
  after insert on public.squad_posts
  for each row execute function public.notify_squad_post_created();
