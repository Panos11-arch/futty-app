// Receives Stripe's webhook events. Bookings made since P4a are handled in
// modes.ts (hold, take 60 minutes later, the booker's guarantee); what
// follows describes the old flow, which bookings made before P4a keep.
//
// Two kinds matter for the old flow (item 6, authorize-then-capture):
//
// - payment_intent.amount_capturable_updated fires when a manual-capture
//   PaymentIntent's authorization succeeds — the card is held, nothing has
//   been charged yet. This is what flips a share to 'authorized' (and, for
//   the booker's own share, reserves the pitch — see below).
// - payment_intent.succeeded now only fires once a manual-capture intent has
//   actually been captured — kept as a fallback/no-op path since this
//   function also used to be the sole handler for the old
//   immediate-capture flow.
//
// Once a share is authorized, this checks whether the booking's entire
// roster (format_player_count(format) shares) is now authorized-or-paid; if
// so, it captures every authorized share's PaymentIntent together, right
// here, so real money only ever moves once for a fully-formed match — never
// for a squad that's still short a player.
//
// Never trust the client's own claim that a payment went through (same
// principle as the whole Apple IAP setup) — this is the one place that does.
//
// Verifies Stripe's signature using the async/WebCrypto-based verifier
// (constructEventAsync + createSubtleCryptoProvider) rather than the default
// sync one — the sync verifier depends on Node's synchronous crypto APIs,
// which aren't available in Deno's edge runtime. Unlike Apple's server
// library (see _shared/apple-app-store.ts for why that one doesn't work
// here at all), Stripe's SDK has an official, documented Deno-compatible
// path for exactly this.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { handlePaymentModeEvent } from './modes.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Mirrors format_player_count() in supabase/legacy/booking-payment-splits.sql —
// duplicated here rather than round-tripping to Postgres for a plain lookup
// table with no rows of its own.
const FORMAT_PLAYER_COUNT: Record<string, number> = {
  '5-a-side': 5,
  '7-a-side': 7,
  '9-a-side': 9,
  '11-a-side': 11,
};

async function handleAuthorized(paymentIntentId: string, supabaseAdmin: SupabaseClient) {
  const { data: share } = await supabaseAdmin
    .from('booking_payment_shares')
    .select('id, booking_id, is_booker, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (!share) return;

  // Atomic pending -> authorized. If two deliveries of this event race, only
  // one gets a row back; the other stops here.
  const { data: claimed } = await supabaseAdmin
    .from('booking_payment_shares')
    .update({ status: 'authorized' })
    .eq('id', share.id)
    .eq('status', 'pending')
    .select('id');
  if (!claimed || claimed.length === 0) return; // already handled — webhooks can repeat

  // The reservation itself is only ever contingent on the BOOKER's own share
  // — everyone else's shares are independent of whether the pitch is held,
  // per spec. This is now "authorized", not "paid" — the pitch is reserved
  // well before anyone is actually charged.
  if (share.is_booker) {
    await supabaseAdmin
      .from('venue_bookings')
      .update({ status: 'confirmed' })
      .eq('id', share.booking_id)
      .eq('status', 'pending_payment');
  }

  await captureIfFull(share.booking_id, supabaseAdmin);
}

/** Captures every authorized share's PaymentIntent together, exactly once,
 *  the moment the booking's full roster is authorized — never one at a
 *  time, so a squad that fills is charged as a single event, not
 *  player-by-player as they happen to join. */
async function captureIfFull(bookingId: string, supabaseAdmin: SupabaseClient) {
  const { data: booking } = await supabaseAdmin
    .from('venue_bookings')
    .select('format, capacity, service_fee_cents_per_player')
    .eq('id', bookingId)
    .maybeSingle();
  if (!booking) return;

  // Mirrors public.booking_total_shares_needed (supabase/legacy/opposition-match-
  // payments.sql): doubled once this booking has a matched opposition
  // post — two full rosters share the one pitch instead of one.
  const { data: matchedOpposition } = await supabaseAdmin
    .from('squad_posts')
    .select('id, payment_mode')
    .eq('venue_booking_id', bookingId)
    .eq('type', 'opposition')
    .eq('status', 'matched')
    .maybeSingle();

  // Gipedo Pano (supabase/legacy/gipedo-pano-payments.sql): capture is
  // deliberately deferred until the match result is known, not the moment
  // the roster fills — every share just stays 'authorized' (a held, not
  // charged, card) until supabase/functions/settle-gipedo-pano captures the
  // losing team and voids the winning one, once submit_friendly_score (or
  // the stale-match sweep) decides an outcome. The redefined
  // bookings_needing_share_cancellation already knows not to void these
  // pre-kickoff once the roster is actually full.
  if (matchedOpposition?.payment_mode === 'gipedo_pano') return;

  // Mirrors public.booking_total_shares_needed (supabase/legacy/flat-service-fee.sql):
  // flat-fee bookings are shared by everyone on the pitch (capacity: 10 for
  // 5 v 5, ...); older bookings keep one team's count, doubled once an
  // opponent is matched.
  const formatCount = FORMAT_PLAYER_COUNT[booking.format as string] ?? 5;
  const needed =
    booking.service_fee_cents_per_player != null
      ? (booking.capacity ?? formatCount * 2)
      : formatCount * (matchedOpposition ? 2 : 1);

  const { data: shares } = await supabaseAdmin
    .from('booking_payment_shares')
    .select('id, status, stripe_payment_intent_id')
    .eq('booking_id', bookingId);
  if (!shares) return;

  const settled = shares.filter((s) => s.status === 'authorized' || s.status === 'paid');
  if (settled.length < needed) return; // still short a player — nothing to capture yet

  for (const share of shares) {
    if (share.status !== 'authorized' || !share.stripe_payment_intent_id) continue;
    try {
      // Idempotency key: if two webhook runs both decide the roster is full,
      // Stripe treats the second capture as the same request, not a new one.
      await stripe.paymentIntents.capture(share.stripe_payment_intent_id, {}, {
        idempotencyKey: `capture-share-${share.id}`,
      });
      await supabaseAdmin
        .from('booking_payment_shares')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', share.id);
    } catch (err) {
      // Keep going — one failed capture (e.g. the card was declined between
      // authorization and now) shouldn't stop the rest of a full roster from
      // being charged. The booking stays 'confirmed' either way; a capture
      // failure here surfaces to that one player as still 'authorized', not
      // 'paid', which cancel-unpaid-bookings will eventually void if it's
      // never resolved.
      console.error(`Capture failed for share ${share.id}:`, err);
    }
  }
}

/** A card hold Stripe released on its own — almost always because it
 *  expired (card authorizations only last about 7 days). The database still
 *  said 'authorized', so the app showed the player as covered when they no
 *  longer were. Put the share back to 'pending' and tell the player to
 *  authorize again; if nobody does, cancel-unpaid-bookings handles it as
 *  for any other unpaid share. Our own voids (cancel-booking, the cleanup
 *  job, Gipedo Pano settlement) never carry the 'automatic' reason, so they
 *  never come through here. */
async function handleHoldExpired(paymentIntent: Stripe.PaymentIntent, supabaseAdmin: SupabaseClient) {
  if (paymentIntent.cancellation_reason !== 'automatic') return;

  const { data: reopened } = await supabaseAdmin
    .from('booking_payment_shares')
    .update({ status: 'pending' })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .eq('status', 'authorized')
    .select('id, booking_id, profile_id');
  const share = reopened?.[0];
  if (!share) return;

  await supabaseAdmin.from('notifications').insert({
    profile_id: share.profile_id,
    type: 'match_payment_due',
    title: 'Please confirm your payment again',
    body: 'The hold on your card for an upcoming game expired. Re-confirm your share to keep your spot.',
    data: { bookingId: share.booking_id },
  });
}

async function processEvent(event: Stripe.Event, supabaseAdmin: SupabaseClient) {
  // Bookings made since P4a (booking modes, hold then take after 60
  // minutes, the booker's guarantee): see modes.ts. Everything below is the
  // old flow, kept for bookings made before P4a.
  if (await handlePaymentModeEvent(event, { stripe, db: dbFromSupabase(supabaseAdmin) })) return;

  if (event.type === 'payment_intent.canceled') {
    await handleHoldExpired(event.data.object as Stripe.PaymentIntent, supabaseAdmin);
    return;
  }

  if (event.type === 'payment_intent.amount_capturable_updated') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await handleAuthorized(paymentIntent.id, supabaseAdmin);
    return;
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    // Per-player split payments (supabase/legacy/booking-payment-splits.sql). Under
    // manual capture this fires when THIS function's own capture() call
    // above completes, so the share is already 'paid' by the time it's
    // received — this branch is now mainly a no-op/backward-compat path.
    const { data: share } = await supabaseAdmin
      .from('booking_payment_shares')
      .select('id, booking_id, is_booker, status')
      .eq('stripe_payment_intent_id', paymentIntent.id)
      .maybeSingle();

    if (share) {
      if (share.status === 'pending') {
        // An automatic-capture intent somehow reached 'succeeded' without
        // ever passing through 'authorized' — treat it as paid outright
        // rather than dropping it silently.
        await supabaseAdmin
          .from('booking_payment_shares')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', share.id);
        if (share.is_booker) {
          await supabaseAdmin
            .from('venue_bookings')
            .update({ status: 'confirmed' })
            .eq('id', share.booking_id)
            .eq('status', 'pending_payment');
        }
      }
      return;
    }

    await supabaseAdmin
      .from('venue_bookings')
      .update({ status: 'confirmed' })
      .eq('stripe_payment_intent_id', paymentIntent.id)
      .eq('status', 'pending_payment'); // no-op if already confirmed/cancelled — safe to receive twice
  }
}

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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Stripe retries deliveries. Record each event ID once; a repeat is
  // acknowledged without being processed again.
  const { error: dedupeError } = await supabaseAdmin
    .from('stripe_webhook_events')
    .insert({ id: event.id, type: event.type });
  if (dedupeError) {
    if (dedupeError.code === '23505') return new Response('duplicate', { status: 200 });
    // Table missing or DB unavailable: return 500 so Stripe retries later
    // instead of the event being lost.
    return new Response(`Could not record event: ${dedupeError.message}`, { status: 500 });
  }

  try {
    await processEvent(event, supabaseAdmin);
  } catch (err) {
    // Forget the event so Stripe's retry is processed rather than skipped as
    // a duplicate.
    await supabaseAdmin.from('stripe_webhook_events').delete().eq('id', event.id);
    console.error(`stripe-webhook: failed processing ${event.id}:`, err);
    return new Response('processing failed', { status: 500 });
  }

  // Other event types (payment_intent.payment_failed etc.) don't need
  // handling here — an authorization that never lands just ages out on its
  // own via cancel-unpaid-bookings.

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
     Events to send: payment_intent.amount_capturable_updated, payment_intent.succeeded,
                     payment_intent.canceled, setup_intent.succeeded (P4a)

3. After creating it, Stripe shows a signing secret ("whsec_...") — set it:
     supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

4. Test mode and live mode have DIFFERENT webhook secrets, even for the same
   URL — you'll need to repeat step 2-3 again with a live-mode endpoint once
   this moves off test keys.

5. If this endpoint was already configured before item 6, add
   payment_intent.amount_capturable_updated to its subscribed events in the
   Stripe dashboard — it won't receive that event type otherwise.
*/
