// The venue owner's Stripe Connect links (P4d). See handler.ts.
//
// Body: { venueId, action: 'onboard' | 'dashboard' }
// Returns { url }: Stripe's onboarding link, or the Express dashboard.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { dbFromSupabase } from '../_shared/db.ts';
import { connectOnboarding } from './handler.ts';

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  try {
    const result = await connectOnboarding(
      {
        stripe,
        db: dbFromSupabase(createClient(supabaseUrl, serviceRoleKey)),
        returnUrl: `${supabaseUrl}/functions/v1/connect-return`,
        now: () => new Date(),
      },
      { id: userData.user.id, email: userData.user.email },
      body,
    );
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('connect-onboarding failed:', err);
    return new Response(JSON.stringify({ error: 'stripe_unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/*
DEPLOYMENT (Panos, after the pay_payouts migrations):
  supabase functions deploy connect-onboarding
  supabase functions deploy connect-return --no-verify-jwt
Uses the existing STRIPE_SECRET_KEY secret. Connect must be switched on in
the Stripe dashboard first (see the P4d pull request).
*/
