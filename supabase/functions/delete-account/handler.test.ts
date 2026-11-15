import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';

import { AppleAccountMismatchError } from '../_shared/apple-sign-in.ts';
import { type Body, deleteAccount, type Deps, type Identity } from './handler.ts';

const USER = 'user-1';
const APPLE_SUB = '001234.abcdef.0001';

type Options = {
  identities?: Identity[] | null;
  moneyInPlay?: boolean;
  revokeError?: Error;
  scrubError?: string;
};

/** Fake deps that record every step, in order. */
function fakeDeps(options: Options = {}) {
  const steps: string[] = [];
  const revokes: { code: string; expectedSub: string }[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    today: '2026-11-13',
    hasMoneyInPlay: (userId, today) => {
      steps.push(`money:${userId}:${today}`);
      return Promise.resolve(options.moneyInPlay ?? false);
    },
    loadIdentities: (userId) => {
      steps.push(`identities:${userId}`);
      return Promise.resolve(options.identities === undefined ? [{ provider: 'email', id: USER }] : options.identities);
    },
    revokeAppleToken: (code, expectedSub) => {
      steps.push('revoke');
      revokes.push({ code, expectedSub });
      return options.revokeError ? Promise.reject(options.revokeError) : Promise.resolve();
    },
    deleteSavedCards: () => {
      steps.push('cards');
      return Promise.resolve();
    },
    deleteLinks: () => {
      steps.push('links');
      return Promise.resolve();
    },
    scrubProfile: () => {
      steps.push('scrub');
      return Promise.resolve(options.scrubError ?? null);
    },
    deleteLogin: () => {
      steps.push('login');
      return Promise.resolve(null);
    },
    log: (message) => logs.push(message),
  };
  const deleted = () => steps.filter((s) => ['cards', 'links', 'scrub', 'login'].includes(s));
  return { deps, steps, revokes, logs, deleted };
}

const apple = [{ provider: 'apple', id: APPLE_SUB }];
const DELETES = ['cards', 'links', 'scrub', 'login'];

async function run(fake: ReturnType<typeof fakeDeps>, body: Body = {}) {
  return await deleteAccount(fake.deps, USER, body);
}

// --- Non-Apple accounts ---------------------------------------------------

for (const provider of ['email', 'google']) {
  Deno.test(`a ${provider} account: deleted, never revoked, no code needed`, async () => {
    const fake = fakeDeps({ identities: [{ provider, id: 'x' }] });
    const result = await run(fake);
    strictEqual(result.status, 200);
    deepStrictEqual(result.body, { deleted: true });
    strictEqual(fake.revokes.length, 0);
    deepStrictEqual(fake.deleted(), DELETES);
  });
}

Deno.test('a non-Apple account that sends a code anyway is still never revoked', async () => {
  const fake = fakeDeps({ identities: [{ provider: 'google', id: 'g' }] });
  const result = await run(fake, { appleAuthorizationCode: 'code', platform: 'ios' });
  strictEqual(result.status, 200);
  strictEqual(fake.revokes.length, 0);
});

// --- Apple accounts on iOS ------------------------------------------------

Deno.test('an Apple account: revoked with the account\'s own Apple ID, before anything is deleted', async () => {
  const fake = fakeDeps({ identities: apple });
  const result = await run(fake, { appleAuthorizationCode: 'fresh-code', platform: 'ios' });
  strictEqual(result.status, 200);
  deepStrictEqual(fake.revokes, [{ code: 'fresh-code', expectedSub: APPLE_SUB }]);
  deepStrictEqual(fake.steps.slice(fake.steps.indexOf('revoke')), ['revoke', ...DELETES]);
});

Deno.test('an Apple account linked to email still needs the revoke', async () => {
  const fake = fakeDeps({ identities: [{ provider: 'email', id: USER }, ...apple] });
  const result = await run(fake, { appleAuthorizationCode: 'fresh-code', platform: 'ios' });
  strictEqual(result.status, 200);
  strictEqual(fake.revokes.length, 1);
});

Deno.test('an Apple account without a code: 400, nothing revoked or deleted', async () => {
  for (const body of [{}, { platform: 'ios' }, { appleAuthorizationCode: '', platform: 'ios' }] as Body[]) {
    const fake = fakeDeps({ identities: apple });
    const result = await run(fake, body);
    strictEqual(result.status, 400);
    match(String(result.body.error), /Confirm with Apple/);
    strictEqual(fake.revokes.length, 0);
    deepStrictEqual(fake.deleted(), []);
  }
});

Deno.test('a failed revoke: 502, nothing deleted', async () => {
  const fake = fakeDeps({ identities: apple, revokeError: new Error('Apple token revoke failed (400)') });
  const result = await run(fake, { appleAuthorizationCode: 'fresh-code', platform: 'ios' });
  strictEqual(result.status, 502);
  deepStrictEqual(fake.deleted(), []);
  strictEqual(fake.logs.length, 1);
});

Deno.test('a code from a different Apple ID: refused, nothing deleted', async () => {
  const fake = fakeDeps({ identities: apple, revokeError: new AppleAccountMismatchError() });
  const result = await run(fake, { appleAuthorizationCode: 'other-apple-id', platform: 'ios' });
  strictEqual(result.status, 403);
  match(String(result.body.error), /Apple ID/);
  deepStrictEqual(fake.deleted(), []);
});

// --- Apple accounts off iOS (decided 13 November, for Panos to confirm) ----

for (const platform of ['android', 'web']) {
  Deno.test(`an Apple account on ${platform}: deleted without the revoke, and logged`, async () => {
    const fake = fakeDeps({ identities: apple });
    const result = await run(fake, { platform });
    strictEqual(result.status, 200);
    strictEqual(fake.revokes.length, 0);
    deepStrictEqual(fake.deleted(), DELETES);
    strictEqual(fake.logs.length, 1);
    match(fake.logs[0], new RegExp(`${USER}.*${platform}.*without revoking`));
  });
}

Deno.test('an Apple account on Android that does send a code is revoked as on iOS', async () => {
  const fake = fakeDeps({ identities: apple });
  const result = await run(fake, { appleAuthorizationCode: 'fresh-code', platform: 'android' });
  strictEqual(result.status, 200);
  strictEqual(fake.revokes.length, 1);
});

// --- Before any of that ----------------------------------------------------

Deno.test('money still in play: 409, nothing revoked or deleted', async () => {
  const fake = fakeDeps({ identities: apple, moneyInPlay: true });
  const result = await run(fake, { appleAuthorizationCode: 'fresh-code', platform: 'ios' });
  strictEqual(result.status, 409);
  strictEqual(fake.revokes.length, 0);
  deepStrictEqual(fake.deleted(), []);
});

Deno.test('the account\'s identities cannot be loaded: 500, nothing revoked or deleted', async () => {
  const fake = fakeDeps({ identities: null });
  const result = await run(fake, { appleAuthorizationCode: 'fresh-code', platform: 'ios' });
  strictEqual(result.status, 500);
  strictEqual(fake.revokes.length, 0);
  deepStrictEqual(fake.deleted(), []);
});

Deno.test('uses the Cyprus date it is given for the money check', async () => {
  const fake = fakeDeps();
  await run(fake);
  strictEqual(fake.steps[0], `money:${USER}:2026-11-13`);
});

// --- After the revoke ------------------------------------------------------

Deno.test('a failed profile scrub: 500, and the login is not deleted', async () => {
  const fake = fakeDeps({ identities: apple, scrubError: 'permission denied' });
  const result = await run(fake, { appleAuthorizationCode: 'fresh-code', platform: 'ios' });
  strictEqual(result.status, 500);
  strictEqual(fake.steps.includes('login'), false);
});
