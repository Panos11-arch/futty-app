// The end-to-end tests' safety catch (docs/testing/maestro.md). The Maestro
// journeys book and pay for real, so they must only ever run against the
// STAGING Supabase project with Stripe in TEST mode. scripts/e2e-seed calls
// assertStagingTarget before it touches anything, and lib/e2e-guard.test.ts
// checks the e2e-test build profile in eas.json with the same rules.
//
// Plain TypeScript with no imports: the seed script runs it under Node.

/** Production's Supabase project ref. Nothing e2e may ever point at it. */
export const PRODUCTION_PROJECT_REF = 'ospztpemchfpvvostisw';

/** Placeholders in eas.json's e2e-test profile until Panos fills them in. */
export const E2E_PLACEHOLDERS = ['REPLACE_STAGING_URL', 'REPLACE_STAGING_ANON_KEY', 'REPLACE_PK_TEST'] as const;

/** Throws unless the Supabase URL and the Stripe key are safe for e2e:
 *  not production's project, and not a live Stripe key (secret,
 *  restricted or publishable). */
export function assertStagingTarget(url: string | undefined, stripeKey: string | undefined): void {
  if (!url || !url.trim()) throw new Error('e2e guard: the staging Supabase URL is missing.');
  if (!stripeKey || !stripeKey.trim()) throw new Error('e2e guard: the Stripe test key is missing.');
  if (url.toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('e2e guard: this is the PRODUCTION Supabase project. End-to-end tests only run against staging.');
  }
  if (/^(sk|pk|rk)_live_/.test(stripeKey.trim())) {
    throw new Error('e2e guard: this is a LIVE Stripe key. End-to-end tests only use Stripe test mode.');
  }
}

/** The app's runtime guard (lib/supabase.ts): in an e2e build
 *  (EXPO_PUBLIC_E2E=1, set only by eas.json's e2e-test profile) a
 *  production Supabase URL or a live Stripe publishable key throws before
 *  any client exists, even if an Expo environment overrode the profile.
 *  Without the flag it does nothing. */
export function assertE2eAppTarget(
  e2eFlag: string | undefined,
  supabaseUrl: string | undefined,
  stripePublishableKey: string | undefined,
): void {
  if (e2eFlag !== '1') return;
  if ((supabaseUrl ?? '').toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('e2e build: EXPO_PUBLIC_SUPABASE_URL is the PRODUCTION project. An e2e build only talks to staging.');
  }
  if ((stripePublishableKey ?? '').trim().startsWith('pk_live_')) {
    throw new Error('e2e build: EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is a live Stripe key. An e2e build only uses Stripe test mode.');
  }
}

export type SupabaseKeyKind = 'secret' | 'publishable' | 'service_role_jwt' | 'anon_jwt' | 'unknown';

/** What kind of Supabase API key this is: the new sb_secret_ / sb_publishable_
 *  keys, or a legacy JWT (read from its role claim, not verified). */
export function supabaseKeyKind(key: string): SupabaseKeyKind {
  const k = key.trim();
  if (k.startsWith('sb_secret_')) return 'secret';
  if (k.startsWith('sb_publishable_')) return 'publishable';
  const role = jwtPayload(k)?.role;
  if (role === 'service_role') return 'service_role_jwt';
  if (role === 'anon') return 'anon_jwt';
  return 'unknown';
}

/** A legacy JWT key names its project in the ref claim. */
export function jwtProjectRef(key: string): string | null {
  const ref = jwtPayload(key.trim())?.ref;
  return typeof ref === 'string' ? ref : null;
}

/** Throws if a legacy JWT key belongs to production. The new sb_ keys
 *  carry no project, so only the URL check covers them. */
export function assertNotProductionKey(key: string | undefined): void {
  if (key && jwtProjectRef(key) === PRODUCTION_PROJECT_REF) {
    throw new Error('e2e guard: this key belongs to the PRODUCTION Supabase project.');
  }
}

function jwtPayload(key: string): Record<string, unknown> | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as unknown;
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The seed needs the service role: a new sb_secret_ key or a legacy
 *  service_role JWT. Anything else is a mistake in the secrets. */
export function assertServiceKey(key: string | undefined): void {
  const kind = key ? supabaseKeyKind(key) : 'unknown';
  if (kind !== 'secret' && kind !== 'service_role_jwt') {
    throw new Error(
      'e2e guard: STAGING_SUPABASE_SERVICE_ROLE_KEY must be an sb_secret_ key or a legacy service_role JWT.',
    );
  }
}

/** The app's key: a new sb_publishable_ key or a legacy anon JWT. */
export function isPublicSupabaseKey(key: string): boolean {
  const kind = supabaseKeyKind(key);
  return kind === 'publishable' || kind === 'anon_jwt';
}

function base64UrlDecode(part: string): string {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
}

type EasJson = { build?: Record<string, Record<string, unknown> | undefined> };

/** Problems with eas.json's e2e-test profile. With `allowPlaceholders`
 *  (Jest, before Panos fills the profile in) the REPLACE_ values pass; the
 *  workflow's first job runs without it and fails while any remain. */
export function e2eProfileProblems(eas: EasJson, { allowPlaceholders }: { allowPlaceholders: boolean }): string[] {
  const profile = eas.build?.['e2e-test'];
  if (!profile) return ['eas.json has no "e2e-test" build profile.'];
  const problems: string[] = [];
  const env = (profile.env ?? {}) as Record<string, string | undefined>;
  const url = env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const pk = env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

  for (const [name, value] of Object.entries({ EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: anon, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk })) {
    if (!value) problems.push(`${name} is not set in the e2e-test profile.`);
    else if (value.startsWith('REPLACE_') && !allowPlaceholders) {
      problems.push(`${name} is still the placeholder ${value}. Put the staging value in eas.json.`);
    }
  }
  try {
    assertStagingTarget(url || 'missing', pk || 'missing');
  } catch (err) {
    problems.push((err as Error).message);
  }
  try {
    assertNotProductionKey(anon);
  } catch (err) {
    problems.push((err as Error).message);
  }
  if (pk && !pk.startsWith('REPLACE_') && !pk.startsWith('pk_test_')) {
    problems.push('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ key.');
  }
  if (anon && !anon.startsWith('REPLACE_') && !isPublicSupabaseKey(anon)) {
    problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY must be an sb_publishable_ key or a legacy anon JWT (never a secret key).');
  }
  if (url && !url.startsWith('REPLACE_') && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
    problems.push('EXPO_PUBLIC_SUPABASE_URL must look like https://<project-ref>.supabase.co.');
  }
  if (env.EXPO_PUBLIC_E2E !== '1') {
    problems.push('EXPO_PUBLIC_E2E must be "1" in the e2e-test profile (it switches on the runtime guard in lib/supabase.ts).');
  }
  if ('channel' in profile) problems.push('The e2e-test profile must not have a channel (no OTA updates into test builds).');
  if ((profile.ios as { simulator?: unknown } | undefined)?.simulator !== true) problems.push('e2e-test needs ios.simulator true.');
  if ((profile.android as { buildType?: unknown } | undefined)?.buildType !== 'apk') problems.push('e2e-test needs android.buildType "apk".');
  return problems;
}
