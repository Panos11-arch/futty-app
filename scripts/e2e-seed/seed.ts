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
//   1. the e2e logins (@e2e.futty.app): four players and two venue staff,
//      confirmed, with the password;
//   2. any booking a run left behind at the E2E venue, cancelled as its
//      booker through the app's own path (cancellation_quote, then the
//      cancel-booking function), so Stripe and the ledger stay right;
//   3. the e2e logins' notifications and saved searches, and the venue's
//      blocks and closures, deleted;
//   4. the venue "E2E Arena": two 5-a-side pitches, one €60 price, open
//      07:00 to midnight every day, live;
//   5. its Stripe TEST connected account, made the way connect-onboarding
//      makes it (same parameters and idempotency key), kept once it exists;
//   6. per platform, a pickup played 2 hours ago at the E2E venue, waiting
//      for its score (S13B, log-score.yaml), made again from scratch;
//   7. per platform, a venue-staff login's own test venue (not live) with a
//      phone booking tomorrow, not paid, for block-clashes.yaml (doc 28):
//      its blocks cleared and open walk-ins cancelled first;
//   8. a live city league in the e2e-only city "E2E" (S10, competition.yaml):
//      four teams, each captained by one player login; Season 1 started by
//      league_start_season; all six pairings played and final (their matches
//      confirmed, levels applied), made once and kept; one upcoming fixture
//      moved to 3 days ahead on every run. The power ranking picks the
//      results up on staging's next match_jobs_tick (every 15 minutes):
//      power_ranking_tick can't run through the API (pg_safeupdate refuses
//      its unqualified DELETE).
//   9. S10A (tournaments.yaml, tournament-admin.yaml): two e2e tournaments in
//      the e2e area, one Coming soon and one with sign-up open, set back to
//      that state on every run, with no teams; and, STAGING ONLY, the
//      platform-1 logins as app admins (seedMain has refused production
//      before this runs).
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
  E2E_ADMIN_EMAILS,
  E2E_DATE_OF_BIRTH,
  E2E_EMAIL_DOMAIN,
  E2E_FORMAT,
  E2E_LEAGUE,
  E2E_LEAGUE_KICKOFF,
  E2E_LEAGUE_RESULTS,
  E2E_LOG_MATCHES,
  E2E_OPENING_HOURS,
  E2E_PITCHES,
  E2E_PRICE_CENTS,
  E2E_STAFF,
  E2E_STAFF_BOOKING,
  E2E_TEAMS,
  E2E_TOURNAMENT_FIELDS,
  E2E_TOURNAMENTS,
  E2E_UPCOMING,
  E2E_USERS,
  E2E_VENUE,
  type E2eStaff,
  type Platform,
} from './config';
import {
  assertE2eLeague,
  assertE2eTeams,
  assertE2eTournaments,
  assertE2eVenue,
  selectBookingsToCancel,
  selectE2eUsers,
  type BookingRow,
} from './reset';
import { addDays, cyprusToday, cyprusWallTime, e2eSlot } from './slot';

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
    // 5.5: the old 4.0 on the 1.0-10.0 scale (S13B).
    level: 5.5,
    provisional: true,
    reliability_pct: 0,
    competitive_matches: 0,
    source: 'questionnaire' as const,
  };
}

/**
 * The server's default level (apply_match_levels makes it: 4.0 since S13B,
 * source 'default') before any competitive match. Home still offers the questions
 * for it (startingLevelOffered), so the seed replaces exactly this row and
 * keeps a level a match has moved.
 */
export const E2E_UNTOUCHED_LEVEL = { source: 'default', competitive_matches: 0 } as const;

/** S13B: the rows of a platform's game waiting for its score (log-score.yaml). */
export function e2eLogScoreMatch(platform: Platform, captainId: string, otherId: string, now: Date) {
  const ids = E2E_LOG_MATCHES[platform];
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  return {
    match: {
      id: ids.matchId,
      kind: 'pickup',
      format: E2E_FORMAT,
      players_per_side: 5,
      venue_id: E2E_VENUE.id,
      kickoff_at: at(-2),
      ends_at: at(-1),
      result_deadline_at: at(23),
      status: 'played',
    },
    sides: [
      { match_id: ids.matchId, side: 'a', label: 'Bibs', captain_profile_id: captainId },
      { match_id: ids.matchId, side: 'b', label: 'Non-bibs', captain_profile_id: null },
    ],
    players: [
      { id: ids.captainPlayerId, match_id: ids.matchId, profile_id: captainId, side: 'a' },
      { id: ids.otherPlayerId, match_id: ids.matchId, profile_id: otherId, side: 'b' },
    ],
  };
}

/** S20 (friends.yaml): each platform's two logins are friends, so Community
 *  → Friends lists the second, and its chat has Book together. The first
 *  asked; the second accepted. */
export function e2eFriendship(firstId: string, secondId: string) {
  return { requester_id: firstId, addressee_id: secondId, status: 'accepted' as const, accepted_at: new Date(0).toISOString() };
}

/** Doc 28 (block-clashes.yaml): a staff login's own test venue. Not live, so
 *  players never see it in Book; one 5-a-side pitch with the same €60 price
 *  and hours as the E2E Arena (add_counter_booking needs both). */
export function e2eStaffVenue(staff: E2eStaff, ownerId: string) {
  return {
    venue: {
      id: staff.venue.id,
      name: staff.venue.name,
      city: E2E_VENUE.city,
      address: E2E_VENUE.address,
      owner_profile_id: ownerId,
      is_live: false,
      allows_6v6_on_5s: false,
    },
    pitch: {
      id: staff.pitchId,
      venue_id: staff.venue.id,
      name: 'Pitch 1',
      size: E2E_FORMAT,
      formats: [E2E_FORMAT],
      is_open: true,
      sort_order: 1,
    },
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ venue_id: staff.venue.id, weekday, ...E2E_OPENING_HOURS })),
    price: { venue_id: staff.venue.id, format: E2E_FORMAT, price_cents: E2E_PRICE_CENTS },
  };
}

/** The phone booking the block will clash with: tomorrow in Cyprus, on the
 *  staff venue's pitch, not paid. add_counter_booking's arguments, called as
 *  the staff login, the way the dashboard adds one. */
export function e2eStaffBooking(staff: E2eStaff, now: Date) {
  return {
    p_venue_id: staff.venue.id,
    p_day: addDays(cyprusToday(now), E2E_STAFF_BOOKING.daysAhead),
    p_start: E2E_STAFF_BOOKING.start,
    p_end: E2E_STAFF_BOOKING.end,
    p_format: E2E_FORMAT,
    p_source: 'phone',
    p_contact_name: E2E_STAFF_BOOKING.contactName,
    p_contact_phone: E2E_STAFF_BOOKING.phone,
    p_pitch_id: staff.pitchId,
  };
}

/** S10: the e2e league's top-level row (the hub). In sign-up, as a city
 *  league stays while its season runs; Season 1 starts on start_date. */
export function e2eLeagueHub(now: Date) {
  return {
    id: E2E_LEAGUE.id,
    name: E2E_LEAGUE.name,
    scope: E2E_LEAGUE.scope,
    format: E2E_LEAGUE.format,
    stage: 'signup',
    capacity: E2E_LEAGUE.capacity,
    season_weeks: E2E_LEAGUE.seasonWeeks,
    kind: 'league',
    parent_league_id: null,
    start_date: addDays(cyprusToday(now), -E2E_LEAGUE.startDaysAgo),
  };
}

/** The four e2e teams, each with its captain as its only player. */
export function e2eTeamRows(idsByEmail: ReadonlyMap<string, string>) {
  const captain = (email: string) => {
    const id = idsByEmail.get(email);
    if (!id) throw new Error(`e2e seed: no login for ${email}.`);
    return id;
  };
  return {
    teams: [...E2E_TEAMS]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((t) => ({ id: t.id, name: t.name, city: E2E_LEAGUE.scope, roster_size: 1, created_by: captain(t.captainEmail) })),
    members: E2E_TEAMS.map((t) => ({ team_id: t.id, profile_id: captain(t.captainEmail), role: 'captain' })),
  };
}

export type E2eFixtureRow = { id: string; home_team_id: string | null; away_team_id: string | null; status: string | null };

export type E2eResultStep = {
  fixtureId: string;
  scheduled_day: string;
  scheduled_time: string;
  homeGoals: number;
  awayGoals: number;
};

/** The pairings still to play and finalise: the i-th result on Season 1's
 *  start + 3·i days. Completed ones are kept as they are (a second run
 *  changes nothing); the upcoming fixture isn't one of them. */
export function e2eResultPlan(fixtures: readonly E2eFixtureRow[], seasonStart: string): E2eResultStep[] {
  const steps: E2eResultStep[] = [];
  E2E_LEAGUE_RESULTS.forEach((r, i) => {
    const home = E2E_TEAMS[r.home].id;
    const away = E2E_TEAMS[r.away].id;
    const fixture = fixtures.find((f) => f.home_team_id === home && f.away_team_id === away);
    if (!fixture) {
      throw new Error(`e2e seed: Season 1 has no fixture ${E2E_TEAMS[r.home].name} v ${E2E_TEAMS[r.away].name}. Stopping.`);
    }
    if (fixture.status === 'completed') return;
    steps.push({
      fixtureId: fixture.id,
      scheduled_day: addDays(seasonStart, 3 * i),
      scheduled_time: E2E_LEAGUE_KICKOFF,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
    });
  });
  return steps;
}

/** The upcoming fixture (the reverse of iOS 1 v Android 1), 3 days ahead. */
export function e2eUpcomingFixture(seasonId: string, now: Date) {
  return {
    league_id: seasonId,
    home_team_id: E2E_TEAMS[E2E_UPCOMING.home].id,
    away_team_id: E2E_TEAMS[E2E_UPCOMING.away].id,
    venue_id: E2E_VENUE.id,
    scheduled_day: addDays(cyprusToday(now), E2E_UPCOMING.daysAhead),
    scheduled_time: E2E_UPCOMING.time,
    status: 'agreed',
  };
}

type E2eMatchPlayer = { id: string; profile_id: string | null; side: string | null };

/** A league match's final result, as both captains agreeing it would leave
 *  it (supabase/tests/helpers.sql tests.s10_result and s10_play): side a =
 *  home; every player checked in; each side's goals by its captain (its
 *  only player); a rating of 8 for a win, 7 a draw, 6 a loss. */
export function e2eMatchResult(
  match: { id: string; kickoff_at: string },
  players: readonly E2eMatchPlayer[],
  homeGoals: number,
  awayGoals: number,
) {
  const played = players.filter((p): p is E2eMatchPlayer & { profile_id: string } => !!p.profile_id);
  const goalsFor = (side: string) => (side === 'a' ? homeGoals : awayGoals);
  const goalsAgainst = (side: string) => (side === 'a' ? awayGoals : homeGoals);
  const goals: { match_id: string; side: string; sort: number; scorer_player_id: string; entered_by: string }[] = [];
  for (const side of ['a', 'b']) {
    const scorer = played.find((p) => p.side === side);
    if (!scorer) continue;
    for (let n = 0; n < goalsFor(side); n++) {
      goals.push({ match_id: match.id, side, sort: goals.length + 1, scorer_player_id: scorer.id, entered_by: scorer.profile_id });
    }
  }
  return {
    match: {
      status: 'confirmed',
      side_a_score: homeGoals,
      side_b_score: awayGoals,
      confirmed_at: new Date(new Date(match.kickoff_at).getTime() + 2 * 3_600_000).toISOString(),
      confirmed_via: 'agreed',
    },
    attendance: played.map((p) => ({
      match_id: match.id,
      profile_id: p.profile_id,
      checked_in_at: match.kickoff_at,
      method: 'qr',
      checked_in_by: p.profile_id,
    })),
    goals,
    ratings: played.map((p) => {
      const diff = goalsFor(p.side ?? 'a') - goalsAgainst(p.side ?? 'a');
      return { match_id: match.id, player_id: p.id, profile_id: p.profile_id, rating: diff > 0 ? 8 : diff === 0 ? 7 : 6 };
    }),
  };
}

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
  for (const user of [...E2E_USERS, ...E2E_STAFF]) {
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
  log(`logins: ${[...E2E_USERS, ...E2E_STAFF].map((u) => u.email).join(', ')}`);

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

  // ---- 6. A game waiting for its score, per platform -------------------------
  for (const platform of ['ios', 'android'] as Platform[]) {
    const [first, second] = E2E_USERS.filter((u) => u.platform === platform);
    const rows = e2eLogScoreMatch(platform, ids.get(first.email)!, ids.get(second.email)!, now);
    check(await admin.from('matches').delete().eq('id', rows.match.id), `clearing the ${platform} game to log`);
    check(await admin.from('matches').insert(rows.match), `writing the ${platform} game to log`);
    check(await admin.from('match_sides').insert(rows.sides), `writing the ${platform} game's sides`);
    check(await admin.from('match_players').insert(rows.players), `writing the ${platform} game's players`);
  }
  log(`games to log: ${Object.values(E2E_LOG_MATCHES).map((m) => m.matchId).join(', ')}`);

  // ---- 6b. Each platform's two logins are friends (S20) ----------------------------
  for (const platform of ['ios', 'android'] as Platform[]) {
    const [first, second] = E2E_USERS.filter((u) => u.platform === platform);
    const a = ids.get(first.email)!;
    const b = ids.get(second.email)!;
    // One row per pair, whoever asked: clear both ways, then write it again.
    check(
      await admin.from('friendships').delete().or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`),
      `clearing the ${platform} friendship`,
    );
    check(await admin.from('friendships').insert(e2eFriendship(a, b)), `writing the ${platform} friendship`);
  }
  log("friends: each platform's two logins");

  // ---- 7. Each staff login's venue, with a phone booking to clash with ----------
  for (const staff of E2E_STAFF) {
    const staffId = ids.get(staff.email)!;
    const existingVenue = check(
      await admin.from('venues').select('name').eq('id', staff.venue.id).maybeSingle(),
      `reading ${staff.venue.name}`,
    ) as { name: string } | null;
    if (existingVenue && existingVenue.name !== staff.venue.name) {
      throw new Error(`e2e seed: venue ${staff.venue.id} is "${existingVenue.name}", not "${staff.venue.name}". Stopping.`);
    }
    check(await admin.from('profiles').update({ role: 'venue_owner' }).eq('id', staffId), `making ${staff.email} venue staff`);
    const rows = e2eStaffVenue(staff, staffId);
    check(await admin.from('venues').upsert(rows.venue), `writing ${staff.venue.name}`);
    check(await admin.from('pitches').upsert(rows.pitch), `writing ${staff.venue.name}'s pitch`);
    check(await admin.from('opening_hours').upsert(rows.hours), `writing ${staff.venue.name}'s hours`);
    check(await admin.from('price_rules').upsert(rows.price), `writing ${staff.venue.name}'s price`);
    check(await admin.from('venue_blocks').delete().eq('venue_id', staff.venue.id), `clearing ${staff.venue.name}'s blocks`);

    // A walk-in a run left open (the flow stopped before confirming the
    // block): cancelled as the dashboard's own cancel does it. Never paid, so
    // no money row. One that has started is past the slot and left alone.
    const asStaff = await deps.signInAs(staff.email);
    const leftover = check(
      await admin
        .from('venue_bookings')
        .select('id')
        .eq('venue_id', staff.venue.id)
        .eq('booking_type', 'counter')
        .neq('status', 'cancelled'),
      `reading ${staff.venue.name}'s walk-ins`,
    ) as { id: string }[];
    for (const { id } of leftover) {
      const { error } = await asStaff.rpc('cancel_counter_booking', { p_booking_id: id });
      if (error && error.message !== 'game_started') {
        throw new Error(`e2e seed: cancelling walk-in ${id} failed: ${error.message}`);
      }
    }
    check(
      await asStaff.rpc('add_counter_booking', e2eStaffBooking(staff, now)),
      `adding ${staff.venue.name}'s phone booking`,
    );
  }
  log(`staff venues: ${E2E_STAFF.map((s) => `${s.venue.name} (${s.venue.id})`).join(', ')}`);

  // ---- 8. The e2e league (S10, competition.yaml) --------------------------------
  await seedLeague(admin, ids, now);
  await seedTournaments(admin, ids);
  // Its matches' triggers may notify the logins; other flows start clean.
  check(await admin.from('notifications').delete().in('profile_id', [...e2eUserIds]), 'clearing e2e notifications');
  log(`league: ${E2E_LEAGUE.name} (${E2E_LEAGUE.id}), ${E2E_TEAMS.length} teams, ${E2E_LEAGUE_RESULTS.length} results, 1 upcoming`);

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

/** Step 8: the e2e league. Made once and kept: a second run finds Season 1
 *  and its completed fixtures and leaves them alone, and only moves the
 *  upcoming fixture to 3 days ahead. Every row is checked to be ours first. */
export async function seedLeague(admin: SupabaseClient, ids: ReadonlyMap<string, string>, now: Date) {
  const teamRows = e2eTeamRows(ids);
  assertE2eTeams(
    check(
      await admin.from('teams').select('id, name').in('id', teamRows.teams.map((t) => t.id)),
      'reading the e2e teams',
    ) as { id: string; name: string }[],
  );
  check(await admin.from('teams').upsert(teamRows.teams), 'writing the e2e teams');
  check(
    await admin.from('team_members').upsert(teamRows.members, { onConflict: 'team_id,profile_id' }),
    'writing the e2e captains',
  );

  const hub = check(
    await admin.from('leagues').select('name, scope, parent_league_id').eq('id', E2E_LEAGUE.id).maybeSingle(),
    'reading the e2e league',
  ) as { name: string; scope: string; parent_league_id: string | null } | null;
  assertE2eLeague(hub);

  const findSeason = async () =>
    check(
      await admin
        .from('leagues')
        .select('id, start_date')
        .eq('parent_league_id', E2E_LEAGUE.id)
        .eq('kind', 'season')
        .eq('season_number', 1)
        .maybeSingle(),
      'reading Season 1',
    ) as { id: string; start_date: string } | null;

  let season = hub ? await findSeason() : null;
  if (!season) {
    // Sign-up, then Season 1 the way a full sign-up starts it.
    check(await admin.from('leagues').upsert(e2eLeagueHub(now)), 'writing the e2e league');
    check(
      await admin
        .from('league_teams')
        .upsert(E2E_TEAMS.map((t) => ({ league_id: E2E_LEAGUE.id, team_id: t.id })), {
          onConflict: 'league_id,team_id',
          ignoreDuplicates: true,
        }),
      'signing up the e2e teams',
    );
    check(await admin.rpc('league_start_season', { p_hub_id: E2E_LEAGUE.id }), 'starting Season 1');
    season = await findSeason();
    if (!season) throw new Error('e2e seed: Season 1 was not created. Stopping.');
  }

  // The six results, each final once.
  const fixtures = check(
    await admin.from('league_fixtures').select('id, home_team_id, away_team_id, status').eq('league_id', season.id),
    'reading the e2e fixtures',
  ) as E2eFixtureRow[];
  const plan = e2eResultPlan(fixtures, season.start_date);
  for (const step of plan) {
    check(
      await admin
        .from('league_fixtures')
        .update({
          venue_id: E2E_VENUE.id,
          scheduled_day: step.scheduled_day,
          scheduled_time: step.scheduled_time,
          status: 'agreed',
        })
        .eq('id', step.fixtureId),
      `scheduling fixture ${step.fixtureId}`,
    );
    const match = check(
      await admin.from('matches').select('id, kickoff_at').eq('league_fixture_id', step.fixtureId).single(),
      `reading fixture ${step.fixtureId}'s match`,
    ) as { id: string; kickoff_at: string };
    const players = check(
      await admin.from('match_players').select('id, profile_id, side').eq('match_id', match.id).is('left_at', null),
      `reading match ${match.id}'s players`,
    ) as { id: string; profile_id: string | null; side: string | null }[];
    const rows = e2eMatchResult(match, players, step.homeGoals, step.awayGoals);
    check(await admin.from('matches').update(rows.match).eq('id', match.id), `confirming match ${match.id}`);
    check(
      await admin.from('match_attendance').upsert(rows.attendance, { onConflict: 'match_id,profile_id', ignoreDuplicates: true }),
      `checking in match ${match.id}`,
    );
    check(await admin.from('match_goals').delete().eq('match_id', match.id), `clearing match ${match.id}'s goals`);
    if (rows.goals.length > 0) check(await admin.from('match_goals').insert(rows.goals), `writing match ${match.id}'s goals`);
    check(
      await admin.from('match_player_ratings').upsert(rows.ratings, { onConflict: 'match_id,player_id' }),
      `rating match ${match.id}`,
    );
    // The final moment, as match_levels_tick runs it: levels move and the
    // fixture takes the match's score (matches_league_fixture_final).
    check(
      await admin.rpc('apply_match_levels', { p_match_id: match.id, p_now: now.toISOString() }),
      `making match ${match.id} final`,
    );
    const done = check(
      await admin.from('league_fixtures').select('status').eq('id', step.fixtureId).single(),
      `reading fixture ${step.fixtureId}`,
    ) as { status: string };
    if (done.status !== 'completed') {
      throw new Error(`e2e seed: fixture ${step.fixtureId} is "${done.status}" after its match went final. Stopping.`);
    }
  }

  // The upcoming fixture: made once, moved every run (its match follows).
  const upcoming = e2eUpcomingFixture(season.id, now);
  if (cyprusWallTime(upcoming.scheduled_day, upcoming.scheduled_time).getTime() <= now.getTime()) {
    throw new Error('e2e seed: the upcoming fixture would be in the past. Stopping.');
  }
  check(
    await admin.from('league_fixtures').upsert(upcoming, { onConflict: 'league_id,home_team_id,away_team_id' }),
    'writing the upcoming fixture',
  );
}

/** The e2e tournament rows (written as service_role, like the dashboard). */
export function e2eTournamentRows(createdBy: string) {
  return Object.values(E2E_TOURNAMENTS).map((t) => ({
    id: t.id,
    name: t.name,
    area: E2E_TOURNAMENT_FIELDS.area,
    format: E2E_TOURNAMENT_FIELDS.format,
    max_teams: E2E_TOURNAMENT_FIELDS.maxTeams,
    squad_subs: E2E_TOURNAMENT_FIELDS.squadSubs,
    entry_fee_cents: E2E_TOURNAMENT_FIELDS.entryFeeCents,
    match_minutes: E2E_TOURNAMENT_FIELDS.matchMinutes,
    start_date: null,
    end_date: null,
    registration_deadline: null,
    status: t.status,
    champion_team_id: null,
    created_by: createdBy,
  }));
}

/** Step 9 (S10A). Every row is checked to be ours first; no team is ever
 *  registered, so a re-run only puts the two tournaments back as they were.
 *  The admins are e2e logins only (E2E_ADMIN_EMAILS), on staging only. */
export async function seedTournaments(admin: SupabaseClient, ids: ReadonlyMap<string, string>) {
  const tournamentIds = Object.values(E2E_TOURNAMENTS).map((t) => t.id);
  assertE2eTournaments(
    check(
      await admin.from('tournaments').select('id, name, area').in('id', tournamentIds),
      'reading the e2e tournaments',
    ) as { id: string; name: string; area: string }[],
  );
  const adminIds = E2E_ADMIN_EMAILS.map((email) => {
    const id = ids.get(email);
    if (!id) throw new Error(`e2e seed: no login for admin ${email}. Stopping.`);
    return id;
  });
  check(
    await admin.from('tournament_pins').delete().in('tournament_id', tournamentIds),
    'clearing e2e tournament pins',
  );
  check(await admin.from('tournaments').upsert(e2eTournamentRows(adminIds[0])), 'writing the e2e tournaments');
  check(
    await admin.from('app_admins').upsert(
      adminIds.map((profile_id) => ({ profile_id })),
      { onConflict: 'profile_id', ignoreDuplicates: true },
    ),
    'making the e2e admins (staging)',
  );
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
