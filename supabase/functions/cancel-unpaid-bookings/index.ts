// Scheduled job (pg_cron + pg_net, see the bottom of
// supabase/booking-payment-splits.sql) — every 10 minutes, finds every
// confirmed booking with at least one still-unpaid player share within 3
// hours of kickoff, cancels the WHOLE booking (voiding the reservation, not
// just the unpaid portion), refunds every share that was already paid IN
// FULL, and notifies everyone involved (including the booker) why.
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
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
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

    // Refund every share that was already paid — the reservation itself is
    // being voided, so this is a full refund of what each of THEM paid, not
    // a partial/prorated one.
    for (const share of shares) {
      if (share.status === 'paid' && share.stripe_payment_intent_id) {
        try {
          await stripe.refunds.create({ payment_intent: share.stripe_payment_intent_id });
        } catch (err) {
          console.error(`Refund failed for share ${share.id}:`, err);
          // Keep going — one failed refund (e.g. already refunded) shouldn't
          // stop the booking from being cancelled or the rest from being
          // refunded/notified.
        }
      }
    }

    await supabaseAdmin.from('venue_bookings').update({ status: 'cancelled' }).eq('id', bookingId);

    await supabaseAdmin
      .from('booking_payment_shares')
      .update({ status: 'cancelled' })
      .eq('booking_id', bookingId)
      .eq('status', 'pending');
    await supabaseAdmin
      .from('booking_payment_shares')
      .update({ status: 'refunded' })
      .eq('booking_id', bookingId)
      .eq('status', 'paid');

    const notifications = shares.map((share) => ({
      profile_id: share.profile_id,
      type: 'booking_cancelled',
      title: 'Booking cancelled',
      body: 'Not everyone paid their share in time, so this booking was cancelled and refunded.',
      data: { bookingId },
    }));
    await supabaseAdmin.from('notifications').insert(notifications);

    cancelledCount += 1;
  }

  return new Response(`cancelled ${cancelledCount} booking(s)`, { status: 200 });
});

/*
DEPLOYMENT:

1. Run supabase/booking-payment-splits.sql first.

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
