// Scheduled job (pg_cron + pg_net, every 5 minutes): takes shares 60 minutes
// after they were held and places the bookers' guarantee holds. See
// handler.ts. Authenticated by the cron secret, like cancel-unpaid-bookings.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { runPaymentJobs } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const db = dbFromSupabase(createClient(supabaseUrl, serviceRoleKey));
  try {
    const summary = await runPaymentJobs({ stripe, db });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('run-payment-jobs failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (not done in P4a; ships with P5):
//
// 1. Uses the existing STRIPE_SECRET_KEY and CRON_SECRET secrets.
//
// 2. Deploy WITHOUT JWT verification (pg_net calls it with the cron secret):
//      supabase functions deploy run-payment-jobs --no-verify-jwt
//
// 3. Schedule it every 5 minutes, the same way as cancel-unpaid-bookings:
//      select cron.schedule('run-payment-jobs', '*/5 * * * *', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/run-payment-jobs',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//        );
//      $$);
//    A share is taken on the first run at or after 60 minutes, so 60-65
//    minutes after its hold; never before.
