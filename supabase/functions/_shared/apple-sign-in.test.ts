import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'npm:jose@5';

import { APPLE_ID_HOST, type AppleSignInConfig, makeClientSecret, revokeAppleToken } from './apple-sign-in.ts';

// A throwaway P-256 key made per run: no real Apple key in the repo.
async function testKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pem = (label: string, der: ArrayBuffer) =>
    `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...new Uint8Array(der)))}\n-----END ${label}-----`;
  return {
    privateKeyPem: pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicKeyPem: pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
  };
}

async function setup() {
  const keys = await testKeys();
  const config: AppleSignInConfig = {
    teamId: 'TEAM123',
    keyId: 'KEY456',
    privateKeyPem: keys.privateKeyPem,
    clientId: 'com.panosalepis.futtyapp',
  };
  return { config, publicKeyPem: keys.publicKeyPem };
}

type Call = { url: string; form: Record<string, string> };

function fakeApple(responses: Record<string, Response>) {
  const calls: Call[] = [];
  const fetchFn = (url: string, init: RequestInit) => {
    calls.push({ url, form: Object.fromEntries(new URLSearchParams(String(init.body))) });
    return Promise.resolve(responses[url.replace(APPLE_ID_HOST, '')] ?? new Response('not found', { status: 404 }));
  };
  return { calls, fetchFn };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

Deno.test('the client secret is an ES256 JWT Apple accepts: team, bundle ID, audience, key ID', async () => {
  const { config, publicKeyPem } = await setup();
  const secret = await makeClientSecret(config);
  strictEqual(decodeProtectedHeader(secret).kid, 'KEY456');
  const { payload } = await jwtVerify(secret, await importSPKI(publicKeyPem, 'ES256'), {
    issuer: 'TEAM123',
    subject: 'com.panosalepis.futtyapp',
    audience: APPLE_ID_HOST,
  });
  strictEqual((payload.exp ?? 0) - (payload.iat ?? 0), 300);
});

Deno.test('swaps the code for a refresh token, then revokes it', async () => {
  const { config } = await setup();
  const apple = fakeApple({
    '/auth/token': ok({ access_token: 'at', refresh_token: 'rt' }),
    '/auth/revoke': new Response(null, { status: 200 }),
  });
  await revokeAppleToken('fresh-code', config, apple.fetchFn);

  deepStrictEqual(apple.calls.map((c) => c.url), [`${APPLE_ID_HOST}/auth/token`, `${APPLE_ID_HOST}/auth/revoke`]);
  const [exchange, revoke] = apple.calls;
  strictEqual(exchange.form.code, 'fresh-code');
  strictEqual(exchange.form.grant_type, 'authorization_code');
  strictEqual(exchange.form.client_id, 'com.panosalepis.futtyapp');
  strictEqual(revoke.form.token, 'rt');
  strictEqual(revoke.form.token_type_hint, 'refresh_token');
  strictEqual(revoke.form.client_id, 'com.panosalepis.futtyapp');
  strictEqual(typeof revoke.form.client_secret, 'string');
});

Deno.test('no refresh token: revokes the access token instead', async () => {
  const { config } = await setup();
  const apple = fakeApple({
    '/auth/token': ok({ access_token: 'at' }),
    '/auth/revoke': new Response(null, { status: 200 }),
  });
  await revokeAppleToken('fresh-code', config, apple.fetchFn);
  strictEqual(apple.calls[1].form.token, 'at');
  strictEqual(apple.calls[1].form.token_type_hint, 'access_token');
});

Deno.test('an expired or used code: throws and never calls revoke', async () => {
  const { config } = await setup();
  const apple = fakeApple({ '/auth/token': new Response('{"error":"invalid_grant"}', { status: 400 }) });
  await rejects(revokeAppleToken('old-code', config, apple.fetchFn), /token exchange failed \(400\)/);
  strictEqual(apple.calls.length, 1);
});

Deno.test('no token at all from Apple: throws', async () => {
  const { config } = await setup();
  const apple = fakeApple({ '/auth/token': ok({}) });
  await rejects(revokeAppleToken('fresh-code', config, apple.fetchFn), /returned no token/);
});

Deno.test('Apple refuses the revoke: throws', async () => {
  const { config } = await setup();
  const apple = fakeApple({
    '/auth/token': ok({ refresh_token: 'rt' }),
    '/auth/revoke': new Response('{"error":"invalid_client"}', { status: 400 }),
  });
  await rejects(revokeAppleToken('fresh-code', config, apple.fetchFn), /revoke failed \(400\)/);
});
