// Scheduled job (pg_cron + pg_net, every minute): short-game warnings, the
// after-match cash prompt, debts to Futty, and collection 2 hours after the
// match. See handler.ts. Authenticated by the cron secret, like
// run-payment-jobs.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { runCollection } from './handler.ts';

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
    const summary = await runCollection({ stripe, db });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('run-collection failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (not done in P4c; ships with P5, after the pay_collection
// migrations):
//
// 1. Uses the existing STRIPE_SECRET_KEY and CRON_SECRET secrets.
//
// 2. Deploy WITHOUT JWT verification (pg_net calls it with the cron secret):
//      supabase functions deploy run-collection --no-verify-jwt
//
// 3. Schedule it every minute, like run-payment-jobs:
//      select cron.schedule('run-collection', '* * * * *', $$
//        select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/run-collection',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//        );
//      $$);
//    A booking is collected on the first run 2 hours after its match ends
//    (or after the venue asks, once it has ended).
