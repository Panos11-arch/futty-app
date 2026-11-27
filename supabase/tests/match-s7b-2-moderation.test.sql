-- S7b: moderation of posts and comments (20261127230100_match_s7b_moderation.sql).
-- Reports bound to the item's author, 3 different reporters hide it, urgent
-- alerts for anything involving an under-18, the founders' queue (admins
-- only, urgent then oldest first, age in hours), every action logged with a
-- statement of reasons, suspensions and bans, flags from the automatic
-- checks and the age range, the 24-hour cleanup of unposted photos, and
-- account deletion.
begin;

create temporary table s7m (k text primary key, v uuid) on commit drop;
grant all on s7m to authenticated, anon, service_role;

create function tests.s7m(p_key text) returns uuid language sql stable as $$ select v from s7m where k = p_key $$;

create function tests.s7m_user(p_key text, p_dob timestamp)
returns uuid
language plpgsql
as $$
declare
  v uuid := tests.create_user(p_key || '@s7m.test', jsonb_build_object('date_of_birth', p_dob::date, 'full_name', initcap(p_key) || ' Surname'));
begin
  update public.profiles set date_of_birth = p_dob::date, city = 'Larnaca' where id = v;
  insert into public.guideline_agreements (profile_id, version) values (v, 1);
  insert into s7m values (p_key, v);
  return v;
end;
$$;

create function tests.s7m_value(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as(p_user);
  execute p_sql into v;
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s7m_post(p_author uuid, p_body text default 'Hello')
returns uuid
language plpgsql
as $$
declare
  v uuid;
begin
  perform tests.act_as_service_role();
  v := public.create_post_internal(p_author, gen_random_uuid(), p_body, 'everyone', null, 0);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s7m_comment(p_author uuid, p_post uuid, p_body text default 'Hi')
returns uuid
language plpgsql
as $$
declare
  v uuid;
begin
  perform tests.act_as_service_role();
  v := public.add_comment_internal(p_author, p_post, p_body);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- p_user reports an item the way the app does (a direct insert, lib/moderation).
create function tests.s7m_report(p_user uuid, p_context text, p_id uuid, p_reason text default 'Abuse')
returns text
language sql
as $$
  select tests.error_as(p_user, format(
    $q$insert into public.reports (reporter_id, context, context_id, reason) values (%L, %L, %L, %L)$q$,
    p_user, p_context, p_id, p_reason));
$$;

create function tests.s7m_post_error(p_author uuid)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  v := tests.error_of(format($q$select public.create_post_internal(%L, gen_random_uuid(), 'x', 'everyone', null, 0)$q$, p_author));
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s7m_comment_error(p_author uuid, p_post uuid)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  v := tests.error_of(format($q$select public.add_comment_internal(%L, %L, 'x')$q$, p_author, p_post));
  perform tests.act_as_postgres();
  return v;
end;
$$;

do $$
declare
  v_minor timestamp := tests.cyprus_today() - interval '16 years';
begin
  perform tests.s7m_user('ann', '1990-05-05');
  perform tests.s7m_user('bob', '1991-05-05');
  perform tests.s7m_user('cat', '1992-05-05');
  perform tests.s7m_user('dov', '1993-05-05');
  perform tests.s7m_user('kim', v_minor);
  perform tests.s7m_user('kai', v_minor);
  perform tests.s7m_user('kit', v_minor);
  perform tests.s7m_user('kya', v_minor);
  insert into s7m values ('boss', tests.s10a_admin('boss@s7m.test'));
  update public.app_rules set posts_enabled = true;
end $$;

-- ---- Reports: bound to the author, deduplicated, never for unseen items ------------------
do $$
declare
  ann uuid := tests.s7m('ann');
  bob uuid := tests.s7m('bob');
  kim uuid := tests.s7m('kim');
  p uuid := tests.s7m_post(ann);
  c uuid := tests.s7m_comment(bob, p);
begin
  -- The app may send any reported_user_id: the server sets the author.
  assert tests.error_as(bob, format(
    $q$insert into public.reports (reporter_id, reported_user_id, context, context_id, reason) values (%L, %L, 'post', %L, 'x')$q$,
    bob, kim, p)) is null, 'Bob reports Ann''s post, naming someone else';
  assert (select reported_user_id from public.reports where reporter_id = bob and context_id = p) = ann,
    'the reported player is the author';
  assert tests.s7m_report(bob, 'post', p) is null, 'a second report by Bob is accepted quietly';
  assert (select count(*) from public.reports where reporter_id = bob and context_id = p) = 1, '... and dropped';
  assert tests.s7m_report(ann, 'post', p) = 'cannot_report_self', 'nobody reports their own post';
  assert tests.s7m_report(kim, 'post', p) = 'not_found', 'a minor can''t report an adult''s post they can''t see';
  assert tests.s7m_report(ann, 'comment', c) is null, 'Ann reports Bob''s comment';
  assert (select reported_user_id from public.reports where reporter_id = ann and context_id = c) = bob, 'the comment''s author';
  assert tests.s7m_report(ann, 'post', null) = 'report_target_required', 'a post report needs the post';
  -- Not urgent: adults only.
  assert not (select bool_or(urgent) from public.reports where context_id in (p, c)), 'adults only: not urgent';
  delete from public.reports where context_id in (p, c);
  delete from public.posts where id = p;
end $$;

-- ---- 3 reports from different people hide the item --------------------------------------
do $$
declare
  ann uuid := tests.s7m('ann');
  bob uuid := tests.s7m('bob');
  cat uuid := tests.s7m('cat');
  dov uuid := tests.s7m('dov');
  p uuid := tests.s7m_post(ann);
  q uuid := tests.s7m_post(ann, 'Another');
  c uuid := tests.s7m_comment(bob, q);
begin
  perform tests.s7m_report(bob, 'post', p);
  perform tests.s7m_report(bob, 'post', p);
  perform tests.s7m_report(cat, 'post', p);
  assert (select hidden_reason from public.posts where id = p) is null, '2 different reporters: still shown';
  perform tests.s7m_report(dov, 'post', p);
  assert (select hidden_reason from public.posts where id = p) = 'reports', '3 different reporters: hidden';
  assert tests.error_as(bob, format('select public.get_post(%L)', p)) = 'post_not_found', 'hidden from others';
  assert (tests.s7m_value(ann, format('select public.get_post(%L)', p))::jsonb ->> 'hidden')::boolean,
    'the author still sees it, marked hidden';
  -- The notice to the author is off until Panos decides (one rule update).
  assert tests.notified(ann, 'content_hidden') = 0, 'no hidden notice while the rule is off';

  -- Comments the same way.
  perform tests.s7m_report(ann, 'comment', c);
  perform tests.s7m_report(cat, 'comment', c);
  update public.app_rules set posts_auto_hide_notice = true;
  perform tests.s7m_report(dov, 'comment', c);
  assert (select hidden_reason from public.post_comments where id = c) = 'reports', 'a comment hidden after 3';
  assert tests.notified(bob, 'content_hidden') = 1, 'with the rule on, the author is told';
  assert (tests.last_notification(bob, 'content_hidden')).body = 'Hidden while we review it.', 'the hidden notice text';
  assert tests.s7m_value(cat, format('select count(*) from public.post_comments_page(%L)', q))::int = 0, 'hidden from others';
  update public.app_rules set posts_auto_hide_notice = false;
  delete from public.reports where context_id in (p, c);
  delete from public.posts where id in (p, q);
end $$;

-- ---- Anything involving an under-18 is urgent and emailed -------------------------------
do $$
declare
  kim uuid := tests.s7m('kim');
  kai uuid := tests.s7m('kai');
  p uuid := tests.s7m_post(kim);
  c uuid := tests.s7m_comment(kim, p);
  v_alerts integer := (select count(*) from public.admin_alerts where kind = 'minor_report');
begin
  assert tests.s7m_report(kai, 'post', p) is null, 'a minor reports a minor''s post';
  assert (select urgent from public.reports where context_id = p), 'a minor''s post report is urgent';
  assert tests.s7m_report(kai, 'comment', c) is null, 'and the comment';
  assert (select urgent from public.reports where context_id = c), 'a minor''s comment report is urgent';
  assert (select count(*) from public.admin_alerts where kind = 'minor_report') = v_alerts + 2, 'two founder alerts';
  perform tests.act_as_service_role();
  assert (select count(*) from public.urgent_report_alerts_due() d where d.report_id in
          (select id from public.reports where context_id in (p, c))) = 2, 'both are due for the email';
  perform tests.act_as_postgres();
  delete from public.reports where context_id in (p, c);
  delete from public.posts where id = p;
end $$;

-- ---- The queue: founders only; urgent first, then oldest; age in hours -------------------
do $$
declare
  ann uuid := tests.s7m('ann');
  bob uuid := tests.s7m('bob');
  kim uuid := tests.s7m('kim');
  kai uuid := tests.s7m('kai');
  boss uuid := tests.s7m('boss');
  old_post uuid := tests.s7m_post(ann, 'Old');
  new_post uuid := tests.s7m_post(ann, 'New');
  minor_post uuid := tests.s7m_post(kim, 'Minor');
  q jsonb;
begin
  perform tests.s7m_report(bob, 'post', new_post, 'Spam');
  perform tests.s7m_report(bob, 'post', old_post, 'Rude');
  update public.reports set created_at = now() - interval '13 hours' where context_id = old_post;
  perform tests.s7m_report(kai, 'post', minor_post, 'Bullying');
  update public.reports set created_at = now() - interval '1 hour' where context_id = minor_post;

  assert tests.error_as(bob, 'select * from public.admin_moderation_queue()') = 'not_admin', 'players can''t open the queue';
  assert tests.error_as(bob, format($q$select public.admin_moderate('post', %L, 'remove', 'x')$q$, new_post)) = 'not_admin',
    'players can''t moderate';
  assert tests.error_as(bob, format($q$select public.admin_moderation_item('post', %L)$q$, new_post)) = 'not_admin',
    'players can''t open an item';

  q := tests.s7m_value(boss, $q$select jsonb_agg(jsonb_build_object('id', target_id, 'urgent', urgent, 'age', age_hours,
        'over', over_12h, 'preview', preview, 'reasons', reasons, 'kind', target_kind, 'name', subject_name))
        from public.admin_moderation_queue()$q$)::jsonb;
  assert jsonb_array_length(q) >= 3, format('three items: %s', q);
  assert (q -> 0 ->> 'id')::uuid = minor_post and (q -> 0 ->> 'urgent')::boolean, 'urgent first';
  assert (q -> 1 ->> 'id')::uuid = old_post, 'then the oldest';
  assert (q -> 2 ->> 'id')::uuid = new_post, 'then the newest';
  assert (q -> 1 ->> 'age')::int = 13 and (q -> 1 ->> 'over')::boolean, 'a 13-hour item is over 12 hours';
  assert (q -> 0 ->> 'age')::int = 1 and not (q -> 0 ->> 'over')::boolean, 'a 1-hour item is not';
  assert q -> 1 ->> 'preview' = 'Old' and q -> 1 -> 'reasons' = '["Rude"]'::jsonb and q -> 1 ->> 'kind' = 'post'
     and q -> 1 ->> 'name' = 'Ann Surname', 'preview, reasons and who';
  assert tests.s7m_value(boss, format($q$select public.admin_moderation_item('post', %L)$q$, old_post))::jsonb
         -> 'reports' -> 0 ->> 'reason' = 'Rude', 'the item shows its reports';

  -- Dismiss resolves the reports: off the queue.
  perform tests.s7m_value(boss, format($q$select public.admin_moderate('post', %L, 'dismiss', 'Not against the rules')$q$, new_post));
  assert not exists (select 1 from public.reports where context_id = new_post and resolved_at is null), 'dismissed: resolved';
  assert tests.s7m_value(boss, format('select count(*) from public.admin_moderation_queue() where target_id = %L', new_post))::int = 0,
    'dismissed: off the queue';
  delete from public.reports where context_id in (old_post, new_post, minor_post);
  delete from public.posts where id in (old_post, new_post, minor_post);
end $$;

-- ---- Actions: logged, with a statement of reasons -----------------------------------------
do $$
declare
  ann uuid := tests.s7m('ann');
  bob uuid := tests.s7m('bob');
  cat uuid := tests.s7m('cat');
  boss uuid := tests.s7m('boss');
  p uuid := tests.s7m_post(ann, 'Bad');
  c uuid := tests.s7m_comment(bob, p, 'Worse');
  n public.notifications;
  a uuid;
begin
  perform tests.s7m_report(cat, 'post', p);
  assert tests.error_as(boss, format($q$select public.admin_moderate('post', %L, 'remove', '  ')$q$, p)) = 'reason_required',
    'a reason is required';
  a := tests.s7m_value(boss, format($q$select public.admin_moderate('post', %L, 'remove', 'Hate speech')$q$, p))::uuid;
  assert (select hidden_reason from public.posts where id = p) = 'admin', 'removed: hidden';
  assert tests.error_as(cat, format('select public.get_post(%L)', p)) = 'post_not_found', 'removed: gone for others';
  assert (select row(admin_id, target_kind, target_id, subject_id, action, reason)::text from public.moderation_actions where id = a)
       = row(boss, 'post', p, ann, 'remove', 'Hate speech')::text, 'logged: who, what and why';
  n := tests.last_notification(ann, 'content_removed');
  assert n.title = 'Post removed' and n.body = 'Your post was removed: Hate speech. Appeal: safety@futty.app',
    format('statement of reasons: %s / %s', n.title, n.body);
  assert (select always_sent from public.notification_types where type = 'content_removed'), 'always sent';
  assert not exists (select 1 from public.reports where context_id = p and resolved_at is null), 'its reports are resolved';

  perform tests.s7m_value(boss, format($q$select public.admin_moderate('comment', %L, 'remove', 'Insult')$q$, c));
  assert (tests.last_notification(bob, 'content_removed')).body = 'Your comment was removed: Insult. Appeal: safety@futty.app',
    'a removed comment''s statement';
  perform tests.s7m_value(boss, format($q$select public.admin_moderate('post', %L, 'restore', 'Appeal upheld')$q$, p));
  assert (select hidden_reason from public.posts where id = p) is null, 'restored';

  perform tests.s7m_value(boss, format($q$select public.admin_moderate('profile', %L, 'warn', 'Spam')$q$, ann));
  assert (tests.last_notification(ann, 'account_warned')).body = 'You broke our community guidelines: Spam. Appeal: safety@futty.app',
    'a warning''s statement';
  assert tests.error_as(boss, format($q$select public.admin_moderate('profile', %L, 'remove', 'x')$q$, ann)) = 'invalid_action',
    'remove is for posts and comments';
  assert tests.error_as(boss, format($q$select public.admin_moderate('post', %L, 'explode', 'x')$q$, p)) = 'invalid_action',
    'an unknown action';
  assert tests.error_as(boss, format($q$select public.admin_moderate('post', %L, 'remove', 'x')$q$, gen_random_uuid())) = 'not_found',
    'an unknown item';

  -- The log can't be changed or removed, not even by the service role.
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$update public.moderation_actions set reason = 'x' where id = %L$q$, a)) = 'moderation_log_append_only',
    'the log can''t be edited';
  assert tests.error_of(format('delete from public.moderation_actions where id = %L', a)) = 'moderation_log_append_only',
    'the log can''t be deleted';
  perform tests.act_as_postgres();
  assert tests.error_as(ann, 'select * from public.moderation_actions') like 'permission denied%', 'players can''t read the log';
  assert (select count(*) from public.moderation_actions where target_id in (p, c, ann)) = 4, 'four actions logged';
  delete from public.reports where context_id = p;
  delete from public.posts where id = p;
end $$;

-- ---- Suspended or banned players can't post, comment or like ------------------------------
do $$
declare
  ann uuid := tests.s7m('ann');
  bob uuid := tests.s7m('bob');
  boss uuid := tests.s7m('boss');
  bob_post uuid := tests.s7m_post(bob, 'Mine');
  ann_post uuid := tests.s7m_post(ann);
  bob_comment uuid := tests.s7m_comment(bob, ann_post, 'Comment');
  n public.notifications;
begin
  assert tests.error_as(boss, format($q$select public.admin_moderate('profile', %L, 'suspend', 'Spam')$q$, bob)) = 'until_required',
    'a suspension needs an end';
  assert tests.error_as(boss, format($q$select public.admin_moderate('profile', %L, 'suspend', 'Spam', now() - interval '1 day')$q$, bob))
    = 'until_required', 'an end in the future';
  perform tests.s7m_value(boss, format($q$select public.admin_moderate('profile', %L, 'suspend', 'Spam', %L)$q$,
                                       bob, now() + interval '7 days'));
  n := tests.last_notification(bob, 'account_restricted');
  assert n.title = 'Account suspended' and n.body like 'You can''t post, comment or like until %: Spam. Appeal: safety@futty.app',
    format('suspension statement: %s', n.body);
  assert tests.s7m_post_error(bob) = 'account_suspended', 'suspended: no posting';
  assert tests.s7m_comment_error(bob, ann_post) = 'account_suspended', 'suspended: no comments';
  assert tests.error_as(bob, format('select public.toggle_like(%L)', ann_post)) = 'account_suspended', 'suspended: no likes';
  assert tests.error_as(bob, format($q$insert into storage.objects (bucket_id, name) values ('post-photos', 'pending/%s/a.jpg')$q$, bob))
    is not null, 'suspended: no uploads';
  assert tests.error_as(ann, format('select public.get_post(%L)', bob_post)) is null, 'a suspension doesn''t hide content';
  -- Once it ends.
  update public.account_restrictions set until = now() - interval '1 second', created_at = now() - interval '8 days'
  where profile_id = bob;
  assert tests.s7m_post_error(bob) is null, 'the suspension ended: posting again';

  -- A ban: nothing, and their content is hidden while banned.
  perform tests.s7m_value(boss, format($q$select public.admin_moderate('profile', %L, 'ban', 'Threats')$q$, bob));
  assert exists (select 1 from public.notifications where profile_id = bob and type = 'account_restricted'
                 and title = 'Account banned' and body = 'You can no longer post, comment or like: Threats. Appeal: safety@futty.app'),
    'ban statement';
  assert tests.s7m_post_error(bob) = 'account_banned', 'banned: no posting';
  assert tests.s7m_comment_error(bob, ann_post) = 'account_banned', 'banned: no comments';
  assert tests.error_as(bob, format('select public.toggle_like(%L)', ann_post)) = 'account_banned', 'banned: no likes';
  assert tests.error_as(ann, format('select public.get_post(%L)', bob_post)) = 'post_not_found', 'banned: posts hidden';
  assert tests.s7m_value(ann, format('select count(*) from public.post_comments_page(%L)', ann_post))::int = 0,
    'banned: comments hidden';
  -- Lifted.
  perform tests.s7m_value(boss, format($q$select public.admin_moderate('profile', %L, 'lift', 'Appeal upheld')$q$, bob));
  assert tests.error_as(ann, format('select public.get_post(%L)', bob_post)) is null, 'lifted: shown again';
  assert tests.s7m_post_error(bob) is null, 'lifted: posting again';
  delete from public.posts where author_id in (ann, bob);
end $$;

-- ---- Flags: the automatic checks and the age range ----------------------------------------
do $$
declare
  ann uuid := tests.s7m('ann');
  kim uuid := tests.s7m('kim');
  boss uuid := tests.s7m('boss');
  f uuid;
  v_alerts integer := (select count(*) from public.admin_alerts where kind = 'minor_report');
begin
  assert tests.error_as(ann, format($q$select public.record_check_flag(%L, 'auto_text', '{}')$q$, ann)) like 'permission denied%',
    'only community-post records check flags';
  perform tests.act_as_service_role();
  f := public.record_check_flag(ann, 'auto_text', '{"text": "bad words", "category": "harassment"}');
  perform public.record_check_flag(kim, 'auto_text', '{"text": "minor text"}');
  assert tests.error_of(format($q$select public.record_check_flag(%L, 'age_mismatch', '{}')$q$, ann)) = 'invalid_kind',
    'check flags are text or image';
  perform tests.act_as_postgres();
  assert not (select urgent from public.moderation_flags where id = f), 'an adult''s flag is not urgent';
  assert (select urgent from public.moderation_flags where profile_id = kim), 'a minor''s flag is urgent';
  assert (select count(*) from public.admin_alerts where kind = 'minor_report') = v_alerts + 1, 'and emailed';
  assert tests.s7m_value(boss, format('select preview from public.admin_moderation_queue() where target_id = %L', f)) = 'bad words',
    'the flag is in the queue';
  perform tests.s7m_value(boss, format($q$select public.admin_moderate('flag', %L, 'warn', 'Harassment')$q$, f));
  assert (select resolved_at is not null from public.moderation_flags where id = f), 'acting resolves the flag';
  assert tests.notified(ann, 'account_warned') >= 1, 'the flag''s player is warned';
end $$;

do $$
declare
  ann uuid := tests.s7m('ann');
  kim uuid := tests.s7m('kim');
  bob uuid := tests.s7m('bob');
  boss uuid := tests.s7m('boss');
  v_alerts integer := (select count(*) from public.admin_alerts where kind = 'minor_report');
begin
  -- Ann is 36 by her date of birth.
  assert tests.s7m_value(ann, $q$select public.report_declared_age_range(18, null, 'ios')$q$) = 'match', '18+: matches';
  assert tests.s7m_value(ann, $q$select public.report_declared_age_range(13, 15, 'ios')$q$) = 'too_soon', 'once a day per source';
  assert tests.s7m_value(ann, $q$select public.report_declared_age_range(13, 15, 'android')$q$) = 'mismatch',
    'a 13-15 range disagrees with an adult date of birth';
  assert exists (select 1 from public.moderation_flags where profile_id = ann and kind = 'age_mismatch' and urgent),
    'flagged, urgent (the phone says under 18)';
  assert (select count(*) from public.admin_alerts where kind = 'minor_report') = v_alerts + 1, 'emailed to the founders';
  assert tests.s7m_value(boss, format($q$select count(*) from public.admin_moderation_queue() where subject_id = %L and source = 'age_mismatch'$q$,
                                      ann))::int = 1, 'in the queue';
  -- Kim is 16: 16-17 matches; 18+ disagrees (still a flag, never a block).
  assert tests.s7m_value(kim, $q$select public.report_declared_age_range(16, 17, 'ios')$q$) = 'match', '16-17: matches';
  assert tests.s7m_value(kim, $q$select public.report_declared_age_range(18, null, 'android')$q$) = 'mismatch', '18+: mismatch';
  assert (select urgent from public.moderation_flags where profile_id = kim and kind = 'age_mismatch'), 'a minor''s mismatch is urgent';
  assert tests.error_as(kim, 'select public.my_post_defaults()') is null, 'a mismatch never blocks';
  -- Bad input.
  assert tests.error_as(bob, $q$select public.report_declared_age_range(18, null, 'web')$q$) = 'invalid_source', 'unknown source';
  assert tests.error_as(bob, $q$select public.report_declared_age_range(16, 13, 'ios')$q$) = 'invalid_range', 'upper below lower';
  update public.profiles set date_of_birth = null where id = bob;
  assert tests.s7m_value(bob, $q$select public.report_declared_age_range(18, null, 'ios')$q$) = 'no_date_of_birth', 'no date of birth';
  update public.profiles set date_of_birth = '1991-05-05' where id = bob;
  perform tests.act_as_anon();
  assert tests.error_of($q$select public.report_declared_age_range(18, null, 'ios')$q$) like 'permission denied%', 'signed out';
  perform tests.act_as_postgres();
end $$;

-- ---- Unposted photos: listed for removal after 24 hours ------------------------------------
do $$
declare
  ann uuid := tests.s7m('ann');
begin
  insert into storage.objects (bucket_id, name, created_at) values
    ('post-photos', 'pending/' || ann || '/old.jpg', now() - interval '25 hours'),
    ('post-photos', 'pending/' || ann || '/new.jpg', now() - interval '23 hours'),
    ('post-photos', 'posts/' || gen_random_uuid() || '/0.jpg', now() - interval '3 days');
  assert tests.error_as(ann, 'select * from public.post_photos_pending_expired()') like 'permission denied%', 'the job only';
  perform tests.act_as_service_role();
  assert (select array_agg(name) from public.post_photos_pending_expired()) = array['pending/' || ann || '/old.jpg'],
    'only pending files older than 24 hours';
  perform tests.act_as_postgres();
end $$;

-- ---- Deleting an account removes their posts, comments, likes and photos ------------------
do $$
declare
  ann uuid := tests.s7m('ann');
  bob uuid := tests.s7m('bob');
  boss uuid := tests.s7m('boss');
  ann_post uuid;
  bob_post uuid := tests.s7m_post(bob, 'Bob''s');
  paths text[];
begin
  perform tests.act_as_service_role();
  ann_post := public.create_post_internal(ann, gen_random_uuid(), 'With photo', 'everyone', null, 1);
  perform tests.act_as_postgres();
  perform tests.s7m_comment(bob, ann_post);
  perform tests.s7m_comment(ann, bob_post);
  perform tests.s7m_value(ann, format('select public.toggle_like(%L)', bob_post));
  perform tests.s7m_value(bob, format('select public.toggle_like(%L)', ann_post));
  perform tests.s7m_report(bob, 'post', ann_post);
  perform tests.s7m_value(boss, format($q$select public.admin_moderate('profile', %L, 'warn', 'x')$q$, ann));

  assert tests.error_as(ann, format('select public.delete_account_posts(%L)', ann)) like 'permission denied%',
    'delete-account only';
  perform tests.act_as_service_role();
  paths := public.delete_account_posts(ann);
  perform tests.act_as_postgres();
  assert 'posts/' || ann_post || '/0.jpg' = any (paths), 'her post photo is returned for removal';
  assert 'pending/' || ann || '/old.jpg' = any (paths), 'and her unposted uploads';
  assert not exists (select 1 from public.posts where author_id = ann), 'her posts are gone';
  assert not exists (select 1 from public.post_comments where author_id = ann), 'her comments are gone';
  assert not exists (select 1 from public.post_likes where profile_id = ann), 'her likes are gone';
  assert not exists (select 1 from public.post_comments where post_id = ann_post), 'comments on her post are gone';
  assert not exists (select 1 from public.guideline_agreements where profile_id = ann), 'her agreement is gone';
  assert not exists (select 1 from public.moderation_flags where profile_id = ann), 'her flags are gone';
  assert not exists (select 1 from public.age_signal_reports where profile_id = ann), 'her age signals are gone';
  assert exists (select 1 from public.posts where id = bob_post), 'Bob''s post stays';
  assert exists (select 1 from public.moderation_actions where subject_id = ann), 'the founders'' log is kept';
end $$;

rollback;
