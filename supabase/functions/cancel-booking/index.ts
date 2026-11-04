// Cancels a booking and refunds it if it was paid — the only path in now
// that client-side calls to the cancel_booking RPC are revoked (see
// supabase/booking-payments.sql). Order matters: cancel_booking_for (with the
// verified caller passed in, so its ownership/cutoff checks apply) runs
// FIRST — if the 30-minutes-before-kickoff cutoff has passed, or it's not
// this user's booking, or it's already cancelled, that fails immediately
// and no refund is ever attempted. Only once the cancellation itself
// succeeds does this call Stripe to actually return the money.

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

  // cancel_booking_for (supabase/security-hardening.sql) does the ownership,
  // cutoff and status flip atomically, and returns what the status was
  // BEFORE cancelling — no separate pre-read that could go stale.
  const { data: previousStatus, error: cancelError } = await supabaseAdmin.rpc('cancel_booking_for', {
    p_booking_id: body.bookingId,
    p_profile_id: userData.user.id,
  });
  if (cancelError) {
    return new Response(JSON.stringify({ error: cancelError.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let refunded = false;
  let released = false;

  // Per-player split payments: void every card hold that was never charged
  // ('authorized' — previously these were left held after a cancellation),
  // refund every share that was actually charged ('paid'), and mark any
  // still-unpaid ones cancelled.
  const { data: shares } = await supabaseAdmin
    .from('booking_payment_shares')
    .select('id, status, stripe_payment_intent_id')
    .eq('booking_id', body.bookingId)
    .in('status', ['pending', 'authorized', 'paid']);

  for (const share of shares ?? []) {
    try {
      if (share.status === 'authorized' && share.stripe_payment_intent_id) {
        await stripe.paymentIntents.cancel(share.stripe_payment_intent_id);
        released = true;
      } else if (share.status === 'paid' && share.stripe_payment_intent_id) {
        await stripe.refunds.create(
          { payment_intent: share.stripe_payment_intent_id },
          { idempotencyKey: `refund-share-${share.id}` }
        );
        refunded = true;
      } else if (share.status === 'pending' && share.stripe_payment_intent_id) {
        // Started paying but never finished — cancel the intent so it can't
        // complete later against a cancelled booking.
        await stripe.paymentIntents.cancel(share.stripe_payment_intent_id).catch(() => {});
      }
    } catch (err) {
      // Keep going: one Stripe failure must not leave everyone else's card
      // held. The error is logged for manual follow-up.
      console.error(`cancel-booking: Stripe action failed for share ${share.id}:`, err);
      continue;
    }
    await supabaseAdmin
      .from('booking_payment_shares')
      .update({ status: share.status === 'paid' ? 'refunded' : 'cancelled' })
      .eq('id', share.id);
  }

  // Bookings from before split payments had a single whole-booking intent.
  if (!shares?.length && previousStatus === 'confirmed') {
    const { data: legacy } = await supabaseAdmin
      .from('venue_bookings')
      .select('amount_cents, stripe_payment_intent_id')
      .eq('id', body.bookingId)
      .maybeSingle();
    if (legacy?.stripe_payment_intent_id && legacy.amount_cents > 0) {
      await stripe.refunds.create(
        { payment_intent: legacy.stripe_payment_intent_id },
        { idempotencyKey: `refund-booking-${body.bookingId}` }
      );
      refunded = true;
    }
  }

  return new Response(JSON.stringify({ cancelled: true, refunded, released }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT:

  supabase functions deploy cancel-booking

(Uses the same STRIPE_SECRET_KEY secret as create-booking-payment — nothing
new to configure if that's already set. Keeps normal JWT verification, since
this is called by the app's own signed-in user, not a webhook.)
*/
