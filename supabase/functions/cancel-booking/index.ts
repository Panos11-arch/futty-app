// Cancels a booking and gives the money back. The only path in: client-side
// calls to the cancel_booking RPC are revoked, so a cancellation can't
// happen without the release and refund alongside it. See handler.ts.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { getCallerId } from '../_shared/caller.ts';
import { dbFromSupabase } from '../_shared/db.ts';
import { cancelBooking } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  const callerId = await getCallerId(req);
  if (!callerId) return new Response('Unauthorized', { status: 401 });

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!body.bookingId) return new Response('Missing bookingId', { status: 400 });

  const result = await cancelBooking(
    { stripe, db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)) },
    callerId,
    body.bookingId,
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT (not done in P4a; ships with P5, after the pay_modes migrations):

  supabase functions deploy cancel-booking

Uses the existing STRIPE_SECRET_KEY secret. Keeps normal JWT verification,
since the app's own signed-in user calls it.
*/
