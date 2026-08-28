// Cancels a booking and refunds it if it was paid — the only path in now
// that client-side calls to the cancel_booking RPC are revoked (see
// supabase/booking-payments.sql). Order matters: cancel_booking (called as
// the authenticated user, so its own ownership/cutoff checks apply) runs
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

  // Read the pre-cancellation state — specifically whether it was actually
  // 'confirmed' (money captured) vs. still 'pending_payment' (nothing to
  // refund), since cancel_booking below will have already changed it.
  const { data: before } = await supabaseAdmin
    .from('venue_bookings')
    .select('status, amount_cents, stripe_payment_intent_id')
    .eq('id', body.bookingId)
    .maybeSingle();

  const { error: cancelError } = await supabaseAsUser.rpc('cancel_booking', { p_booking_id: body.bookingId });
  if (cancelError) {
    return new Response(JSON.stringify({ error: cancelError.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let refunded = false;

  if (before?.status === 'confirmed' && before.amount_cents > 0) {
    // Per-player split payments (supabase/booking-payment-splits.sql): each
    // player who already paid their own share gets refunded individually,
    // since there is no single whole-booking PaymentIntent for a split
    // booking any more (booking.stripe_payment_intent_id, checked below, is
    // only ever set by the pre-splitting flow).
    const { data: paidShares } = await supabaseAdmin
      .from('booking_payment_shares')
      .select('id, stripe_payment_intent_id')
      .eq('booking_id', body.bookingId)
      .eq('status', 'paid');

    if (paidShares && paidShares.length > 0) {
      for (const share of paidShares) {
        if (share.stripe_payment_intent_id) {
          await stripe.refunds.create({ payment_intent: share.stripe_payment_intent_id });
          refunded = true;
        }
      }
      await supabaseAdmin
        .from('booking_payment_shares')
        .update({ status: 'refunded' })
        .eq('booking_id', body.bookingId)
        .eq('status', 'paid');
    } else if (before.stripe_payment_intent_id) {
      await stripe.refunds.create({ payment_intent: before.stripe_payment_intent_id });
      refunded = true;
    }
  }

  return new Response(JSON.stringify({ cancelled: true, refunded }), {
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
