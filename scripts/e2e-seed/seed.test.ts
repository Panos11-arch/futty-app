import fs from 'node:fs';
import path from 'node:path';

import { PRODUCTION_PROJECT_REF } from '../../lib/e2e-guard';
import {
  E2E_DATE_OF_BIRTH,
  E2E_LEAGUE,
  E2E_LEAGUE_RESULTS,
  E2E_LOG_MATCHES,
  E2E_PITCHES,
  E2E_STAFF,
  E2E_STAFF_BOOKING,
  E2E_TEAMS,
  E2E_UPCOMING,
  E2E_USERS,
  E2E_VENUE,
} from './config';
import { startingLevelOffered } from '../../lib/match/levels';
import { addDays, cyprusToday, cyprusWallTime } from './slot';
import {
  connectAccountKey,
  connectAccountParams,
  E2E_UNTOUCHED_LEVEL,
  e2eFriendship,
  e2eLeagueHub,
  e2eMatchResult,
  e2eResultPlan,
  e2eTeamRows,
  e2eUpcomingFixture,
  e2eLogScoreMatch,
  e2eStaffBooking,
  e2eStaffVenue,
  e2eStartingLevel,
  e2eVenue,
  readSeedEnv,
  seedMain,
  stripeRest,
} from './seed';

const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

const good = {
  STAGING_SUPABASE_URL: 'https://stagingref123.supabase.co',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc',
  STAGING_STRIPE_SECRET_KEY: 'sk_test_abc',
  STAGING_E2E_PASSWORD: 'a-long-test-password',
};

describe('readSeedEnv', () => {
  it('takes a staging project with either kind of service key and a Stripe test key', () => {
    expect(readSeedEnv(good)).toEqual({
      url: 'https://stagingref123.supabase.co',
      serviceKey: 'sb_secret_abc',
      stripeKey: 'sk_test_abc',
      password: 'a-long-test-password',
    });
    const legacy = jwt({ role: 'service_role', ref: 'stagingref123' });
    expect(readSeedEnv({ ...good, STAGING_SUPABASE_SERVICE_ROLE_KEY: legacy }).serviceKey).toBe(legacy);
  });

  it.each([
    ['the production URL', { STAGING_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }, /PRODUCTION/],
    ['a live Stripe key', { STAGING_STRIPE_SECRET_KEY: 'sk_live_abc' }, /LIVE/],
    ['a publishable Stripe key', { STAGING_STRIPE_SECRET_KEY: 'pk_test_abc' }, /TEST secret key/],
    ['an anon key as the service key', { STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_abc' }, /sb_secret_/],
    ['a legacy anon JWT as the service key', { STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon' }) }, /sb_secret_/],
    ["production's service JWT", { STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: PRODUCTION_PROJECT_REF }) }, /PRODUCTION/],
    ['a short password', { STAGING_E2E_PASSWORD: 'short' }, /8 characters/],
    ['a URL that is not a Supabase project', { STAGING_SUPABASE_URL: 'https://example.com' }, /supabase\.co/],
    ['nothing at all', { STAGING_SUPABASE_URL: undefined }, /missing/],
  ])('refuses %s', (_name, change, message) => {
    expect(() => readSeedEnv({ ...good, ...change })).toThrow(message);
  });

  it('--local runs only against the local stack', () => {
    const local = { ...good, STAGING_SUPABASE_URL: 'http://127.0.0.1:54321' };
    expect(readSeedEnv(local, { local: true }).url).toBe('http://127.0.0.1:54321');
    expect(() => readSeedEnv(good, { local: true })).toThrow(/--local/);
    expect(() => readSeedEnv(local)).toThrow(/supabase\.co/);
  });
});

describe('seedMain checks the target before it makes any client', () => {
  it.each([
    { STAGING_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` },
    { STAGING_STRIPE_SECRET_KEY: 'sk_live_abc' },
  ])('%o', async (change) => {
    const createClient = jest.fn();
    await expect(seedMain({ ...good, ...change }, [], { createClient })).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('the Stripe connected account, the way connect-onboarding makes it', () => {
  const handler = fs.readFileSync(path.join(__dirname, '../../supabase/functions/connect-onboarding/handler.ts'), 'utf8');
  const money = fs.readFileSync(path.join(__dirname, '../../supabase/functions/_shared/money.ts'), 'utf8');

  it('the same parameters', () => {
    expect(handler).toMatch(/type: 'express'/);
    expect(handler).toMatch(/country: 'CY'/);
    expect(handler).toMatch(/business_profile: \{ name: account\.venue_name \}/);
    expect(handler).toMatch(/capabilities: \{ transfers: \{ requested: true \} \}/);
    expect(handler).toMatch(/metadata: \{ venue_id: venueId \}/);
    expect(connectAccountParams()).toEqual({
      type: 'express',
      country: 'CY',
      email: 'e2e-venue@e2e.futty.app',
      'business_profile[name]': 'E2E Arena',
      'capabilities[transfers][requested]': 'true',
      'metadata[venue_id]': E2E_VENUE.id,
    });
  });

  it('the same idempotency key, in test mode', () => {
    expect(money).toContain("connectAccount: (venueId: string, livemode: boolean) => `connect-account-${venueId}-${livemode ? 'live' : 'test'}`");
    expect(connectAccountKey(E2E_VENUE.id)).toBe(`connect-account-${E2E_VENUE.id}-test`);
  });

  it('sends the key and the form to Stripe, and treats a missing account as gone', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'acct_1', livemode: false }) })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    const stripe = stripeRest('sk_test_abc', fetchImpl as unknown as typeof fetch);
    await expect(stripe.createAccount(connectAccountParams(), 'key-1')).resolves.toEqual({ id: 'acct_1', livemode: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/accounts');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk_test_abc', 'Idempotency-Key': 'key-1' });
    expect(init.body).toContain('capabilities%5Btransfers%5D%5Brequested%5D=true');
    await expect(stripe.retrieveAccount('acct_gone')).resolves.toBeNull();
  });
});

describe('check-profile: the workflow’s first job', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { checkProfile } = require('./check-profile') as typeof import('./check-profile');
  const eas = fs.readFileSync(path.join(__dirname, '../../eas.json'), 'utf8');

  it('passes on today’s eas.json, which has the staging values', () => {
    // The problems name no key value, so a failure here prints none of eas.json's keys.
    expect(checkProfile(eas)).toEqual([]);
  });

  it('fails while a placeholder remains, naming it', () => {
    // An in-memory copy of the real profile with the three placeholders put back.
    const json = JSON.parse(eas);
    Object.assign(json.build['e2e-test'].env, {
      EXPO_PUBLIC_SUPABASE_URL: 'REPLACE_STAGING_URL',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'REPLACE_STAGING_ANON_KEY',
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'REPLACE_PK_TEST',
    });
    const problems = checkProfile(JSON.stringify(json)).join('\n');
    expect(problems).toMatch(/REPLACE_STAGING_URL/);
    expect(problems).toMatch(/REPLACE_PK_TEST/);
  });

  it('requires EXPO_PUBLIC_E2E=1, which switches on lib/supabase.ts’s runtime guard', () => {
    const json = JSON.parse(eas);
    delete json.build['e2e-test'].env.EXPO_PUBLIC_E2E;
    expect(checkProfile(JSON.stringify(json)).join(' ')).toMatch(/EXPO_PUBLIC_E2E/);
    json.build['e2e-test'].env.EXPO_PUBLIC_E2E = '0';
    expect(checkProfile(JSON.stringify(json)).join(' ')).toMatch(/EXPO_PUBLIC_E2E/);
  });
});

describe('a starting level for each test login', () => {
  // Home opens the five starting questions for a player with no level once
  // the server answers; on a slow simulator that's after the flow has moved
  // on, so the questions slid over Home and "home-screen is visible" failed.
  it('is a questionnaire level, so Home never offers the questions', () => {
    const row = e2eStartingLevel('user-1');
    expect(row).toEqual({
      profile_id: 'user-1',
      level: 5.5,
      provisional: true,
      reliability_pct: 0,
      competitive_matches: 0,
      source: 'questionnaire',
    });
    expect(
      startingLevelOffered({
        level: row.level,
        provisional: row.provisional,
        reliabilityPct: row.reliability_pct,
        competitiveMatches: row.competitive_matches,
        source: row.source,
      })
    ).toBe(false);
  });

  // The upsert keeps a row that's already there, so a login that already had
  // the server's default level (3.0, no competitive match) kept it, and Home
  // still offered the questions. The seed now turns exactly that row into the
  // questionnaire level, and leaves a level that a match has moved alone.
  it('replaces an untouched default level, the one Home still offers the questions for', () => {
    const untouched = { level: 3, provisional: true, reliabilityPct: 0, competitiveMatches: 0, source: 'default' as const };
    expect(startingLevelOffered(untouched)).toBe(true);
    expect(E2E_UNTOUCHED_LEVEL).toEqual({ source: 'default', competitive_matches: 0 });
    const replaced = { ...untouched, level: e2eStartingLevel('user-1').level, source: e2eStartingLevel('user-1').source };
    expect(startingLevelOffered(replaced)).toBe(false);
    // A match moved it: not matched by the filter, so kept.
    const moved = { ...untouched, competitiveMatches: 2 };
    expect(moved.competitiveMatches).not.toBe(E2E_UNTOUCHED_LEVEL.competitive_matches);
    expect(startingLevelOffered(moved)).toBe(false);
  });
});

describe('a game waiting for its score (S13B, log-score.yaml)', () => {
  const now = new Date('2026-11-24T18:00:00.000Z');

  it('a pickup at the E2E venue, played 2 hours ago, waiting for the result for 23 more hours', () => {
    const rows = e2eLogScoreMatch('ios', 'cap', 'other', now);
    expect(rows.match).toEqual({
      id: E2E_LOG_MATCHES.ios.matchId,
      kind: 'pickup',
      format: '5-a-side',
      players_per_side: 5,
      venue_id: E2E_VENUE.id,
      kickoff_at: '2026-11-24T16:00:00.000Z',
      ends_at: '2026-11-24T17:00:00.000Z',
      result_deadline_at: '2026-11-25T17:00:00.000Z',
      status: 'played',
    });
  });

  it('the first login captains Bibs; the second plays Non-bibs; fixed ids per platform', () => {
    const rows = e2eLogScoreMatch('android', 'cap', 'other', now);
    expect(rows.sides).toEqual([
      { match_id: E2E_LOG_MATCHES.android.matchId, side: 'a', label: 'Bibs', captain_profile_id: 'cap' },
      { match_id: E2E_LOG_MATCHES.android.matchId, side: 'b', label: 'Non-bibs', captain_profile_id: null },
    ]);
    expect(rows.players.map((p) => [p.id, p.profile_id, p.side])).toEqual([
      [E2E_LOG_MATCHES.android.captainPlayerId, 'cap', 'a'],
      [E2E_LOG_MATCHES.android.otherPlayerId, 'other', 'b'],
    ]);
    expect(E2E_LOG_MATCHES.ios.matchId).not.toBe(E2E_LOG_MATCHES.android.matchId);
  });
});

// S12: without a date of birth the app holds every login on the date of
// birth screen; under 18 the minor limits would change what flows see.
describe('the e2e logins’ date of birth', () => {
  it('is a real date, 18 or more years ago', () => {
    expect(E2E_DATE_OF_BIRTH).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    expect(new Date(`${E2E_DATE_OF_BIRTH}T00:00:00Z`).getTime()).toBeLessThan(eighteenYearsAgo.getTime());
  });
});

// Doc 28 prompt 1 (block-clashes.yaml): each platform's venue-staff login owns
// its own test venue, which holds a phone booking tomorrow for the block to
// clash with.
describe('the venue staff’s test venue and its phone booking', () => {
  it('one per platform, apart from each other and from the E2E Arena', () => {
    expect(E2E_STAFF.map((s) => s.platform)).toEqual(['ios', 'android']);
    const ids = [E2E_VENUE.id, ...E2E_PITCHES.map((p) => p.id), ...E2E_STAFF.flatMap((s) => [s.venue.id, s.pitchId])];
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of E2E_STAFF) expect(s.email).toMatch(/^e2e-(ios|android)-staff@e2e\.futty\.app$/);
  });

  it('the staff login owns it; not live, so players never see it in Book; one 5-a-side pitch with a price', () => {
    const rows = e2eStaffVenue(E2E_STAFF[0], 'staff-id');
    expect(rows.venue).toMatchObject({
      id: E2E_STAFF[0].venue.id,
      name: 'E2E Staff Arena iOS',
      owner_profile_id: 'staff-id',
      is_live: false,
    });
    expect(rows.pitch).toMatchObject({ id: E2E_STAFF[0].pitchId, venue_id: E2E_STAFF[0].venue.id, size: '5-a-side', is_open: true });
    expect(rows.hours).toHaveLength(7);
    expect(rows.price).toEqual({ venue_id: E2E_STAFF[0].venue.id, format: '5-a-side', price_cents: 6000 });
  });

  it('the phone booking: tomorrow in Cyprus, on that pitch, not paid (no money row)', () => {
    // 23:30 on 24 November in Cyprus is already the 24th; tomorrow is the 25th.
    const args = e2eStaffBooking(E2E_STAFF[1], new Date('2026-11-24T21:30:00Z'));
    expect(args).toEqual({
      p_venue_id: E2E_STAFF[1].venue.id,
      p_day: '2026-11-25',
      p_start: E2E_STAFF_BOOKING.start,
      p_end: E2E_STAFF_BOOKING.end,
      p_format: '5-a-side',
      p_source: 'phone',
      p_contact_name: 'E2E Caller',
      p_contact_phone: '+35799000000',
      p_pitch_id: E2E_STAFF[1].pitchId,
    });
    // 00:30 on 25 November in Cyprus (22:30 UTC on the 24th): tomorrow is the 26th.
    expect(e2eStaffBooking(E2E_STAFF[1], new Date('2026-11-24T22:30:00Z')).p_day).toBe('2026-11-26');
  });
});

describe('the E2E venue (S17: on the map and with weather, staging only)', () => {
  it('has coordinates in Nicosia, both or neither, inside Cyprus (spec 13 "Coordinates")', () => {
    const row = e2eVenue();
    expect(row).toMatchObject({ id: E2E_VENUE.id, name: 'E2E Arena', city: 'Nicosia', is_live: true, allows_6v6_on_5s: false });
    expect(row.latitude).toBe(35.165);
    expect(row.longitude).toBe(33.36);
    // Inside Cyprus, roughly: 34.5 to 35.7 N, 32.2 to 34.6 E.
    expect(row.latitude).toBeGreaterThan(34.5);
    expect(row.latitude).toBeLessThan(35.7);
    expect(row.longitude).toBeGreaterThan(32.2);
    expect(row.longitude).toBeLessThan(34.6);
  });
});

describe('the e2e league (S10, competition.yaml)', () => {
  const now = new Date('2026-11-27T10:00:00Z');
  const captainIds = new Map(E2E_USERS.map((u, i) => [u.email, `profile-${i}`]));

  it('a top-level city league in its own e2e city, in sign-up, starting 21 days ago', () => {
    expect(e2eLeagueHub(now)).toEqual({
      id: E2E_LEAGUE.id,
      name: 'E2E City 5s',
      scope: 'E2E',
      format: '5-a-side',
      stage: 'signup',
      capacity: 8,
      season_weeks: 6,
      kind: 'league',
      parent_league_id: null,
      start_date: '2026-11-06',
    });
  });

  it('four teams, one per player login, each its captain, with fixed ids in pairing order', () => {
    const rows = e2eTeamRows(captainIds);
    expect(rows.teams.map((t) => t.id)).toEqual([...E2E_TEAMS.map((t) => t.id)].sort());
    expect(new Set(E2E_TEAMS.map((t) => t.captainEmail))).toEqual(new Set(E2E_USERS.map((u) => u.email)));
    expect(rows.teams.every((t) => t.roster_size === 1 && t.name.startsWith('E2E '))).toBe(true);
    expect(rows.members).toEqual(
      E2E_TEAMS.map((t) => ({ team_id: t.id, profile_id: captainIds.get(t.captainEmail), role: 'captain' })),
    );
  });

  it('every pairing once, each team 3 games', () => {
    const pairs = new Set(E2E_LEAGUE_RESULTS.map((r) => [r.home, r.away].sort().join('-')));
    expect(pairs.size).toBe(6);
    for (let t = 0; t < 4; t++) {
      expect(E2E_LEAGUE_RESULTS.filter((r) => r.home === t || r.away === t)).toHaveLength(3);
    }
    // sync_league_fixtures makes home the lower id.
    expect(E2E_LEAGUE_RESULTS.every((r) => E2E_TEAMS[r.home].id < E2E_TEAMS[r.away].id)).toBe(true);
  });

  const start = addDays(cyprusToday(now), -E2E_LEAGUE.startDaysAgo);
  const fixtures = E2E_LEAGUE_RESULTS.map((r, i) => ({
    id: `f${i}`,
    home_team_id: E2E_TEAMS[r.home].id,
    away_team_id: E2E_TEAMS[r.away].id,
    status: 'unscheduled',
  }));

  it('plays the six pairings 3 days apart from the start, all final well before the first run', () => {
    const plan = e2eResultPlan(fixtures, start);
    expect(plan.map((p) => p.fixtureId)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5']);
    expect(plan.map((p) => p.scheduled_day)).toEqual([0, 3, 6, 9, 12, 15].map((d) => addDays(start, d)));
    const last = cyprusWallTime(plan[5].scheduled_day, plan[5].scheduled_time);
    // The match's end + 24 hours (its result deadline), with a day to spare.
    expect(last.getTime() + (1 + 24 + 24) * 3_600_000).toBeLessThan(now.getTime());
    expect(plan[0]).toMatchObject({ homeGoals: 2, awayGoals: 1 });
  });

  it('a second run leaves completed fixtures alone, and ignores the upcoming one', () => {
    const upcoming = { id: 'up', home_team_id: E2E_TEAMS[1].id, away_team_id: E2E_TEAMS[0].id, status: 'agreed' };
    const done = fixtures.map((f) => ({ ...f, status: 'completed' }));
    expect(e2eResultPlan([...done, upcoming], start)).toEqual([]);
    // A run that stopped halfway picks up the rest.
    expect(e2eResultPlan([...done.slice(0, 4), ...fixtures.slice(4), upcoming], start).map((p) => p.fixtureId)).toEqual([
      'f4',
      'f5',
    ]);
  });

  it('stops when a pairing is missing (the season is not ours)', () => {
    expect(() => e2eResultPlan(fixtures.slice(1), start)).toThrow(/Stopping/);
  });

  it('the upcoming fixture: Android 1 at home to iOS 1, 3 days ahead in Cyprus, at the E2E Arena', () => {
    expect(e2eUpcomingFixture('season-1', now)).toEqual({
      league_id: 'season-1',
      home_team_id: E2E_TEAMS[E2E_UPCOMING.home].id,
      away_team_id: E2E_TEAMS[E2E_UPCOMING.away].id,
      venue_id: E2E_VENUE.id,
      scheduled_day: '2026-11-30',
      scheduled_time: '20:00',
      status: 'agreed',
    });
    expect(E2E_TEAMS[E2E_UPCOMING.home].id > E2E_TEAMS[E2E_UPCOMING.away].id).toBe(true);
  });

  it('a final result: confirmed by both captains, everyone checked in, the goals and ratings', () => {
    const kickoff = '2026-11-06T17:00:00.000Z';
    const players = [
      { id: 'pa', profile_id: 'ua', side: 'a' },
      { id: 'pb', profile_id: 'ub', side: 'b' },
    ];
    const rows = e2eMatchResult({ id: 'm1', kickoff_at: kickoff }, players, 2, 1);
    expect(rows.match).toEqual({
      status: 'confirmed',
      side_a_score: 2,
      side_b_score: 1,
      confirmed_at: '2026-11-06T19:00:00.000Z',
      confirmed_via: 'agreed',
    });
    expect(rows.attendance).toEqual([
      { match_id: 'm1', profile_id: 'ua', checked_in_at: kickoff, method: 'qr', checked_in_by: 'ua' },
      { match_id: 'm1', profile_id: 'ub', checked_in_at: kickoff, method: 'qr', checked_in_by: 'ub' },
    ]);
    expect(rows.goals.map((g) => [g.side, g.sort, g.scorer_player_id])).toEqual([
      ['a', 1, 'pa'],
      ['a', 2, 'pa'],
      ['b', 3, 'pb'],
    ]);
    expect(rows.ratings).toEqual([
      { match_id: 'm1', player_id: 'pa', profile_id: 'ua', rating: 8 },
      { match_id: 'm1', player_id: 'pb', profile_id: 'ub', rating: 6 },
    ]);
    expect(e2eMatchResult({ id: 'm2', kickoff_at: kickoff }, players, 0, 0).ratings.map((r) => r.rating)).toEqual([7, 7]);
  });
});

// S20 (friends.yaml): the two logins of a platform are friends.
describe('the e2e friendship', () => {
  it('the first asked, the second accepted', () => {
    expect(e2eFriendship('first', 'second')).toEqual({
      requester_id: 'first',
      addressee_id: 'second',
      status: 'accepted',
      accepted_at: '1970-01-01T00:00:00.000Z',
    });
  });
});
