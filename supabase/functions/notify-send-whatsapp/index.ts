// Scheduled job (pg_cron + pg_net, every minute): sends the WhatsApp
// reminders that send_notification queued (A9). See handler.ts.
// Authenticated by the cron secret, like notify-send-pushes.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { dbFromSupabase } from '../_shared/db.ts';
import { cloudApiSender, sendWhatsApp } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
const token = Deno.env.get('WHATSAPP_TOKEN');
const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
const graphVersion = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!token || !phoneNumberId) {
    // Not set up yet: leave the messages queued rather than failing them.
    return new Response(JSON.stringify({ skipped: 'whatsapp_not_configured' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const db = dbFromSupabase(createClient(supabaseUrl, serviceRoleKey));
  try {
    const summary = await sendWhatsApp({ db, send: cloudApiSender({ token, phoneNumberId, graphVersion }) });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('notify-send-whatsapp failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (Panos, once the WhatsApp Business account and templates are
// approved; see docs/specs/whatsapp-templates.md):
//
// 1. Secrets: WHATSAPP_TOKEN (a permanent System User token),
//    WHATSAPP_PHONE_NUMBER_ID, and optionally WHATSAPP_GRAPH_VERSION. Uses
//    the existing CRON_SECRET.
//      supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...
//
// 2. Deploy WITHOUT JWT verification (pg_net calls it with the cron secret):
//      supabase functions deploy notify-send-whatsapp --no-verify-jwt
//
// 3. Schedule it every minute, like notify-send-pushes:
//      select cron.schedule('notify-send-whatsapp', '* * * * *', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/notify-send-whatsapp',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//        );
//      $$);
//
// Until the secrets are set it answers "whatsapp_not_configured" and sends
// nothing; players who chose WhatsApp still get the bell in the app.
