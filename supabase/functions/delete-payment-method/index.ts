// Detaches one saved card. Verifies the payment method actually belongs to
// the caller's own Stripe customer before detaching it — otherwise a
// guessed/brute-forced payment method id could be used to detach someone
// else's card.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

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

  let body: { paymentMethodId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!body.paymentMethodId) return new Response('Missing paymentMethodId', { status: 400 });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile?.stripe_customer_id) return new Response('No saved cards', { status: 404 });

  const paymentMethod = await stripe.paymentMethods.retrieve(body.paymentMethodId);
  if (paymentMethod.customer !== profile.stripe_customer_id) {
    return new Response('Not your payment method', { status: 403 });
  }

  await stripe.paymentMethods.detach(body.paymentMethodId);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT:

     supabase functions deploy delete-payment-method
*/
