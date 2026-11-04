// Receives Apple's App Store Server Notifications V2 for every product this
// app sells — renewals/cancellations for Personal Premium (a subscription)
// and refunds for Team Premium (a non-consumable). App Store Connect only
// lets you configure one Production and one Sandbox URL per app, so this
// single endpoint always was going to receive both; it just routes by which
// table recognizes the transaction. Deployment steps at the bottom.
//
// Does NOT cryptographically verify the notification's own JWS signature —
// see _shared/apple-app-store.ts for why (Apple's own verification library
// is currently broken on Deno, and hand-rolling X.509 certificate-chain
// verification from scratch is exactly the kind of thing that's easy to get
// subtly wrong in a way that looks like it works). Instead this only uses
// the incoming payload to learn WHICH transaction may have changed, then
// re-asks Apple's authenticated API directly for that transaction's real
// state — the same trusted path verify-purchase / verify-team-purchase use.
// Forging a POST to this URL can at worst trigger a redundant re-check of a
// real transaction id already on file; it can never grant or extend Premium
// on its own, because nothing here is trusted without that live round-trip
// to Apple.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  extractOriginalTransactionId,
  fetchAppleSubscriptionStatus,
  fetchAppleTransaction,
} from '../_shared/apple-app-store.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function handleSubscription(
  supabaseAdmin: SupabaseClient,
  originalTransactionId: string
) {
  const { data: existing } = await supabaseAdmin
    .from('premium_subscriptions')
    .select('profile_id, product_id')
    .eq('platform', 'ios')
    .eq('original_transaction_id', originalTransactionId)
    .maybeSingle();
  if (!existing) return false;

  const status = await fetchAppleSubscriptionStatus(originalTransactionId, existing.product_id as string);
  if (!status) return true; // recognized, but couldn't re-verify — leave state as-is

  await supabaseAdmin
    .from('premium_subscriptions')
    .update({
      status: status.active ? 'active' : 'expired',
      expires_at: status.expiresAt ? new Date(status.expiresAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('platform', 'ios')
    .eq('original_transaction_id', originalTransactionId);

  await supabaseAdmin
    .from('profiles')
    .update({ is_premium: status.active })
    .eq('id', existing.profile_id as string);

  return true;
}

async function handleTeamPurchase(
  supabaseAdmin: SupabaseClient,
  originalTransactionId: string
) {
  const { data: existing } = await supabaseAdmin
    .from('team_premium_purchases')
    .select('team_id, format')
    .eq('original_transaction_id', originalTransactionId)
    .maybeSingle();
  if (!existing) return false;

  // Non-consumable: there's only ever one transaction, so transactionId and
  // originalTransactionId are the same id — unlike the subscription case,
  // there's no "which one is current" ambiguity to worry about here.
  const transaction = await fetchAppleTransaction(originalTransactionId);
  if (!transaction) return true;

  const revoked = 'revocationDate' in transaction && (transaction as { revocationDate?: number }).revocationDate;
  const active = !revoked;

  await supabaseAdmin
    .from('team_premium_purchases')
    .update({ status: active ? 'active' : 'refunded', updated_at: new Date().toISOString() })
    .eq('original_transaction_id', originalTransactionId);

  const column = existing.format === '9-a-side' ? 'premium_9aside' : 'premium_11aside';
  await supabaseAdmin
    .from('teams')
    .update({ [column]: active })
    .eq('id', existing.team_id as string);

  // A refund mid-season doesn't retroactively undo results already banked,
  // but the team can't keep playing on a Premium slot they no longer paid
  // for — forfeit_team_premium_fixtures (supabase/team-premium-forfeit.sql)
  // resolves every not-yet-completed fixture in this format as a loss for
  // them / a walkover win for their opponent.
  if (!active) {
    await supabaseAdmin.rpc('forfeit_team_premium_fixtures', {
      p_team_id: existing.team_id as string,
      p_format: existing.format as string,
    });
  }

  return true;
}

Deno.serve(async (req) => {
  let body: { signedPayload?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const originalTransactionId = body.signedPayload ? extractOriginalTransactionId(body.signedPayload) : null;
  // Apple retries on non-2xx, so malformed/unrecognized payloads still get a
  // 200 — there's nothing useful a retry would change here.
  if (!originalTransactionId) return new Response('ignored', { status: 200 });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const handled =
    (await handleSubscription(supabaseAdmin, originalTransactionId)) ||
    (await handleTeamPurchase(supabaseAdmin, originalTransactionId));

  return new Response(handled ? 'ok' : 'unknown transaction', { status: 200 });
});

/*
DEPLOYMENT:

0. Run supabase/team-premium-forfeit.sql in the SQL Editor first (adds
   forfeit_team_premium_fixtures, called below) if you haven't already.

1. Deploy (reuses the ASC_KEY_ID/ASC_ISSUER_ID/ASC_PRIVATE_KEY secrets set up
   for verify-purchase — nothing new to configure here):
     supabase functions deploy apple-server-notifications

2. In App Store Connect: your app > General > App Information > App Store
   Server Notifications. Set both the Production and Sandbox URLs to:
     https://<project-ref>.supabase.co/functions/v1/apple-server-notifications
   Version: V2.

3. Test in Sandbox first:
   - Personal Premium: make a sandbox subscription purchase, then either wait
     for a sandbox renewal (sandbox subscriptions renew every few minutes
     instead of monthly, specifically so you don't have to wait) or refund it
     from App Store Connect > Sandbox testers, and confirm
     premium_subscriptions.status / profiles.is_premium update.
   - Team Premium: make a sandbox non-consumable purchase, refund it from
     App Store Connect > Sandbox testers, and confirm
     team_premium_purchases.status / teams.premium_9aside|11aside flip back
     to false.
*/
