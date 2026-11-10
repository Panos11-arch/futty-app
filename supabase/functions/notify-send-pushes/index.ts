// Scheduled job (pg_cron + pg_net, every minute): sends the pushes that
// send_notification queued. See handler.ts. Authenticated by the cron
// secret, like run-payment-jobs.
//
// This is the only push path for send_notification. Nothing pushes on a
// notifications insert (no trigger or Database Webhook on that table in the
// repo); notify-squad-post, notify-squad-post-created and
// notify-opposition-matched push their own events, which don't go through
// send_notification.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { dbFromSupabase } from '../_shared/db.ts';
import { expoSender, sendPushes } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
// Optional: only needed if "enhanced push security" is turned on in Expo.
const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') ?? undefined;

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const db = dbFromSupabase(createClient(supabaseUrl, serviceRoleKey));
  try {
    const summary = await sendPushes({ db, sendExpo: expoSender(fetch, expoAccessToken) });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('notify-send-pushes failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (Panos, with the next push of the match_* migrations):
//
// 1. Uses the existing CRON_SECRET secret (and EXPO_ACCESS_TOKEN if set).
//
// 2. Deploy WITHOUT JWT verification (pg_net calls it with the cron secret):
//      supabase functions deploy notify-send-pushes --no-verify-jwt
//
// 3. Schedule it every minute, like run-payment-jobs:
//      select cron.schedule('notify-send-pushes', '* * * * *', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/notify-send-pushes',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//        );
//      $$);
//
// 4. The match jobs (scheduled → played, the 24-hour result deadline,
//    voiding cancelled bookings' matches) are SQL only; schedule them every
//    15 minutes:
//      select cron.schedule('match-jobs-tick', '*/15 * * * *', $$ select public.match_jobs_tick() $$);
//
// 5. Check that no Database Webhook on public.notifications INSERT was set
//    up by hand in the dashboard: it would push a notification a second time.
