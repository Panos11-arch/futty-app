// Scheduled job (pg_cron + pg_net, registered at the bottom of this file's
// deployment notes) — every 10 minutes, executes whatever Gipedo Pano
// settlement supabase/legacy/gipedo-pano-payments.sql has already decided
// (submit_friendly_score's confirmed/dispute-lockout paths, or the stale-
// match sweep) but hasn't been turned into real Stripe calls yet.
//
// All the DECISION-making (who won, who forfeited, who's a genuine no-show)
// already happened in Postgres — this function's only job is to execute it:
// capture the losing team's held PaymentIntents, void (cancel) the winning
// team's, same "never trust anything client-side, only ever act on
// server-decided state" principle as stripe-webhook and cancel-unpaid-
// bookings.
//
// Deliberately not triggered by a client call anywhere — same shared-secret
// cron auth as cancel-unpaid-bookings.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

type PendingShare = {
  match_id: string;
  share_id: string;
  stripe_payment_intent_id: string | null;
  action: 'capture' | 'void';
};

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: shares, error } = await supabaseAdmin.rpc('gipedo_pano_pending_settlement_shares');
  if (error) {
    return new Response(`Query failed: ${error.message}`, { status: 500 });
  }
  if (!shares || shares.length === 0) {
    return new Response('nothing to settle', { status: 200 });
  }

  const byMatch = new Map<string, PendingShare[]>();
  for (const share of shares as PendingShare[]) {
    const list = byMatch.get(share.match_id) ?? [];
    list.push(share);
    byMatch.set(share.match_id, list);
  }

  let settledCount = 0;

  for (const [matchId, matchShares] of byMatch) {
    for (const share of matchShares) {
      if (!share.stripe_payment_intent_id) continue;

      try {
        if (share.action === 'capture') {
          await stripe.paymentIntents.capture(share.stripe_payment_intent_id);
          await supabaseAdmin.rpc('mark_gipedo_pano_share_settled', {
            p_share_id: share.share_id,
            p_new_status: 'paid',
          });
        } else {
          await stripe.paymentIntents.cancel(share.stripe_payment_intent_id);
          await supabaseAdmin.rpc('mark_gipedo_pano_share_settled', {
            p_share_id: share.share_id,
            p_new_status: 'cancelled',
          });
        }
      } catch (err) {
        console.error(`Settlement ${share.action} failed for share ${share.share_id}:`, err);
        // Keep going — one failed capture/void (e.g. the hold already
        // expired) shouldn't stop the rest of the match's shares from
        // being settled. This match's finalize call below is skipped this
        // run so a retried run can pick the leftover share back up (still
        // returned by gipedo_pano_pending_settlement_shares since it's
        // still 'authorized').
        continue;
      }
    }

    // Only finalize once every share for this match actually settled — a
    // partial failure above leaves at least one share still 'authorized',
    // so payment_settled_at stays null and the next run retries it.
    const { data: stillPending } = await supabaseAdmin
      .from('booking_payment_shares')
      .select('id')
      .in(
        'id',
        matchShares.map((s) => s.share_id)
      )
      .eq('status', 'authorized');

    if (!stillPending || stillPending.length === 0) {
      await supabaseAdmin.rpc('finalize_gipedo_pano_settlement', { p_match_id: matchId });
      settledCount += 1;
    }
  }

  return new Response(`settled ${settledCount} match(es)`, { status: 200 });
});

/*
DEPLOYMENT:

1. Run supabase/legacy/gipedo-pano-payments.sql first.

2. Deploy WITHOUT JWT verification — pg_net calls this directly, with no
   Supabase user session:
     supabase functions deploy settle-gipedo-pano --no-verify-jwt

3. Uses the same CRON_SECRET and STRIPE_SECRET_KEY already set for
   cancel-unpaid-bookings — no new secrets needed.

4. Register the cron job: fill in <CRON_SECRET> in
   supabase/legacy/settle-gipedo-pano-cron.sql and run it in the Supabase dashboard
   SQL editor. (It lives in its own file because the cron schedule string
   contains the characters that end a code comment — inside this comment it
   stopped the whole function from compiling.)
*/
