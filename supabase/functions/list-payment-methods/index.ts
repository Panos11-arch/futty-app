// Lists the caller's saved cards — reads profiles.stripe_customer_id (never
// trusts a client-supplied customer id) and asks Stripe for that customer's
// payment methods directly. Nothing about saved cards is cached in our own
// database; Stripe is the only source of truth for what's saved.

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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile?.stripe_customer_id) {
    return new Response(JSON.stringify({ paymentMethods: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const methods = await stripe.paymentMethods.list({
    customer: profile.stripe_customer_id,
    type: 'card',
  });

  const paymentMethods = methods.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? 'card',
    last4: pm.card?.last4 ?? '????',
    expMonth: pm.card?.exp_month ?? 0,
    expYear: pm.card?.exp_year ?? 0,
  }));

  return new Response(JSON.stringify({ paymentMethods }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT:

     supabase functions deploy list-payment-methods
*/
