// Scheduled job (pg_cron + pg_net): venue payouts. See handler.ts.
// Authenticated by the cron secret, like run-collection.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { isLiveKey } from '../_shared/stripe-mode.ts';
import { runPayouts } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeKey);
const livemode = isLiveKey(stripeKey);

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const db = dbFromSupabase(createClient(supabaseUrl, serviceRoleKey));
  try {
    const summary = await runPayouts({ stripe, db, livemode });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('run-payouts failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (Panos, after the pay_payouts migrations):
//
// 1. Uses the existing STRIPE_SECRET_KEY and CRON_SECRET secrets.
//
// 2. Deploy WITHOUT JWT verification (pg_net calls it with the cron secret):
//      supabase functions deploy run-payouts --no-verify-jwt
//
// 3. Schedule it every 5 minutes:
//      select cron.schedule('run-payouts', '*/5 * * * *', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/run-payouts',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//        );
//      $$);
//    A booking's transfer goes on the first run after its money is final.
