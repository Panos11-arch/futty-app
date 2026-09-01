// Creates (or reuses) a Stripe Customer for the caller, then a SetupIntent
// against it — this is how "Payment methods" saves a card without charging
// it. The cached customer id (profiles.stripe_customer_id) is also used by
// create-booking-payment, so a saved card shows up as a selectable option
// at real booking checkout too, not just here.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

// Ephemeral keys need an explicit API version pinned, unlike the rest of
// this file's Stripe calls — this should track whatever
// @stripe/stripe-react-native's compiled native SDK expects.
const STRIPE_API_VERSION = '2024-06-20';

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

  let customerId = profile?.stripe_customer_id ?? null;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userData.user.email,
      metadata: { profile_id: userData.user.id },
    });
    customerId = customer.id;
    await supabaseAdmin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', userData.user.id);
  }

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: STRIPE_API_VERSION }
  );

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    automatic_payment_methods: { enabled: true },
  });

  // Field names here must match lib/payments.ts's SetupIntentPayload exactly
  // — item 9's "must provide either intentConfiguration or
  // customEphemeralKeySecret" error was this response using clientSecret/
  // ephemeralKeySecret while the client read setupIntentClientSecret/
  // ephemeralKey, so both arrived at CustomerSheet.initialize() as
  // undefined despite this function doing everything else right.
  return new Response(
    JSON.stringify({
      setupIntentClientSecret: setupIntent.client_secret,
      customerId,
      ephemeralKey: ephemeralKey.secret,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

/*
DEPLOYMENT:

1. Uses the same STRIPE_SECRET_KEY secret as create-booking-payment — no new
   secret needed if that's already set.

2. Deploy:
     supabase functions deploy create-setup-intent
*/
