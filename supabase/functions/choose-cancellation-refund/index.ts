// A player chooses card refund or venue credit for a share given back after
// a cancellation. See handler.ts.
//
// Body: { lineId, choice: 'card' | 'credit' }, where lineId is the
// cancellationLineId in the player's "Game cancelled" notification.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { getCallerId } from '../_shared/caller.ts';
import { dbFromSupabase } from '../_shared/db.ts';
import { type Body, chooseCancellationRefund } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  const callerId = await getCallerId(req);
  if (!callerId) return new Response('Unauthorized', { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const result = await chooseCancellationRefund(
    { stripe, db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)) },
    callerId,
    body,
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT (not done in P4b; ships with P5, after the pay_cancellations
migrations):
  supabase functions deploy choose-cancellation-refund
Uses the existing STRIPE_SECRET_KEY secret. Keeps normal JWT verification.
*/
