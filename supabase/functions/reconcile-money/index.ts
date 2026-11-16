// Scheduled job (pg_cron + pg_net), daily: the money check. See handler.ts.
// Authenticated by the cron secret, like run-collection.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { dbFromSupabase } from '../_shared/db.ts';
import { reconcileMoney } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const summary = await reconcileMoney({ db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)) });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('reconcile-money failed:', err);
    return new Response('failed', { status: 500 });
  }
});

// DEPLOYMENT (Panos, after the pay_payouts migrations):
//   supabase functions deploy reconcile-money --no-verify-jwt
// Schedule it daily (04:00 UTC, after the night's runs):
//   select cron.schedule('reconcile-money', '0 4 * * *', $$
//     select net.http_post(
//       url := 'https://<project-ref>.supabase.co/functions/v1/reconcile-money',
//       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
//     );
//   $$);
