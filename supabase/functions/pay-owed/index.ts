// "Pay what I owe": the card payment of one of the caller's debts, or of
// their cash part after the match. See handler.ts for the rules.
//
// Body: { debtId } or { shareId }
// Returns { clientSecret, customerId, amountCents }.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { payOwed } from './handler.ts';

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

  const result = await payOwed(
    { stripe, db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)) },
    { id: userData.user.id, email: userData.user.email },
    {
      debtId: typeof body.debtId === 'string' ? body.debtId : undefined,
      shareId: typeof body.shareId === 'string' ? body.shareId : undefined,
    },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT (not done in P4c; ships with P5, after the pay_collection migrations):
  supabase functions deploy pay-owed
Uses the existing STRIPE_SECRET_KEY secret.
*/
