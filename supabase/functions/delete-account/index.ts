// Deletes the caller's own account, from inside the app (Apple requires
// in-app deletion for any app that lets people create an account —
// App Store Review Guideline 5.1.1(v)). The logic is in handler.ts.
//
// What it does:
//   1. Refuses while the caller still has money in play — a card hold or
//      charge on an upcoming game, or an upcoming booking they made. They
//      need to cancel those first, so nobody else's game is left unpaid.
//      Then, for a Sign in with Apple account, revokes the user's Apple
//      token with the fresh code the app sends (App Review 5.1.1(v), P13),
//      after checking the code is for the account's own Apple ID. If that
//      fails nothing is deleted, so the user can retry. From Android or web
//      (no Apple sheet, so no code) the account is deleted without the
//      revoke, and that is logged (decided 13 November, for Panos to confirm).
//   2. Deletes their saved cards (the Stripe customer), push tokens and
//      follows/blocks.
//   3. Clears every personal field on their profile. Match stats stay, under
//      "Deleted player", so league tables and opponents' records don't
//      change retroactively.
//   4. Soft-deletes the login (auth user): it can never sign in again and
//      the email is freed, but the row stays so past bookings/results that
//      point at it don't break.
//
// Body: { appleAuthorizationCode?: string, platform?: 'ios' | 'android' | 'web' }.
//
// Deploy:
//   supabase functions deploy delete-account

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

import { APPLE_BUNDLE_ID } from '../_shared/apple-app-store.ts';
import { revokeAppleToken } from '../_shared/apple-sign-in.ts';
import { getCallerId } from '../_shared/caller.ts';
import { cyprusToday } from '../_shared/cyprus-time.ts';
import { type Body, deleteAccount } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

Deno.serve(async (req) => {
  const userId = await getCallerId(req);
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const raw = await req.json().catch(() => null);
  const body: Body = {
    appleAuthorizationCode: typeof raw?.appleAuthorizationCode === 'string' ? raw.appleAuthorizationCode : undefined,
    platform: typeof raw?.platform === 'string' ? raw.platform : undefined,
  };

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const result = await deleteAccount(
    {
      // Booking days are Cyprus dates; the server's UTC date is a day behind
      // between midnight and 02:00 in Cyprus.
      today: cyprusToday(),

      async hasMoneyInPlay(id, today) {
        const { data: activeShares } = await admin
          .from('booking_payment_shares')
          .select('id, venue_bookings!inner(booking_day, status)')
          .eq('profile_id', id)
          .in('status', ['authorized', 'paid'])
          .gte('venue_bookings.booking_day', today)
          .neq('venue_bookings.status', 'cancelled')
          .limit(1);
        const { data: upcomingBookings } = await admin
          .from('venue_bookings')
          .select('id')
          .eq('created_by', id)
          .gte('booking_day', today)
          .neq('status', 'cancelled')
          .limit(1);
        return (activeShares?.length ?? 0) > 0 || (upcomingBookings?.length ?? 0) > 0;
      },

      async loadIdentities(id) {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error || !data.user) return null;
        // GoTrue's identity `id` is its provider_id: for Apple, the Apple ID's sub.
        return (data.user.identities ?? []).map((identity) => ({ provider: identity.provider, id: identity.id }));
      },

      revokeAppleToken: (code, expectedSub) =>
        revokeAppleToken(code, expectedSub, {
          teamId: Deno.env.get('APPLE_TEAM_ID')!,
          keyId: Deno.env.get('APPLE_SIGN_IN_KEY_ID')!,
          privateKeyPem: Deno.env.get('APPLE_SIGN_IN_PRIVATE_KEY')!,
          clientId: APPLE_BUNDLE_ID,
        }),

      async deleteSavedCards(id) {
        const { data: profile } = await admin
          .from('profiles')
          .select('stripe_customer_id')
          .eq('id', id)
          .maybeSingle();
        if (!profile?.stripe_customer_id) return;
        try {
          await stripe.customers.del(profile.stripe_customer_id);
        } catch (err) {
          // Already deleted in Stripe is fine; anything else is logged so it can
          // be removed by hand — it must not block the user's deletion request.
          console.error(`delete-account: Stripe customer delete failed for ${id}:`, err);
        }
      },

      async deleteLinks(id) {
        await admin.from('push_tokens').delete().eq('profile_id', id);
        await admin.from('user_follows').delete().eq('follower_id', id);
        await admin.from('user_follows').delete().eq('target_type', 'player').eq('target_id', id);
        await admin.from('blocked_users').delete().eq('blocker_id', id);
      },

      async scrubProfile(id) {
        const { error } = await admin
          .from('profiles')
          .update({
            email: null,
            username: null,
            full_name: 'Deleted player',
            phone: null,
            gender: null,
            date_of_birth: null,
            bio: null,
            city: null,
            position: null,
            preferred_foot: null,
            show_phone_publicly: false,
            stripe_customer_id: null,
          })
          .eq('id', id);
        return error ? error.message : null;
      },

      async deleteLogin(id) {
        const { error } = await admin.auth.admin.deleteUser(id, true);
        return error ? error.message : null;
      },

      log: (message, err) => (err === undefined ? console.warn(message) : console.error(message, err)),
    },
    userId,
    body
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
