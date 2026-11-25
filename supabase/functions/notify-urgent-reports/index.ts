// Scheduled job (pg_cron + pg_net, every 5 minutes): emails the founders
// about reports that involve a minor (A7). See handler.ts. Authenticated by
// the cron secret, like notify-send-pushes.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { dbFromSupabase } from '../_shared/db.ts';
import { resendSender, sendUrgentReportEmails } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
const resendApiKey = Deno.env.get('RESEND_API_KEY');
const foundersEmail = Deno.env.get('FOUNDERS_EMAIL');
const fromEmail = Deno.env.get('ALERTS_FROM_EMAIL') ?? 'Futty <alerts@futty.app>';

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!resendApiKey || !foundersEmail) {
    console.error('notify-urgent-reports: RESEND_API_KEY or FOUNDERS_EMAIL is not set');
    return new Response('not configured', { status: 500 });
  }
  const db = dbFromSupabase(createClient(supabaseUrl, serviceRoleKey));
  try {
    const summary = await sendUrgentReportEmails({
      db,
      sendEmail: resendSender(fetch, resendApiKey, fromEmail, foundersEmail),
    });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('notify-urgent-reports failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (Panos):
//
// 1. Secrets: RESEND_API_KEY (a Resend account with futty.app verified as a
//    sending domain), FOUNDERS_EMAIL (comma separated), and optionally
//    ALERTS_FROM_EMAIL (default "Futty <alerts@futty.app>"). Uses the
//    existing CRON_SECRET.
//
// 2. Deploy WITHOUT JWT verification (pg_net calls it with the cron secret):
//      supabase functions deploy notify-urgent-reports --no-verify-jwt
//
// 3. Schedule it every 5 minutes:
//      select cron.schedule('notify-urgent-reports', '*/5 * * * *', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/notify-urgent-reports',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//        );
//      $$);
