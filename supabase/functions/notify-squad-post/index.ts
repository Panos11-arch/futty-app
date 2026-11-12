// Sends a push notification to everyone who follows the poster of a
// 'players' post, via Expo's push API. An 'opposition' post is not pushed
// here: the team's followers get followed_team_opponent_wanted through
// send_notification (A3b, see handler.ts). Triggered by a Supabase Database Webhook on squad_posts INSERT —
// see the deployment steps at the bottom of this file. Nothing calls this
// function directly from the app.
//
// Requires: real push registration to exist first (supabase/push-
// notifications.sql + lib/push-notifications.ts), and an EAS project to be
// configured (this app has neither set up yet — see AGENTS notes elsewhere).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { followerTarget, type SquadPostRecord } from './handler.ts';

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by the
// Edge Functions runtime — do not set these as secrets yourself.
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// You DO need to set this one — see step 2 below. Without it, anyone who
// finds this function's URL could trigger notifications to your users.
const webhookSecret = Deno.env.get('WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (!webhookSecret || req.headers.get('x-webhook-secret') !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = await req.json();
  const post = payload.record as SquadPostRecord | undefined;

  if (payload.type !== 'INSERT' || !post) {
    return new Response('ignored', { status: 200 });
  }

  const target = followerTarget(post);
  if (!target) {
    return new Response(post.type === 'opposition' ? 'handled by send_notification' : 'no target', { status: 200 });
  }
  const { targetType, targetId } = target;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: follows } = await supabase
    .from('user_follows')
    .select('follower_id')
    .eq('target_type', targetType)
    .eq('target_id', targetId);

  const followerIds = (follows ?? []).map((row) => row.follower_id as string);
  if (followerIds.length === 0) {
    return new Response('no followers', { status: 200 });
  }

  const { data: tokenRows } = await supabase
    .from('push_tokens')
    .select('token')
    .in('profile_id', followerIds);

  if (!tokenRows || tokenRows.length === 0) {
    return new Response('no tokens', { status: 200 });
  }

  const { data: venue } = await supabase
    .from('venues')
    .select('name')
    .eq('id', post.venue_id)
    .maybeSingle();
  const venueName = venue?.name ?? 'a venue';

  let who = 'Someone you follow';
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', targetId)
    .maybeSingle();
  if (profile?.username) who = profile.username;

  const title = 'Looking for players';
  const body = `${who} needs players at ${venueName}`;

  const messages = tokenRows.map((row) => ({
    to: row.token as string,
    sound: 'default',
    title,
    body,
    data: { postId: post.id, postType: post.type },
  }));

  // Expo's push API accepts at most 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response('sent', { status: 200 });
});

/*
DEPLOYMENT — none of this happens automatically, unlike the SQL files:

0. A3b (12 November): redeploy this function together with the migration
   20261112000801_match_followed_teams.sql. That migration's squad_posts
   trigger tells team followers about an opposition post through
   send_notification; this function no longer does. The migration alone,
   with the old function still deployed, pushes them twice.

1. Install the Supabase CLI and log in:
     npm install -g supabase
     supabase login
     supabase link --project-ref ospztpemchfpvvostisw

2. Set a random secret (used to authenticate the webhook call to this
   function — pick any long random string, e.g. from a password generator):
     supabase secrets set WEBHOOK_SECRET=<your-random-string>

3. Deploy this function:
     supabase functions deploy notify-squad-post

4. In the Supabase dashboard: Database > Webhooks > Create a new webhook
     - Table: squad_posts
     - Events: Insert
     - Type: Supabase Edge Function (or HTTP Request to the function's URL,
       shown after deploying)
     - Add an HTTP header: x-webhook-secret: <the same random string>

5. Separately, get push notifications working at all in the app:
     - Run an EAS project setup (`eas init`) to get a real projectId — the
       app currently has none, and lib/push-notifications.ts fails cleanly
       with 'no_project_id' until this exists.
     - Build a development build (`eas build --profile development`) — as of
       Expo SDK 53+, Android cannot receive push notifications in Expo Go at
       all; a development build is required to test this on Android.
*/
