-- S7b (part 1 of 2, server): moderation for posts and comments.
--
--   * Reports on posts and comments (lib/moderation's reports, two new
--     contexts). The server sets who is reported; a repeat report by the
--     same person is ignored. 3 reports from different people hide the item
--     until a founder reviews it.
--   * A report involving an under-18 is urgent: report_involves_minor now
--     covers posts and comments, so the existing alert email
--     (notify-urgent-reports) goes out for them too.
--   * Flags: text or a photo the automatic checks refused (community-post),
--     and an age range from the phone that disagrees with the date of birth.
--   * The founders' queue (existing admins, app_admins): reports, hidden
--     items and flags, urgent first, then oldest first, with each item's age
--     (we act within 24 hours; over 12 is highlighted). Remove, warn,
--     suspend (until a date), ban, lift, restore or dismiss, each logged
--     with who, when, what and why, and the person gets a statement of
--     reasons with how to appeal (EU Digital Services Act).
--   * The daily cleanup of unposted photos, and account deletion.

-- ---- 1. Rules and notification types ----------------------------------------------------

-- Whether an item hidden by 3 reports sends its author a notice ("hidden
-- while we review it"). Waiting on Panos (DSA): turning it on is one update
-- of this rule, no code change.
alter table public.app_rules
  add column posts_auto_hide_notice boolean not null default false;

-- Statements of reasons: always sent, whatever the player's settings.
insert into public.notification_types (type, always_sent, default_enabled) values
  ('content_removed', true, true),
  ('content_hidden', true, true),
  ('account_warned', true, true),
  ('account_restricted', true, true)
on conflict (type) do nothing;

-- Where appeals go (decided by Anghelo, 27 November).
create function public.moderation_appeal_email()
returns text
language sql
immutable
set search_path = ''
as $$ select 'safety@futty.app' $$;

-- ---- 2. Tables -----------------------------------------------------------------------

-- Reports a founder has dealt with (any action on the item) are resolved;
-- only open reports count towards the 3 that hide an item.
alter table public.reports add column resolved_at timestamptz;
create index reports_open_target_idx on public.reports (context, context_id) where resolved_at is null;

-- What the automatic checks refused, and age signals that disagree with the
-- date of birth.
create table public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('auto_text', 'auto_image', 'age_mismatch')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  details jsonb not null default '{}',
  urgent boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index moderation_flags_open_idx on public.moderation_flags (created_at) where resolved_at is null;

-- Every founder action: who, when, what and why. Never changed or removed.
create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles (id) on delete set null,
  target_kind text not null check (target_kind in ('post', 'comment', 'profile', 'flag', 'report')),
  target_id uuid not null,
  subject_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('remove', 'restore', 'dismiss', 'warn', 'suspend', 'ban', 'lift')),
  reason text not null check (char_length(trim(reason)) > 0),
  until timestamptz,
  created_at timestamptz not null default now()
);
create index moderation_actions_target_idx on public.moderation_actions (target_kind, target_id, created_at);

create function public.moderation_actions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'moderation_log_append_only';
end;
$$;

create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function public.moderation_actions_append_only();

-- The age ranges phones report (Apple's Declared Age Range, Google Play
-- Age Signals), to limit them to one per source a day.
create table public.age_signal_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('ios', 'android')),
  lower_age integer not null,
  upper_age integer,
  matches boolean not null,
  reported_at timestamptz not null default now()
);
create index age_signal_reports_profile_idx on public.age_signal_reports (profile_id, source, reported_at desc);

alter table public.moderation_flags enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.age_signal_reports enable row level security;
revoke all on public.moderation_flags, public.moderation_actions, public.age_signal_reports
  from public, anon, authenticated;
grant all on public.moderation_flags, public.moderation_actions, public.age_signal_reports to service_role;

-- New admin alert kind? No: flags involving an under-18 reuse 'minor_report'
-- so notify-urgent-reports emails them unchanged.

-- ---- 3. Reports on posts and comments ----------------------------------------------------

-- Before a post or comment report is stored: the reporter must be able to
-- see the item, the reported player is its author (never what the app
-- sent), and a second open report by the same person is dropped.
-- Named to run before reports_flag_urgent (triggers run in name order).
create function public.reports_bind_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.context not in ('post', 'comment') then
    return new;
  end if;
  if new.context_id is null then
    raise exception 'report_target_required';
  end if;
  if new.context = 'post' then
    if not public.post_visible_to(new.reporter_id, new.context_id) then
      raise exception 'not_found';
    end if;
    select p.author_id into new.reported_user_id from public.posts p where p.id = new.context_id;
  else
    if not public.comment_visible_to(new.reporter_id, new.context_id) then
      raise exception 'not_found';
    end if;
    select c.author_id into new.reported_user_id from public.post_comments c where c.id = new.context_id;
  end if;
  if new.reported_user_id = new.reporter_id then
    raise exception 'cannot_report_self';
  end if;
  if exists (
    select 1 from public.reports r
    where r.reporter_id = new.reporter_id and r.context = new.context and r.context_id = new.context_id
      and r.resolved_at is null
  ) then
    return null;
  end if;
  return new;
end;
$$;

create trigger reports_bind_target
  before insert on public.reports
  for each row execute function public.reports_bind_target();

-- After a post or comment report: 3 open reports from different people hide
-- the item until a founder reviews it.
create function public.reports_auto_hide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporters integer;
  v_author uuid;
  v_hidden boolean := false;
begin
  if new.context not in ('post', 'comment') then
    return new;
  end if;
  select count(distinct r.reporter_id) into v_reporters
  from public.reports r
  where r.context = new.context and r.context_id = new.context_id and r.resolved_at is null;
  if v_reporters < 3 then
    return new;
  end if;

  if new.context = 'post' then
    update public.posts set hidden_reason = 'reports', hidden_at = now()
    where id = new.context_id and hidden_reason is null
    returning author_id into v_author;
  else
    update public.post_comments set hidden_reason = 'reports', hidden_at = now()
    where id = new.context_id and hidden_reason is null
    returning author_id into v_author;
  end if;
  v_hidden := v_author is not null;

  if v_hidden and (public.app_rules_now()).posts_auto_hide_notice then
    perform public.send_notification(v_author, 'content_hidden', jsonb_build_object(
      'title', case when new.context = 'post' then 'Post hidden' else 'Comment hidden' end,
      'body', 'Hidden while we review it.',
      new.context || '_id', new.context_id));
  end if;
  return new;
end;
$$;

create trigger reports_auto_hide
  after insert on public.reports
  for each row execute function public.reports_auto_hide();

-- report_involves_minor, re-created from its latest definition
-- (20261124224929_match_age_safety.sql). Added: a post or comment by an
-- under-18 or in the under-18 community.
create or replace function public.report_involves_minor(p_report public.reports)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_minor(p_report.reporter_id)
      or (p_report.reported_user_id is not null and public.is_minor(p_report.reported_user_id))
      or (p_report.context = 'fixture_chat' and p_report.context_id is not null
          and public.fixture_has_minor_captain(p_report.context_id))
      or (p_report.context = 'team' and p_report.context_id is not null and exists (
            select 1 from public.team_members tm
            where tm.team_id = p_report.context_id and public.is_minor(tm.profile_id)))
      or (p_report.context = 'post' and p_report.context_id is not null and exists (
            select 1 from public.posts p
            where p.id = p_report.context_id and (p.community = 'minor' or public.is_minor(p.author_id))))
      or (p_report.context = 'comment' and p_report.context_id is not null and exists (
            select 1 from public.post_comments c
            where c.id = p_report.context_id and (c.community = 'minor' or public.is_minor(c.author_id))));
$$;

-- ---- 4. Flags --------------------------------------------------------------------------

-- A flag for the queue. One that involves an under-18 is urgent and emailed
-- to the founders like an urgent report (the alert's report_id is the
-- flag's id).
create function public.add_moderation_flag(p_kind text, p_profile_id uuid, p_details jsonb, p_urgent boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_urgent boolean := coalesce(p_urgent, false) or public.is_minor(p_profile_id);
begin
  insert into public.moderation_flags (kind, profile_id, details, urgent)
  values (p_kind, p_profile_id, coalesce(p_details, '{}'), v_urgent)
  returning id into v_id;
  if v_urgent then
    insert into public.admin_alerts (kind, details)
    values ('minor_report', jsonb_build_object('report_id', v_id, 'context', 'flag_' || p_kind));
  end if;
  return v_id;
end;
$$;

-- community-post: text or a photo the automatic checks refused. Nothing
-- was posted; the flag keeps what was refused for the founders.
create function public.record_check_flag(p_profile_id uuid, p_kind text, p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('auto_text', 'auto_image') then
    raise exception 'invalid_kind';
  end if;
  return public.add_moderation_flag(p_kind, p_profile_id, p_details, false);
end;
$$;

-- The age range a parent shared on the phone (Apple's Declared Age Range,
-- Google Play Age Signals). It never blocks: a range that disagrees with
-- the date of birth is flagged for the founders. One per source a day.
-- Returns 'match', 'mismatch', 'no_date_of_birth' or 'too_soon'.
create function public.report_declared_age_range(p_lower integer, p_upper integer, p_source text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_dob date;
  v_age integer;
  v_matches boolean;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_source is null or p_source not in ('ios', 'android') then
    raise exception 'invalid_source';
  end if;
  if p_lower is null or p_lower < 0 or p_lower > 120 or (p_upper is not null and (p_upper < p_lower or p_upper > 120)) then
    raise exception 'invalid_range';
  end if;
  select p.date_of_birth into v_dob from public.profiles p where p.id = v_me;
  if v_dob is null then
    return 'no_date_of_birth';
  end if;
  if exists (
    select 1 from public.age_signal_reports a
    where a.profile_id = v_me and a.source = p_source and a.reported_at > now() - interval '1 day'
  ) then
    return 'too_soon';
  end if;

  v_age := public.age_in_years(v_dob, public.cyprus_date(now()));
  v_matches := v_age >= p_lower and (p_upper is null or v_age <= p_upper);
  insert into public.age_signal_reports (profile_id, source, lower_age, upper_age, matches)
  values (v_me, p_source, p_lower, p_upper, v_matches);

  if not v_matches then
    perform public.add_moderation_flag('age_mismatch', v_me,
      jsonb_build_object('source', p_source, 'lower', p_lower, 'upper', p_upper, 'age_from_date_of_birth', v_age),
      -- Under 18 by either account: urgent.
      p_upper is not null and p_upper < 18);
    return 'mismatch';
  end if;
  return 'match';
end;
$$;

-- ---- 5. The founders' queue --------------------------------------------------------------

-- Open reports grouped by item, and open flags: urgent first, then oldest
-- first. age_hours counts from the oldest open report or the flag.
create function public.admin_moderation_queue()
returns table (
  target_kind text,
  target_id uuid,
  source text,
  subject_id uuid,
  subject_name text,
  report_count integer,
  reasons text[],
  urgent boolean,
  hidden boolean,
  preview text,
  oldest_at timestamptz,
  age_hours integer,
  over_12h boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
    with groups as (
      select r.context, coalesce(r.context_id, r.reported_user_id) as item_id,
             max(r.reported_user_id::text)::uuid as subject,
             count(distinct r.reporter_id)::integer as n,
             array_agg(r.reason order by r.created_at) as why,
             bool_or(r.urgent) as is_urgent,
             min(r.created_at) as first_at
      from public.reports r
      where r.resolved_at is null and coalesce(r.context_id, r.reported_user_id) is not null
      group by r.context, coalesce(r.context_id, r.reported_user_id)
    ),
    report_items as (
      select g.context, g.item_id, 'report'::text, g.subject,
             g.n, g.why, g.is_urgent,
             case g.context
               when 'post' then (select p.hidden_reason is not null from public.posts p where p.id = g.item_id)
               when 'comment' then (select c.hidden_reason is not null from public.post_comments c where c.id = g.item_id)
               else false
             end,
             case g.context
               when 'post' then (select left(coalesce(p.body, ''), 200) from public.posts p where p.id = g.item_id)
               when 'comment' then (select left(c.body, 200) from public.post_comments c where c.id = g.item_id)
             end,
             g.first_at
      from groups g
    ),
    flag_items as (
      select 'flag'::text, f.id, f.kind, f.profile_id, 0, array[]::text[], f.urgent, false,
             left(coalesce(f.details ->> 'text', ''), 200), f.created_at
      from public.moderation_flags f
      where f.resolved_at is null
    ),
    everything (k, id, src, subject, n, why, is_urgent, is_hidden, prev, first_at) as (
      select * from report_items
      union all
      select * from flag_items
    )
    select e.k, e.id, e.src, e.subject,
           (select coalesce(public.community_display_name(pr), 'Player') from public.profiles pr where pr.id = e.subject),
           e.n, e.why, e.is_urgent, coalesce(e.is_hidden, false), e.prev, e.first_at,
           floor(extract(epoch from now() - e.first_at) / 3600)::integer,
           now() - e.first_at > interval '12 hours'
    from everything e
    order by e.is_urgent desc, e.first_at, e.id;
end;
$$;

-- One item for the founders: the content, every report on it and every
-- action taken on it.
create function public.admin_moderation_item(p_target_kind text, p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return jsonb_build_object(
    'post', (select to_jsonb(p) || jsonb_build_object('photoPaths',
               coalesce((select jsonb_agg(ph.path order by ph.idx) from public.post_photos ph where ph.post_id = p.id), '[]'))
             from public.posts p where p_target_kind = 'post' and p.id = p_target_id),
    'comment', (select to_jsonb(c) from public.post_comments c where p_target_kind = 'comment' and c.id = p_target_id),
    'flag', (select to_jsonb(f) from public.moderation_flags f where p_target_kind = 'flag' and f.id = p_target_id),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'reporterId', r.reporter_id, 'reason', r.reason,
                                          'urgent', r.urgent, 'createdAt', r.created_at, 'resolvedAt', r.resolved_at)
                       order by r.created_at)
      from public.reports r
      where coalesce(r.context_id, r.reported_user_id) = p_target_id), '[]'),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object('adminId', a.admin_id, 'action', a.action, 'reason', a.reason,
                                          'until', a.until, 'createdAt', a.created_at)
                       order by a.created_at)
      from public.moderation_actions a
      where a.target_id = p_target_id), '[]')
  );
end;
$$;

-- A founder acts on an item. target_kind: post, comment, profile, flag, or
-- report (any other reported item, by its id). Actions:
--   remove (post, comment)          hide it; the author gets the reasons
--   restore (post, comment)         show it again
--   dismiss (any)                   no action; a post or comment hidden by
--                                   reports is shown again
--   warn, suspend, ban              on the player (the item's author, the
--                                   profile, the flag's or the reported
--                                   player); suspend needs a future until
--   lift (profile)                  ends their suspension or ban
-- Each one resolves the item's open reports (or the flag), is logged, and
-- every remove, warn, suspend and ban sends the statement of reasons.
create function public.admin_moderate(
  p_target_kind text,
  p_target_id uuid,
  p_action text,
  p_reason text,
  p_until timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_reason text := nullif(trim(p_reason), '');
  v_subject uuid;
  v_what text;
  v_action_id uuid;
begin
  if v_reason is null then
    raise exception 'reason_required';
  end if;
  if p_target_kind is null or p_target_kind not in ('post', 'comment', 'profile', 'flag', 'report') then
    raise exception 'invalid_target';
  end if;
  if p_action is null or p_action not in ('remove', 'restore', 'dismiss', 'warn', 'suspend', 'ban', 'lift') then
    raise exception 'invalid_action';
  end if;

  -- Who the item is about.
  case p_target_kind
    when 'post' then select author_id into v_subject from public.posts where id = p_target_id;
    when 'comment' then select author_id into v_subject from public.post_comments where id = p_target_id;
    when 'profile' then select id into v_subject from public.profiles where id = p_target_id;
    when 'flag' then select profile_id into v_subject from public.moderation_flags where id = p_target_id;
    when 'report' then
      select r.reported_user_id into v_subject from public.reports r
      where coalesce(r.context_id, r.reported_user_id) = p_target_id and r.reported_user_id is not null
      order by r.created_at limit 1;
  end case;
  if v_subject is null and p_target_kind <> 'report' then
    raise exception 'not_found';
  end if;
  v_what := case p_target_kind when 'post' then 'post' when 'comment' then 'comment' else 'content' end;

  if p_action in ('remove', 'restore') and p_target_kind not in ('post', 'comment') then
    raise exception 'invalid_action';
  end if;
  if p_action = 'lift' and p_target_kind <> 'profile' then
    raise exception 'invalid_action';
  end if;
  if p_action in ('warn', 'suspend', 'ban') and v_subject is null then
    raise exception 'not_found';
  end if;
  if p_action = 'suspend' and (p_until is null or p_until <= now()) then
    raise exception 'until_required';
  end if;

  -- The content.
  if p_action = 'remove' then
    if p_target_kind = 'post' then
      update public.posts set hidden_reason = 'admin', hidden_at = now() where id = p_target_id;
    else
      update public.post_comments set hidden_reason = 'admin', hidden_at = now() where id = p_target_id;
    end if;
  elsif p_action = 'restore' or (p_action = 'dismiss' and p_target_kind in ('post', 'comment')) then
    if p_target_kind = 'post' then
      update public.posts set hidden_reason = null, hidden_at = null
      where id = p_target_id and (p_action = 'restore' or hidden_reason = 'reports');
    else
      update public.post_comments set hidden_reason = null, hidden_at = null
      where id = p_target_id and (p_action = 'restore' or hidden_reason = 'reports');
    end if;
  end if;

  -- The player.
  if p_action = 'suspend' then
    insert into public.account_restrictions (profile_id, kind, until, reason, admin_id)
    values (v_subject, 'suspend', p_until, v_reason, v_admin);
  elsif p_action = 'ban' then
    insert into public.account_restrictions (profile_id, kind, until, reason, admin_id)
    values (v_subject, 'ban', null, v_reason, v_admin);
  elsif p_action = 'lift' then
    update public.account_restrictions set lifted_at = now()
    where profile_id = v_subject and lifted_at is null;
  end if;

  -- The item's reports or flag are dealt with.
  if p_target_kind = 'flag' then
    update public.moderation_flags set resolved_at = now() where id = p_target_id and resolved_at is null;
  else
    update public.reports set resolved_at = now()
    where resolved_at is null
      and (coalesce(context_id, reported_user_id) = p_target_id
           or (p_target_kind = 'profile' and context = 'player' and reported_user_id = p_target_id));
  end if;

  insert into public.moderation_actions (admin_id, target_kind, target_id, subject_id, action, reason, until)
  values (v_admin, p_target_kind, p_target_id, v_subject, p_action, v_reason,
          case when p_action = 'suspend' then p_until end)
  returning id into v_action_id;

  -- The statement of reasons (DSA): what, why, and how to appeal.
  if p_action = 'remove' then
    perform public.send_notification(v_subject, 'content_removed', jsonb_build_object(
      'title', initcap(v_what) || ' removed',
      'body', format('Your %s was removed: %s. Appeal: %s', v_what, v_reason, public.moderation_appeal_email()),
      p_target_kind || '_id', p_target_id, 'action_id', v_action_id));
  elsif p_action = 'warn' then
    perform public.send_notification(v_subject, 'account_warned', jsonb_build_object(
      'title', 'Warning',
      'body', format('You broke our community guidelines: %s. Appeal: %s', v_reason, public.moderation_appeal_email()),
      'action_id', v_action_id));
  elsif p_action = 'suspend' then
    perform public.send_notification(v_subject, 'account_restricted', jsonb_build_object(
      'title', 'Account suspended',
      'body', format('You can''t post, comment or like until %s: %s. Appeal: %s',
                     to_char(p_until at time zone 'Asia/Nicosia', 'DD/MM/YYYY HH24:MI'), v_reason,
                     public.moderation_appeal_email()),
      'until', p_until, 'action_id', v_action_id));
  elsif p_action = 'ban' then
    perform public.send_notification(v_subject, 'account_restricted', jsonb_build_object(
      'title', 'Account banned',
      'body', format('You can no longer post, comment or like: %s. Appeal: %s', v_reason, public.moderation_appeal_email()),
      'action_id', v_action_id));
  end if;

  return v_action_id;
end;
$$;

-- ---- 6. Photos never posted: deleted after 24 hours ---------------------------------------

-- The daily futty-ai-cleanup job removes these through the Storage API.
create function public.post_photos_pending_expired(p_limit integer default 500)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'post-photos'
    and o.name like 'pending/%'
    and o.created_at < now() - interval '24 hours'
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

-- ---- 7. Account deletion -------------------------------------------------------------------

-- delete-account: the player's posts (with everyone's likes and comments on
-- them), their own likes and comments elsewhere, agreements, flags and age
-- signals. Returns the storage paths to remove: the posts' photos and any
-- unposted uploads. Reports and the founders' action log are kept (the
-- moderation record).
create function public.delete_account_posts(p_profile_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  select coalesce(array_agg(ph.path), '{}') into v_paths
  from public.post_photos ph
  join public.posts p on p.id = ph.post_id
  where p.author_id = p_profile_id;

  select v_paths || coalesce(array_agg(o.name), '{}') into v_paths
  from storage.objects o
  where o.bucket_id = 'post-photos' and o.name like 'pending/' || p_profile_id::text || '/%';

  delete from public.post_likes where profile_id = p_profile_id;
  delete from public.post_comments where author_id = p_profile_id;
  delete from public.posts where author_id = p_profile_id;
  delete from public.guideline_agreements where profile_id = p_profile_id;
  delete from public.moderation_flags where profile_id = p_profile_id;
  delete from public.age_signal_reports where profile_id = p_profile_id;
  return v_paths;
end;
$$;

-- ---- 8. Founders can open every post photo (the queue) -----------------------------------

-- post_photo_readable, re-created from its definition in
-- 20261127230000_match_s7b_posts.sql. Added: an admin reads any post photo,
-- hidden or not, to review it.
create or replace function public.post_photo_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if auth.uid() is null or v_parts is null then
    return false;
  end if;
  if v_parts[1] = 'pending' then
    return v_parts[2] = auth.uid()::text;
  end if;
  if v_parts[1] = 'posts' and v_parts[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.is_app_admin()
        or ((public.app_rules_now()).posts_enabled and public.post_visible_to(auth.uid(), v_parts[2]::uuid));
  end if;
  return false;
end;
$$;

-- ---- 9. Grants ------------------------------------------------------------------------------

revoke all on function public.moderation_appeal_email() from public, anon, authenticated;
revoke all on function public.moderation_actions_append_only() from public, anon, authenticated;
revoke all on function public.reports_bind_target() from public, anon, authenticated;
revoke all on function public.reports_auto_hide() from public, anon, authenticated;
revoke all on function public.add_moderation_flag(text, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.record_check_flag(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.post_photos_pending_expired(integer) from public, anon, authenticated;
revoke all on function public.delete_account_posts(uuid) from public, anon, authenticated;
grant execute on function public.moderation_appeal_email() to service_role;
grant execute on function public.add_moderation_flag(text, uuid, jsonb, boolean) to service_role;
grant execute on function public.record_check_flag(uuid, text, jsonb) to service_role;
grant execute on function public.post_photos_pending_expired(integer) to service_role;
grant execute on function public.delete_account_posts(uuid) to service_role;

-- Signed in (the admin ones check app_admins themselves).
revoke all on function public.report_declared_age_range(integer, integer, text) from public, anon;
revoke all on function public.admin_moderation_queue() from public, anon;
revoke all on function public.admin_moderation_item(text, uuid) from public, anon;
revoke all on function public.admin_moderate(text, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.report_declared_age_range(integer, integer, text) to authenticated, service_role;
grant execute on function public.admin_moderation_queue() to authenticated, service_role;
grant execute on function public.admin_moderation_item(text, uuid) to authenticated, service_role;
grant execute on function public.admin_moderate(text, uuid, text, text, timestamptz) to authenticated, service_role;

revoke all on function public.post_photo_readable(text) from public, anon;
grant execute on function public.post_photo_readable(text) to authenticated, service_role;
