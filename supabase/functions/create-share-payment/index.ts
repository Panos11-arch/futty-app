// Per-player equivalent of create-booking-payment: creates a Stripe
// PaymentIntent for exactly ONE player's share of a split booking (see
// supabase/booking-payment-splits.sql), for the exact amount book_slot /
// add_booking_share_internal already computed server-side. A player can only
// ever create a PaymentIntent for their OWN share — there is no "pay for
// someone else" path.
//
// capture_method: 'manual' (item 6) — this only ever authorizes a hold on
// the card, never actually charges it. stripe-webhook captures every share's
// intent together, all at once, only once the whole booking's roster is
// full — see that function for why, and cancel-unpaid-bookings for what
// happens if it never fills before kickoff.
//
// Same never-trust-the-client principle as create-booking-payment: this
// only creates the payment intent. Only stripe-webhook, once Stripe itself
// confirms the authorization, marks the share 'authorized' (and, if it's the
// booker's own share, flips the booking to 'confirmed' — the pitch is held
// as soon as the booker's card is authorized, well before anyone's actually
// charged).

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

  let body: { shareId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!body.shareId) return new Response('Missing shareId', { status: 400 });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: share } = await supabaseAdmin
    .from('booking_payment_shares')
    .select('id, booking_id, profile_id, amount_cents, status, stripe_payment_intent_id')
    .eq('id', body.shareId)
    .maybeSingle();

  if (!share) return new Response('Share not found', { status: 404 });
  if (share.profile_id !== userData.user.id) return new Response('Not your share', { status: 403 });
  if (share.status !== 'pending') {
    return new Response(JSON.stringify({ error: 'This share is not awaiting payment' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (share.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(share.stripe_payment_intent_id);
    if (existing.status !== 'canceled') {
      return new Response(JSON.stringify({ clientSecret: existing.client_secret }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: share.amount_cents,
    currency: 'eur',
    capture_method: 'manual',
    automatic_payment_methods: { enabled: true },
    metadata: { share_id: share.id, booking_id: share.booking_id, profile_id: userData.user.id },
  });

  await supabaseAdmin
    .from('booking_payment_shares')
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq('id', share.id);

  return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT:
  supabase functions deploy create-share-payment
(Uses the same STRIPE_SECRET_KEY already set for create-booking-payment —
no new secret needed.)
*/
