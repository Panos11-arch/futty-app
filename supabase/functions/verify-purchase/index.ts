// Called by the app right after expo-iap reports a completed purchase of
// Premium or Premium Plus (P1). Verifies it against Apple's own servers
// before granting anything; see handler.ts for the rules. Nothing in the
// client's own claim is trusted: Apple's live API is the only source of
// truth this writes from, and apply_premium_subscription (service role)
// sets profiles.premium_tier and is_premium. Deployment steps at the bottom.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { APPLE_BUNDLE_ID, fetchAppleSubscriptionState, fetchAppleTransaction } from '../_shared/apple-app-store.ts';
import { verifyPurchase } from './handler.ts';

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const result = await verifyPurchase(
    {
      bundleId: APPLE_BUNDLE_ID,
      fetchTransaction: fetchAppleTransaction,
      fetchSubscription: fetchAppleSubscriptionState,
      apply: async (a) => {
        const { data, error } = await supabaseAdmin.rpc('apply_premium_subscription', {
          p_profile_id: a.profileId,
          p_platform: 'ios',
          p_product_id: a.productId,
          p_original_transaction_id: a.originalTransactionId,
          p_active: a.active,
          p_expires_at: a.expiresAt,
        });
        return { tier: (data as string | null) ?? null, error: error?.message ?? null };
      },
    },
    userData.user.id,
    body,
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
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

3. Push the P1 migration (20261124220000_pay_p1_premium_plus.sql: the
   tier and apply_premium_subscription) first, then deploy:
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
