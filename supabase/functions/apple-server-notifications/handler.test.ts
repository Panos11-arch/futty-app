import { deepStrictEqual } from 'node:assert/strict';

import type { SubscriptionState } from '../_shared/premium.ts';
import type { ApplyArgs } from '../verify-purchase/handler.ts';
import { handleNotification, type NotificationDeps } from './handler.ts';

function deps(over: {
  existing?: { profileId: string; productId: string } | null;
  state?: SubscriptionState | null;
  team?: boolean;
} = {}) {
  const applied: ApplyArgs[] = [];
  const teams: string[] = [];
  const d: NotificationDeps = {
    findSubscription: async () => (over.existing === undefined ? { profileId: 'p1', productId: 'premium_monthly_v2' } : over.existing),
    fetchSubscription: async () => (over.state === undefined ? { active: true, productId: 'premium_plus_monthly', expiresAt: 1_800_000_000_000 } : over.state),
    apply: async (a) => {
      applied.push(a);
      return { tier: 'x', error: null };
    },
    handleTeamPurchase: async (otx) => {
      teams.push(otx);
      return over.team ?? false;
    },
  };
  return { d, applied, teams };
}

Deno.test('a renewal after an upgrade: re-asks Apple and records the new product (Premium → Plus)', async () => {
  const { d, applied } = deps();
  deepStrictEqual(await handleNotification(d, 'otx'), 'ok');
  deepStrictEqual(applied, [
    { profileId: 'p1', productId: 'premium_plus_monthly', originalTransactionId: 'otx', active: true, expiresAt: new Date(1_800_000_000_000).toISOString() },
  ]);
});

Deno.test('a downgrade taking effect at renewal: Plus → Premium', async () => {
  const { d, applied } = deps({
    existing: { profileId: 'p1', productId: 'premium_plus_monthly' },
    state: { active: true, productId: 'premium_monthly_v2', expiresAt: null },
  });
  await handleNotification(d, 'otx');
  deepStrictEqual([applied[0].productId, applied[0].active], ['premium_monthly_v2', true]);
});

Deno.test('expiry, a refund or a revocation: inactive (back to Basic in the database)', async () => {
  const { d, applied } = deps({ state: { active: false, productId: 'premium_plus_monthly', expiresAt: null } });
  await handleNotification(d, 'otx');
  deepStrictEqual(applied[0].active, false);
  // Apple has data but nothing for this subscription any more: inactive on the product on file.
  const gone = deps({ state: { active: false, productId: null, expiresAt: null } });
  await handleNotification(gone.d, 'otx');
  deepStrictEqual([gone.applied[0].productId, gone.applied[0].active], ['premium_monthly_v2', false]);
});

Deno.test("Apple can't answer right now: nothing changes", async () => {
  const { d, applied } = deps({ state: null });
  deepStrictEqual(await handleNotification(d, 'otx'), 'ok');
  deepStrictEqual(applied, []);
});

Deno.test('not a personal subscription: Team Premium as before, or unknown; no payload is ignored', async () => {
  const team = deps({ existing: null, team: true });
  deepStrictEqual(await handleNotification(team.d, 'otx'), 'ok');
  deepStrictEqual(team.teams, ['otx']);
  deepStrictEqual(team.applied, []);
  deepStrictEqual(await handleNotification(deps({ existing: null }).d, 'otx'), 'unknown transaction');
  deepStrictEqual(await handleNotification(deps().d, null), 'ignored');
});
