// The booker replaces the card behind their guarantee. See handler.ts.
//
// Body: { bookingId }. Returns { setupIntentClientSecret, customerId } for
// the app to confirm on-session (3-D Secure included).

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { getCallerId } from '../_shared/caller.ts';
import { dbFromSupabase } from '../_shared/db.ts';
import { updateGuaranteeCard } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  const callerId = await getCallerId(req);
  if (!callerId) return new Response('Unauthorized', { status: 401 });

  let body: { bookingId?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const result = await updateGuaranteeCard(
    { stripe, db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)) },
    callerId,
    { bookingId: typeof body.bookingId === 'string' ? body.bookingId : undefined },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT (not done in P4a; ships with P5, after the pay_modes migrations):
  supabase functions deploy update-guarantee-card
Uses the existing STRIPE_SECRET_KEY secret. Keeps normal JWT verification.
*/
