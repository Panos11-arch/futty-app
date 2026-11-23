// "Pay the whole pitch and play" (Booking v2): the captain's one payment for
// the other half when nobody took on his half pitch. See handler.ts.
//
// Body: { bookingId }
// Returns { clientSecret, customerId, amountCents }.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { payOtherHalf } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabaseAsUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser();
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const result = await payOtherHalf(
    { stripe, db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)) },
    { id: userData.user.id, email: userData.user.email },
    { bookingId: typeof body.bookingId === 'string' ? body.bookingId : undefined },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT (Panos, with Booking v2 going live; not before half pitches are
switched on):
  supabase functions deploy pay-other-half
Uses the existing STRIPE_SECRET_KEY secret. The webhook already receives
payment_intent.succeeded and payment_intent.canceled.
*/
