// Deletes the caller's own account, from inside the app (Apple requires
// in-app deletion for any app that lets people create an account —
// App Store Review Guideline 5.1.1(v)).
//
// What it does:
//   1. Refuses while the caller still has money in play — a card hold or
//      charge on an upcoming game, or an upcoming booking they made. They
//      need to cancel those first, so nobody else's game is left unpaid.
//   2. Deletes their saved cards (the Stripe customer), push tokens and
//      follows/blocks.
//   3. Clears every personal field on their profile. Match stats stay, under
//      "Deleted player", so league tables and opponents' records don't
//      change retroactively.
//   4. Soft-deletes the login (auth user): it can never sign in again and
//      the email is freed, but the row stays so past bookings/results that
//      point at it don't break.
//
// Deploy:
//   supabase functions deploy delete-account

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

import { getCallerId } from '../_shared/caller.ts';
import { cyprusToday } from '../_shared/cyprus-time.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const userId = await getCallerId(req);
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  // Booking days are Cyprus dates; the server's UTC date is a day behind
  // between midnight and 02:00 in Cyprus.
  const today = cyprusToday();

  // 1. Money still in play?
  const { data: activeShares } = await admin
    .from('booking_payment_shares')
    .select('id, venue_bookings!inner(booking_day, status)')
    .eq('profile_id', userId)
    .in('status', ['authorized', 'paid'])
    .gte('venue_bookings.booking_day', today)
    .neq('venue_bookings.status', 'cancelled')
    .limit(1);
  const { data: upcomingBookings } = await admin
    .from('venue_bookings')
    .select('id')
    .eq('created_by', userId)
    .gte('booking_day', today)
    .neq('status', 'cancelled')
    .limit(1);
  if ((activeShares?.length ?? 0) > 0 || (upcomingBookings?.length ?? 0) > 0) {
    return json(
      {
        error:
          'You still have upcoming games. Cancel your bookings (or wait until they have been played) and then try again.',
      },
      409
    );
  }

  // 2. Saved cards and device links.
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.stripe_customer_id) {
    try {
      await stripe.customers.del(profile.stripe_customer_id);
    } catch (err) {
      // Already deleted in Stripe is fine; anything else is logged so it can
      // be removed by hand — it must not block the user's deletion request.
      console.error(`delete-account: Stripe customer delete failed for ${userId}:`, err);
    }
  }
  await admin.from('push_tokens').delete().eq('profile_id', userId);
  await admin.from('user_follows').delete().eq('follower_id', userId);
  await admin.from('user_follows').delete().eq('target_type', 'player').eq('target_id', userId);
  await admin.from('blocked_users').delete().eq('blocker_id', userId);

  // 3. Personal data off the profile. Stats/XP columns are left alone.
  const { error: scrubError } = await admin
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
    .eq('id', userId);
  if (scrubError) {
    return json({ error: `Could not delete your profile details: ${scrubError.message}` }, 500);
  }

  // 4. The login itself.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId, true);
  if (deleteError) {
    return json({ error: `Could not delete your login: ${deleteError.message}` }, 500);
  }

  return json({ deleted: true });
});
