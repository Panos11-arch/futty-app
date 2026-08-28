// Receives Stripe's webhook events — specifically payment_intent.succeeded,
// which is the ONLY thing that flips a booking from 'pending_payment' to
// 'confirmed'. Never trust the client's own claim that a payment went
// through (same principle as the whole Apple IAP setup) — this is the one
// place that does.
//
// Verifies Stripe's signature using the async/WebCrypto-based verifier
// (constructEventAsync + createSubtleCryptoProvider) rather than the default
// sync one — the sync verifier depends on Node's synchronous crypto APIs,
// which aren't available in Deno's edge runtime. Unlike Apple's server
// library (see _shared/apple-app-store.ts for why that one doesn't work
// here at all), Stripe's SDK has an official, documented Deno-compatible
// path for exactly this.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  // Signature verification needs the exact raw bytes Stripe signed — reading
  // this as text (not req.json()) is what makes that possible.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`Signature verification failed: ${err instanceof Error ? err.message : err}`, {
      status: 400,
    });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Per-player split payments (supabase/booking-payment-splits.sql) — this
    // is now the normal path for a priced booking. Falls through to the
    // whole-booking path below only for an intent this lookup doesn't find,
    // which keeps this function backward-compatible with anything already
    // in flight from before splitting existed.
    const { data: share } = await supabaseAdmin
      .from('booking_payment_shares')
      .select('id, booking_id, is_booker, status')
      .eq('stripe_payment_intent_id', paymentIntent.id)
      .maybeSingle();

    if (share) {
      if (share.status === 'pending') {
        await supabaseAdmin
          .from('booking_payment_shares')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', share.id);

        // The reservation itself is only ever contingent on the BOOKER's own
        // share — everyone else's shares are independent of whether the
        // pitch is held, per spec.
        if (share.is_booker) {
          await supabaseAdmin
            .from('venue_bookings')
            .update({ status: 'confirmed' })
            .eq('id', share.booking_id)
            .eq('status', 'pending_payment');
        }
      }
      return new Response('ok', { status: 200 });
    }

    await supabaseAdmin
      .from('venue_bookings')
      .update({ status: 'confirmed' })
      .eq('stripe_payment_intent_id', paymentIntent.id)
      .eq('status', 'pending_payment'); // no-op if already confirmed/cancelled — safe to receive twice
  }

  // Other event types (payment_intent.payment_failed, canceled, etc.) don't
  // need handling here — an unpaid booking just ages out on its own via the
  // cancel-stale-pending-bookings cron job (supabase/booking-payments.sql).

  return new Response('ok', { status: 200 });
});

/*
DEPLOYMENT:

1. Deploy WITHOUT JWT verification — Stripe calls this directly, with no
   Supabase session, so the default JWT gate would reject every real call
   before it ever reaches this code:
     supabase functions deploy stripe-webhook --no-verify-jwt

2. In the Stripe dashboard (Developers > Webhooks > Add endpoint):
     URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
     Events to send: payment_intent.succeeded

3. After creating it, Stripe shows a signing secret ("whsec_...") — set it:
     supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

4. Test mode and live mode have DIFFERENT webhook secrets, even for the same
   URL — you'll need to repeat step 2-3 again with a live-mode endpoint once
   this moves off test keys.
*/
