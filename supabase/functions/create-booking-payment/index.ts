// Called right after book_slot reserves a pitch (status 'pending_payment') —
// creates a Stripe PaymentIntent for the exact amount book_slot already
// computed server-side (never trust a client-supplied amount), and returns
// its client_secret so the app can open Stripe's native Payment Sheet.
//
// This only creates the payment intent — it does NOT mark the booking
// confirmed. That only happens in stripe-webhook, once Stripe itself
// confirms the charge actually succeeded, same never-trust-the-client
// principle as the whole Apple IAP setup.

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

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!body.bookingId) return new Response('Missing bookingId', { status: 400 });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: booking } = await supabaseAdmin
    .from('venue_bookings')
    .select('id, created_by, status, amount_cents, stripe_payment_intent_id')
    .eq('id', body.bookingId)
    .maybeSingle();

  if (!booking) return new Response('Booking not found', { status: 404 });
  if (booking.created_by !== userData.user.id) return new Response('Not your booking', { status: 403 });
  if (booking.status !== 'pending_payment') {
    return new Response(JSON.stringify({ error: 'Booking is not awaiting payment' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!booking.amount_cents || booking.amount_cents <= 0) {
    return new Response(JSON.stringify({ error: 'Nothing to pay for this booking' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Re-use the same PaymentIntent on a retry (e.g. the app was closed and
  // reopened before paying) instead of creating a new one every time.
  if (booking.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
    if (existing.status !== 'canceled') {
      return new Response(JSON.stringify({ clientSecret: existing.client_secret }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: booking.amount_cents,
    currency: 'eur',
    automatic_payment_methods: { enabled: true },
    metadata: { booking_id: booking.id, profile_id: userData.user.id },
  });

  await supabaseAdmin
    .from('venue_bookings')
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq('id', booking.id);

  return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT:

1. Set the Stripe secret key (test key for now — the "sk_test_..." one):
     supabase secrets set STRIPE_SECRET_KEY=sk_test_...

2. Deploy:
     supabase functions deploy create-booking-payment
*/
