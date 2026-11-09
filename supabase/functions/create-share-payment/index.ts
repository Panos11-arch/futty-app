// Creates the Stripe payment for exactly ONE player's share, for the amount
// the database computed. See handler.ts for the rules.
//
// Body: { shareId, method?: 'card' | 'cash', acceptNonRefundable?: boolean }
// Returns { clientSecret, customerId, amountCents, cashCents, nonRefundable },
// or { setupIntentClientSecret, ... } when only a card needs saving, or
// { paid: true } when there is nothing to pay by card.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { createSharePayment } from './handler.ts';

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

  const result = await createSharePayment(
    { stripe, db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)) },
    { id: userData.user.id, email: userData.user.email },
    {
      shareId: typeof body.shareId === 'string' ? body.shareId : undefined,
      method: body.method as 'card' | 'cash' | undefined,
      acceptNonRefundable: body.acceptNonRefundable === true,
    },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT (not done in P4a; ships with P5, after the pay_modes migrations):
  supabase functions deploy create-share-payment
Uses the existing STRIPE_SECRET_KEY secret.
*/
