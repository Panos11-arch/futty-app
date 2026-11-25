// End-to-end seed for STAGING (docs/testing/maestro.md). The Expo workflow
// runs it before the Maestro jobs:
//
//   npx --yes tsx@4.20.6 scripts/e2e-seed/seed.ts
//
// It reads STAGING_SUPABASE_URL, STAGING_SUPABASE_SERVICE_ROLE_KEY (an
// sb_secret_ key or a legacy service_role JWT), STAGING_STRIPE_SECRET_KEY
// (sk_test_ only) and STAGING_E2E_PASSWORD, checks them with
// lib/e2e-guard.ts before anything else, then resets and re-creates only
// e2e data:
//   1. the four e2e logins (@e2e.futty.app), confirmed, with the password;
//   2. any booking a run left behind at the E2E venue, cancelled as its
//      booker through the app's own path (cancellation_quote, then the
//      cancel-booking function), so Stripe and the ledger stay right;
//   3. the e2e logins' notifications and saved searches, and the venue's
//      blocks and closures, deleted;
//   4. the venue "E2E Arena": two 5-a-side pitches, one €60 price, open
//      07:00 to midnight every day, live;
//   5. its Stripe TEST connected account, made the way connect-onboarding
//      makes it (same parameters and idempotency key), kept once it exists.
// Money rows (ledger, payments, cancellations) are never deleted.
//
// With E2E_SEED_OUTPUT set it writes { slot_day, ios_start, android_start,
// venue_id } there as JSON for the workflow to hand to the flows.
//
// --local runs against a local stack (http://127.0.0.1:54321 only) with a
// fake Stripe, to try the seed without any remote service.
import { writeFileSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  assertNotProductionKey,
  assertServiceKey,
  assertStagingTarget,
} from '../../lib/e2e-guard';
import {
  E2E_DATE_OF_BIRTH,
  E2E_EMAIL_DOMAIN,
  E2E_FORMAT,
  E2E_OPENING_HOURS,
  E2E_PITCHES,
  E2E_PRICE_CENTS,
  E2E_USERS,
  E2E_VENUE,
  type Platform,
} from './config';
import { assertE2eVenue, selectBookingsToCancel, selectE2eUsers, type BookingRow } from './reset';
import { e2eSlot } from './slot';

export type SeedEnv = { url: string; serviceKey: string; stripeKey: string; password: string };

/** Reads and checks the environment. Throws before anything is created. */
export function readSeedEnv(env: Record<string, string | undefined>, { local = false } = {}): SeedEnv {
  const url = (env.STAGING_SUPABASE_URL ?? '').trim();
  const serviceKey = (env.STAGING_SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const stripeKey = (env.STAGING_STRIPE_SECRET_KEY ?? '').trim();
  const password = env.STAGING_E2E_PASSWORD ?? '';

  assertStagingTarget(url, stripeKey);
  assertServiceKey(serviceKey);
  assertNotProductionKey(serviceKey);
  if (!/^(sk|rk)_test_/.test(stripeKey)) {
    throw new Error('e2e seed: STAGING_STRIPE_SECRET_KEY must be a Stripe TEST secret key (sk_test_).');
  }
  if (password.length < 8) throw new Error('e2e seed: STAGING_E2E_PASSWORD must be at least 8 characters.');
  const isLocal = /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(url);
  if (local && !isLocal) throw new Error('e2e seed: --local only runs against http://127.0.0.1:54321.');
  if (!local && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
    throw new Error('e2e seed: STAGING_SUPABASE_URL must be https://<staging-ref>.supabase.co.');
  }
  return { url: url.replace(/\/$/, ''), serviceKey, stripeKey, password };
}

export type StripeAccount = { id: string; livemode: boolean; deleted?: boolean };
export type StripeApi = {
  retrieveAccount(id: string): Promise<StripeAccount | null>;
  createAccount(params: Record<string, string>, idempotencyKey: string): Promise<StripeAccount>;
};

/** Stripe's REST API, test key only (readSeedEnv checked it). */
export function stripeRest(secretKey: string, fetchImpl: typeof fetch = fetch): StripeApi {
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  return {
    async retrieveAccount(id) {
      const res = await fetchImpl(`https://api.stripe.com/v1/accounts/${encodeURIComponent(id)}`, { headers });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`Stripe: retrieving ${id} failed (${res.status}).`);
      return (await res.json()) as StripeAccount;
    },
    async createAccount(params, idempotencyKey) {
      const res = await fetchImpl('https://api.stripe.com/v1/accounts', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': idempotencyKey },
        body: new URLSearchParams(params).toString(),
      });
      if (!res.ok) throw new Error(`Stripe: creating the connected account failed (${res.status}): ${await res.text()}`);
      return (await res.json()) as StripeAccount;
    },
  };
}

/** For --local: no network, a made-up test account. */
export function fakeStripe(): StripeApi {
  return {
    retrieveAccount: async (id) => ({ id, livemode: false }),
    createAccount: async () => ({ id: 'acct_e2elocalfake', livemode: false }),
  };
}

/** The parameters connect-onboarding sends (supabase/functions/
 *  connect-onboarding/handler.ts), as form fields. */
export function connectAccountParams(): Record<string, string> {
  return {
    type: 'express',
    country: 'CY',
    email: `e2e-venue@${E2E_EMAIL_DOMAIN}`,
    'business_profile[name]': E2E_VENUE.name,
    'capabilities[transfers][requested]': 'true',
    'metadata[venue_id]': E2E_VENUE.id,
  };
}

/** idempotencyKeys.connectAccount in supabase/functions/_shared/money.ts. */
export const connectAccountKey = (venueId: string) => `connect-account-${venueId}-test`;

/**
 * Each test login's starting level: a questionnaire level, so Home never
 * opens the five starting questions for it. Home opens them once the server
 * answers; on a slow simulator that was after the flow had moved on, so the
 * questions slid over Home and "home-screen is visible" failed. The flows
 * still skip them if they ever show.
 */
export function e2eStartingLevel(profileId: string) {
  return {
    profile_id: profileId,
    level: 4,
    provisional: true,
    reliability_pct: 0,
    competitive_matches: 0,
    source: 'questionnaire' as const,
  };
}

/**
 * The server's default level (match_rate_players makes it: 3.0, source
 * 'default') before any competitive match. Home still offers the questions
 * for it (startingLevelOffered), so the seed replaces exactly this row and
 * keeps a level a match has moved.
 */
export const E2E_UNTOUCHED_LEVEL = { source: 'default', competitive_matches: 0 } as const;

export type SeedOutput = { slot_day: string; ios_start: string; android_start: string; venue_id: string };

export type SeedDeps = {
  env: SeedEnv;
  /** The service-role client. */
  admin: SupabaseClient;
  /** A client signed in as that e2e login (to cancel the way the app does). */
  signInAs: (email: string) => Promise<SupabaseClient>;
  stripe: StripeApi;
  now: () => Date;
  log: (line: string) => void;
};

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`e2e seed: ${what} failed: ${result.error.message}`);
  return result.data;
}

export async function runSeed(deps: SeedDeps): Promise<SeedOutput> {
  const { admin, env, log } = deps;
  const now = deps.now();

  // ---- 1. The e2e logins -------------------------------------------------
  const existing: { id: string; email?: string | null }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`e2e seed: listing logins failed: ${error.message}`);
    existing.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const found = new Map(selectE2eUsers(existing).map((u) => [u.email!.trim().toLowerCase(), u.id]));
  const ids = new Map<string, string>();
  for (const user of E2E_USERS) {
    const attributes = {
      password: env.password,
      email_confirm: true,
      user_metadata: { username: user.username, full_name: user.fullName, date_of_birth: E2E_DATE_OF_BIRTH },
    };
    let id = found.get(user.email);
    if (id) {
      const { error } = await admin.auth.admin.updateUserById(id, attributes);
      if (error) throw new Error(`e2e seed: updating ${user.email} failed: ${error.message}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email: user.email, ...attributes });
      if (error || !data.user) throw new Error(`e2e seed: creating ${user.email} failed: ${error?.message ?? 'no user'}`);
      id = data.user.id;
    }
    ids.set(user.email, id);
    check(
      await admin
        .from('profiles')
        .update({ username: user.username, full_name: user.fullName, date_of_birth: E2E_DATE_OF_BIRTH })
        .eq('id', id),
      `setting ${user.email}'s username`,
    );
    // Kept if it's already there (a match may have moved it)...
    const start = e2eStartingLevel(id);
    check(
      await admin.from('player_levels').upsert(start, { onConflict: 'profile_id', ignoreDuplicates: true }),
      `giving ${user.email} a starting level`,
    );
    // ...unless it's still the untouched default, which Home offers the questions for.
    check(
      await admin
        .from('player_levels')
        .update({ level: start.level, source: start.source })
        .eq('profile_id', id)
        .eq('source', E2E_UNTOUCHED_LEVEL.source)
        .eq('competitive_matches', E2E_UNTOUCHED_LEVEL.competitive_matches),
      `replacing ${user.email}'s default level`,
    );
  }
  const e2eUserIds = new Set(ids.values());
  log(`logins: ${E2E_USERS.map((u) => u.email).join(', ')}`);

  // ---- 2. Bookings a run left behind --------------------------------------
  const venueRow = check(
    await admin.from('venues').select('name').eq('id', E2E_VENUE.id).maybeSingle(),
    'reading the E2E venue',
  ) as { name: string } | null;
  assertE2eVenue(venueRow);

  const open = check(
    await admin
      .from('venue_bookings')
      .select('id, venue_id, created_by, status, booking_day, start_time')
      .eq('venue_id', E2E_VENUE.id)
      .in('created_by', [...e2eUserIds])
      .neq('status', 'cancelled'),
    'reading leftover bookings',
  ) as BookingRow[];
  const emailFor = new Map([...ids].map(([email, id]) => [id, email]));
  for (const booking of selectBookingsToCancel(open, { e2eUserIds, now })) {
    const asBooker = await deps.signInAs(emailFor.get(booking.created_by!)!);
    await cancelAsBooker(asBooker, booking.id, log);
  }

  // ---- 3. Other e2e-only rows ---------------------------------------------
  check(await admin.from('notifications').delete().in('profile_id', [...e2eUserIds]), 'clearing e2e notifications');
  check(await admin.from('saved_searches').delete().in('profile_id', [...e2eUserIds]), 'clearing e2e saved searches');
  check(await admin.from('venue_blocks').delete().eq('venue_id', E2E_VENUE.id), 'clearing E2E venue blocks');
  check(await admin.from('venue_closures').delete().eq('venue_id', E2E_VENUE.id), 'clearing E2E venue closures');

  // ---- 4. The venue --------------------------------------------------------
  check(
    await admin.from('venues').upsert({
      id: E2E_VENUE.id,
      name: E2E_VENUE.name,
      city: E2E_VENUE.city,
      address: E2E_VENUE.address,
      is_live: true,
      allows_6v6_on_5s: false,
    }),
    'writing the E2E venue',
  );
  check(
    await admin.from('pitches').upsert(
      E2E_PITCHES.map((p) => ({
        id: p.id,
        venue_id: E2E_VENUE.id,
        name: p.name,
        size: E2E_FORMAT,
        formats: [E2E_FORMAT],
        is_open: true,
        sort_order: p.sortOrder,
      })),
    ),
    'writing the E2E pitches',
  );
  check(
    await admin.from('opening_hours').upsert(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ venue_id: E2E_VENUE.id, weekday, ...E2E_OPENING_HOURS })),
    ),
    'writing the E2E opening hours',
  );
  check(
    await admin
      .from('price_rules')
      .upsert({ venue_id: E2E_VENUE.id, format: E2E_FORMAT, price_cents: E2E_PRICE_CENTS }),
    'writing the E2E price',
  );
  log(`venue: ${E2E_VENUE.name} (${E2E_VENUE.id}), ${E2E_PITCHES.length} pitches, ${E2E_FORMAT} at ${E2E_PRICE_CENTS} cents`);

  // ---- 5. Its Stripe TEST connected account --------------------------------
  const account = check(
    await admin.from('venue_stripe_accounts').select('stripe_account_id, livemode').eq('venue_id', E2E_VENUE.id).maybeSingle(),
    'reading the E2E Stripe account',
  ) as { stripe_account_id: string; livemode: boolean } | null;
  let accountId: string | null = null;
  if (account && account.livemode === false) {
    const atStripe = await deps.stripe.retrieveAccount(account.stripe_account_id);
    if (atStripe && !atStripe.deleted) accountId = atStripe.id;
  }
  if (!accountId) {
    // A replaced account needs a new key: Stripe would answer the old one
    // with the account that no longer exists.
    const key = account ? `${connectAccountKey(E2E_VENUE.id)}-${now.toISOString().slice(0, 10)}` : connectAccountKey(E2E_VENUE.id);
    const created = await deps.stripe.createAccount(connectAccountParams(), key);
    if (created.livemode) throw new Error('e2e seed: Stripe made a LIVE account. Stopping.');
    accountId = check(
      await admin.rpc('connect_account_created', { p_venue_id: E2E_VENUE.id, p_account_id: created.id, p_livemode: false }),
      'recording the E2E Stripe account',
    ) as string;
  }
  log(`stripe: test connected account ${accountId}`);

  // ---- The slots, which must be free now -----------------------------------
  const slots = { ios: e2eSlot('ios', now), android: e2eSlot('android', now) };
  for (const platform of ['ios', 'android'] as Platform[]) {
    const slot = slots[platform];
    const clash = check(
      await admin
        .from('venue_bookings')
        .select('id')
        .eq('venue_id', E2E_VENUE.id)
        .eq('booking_day', slot.day)
        .neq('status', 'cancelled')
        .lt('start_time', slot.end)
        .gt('end_time', slot.start),
      `checking the ${platform} slot`,
    ) as { id: string }[];
    if (clash.length > 0) {
      throw new Error(`e2e seed: the ${platform} slot ${slot.day} ${slot.start} still has booking ${clash[0].id}. Stopping.`);
    }
  }
  return { slot_day: slots.ios.day, ios_start: slots.ios.start, android_start: slots.android.start, venue_id: E2E_VENUE.id };
}

/** As the app does it (lib/booking-detail.ts confirmCancellation): the
 *  quote first, then cancel-booking with exactly that quote. A booker who
 *  paid for everyone can only cancel the whole booking; otherwise their
 *  own spot. */
async function cancelAsBooker(client: SupabaseClient, bookingId: string, log: (line: string) => void) {
  for (const scope of ['whole_team', 'my_spot'] as const) {
    const quote = await client.rpc('cancellation_quote', { p_booking_id: bookingId, p_scope: scope });
    if (quote.error || !quote.data) continue;
    const { error } = await client.functions.invoke('cancel-booking', {
      body: { bookingId, scope, quote: (quote.data as { quote: string }).quote },
    });
    if (error) throw new Error(`e2e seed: cancelling leftover booking ${bookingId} failed: ${error.message}`);
    log(`cancelled leftover booking ${bookingId} (${scope})`);
    return;
  }
  throw new Error(`e2e seed: leftover booking ${bookingId} has no cancellation quote. Stopping.`);
}

export type Factories = {
  createClient: (url: string, key: string) => SupabaseClient;
};

/** Checks the environment first; only then makes a client. */
export async function seedMain(
  rawEnv: Record<string, string | undefined>,
  args: string[],
  factories: Factories = {
    createClient: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  },
): Promise<SeedOutput> {
  const local = args.includes('--local');
  const env = readSeedEnv(rawEnv, { local });
  const admin = factories.createClient(env.url, env.serviceKey);
  const output = await runSeed({
    env,
    admin,
    signInAs: async (email) => {
      const client = factories.createClient(env.url, env.serviceKey);
      const { error } = await client.auth.signInWithPassword({ email, password: env.password });
      if (error) throw new Error(`e2e seed: signing in as ${email} failed: ${error.message}`);
      return client;
    },
    stripe: local ? fakeStripe() : stripeRest(env.stripeKey),
    now: () => new Date(),
    log: (line) => console.log(`e2e seed: ${line}`),
  });
  if (rawEnv.E2E_SEED_OUTPUT) writeFileSync(rawEnv.E2E_SEED_OUTPUT, JSON.stringify(output));
  console.log(JSON.stringify(output));
  return output;
}

// Run directly (npx tsx scripts/e2e-seed/seed.ts), not when Jest imports it.
if (typeof require !== 'undefined' && require.main === module) {
  seedMain(process.env, process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
