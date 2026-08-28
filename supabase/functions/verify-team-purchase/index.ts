// Called by the app right after expo-iap reports a completed Team Premium
// purchase — verifies it against Apple's own servers before granting
// anything, then flips teams.premium_9aside/premium_11aside. Same trust
// model as verify-purchase (Personal Premium), but for a non-consumable,
// per-team product instead of a per-profile subscription — no subscription
// status check needed, just "does this transaction exist, match this app
// and product, and hasn't been revoked". Deployment steps at the bottom.
//
// NOT wired up from the app yet — same expo-iap caveat as verify-purchase
// (see lib/premium.ts).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { APPLE_BUNDLE_ID, fetchAppleTransaction } from '../_shared/apple-app-store.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

// Maps each Team Premium App Store product id to the league format it
// unlocks — keep in sync with whatever product ids get created in App Store
// Connect, and with PREMIUM_FORMAT_PRICES in lib/teams.ts.
const PRODUCT_FORMATS: Record<string, '9-a-side' | '11-a-side'> = {
  team_premium_9aside: '9-a-side',
  team_premium_11aside: '11-a-side',
};

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  // Identify the caller from their own Supabase session — the captain check
  // below relies on this being real, not on anything the client claims.
  const supabaseAsUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser();
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 });
  const profileId = userData.user.id;

  let body: { transactionId?: string; productId?: string; teamId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  const { transactionId, productId, teamId } = body;
  if (!transactionId || !productId || !teamId) {
    return new Response('Missing transactionId/productId/teamId', { status: 400 });
  }

  const format = PRODUCT_FORMATS[productId];
  if (!format) return new Response('Unknown product', { status: 400 });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Only a captain of this team can spend a purchase on it — mirrors the
  // check set_team_premium used to do; enforced here now since that
  // function's execute grant has been revoked (team-premium-payments.sql).
  const { data: captainRow } = await supabaseAdmin
    .from('team_members')
    .select('profile_id')
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .eq('role', 'captain')
    .maybeSingle();
  if (!captainRow) return new Response('Not a captain of this team', { status: 403 });

  const transaction = await fetchAppleTransaction(transactionId);
  if (!transaction) {
    return new Response(JSON.stringify({ error: 'Apple could not verify this transaction' }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (transaction.bundleId !== APPLE_BUNDLE_ID || transaction.productId !== productId) {
    return new Response(JSON.stringify({ error: 'Transaction does not match this app/product' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error: upsertError } = await supabaseAdmin.from('team_premium_purchases').upsert(
    {
      team_id: teamId,
      format,
      product_id: productId,
      original_transaction_id: transaction.originalTransactionId,
      purchased_by: profileId,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'original_transaction_id' }
  );
  if (upsertError) {
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const column = format === '9-a-side' ? 'premium_9aside' : 'premium_11aside';
  await supabaseAdmin.from('teams').update({ [column]: true }).eq('id', teamId);

  return new Response(JSON.stringify({ active: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT:

1. Uses the same ASC_KEY_ID/ASC_ISSUER_ID/ASC_PRIVATE_KEY secrets as
   verify-purchase — nothing new to set if that's already deployed.

2. Create the two non-consumable products in App Store Connect: your app >
   Features > In-App Purchases > + > Non-Consumable. Use ids
   team_premium_9aside / team_premium_11aside (or your own — just keep
   PRODUCT_FORMATS above in sync), priced to match
   PREMIUM_FORMAT_PRICES in lib/teams.ts (€45 / €59).

3. Deploy:
     supabase functions deploy verify-team-purchase

4. Once expo-iap is installed and wired up client-side, call this right
   after a purchase completes, before calling finishTransaction() — same
   pattern as verify-purchase, plus a teamId in the body:
     body: JSON.stringify({ transactionId, productId, teamId })
*/
