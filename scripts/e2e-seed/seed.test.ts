import fs from 'node:fs';
import path from 'node:path';

import { PRODUCTION_PROJECT_REF } from '../../lib/e2e-guard';
import { E2E_VENUE } from './config';
import { startingLevelOffered } from '../../lib/match/levels';
import {
  connectAccountKey,
  connectAccountParams,
  E2E_UNTOUCHED_LEVEL,
  e2eStartingLevel,
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
      level: 4,
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
