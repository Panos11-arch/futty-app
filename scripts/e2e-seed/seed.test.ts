import fs from 'node:fs';
import path from 'node:path';

import { PRODUCTION_PROJECT_REF } from '../../lib/e2e-guard';
import { E2E_VENUE } from './config';
import { connectAccountKey, connectAccountParams, readSeedEnv, seedMain, stripeRest } from './seed';

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

  it('fails on today’s eas.json, which still has the placeholders', () => {
    expect(checkProfile(eas).join('\n')).toMatch(/REPLACE_STAGING_URL/);
  });

  it('passes once the staging values are in', () => {
    const filled = eas
      .replace('REPLACE_STAGING_URL', 'https://stagingref123.supabase.co')
      .replace('REPLACE_STAGING_ANON_KEY', 'sb_publishable_abc')
      .replace('REPLACE_PK_TEST', 'pk_test_abc');
    expect(checkProfile(filled)).toEqual([]);
  });
});
