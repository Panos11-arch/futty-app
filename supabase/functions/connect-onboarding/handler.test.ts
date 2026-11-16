// connect-onboarding (P4d): the venue owner's Express account, created once
// and keyed on the venue; Stripe's onboarding link or Express dashboard link;
// nobody else's. connect-return opens the app again.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { connectOnboarding, returnToApp } from './handler.ts';

const caller = { id: 'owner1', email: 'owner@venue.test' };
const now = () => new Date('2026-11-16T10:00:30Z');
const minute = Math.floor(now().getTime() / 60_000);

function setup(account: Record<string, unknown> = { stripe_account_id: null, payouts_enabled: false }) {
  const db = createDbFake();
  db.respond('connect_account_for_venue', { venue_id: 'v1', venue_name: 'Nuevo Campo', ...account });
  db.respond('connect_account_created', (args: Record<string, unknown>) => args.p_account_id);
  const stripe = createStripeFake();
  stripe.respond('accounts.create', { id: 'acct_new' });
  stripe.respond('accountLinks.create', { url: 'https://connect.stripe.com/setup/e/acct_new/abc' });
  stripe.respond('accounts.createLoginLink', { url: 'https://connect.stripe.com/express/acct_1/xyz' });
  const deps = { db: db.db, stripe: stripe.stripe, returnUrl: 'https://ref.supabase.co/functions/v1/connect-return', now };
  return { db, stripe, deps };
}

Deno.test('onboard, first time: an Express account for the venue, once, then the onboarding link', async () => {
  const { db, stripe, deps } = setup();
  const result = await connectOnboarding(deps, caller, { venueId: 'v1', action: 'onboard' });
  deepStrictEqual(result, { status: 200, body: { url: 'https://connect.stripe.com/setup/e/acct_new/abc' } });

  deepStrictEqual(db.callsTo('connect_account_for_venue')[0].args, { p_venue_id: 'v1', p_profile_id: 'owner1' },
    'the caller is checked against the venue');
  const created = stripe.callsTo('accounts.create');
  strictEqual(created.length, 1);
  deepStrictEqual(created[0].params, {
    type: 'express',
    country: 'CY',
    email: 'owner@venue.test',
    business_profile: { name: 'Nuevo Campo' },
    capabilities: { transfers: { requested: true } },
    metadata: { venue_id: 'v1' },
  });
  strictEqual(created[0].idempotencyKey, 'connect-account-v1', 'one account per venue, however often asked');
  deepStrictEqual(db.callsTo('connect_account_created')[0].args, { p_venue_id: 'v1', p_account_id: 'acct_new' });

  const link = stripe.callsTo('accountLinks.create')[0];
  deepStrictEqual(link.params, {
    account: 'acct_new',
    type: 'account_onboarding',
    return_url: 'https://ref.supabase.co/functions/v1/connect-return?venueId=v1&state=return',
    refresh_url: 'https://ref.supabase.co/functions/v1/connect-return?venueId=v1&state=refresh',
  });
  strictEqual(link.idempotencyKey, `connect-link-v1-${minute}`);
});

Deno.test('onboard again: the existing account, no new one', async () => {
  const { stripe, deps } = setup({ stripe_account_id: 'acct_1', payouts_enabled: false });
  const result = await connectOnboarding(deps, caller, { venueId: 'v1', action: 'onboard' });
  strictEqual(result.status, 200);
  strictEqual(stripe.callsTo('accounts.create').length, 0);
  strictEqual(stripe.callsTo('accountLinks.create')[0].params?.account, 'acct_1');
});

Deno.test("dashboard: the venue's Stripe Express dashboard (its bank payouts)", async () => {
  const { stripe, deps } = setup({ stripe_account_id: 'acct_1', payouts_enabled: true });
  const result = await connectOnboarding(deps, caller, { venueId: 'v1', action: 'dashboard' });
  deepStrictEqual(result, { status: 200, body: { url: 'https://connect.stripe.com/express/acct_1/xyz' } });
  const login = stripe.callsTo('accounts.createLoginLink')[0];
  strictEqual(login.id, 'acct_1');
  strictEqual(login.idempotencyKey, `connect-login-v1-${minute}`);
});

Deno.test('dashboard before onboarding: refused', async () => {
  const { stripe, deps } = setup();
  deepStrictEqual(await connectOnboarding(deps, caller, { venueId: 'v1', action: 'dashboard' }),
    { status: 409, body: { error: 'not_onboarded' } });
  strictEqual(stripe.calls.length, 0);
});

Deno.test("not the venue's owner, an unknown venue, a bad request: refused, no Stripe call", async () => {
  const { db, stripe, deps } = setup();
  db.fail('connect_account_for_venue', 'not_venue_staff');
  deepStrictEqual(await connectOnboarding(deps, caller, { venueId: 'v1', action: 'onboard' }),
    { status: 403, body: { error: 'not_venue_staff' } });
  db.fail('connect_account_for_venue', 'venue_not_found');
  deepStrictEqual(await connectOnboarding(deps, caller, { venueId: 'v9', action: 'onboard' }),
    { status: 404, body: { error: 'venue_not_found' } });
  db.fail('connect_account_for_venue', 'something else');
  strictEqual((await connectOnboarding(deps, caller, { venueId: 'v1', action: 'onboard' })).status, 500);
  deepStrictEqual(await connectOnboarding(deps, caller, { venueId: 'v1', action: 'payout' }),
    { status: 400, body: { error: 'invalid_request' } });
  deepStrictEqual(await connectOnboarding(deps, caller, { action: 'onboard' }),
    { status: 400, body: { error: 'invalid_request' } });
  strictEqual(stripe.calls.length, 0);
});

Deno.test("connect-return: back into the app's Payouts screen", () => {
  const back = returnToApp(new URL('https://ref.supabase.co/functions/v1/connect-return?venueId=v1&state=return'), 'futtyapp');
  strictEqual(back.status, 302);
  strictEqual(back.headers.get('Location'), 'futtyapp://venue-payouts?venueId=v1&stripe=return');
  const refresh = returnToApp(new URL('https://x/connect-return?venueId=v%201&state=refresh'), 'futtyapp');
  strictEqual(refresh.headers.get('Location'), 'futtyapp://venue-payouts?venueId=v%201&stripe=refresh');
  const odd = returnToApp(new URL('https://x/connect-return?state=evil'), 'futtyapp');
  strictEqual(odd.headers.get('Location'), 'futtyapp://venue-payouts?venueId=&stripe=return');
});
