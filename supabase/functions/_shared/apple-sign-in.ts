// Revokes a Sign in with Apple user's token when they delete their account,
// as App Store Review Guideline 5.1.1(v) requires (P13).
//
// The app asks the user to confirm with Apple once more and sends the fresh
// authorization code (valid for 5 minutes). Here it is swapped for a refresh
// token at Apple's /auth/token, which is then revoked at /auth/revoke. No
// Apple token is ever stored.
//
// Before revoking, the sub in the id_token that comes back with it must be the
// Apple ID linked to the Futty account: the device may be signed into a
// different Apple ID, and revoking that one would leave the account's own
// grant in place while the account is deleted.
//
// The client secret is a short-lived ES256 JWT signed with the Sign in with
// Apple key (.p8), made with jose for the reason given in apple-app-store.ts.
// Config is passed in rather than read from Deno.env here, so tests need no
// env access and no real key.

import { decodeJwt, importPKCS8, SignJWT } from 'npm:jose@5';

export const APPLE_ID_HOST = 'https://appleid.apple.com';

export type AppleSignInConfig = {
  /** Apple Developer Team ID. */
  teamId: string;
  /** Key ID of the Sign in with Apple key. */
  keyId: string;
  /** The .p8 key's contents (PKCS#8 PEM). */
  privateKeyPem: string;
  /** The native app's bundle ID: the audience of the app's Apple tokens. */
  clientId: string;
};

/** The code is for a different Apple ID from the one on the account. */
export class AppleAccountMismatchError extends Error {
  constructor() {
    super('The Apple ID that confirmed is not the one linked to this account');
    this.name = 'AppleAccountMismatchError';
  }
}

function subOf(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const { sub } = decodeJwt(idToken);
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export async function makeClientSecret(config: AppleSignInConfig): Promise<string> {
  const key = await importPKCS8(config.privateKeyPem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(config.clientId)
    .setAudience(APPLE_ID_HOST)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

function post(fetchFn: FetchFn, path: string, form: Record<string, string>) {
  return fetchFn(`${APPLE_ID_HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

/**
 * Throws when Apple refuses either step, or when the code belongs to an Apple
 * ID other than `expectedSub` (the account's Apple identity), so the caller
 * can stop before deleting anything.
 */
export async function revokeAppleToken(
  authorizationCode: string,
  expectedSub: string,
  config: AppleSignInConfig,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const clientSecret = await makeClientSecret(config);
  const client = { client_id: config.clientId, client_secret: clientSecret };

  const tokenResponse = await post(fetchFn, '/auth/token', {
    ...client,
    code: authorizationCode,
    grant_type: 'authorization_code',
  });
  if (!tokenResponse.ok) {
    throw new Error(`Apple token exchange failed (${tokenResponse.status}): ${await tokenResponse.text()}`);
  }

  const tokens = (await tokenResponse.json()) as { refresh_token?: string; access_token?: string; id_token?: string };

  // Read straight from Apple's answer to our signed request over TLS, so its
  // signature needs no separate check here.
  const sub = subOf(tokens.id_token);
  if (!sub) throw new Error('Apple token exchange returned no usable id_token');
  if (sub !== expectedSub) throw new AppleAccountMismatchError();

  const [token, hint] = tokens.refresh_token
    ? [tokens.refresh_token, 'refresh_token']
    : [tokens.access_token, 'access_token'];
  if (!token) throw new Error('Apple token exchange returned no token');

  const revokeResponse = await post(fetchFn, '/auth/revoke', { ...client, token, token_type_hint: hint });
  if (!revokeResponse.ok) {
    throw new Error(`Apple token revoke failed (${revokeResponse.status}): ${await revokeResponse.text()}`);
  }
}
