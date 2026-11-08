// Scheduled job (pg_cron + pg_net, see the bottom of
// supabase/legacy/booking-payment-splits.sql) — every 10 minutes, finds every
// confirmed booking with at least one share that isn't fully authorized (or
// isn't authorized at all) within 3 hours of kickoff, cancels the WHOLE
// booking (voiding the reservation, not just the unpaid portion), and
// notifies everyone involved (including the booker) why.
//
// Item 6 (authorize-then-capture): every share here is either 'pending' (no
// successful PaymentIntent) or 'authorized' (card held, never captured,
// since stripe-webhook only ever captures once the WHOLE roster is
// authorized — see that function) — never 'paid', because a fully-authorized
// booking is captured immediately and would never still be sitting
// unconfirmed this close to kickoff. So this now VOIDS every authorized
// hold instead of charging-then-refunding: no real money ever moves for a
// match that didn't happen. The 'paid' branch below is kept only as a
// defensive fallback for a share captured under the old immediate-capture
// model (or a rare capture/cancellation race) — refunding is still correct
// for money that was actually taken.
//
// Deliberately not triggered by a client call anywhere — this only ever
// runs on the schedule, authenticated by a shared secret (x-cron-secret)
// rather than a user JWT, the same shape as notify-squad-post's webhook
// secret.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: candidates, error: candidatesError } = await supabaseAdmin.rpc(
    'bookings_needing_share_cancellation'
  );
  if (candidatesError) {
    return new Response(`Query failed: ${candidatesError.message}`, { status: 500 });
  }
  if (!candidates || candidates.length === 0) {
    return new Response('nothing to cancel', { status: 200 });
  }

  let cancelledCount = 0;

  for (const { booking_id: bookingId } of candidates as { booking_id: string }[]) {
    const { data: shares } = await supabaseAdmin
      .from('booking_payment_shares')
      .select('id, profile_id, status, stripe_payment_intent_id')
      .eq('booking_id', bookingId);

    if (!shares || shares.length === 0) continue;

    // Void every authorized hold — nobody was actually charged, so there's
    // nothing to refund, just the hold on their card to release. The 'paid'
    // branch is a defensive fallback only (see the file header comment).
    for (const share of shares) {
      if (share.status === 'authorized' && share.stripe_payment_intent_id) {
        try {
          await stripe.paymentIntents.cancel(share.stripe_payment_intent_id);
        } catch (err) {
          console.error(`Void failed for share ${share.id}:`, err);
          // Keep going — one failed void shouldn't stop the booking from
          // being cancelled or the rest from being voided/notified.
        }
      } else if (share.status === 'paid' && share.stripe_payment_intent_id) {
        try {
          await stripe.refunds.create({ payment_intent: share.stripe_payment_intent_id });
        } catch (err) {
          console.error(`Refund failed for share ${share.id}:`, err);
        }
      }
    }

    await supabaseAdmin.from('venue_bookings').update({ status: 'cancelled' }).eq('id', bookingId);

    await supabaseAdmin
      .from('booking_payment_shares')
      .update({ status: 'cancelled' })
      .eq('booking_id', bookingId)
      .in('status', ['pending', 'authorized']);
    await supabaseAdmin
      .from('booking_payment_shares')
      .update({ status: 'refunded' })
      .eq('booking_id', bookingId)
      .eq('status', 'paid');

    const notifications = shares.map((share) => ({
      profile_id: share.profile_id,
      type: 'booking_cancelled',
      title: 'Booking cancelled',
      body: "Not everyone's spot was confirmed in time, so this booking was cancelled — no one was charged.",
      data: { bookingId },
    }));
    await supabaseAdmin.from('notifications').insert(notifications);

    cancelledCount += 1;
  }

  return new Response(`cancelled ${cancelledCount} booking(s)`, { status: 200 });
});

/*
DEPLOYMENT:

1. Run supabase/legacy/booking-payment-splits.sql first.

2. Set a random shared secret (same pattern as notify-squad-post's
   WEBHOOK_SECRET):
     supabase secrets set CRON_SECRET=<your-random-string>

3. Deploy WITHOUT JWT verification — pg_net calls this directly, with no
   Supabase user session:
     supabase functions deploy cancel-unpaid-bookings --no-verify-jwt

4. Fill in that same secret (and this project's ref) into the two
   placeholders in booking-payment-splits.sql's `cron.schedule(...)` call,
   then re-run that file so the cron job actually points at this function.
*/
