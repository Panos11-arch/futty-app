import fs from 'node:fs';
import path from 'node:path';

import {
  assertNotProductionKey,
  assertServiceKey,
  assertStagingTarget,
  e2eProfileProblems,
  isPublicSupabaseKey,
  jwtProjectRef,
  PRODUCTION_PROJECT_REF,
  supabaseKeyKind,
} from '@/lib/e2e-guard';

/** An unsigned legacy-style key: only its claims matter here. */
function jwt(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}.signature`;
}

const STAGING_URL = 'https://stagingref123.supabase.co';

describe('assertStagingTarget', () => {
  it('passes a staging URL with Stripe test keys', () => {
    expect(() => assertStagingTarget(STAGING_URL, 'sk_test_abc')).not.toThrow();
    expect(() => assertStagingTarget(STAGING_URL, 'pk_test_abc')).not.toThrow();
  });

  it.each([
    `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    `https://${PRODUCTION_PROJECT_REF.toUpperCase()}.supabase.co/`,
    `postgresql://postgres@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
  ])('refuses production: %s', (url) => {
    expect(() => assertStagingTarget(url, 'sk_test_abc')).toThrow(/PRODUCTION/);
  });

  it.each(['sk_live_abc', 'pk_live_abc', 'rk_live_abc', '  sk_live_abc'])('refuses the live Stripe key %s', (key) => {
    expect(() => assertStagingTarget(STAGING_URL, key)).toThrow(/LIVE/);
  });

  it('refuses a missing URL or key', () => {
    expect(() => assertStagingTarget(undefined, 'sk_test_abc')).toThrow(/URL is missing/);
    expect(() => assertStagingTarget(STAGING_URL, '')).toThrow(/key is missing/);
  });
});

describe('Supabase key kinds (legacy JWTs and the new sb_ keys)', () => {
  it('tells them apart', () => {
    expect(supabaseKeyKind('sb_secret_abc')).toBe('secret');
    expect(supabaseKeyKind('sb_publishable_abc')).toBe('publishable');
    expect(supabaseKeyKind(jwt({ role: 'service_role', ref: 'stagingref123' }))).toBe('service_role_jwt');
    expect(supabaseKeyKind(jwt({ role: 'anon', ref: 'stagingref123' }))).toBe('anon_jwt');
    expect(supabaseKeyKind('not-a-key')).toBe('unknown');
    expect(supabaseKeyKind('a.b.c')).toBe('unknown');
  });

  it('the seed takes only a service key, of either kind', () => {
    expect(() => assertServiceKey('sb_secret_abc')).not.toThrow();
    expect(() => assertServiceKey(jwt({ role: 'service_role' }))).not.toThrow();
    expect(() => assertServiceKey('sb_publishable_abc')).toThrow();
    expect(() => assertServiceKey(jwt({ role: 'anon' }))).toThrow();
    expect(() => assertServiceKey(undefined)).toThrow();
  });

  it('the app takes only a public key, of either kind', () => {
    expect(isPublicSupabaseKey('sb_publishable_abc')).toBe(true);
    expect(isPublicSupabaseKey(jwt({ role: 'anon' }))).toBe(true);
    expect(isPublicSupabaseKey('sb_secret_abc')).toBe(false);
    expect(isPublicSupabaseKey(jwt({ role: 'service_role' }))).toBe(false);
  });

  it("refuses a legacy key from production's project", () => {
    const prod = jwt({ role: 'service_role', ref: PRODUCTION_PROJECT_REF });
    expect(jwtProjectRef(prod)).toBe(PRODUCTION_PROJECT_REF);
    expect(() => assertNotProductionKey(prod)).toThrow(/PRODUCTION/);
    expect(() => assertNotProductionKey(jwt({ role: 'anon', ref: 'stagingref123' }))).not.toThrow();
    expect(() => assertNotProductionKey('sb_secret_abc')).not.toThrow();
  });
});

describe('the e2e-test profile in eas.json', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eas.json'), 'utf8'));

  it('never points at production or uses a live Stripe key (placeholders allowed until Panos fills them in)', () => {
    expect(e2eProfileProblems(eas, { allowPlaceholders: true })).toEqual([]);
  });

  it('builds a simulator app and an APK with no update channel, and leaves the other profiles alone', () => {
    const profile = eas.build['e2e-test'];
    expect(profile.ios).toEqual({ simulator: true });
    expect(profile.android).toEqual({ buildType: 'apk' });
    expect(profile.distribution).toBe('internal');
    expect(profile.channel).toBeUndefined();
    expect(profile.env.EXPO_ROUTER_IMPORT_MODE).toBe('sync');
    expect(Object.keys(eas.build).sort()).toEqual(['development', 'e2e-test', 'preview', 'production']);
  });

  const filled = (env: Record<string, string>, extra: Record<string, unknown> = {}) => ({
    build: { 'e2e-test': { ios: { simulator: true }, android: { buildType: 'apk' }, env, ...extra } },
  });
  const good = {
    EXPO_PUBLIC_SUPABASE_URL: STAGING_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abc',
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
  };

  it('passes a filled-in staging profile, with either kind of anon key', () => {
    expect(e2eProfileProblems(filled(good), { allowPlaceholders: false })).toEqual([]);
    const legacy = { ...good, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'stagingref123' }) };
    expect(e2eProfileProblems(filled(legacy), { allowPlaceholders: false })).toEqual([]);
  });

  it('the workflow check fails while a placeholder remains', () => {
    const problems = e2eProfileProblems(eas, { allowPlaceholders: false });
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining('REPLACE_STAGING_URL'), expect.stringContaining('REPLACE_PK_TEST')]),
    );
  });

  it.each([
    ['production URL', { ...good, EXPO_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }, /PRODUCTION/],
    ['production anon JWT', { ...good, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: PRODUCTION_PROJECT_REF }) }, /PRODUCTION/],
    ['live publishable key', { ...good, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_abc' }, /LIVE/],
    ['a secret Stripe key in the app', { ...good, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'sk_test_abc' }, /pk_test_/],
    ['a secret Supabase key in the app', { ...good, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_abc' }, /never a secret/],
    ['a URL that is not a Supabase project', { ...good, EXPO_PUBLIC_SUPABASE_URL: 'https://example.com' }, /supabase\.co/],
  ])('refuses %s', (_name, env, message) => {
    expect(e2eProfileProblems(filled(env), { allowPlaceholders: false }).join('\n')).toMatch(message);
  });

  it('refuses an update channel', () => {
    expect(e2eProfileProblems(filled(good, { channel: 'preview' }), { allowPlaceholders: false }).join('\n')).toMatch(/channel/);
  });
});

// The SQLite session store is native; only the client's construction matters here.
jest.mock('@/lib/auth-storage', () => ({ authStorage: undefined }));

describe('lib/supabase.ts takes either kind of anon key', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  it.each([
    ['a new sb_publishable_ key', 'sb_publishable_abc123'],
    ['a legacy anon JWT', jwt({ role: 'anon', ref: 'stagingref123' })],
  ])('%s', (_name, key) => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = STAGING_URL;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
    jest.isolateModules(() => {
      const { supabase } = require('@/lib/supabase') as typeof import('@/lib/supabase');
      expect(supabase).toBeDefined();
    });
  });
});
