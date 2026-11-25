// Deletes the caller's own account, from inside the app (Apple requires
// in-app deletion for any app that lets people create an account —
// App Store Review Guideline 5.1.1(v)). The logic is in handler.ts.
//
// What it does:
//   1. Refuses while the caller still has money in play — a card hold or
//      charge on an upcoming game, or an upcoming app booking they made (not
//      a walk-in they added as staff, nor their training blocks). They
//      need to cancel those first, so nobody else's game is left unpaid.
//      Then refuses while they owe money: any unsettled debt to a venue or
//      to Futty (owed.ts; spec 13 "Deleting an account").
//      Then, for a Sign in with Apple account, revokes the user's Apple
//      token with the fresh code the app sends (App Review 5.1.1(v), P13),
//      after checking the code is for the account's own Apple ID. If that
//      fails nothing is deleted, so the user can retry. From Android or web
//      (no Apple sheet, so no code) the account is deleted without the
//      revoke, and that is logged (decided 13 November, for Panos to confirm).
//   2. Deletes their saved cards (the Stripe customer), push tokens,
//      follows/blocks and saved searches (links.ts).
//      Also their Futty AI chats and the photos in them (S13A).
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

import { deleteAiChats } from '../_shared/ai-chats.ts';
import { APPLE_BUNDLE_ID } from '../_shared/apple-app-store.ts';
import { revokeAppleToken } from '../_shared/apple-sign-in.ts';
import { getCallerId } from '../_shared/caller.ts';
import { cyprusToday } from '../_shared/cyprus-time.ts';
import { type Body, deleteAccount } from './handler.ts';
import { deleteAccountLinks } from './links.ts';
import { SCRUBBED_PROFILE } from './scrub.ts';
import { type Db as OwedDb, owedCents } from './owed.ts';
import { type Db, hasUpcomingGames } from './upcoming.ts';

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

      // Walk-ins a staff member added and an owner's training blocks don't
      // count: see upcoming.ts (P6).
      hasMoneyInPlay: (id, today) => hasUpcomingGames(admin as unknown as Db, id, today),

      // Unsettled debts, the same source as the Payments "You owe" screen.
      owedCents: (id) => owedCents(admin as unknown as OwedDb, id),

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
        // Futty AI chats and their photos (S13A): photos first, from the
        // chats' messages; the chats go even if a photo can't.
        const { data: chats, error: chatsError } = await admin
          .from('ai_chats')
          .select('id, ai_chat_messages(photo_paths)')
          .eq('profile_id', id);
        if (chatsError) console.error(`delete-account: Futty AI chats not read for ${id}:`, chatsError.message);
        const ai = await deleteAiChats(
          {
            async removePhotos(paths) {
              const { error } = await admin.storage.from('ai-chat-photos').remove(paths);
              if (error) throw new Error(error.message);
            },
            async deleteChats(ids) {
              const { error } = await admin.from('ai_chats').delete().in('id', ids);
              if (error) throw new Error(error.message);
            },
          },
          (chats ?? []).map((c: { id: string; ai_chat_messages: { photo_paths: string[] }[] }) => ({
            chat_id: c.id,
            photo_paths: c.ai_chat_messages.flatMap((m) => m.photo_paths),
          })),
          { keepChatsIfPhotosFail: false },
        ).catch((err) => ({ deleted: 0, photoError: err instanceof Error ? err.message : String(err) }));
        if (ai.photoError) console.error(`delete-account: Futty AI chats or photos not deleted for ${id}:`, ai.photoError);

        const failed = await deleteAccountLinks(admin, id);
        if (failed.length > 0) console.error(`delete-account: links not deleted for ${id}: ${failed.join('; ')}`);
      },

      async scrubProfile(id) {
        const { error } = await admin
          .from('profiles')
          .update(SCRUBBED_PROFILE)
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
