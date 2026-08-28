// Called by the app right after expo-iap reports a completed purchase —
// verifies it against Apple's own servers before granting anything, then
// flips profiles.is_premium. Nothing in the client's own claim (that a
// purchase "succeeded") is trusted; Apple's live API is the only source of
// truth this writes from. Deployment steps at the bottom.
//
// NOT wired up from the app yet — app/premium.tsx still needs the real
// expo-iap purchase flow once that package is installed and its current API
// can be read directly from node_modules (see lib/premium.ts).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { APPLE_BUNDLE_ID, fetchAppleSubscriptionStatus, fetchAppleTransaction } from '../_shared/apple-app-store.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  // Identify the caller from their own Supabase session — never take a
  // profile id from the request body, only from a verified JWT, so nobody
  // can grant Premium to someone else's account.
  const supabaseAsUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser();
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 });
  const profileId = userData.user.id;

  let body: { transactionId?: string; productId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  const { transactionId, productId } = body;
  if (!transactionId || !productId) {
    return new Response('Missing transactionId/productId', { status: 400 });
  }

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

  const status = await fetchAppleSubscriptionStatus(transaction.originalTransactionId, productId);
  if (!status) {
    return new Response(JSON.stringify({ error: 'Could not read subscription status' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  await supabaseAdmin.from('premium_subscriptions').upsert(
    {
      profile_id: profileId,
      platform: 'ios',
      product_id: productId,
      original_transaction_id: transaction.originalTransactionId,
      status: status.active ? 'active' : 'expired',
      expires_at: status.expiresAt ? new Date(status.expiresAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'platform,original_transaction_id' }
  );

  await supabaseAdmin.from('profiles').update({ is_premium: status.active }).eq('id', profileId);

  return new Response(JSON.stringify({ active: status.active }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
DEPLOYMENT:

1. Get an App Store Connect API key: App Store Connect > Users and Access >
   Integrations > App Store Connect API > Team Keys > Generate. Needs at
   least the "App Manager" role. Download the .p8 file ONCE — Apple won't let
   you download it again, so keep it somewhere safe.

2. Set secrets (values come from the key you just made):
     supabase secrets set ASC_KEY_ID=<Key ID>
     supabase secrets set ASC_ISSUER_ID=<Issuer ID, shown on the same page>
     supabase secrets set ASC_PRIVATE_KEY="$(cat AuthKey_XXXXXXXXXX.p8)"

3. Deploy:
     supabase functions deploy verify-purchase

4. Once expo-iap is installed and wired up client-side, call this right
   after a purchase completes, before calling finishTransaction():
     const { data: { session } } = await supabase.auth.getSession();
     const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-purchase`, {
       method: 'POST',
       headers: {
         Authorization: `Bearer ${session.access_token}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({ transactionId, productId }),
     });
   Only call finishTransaction() after this returns { active: true } —
   finishing the transaction with Apple before confirming the grant landed
   risks a purchase that's "done" on Apple's side but never actually turned
   on Premium.
*/
