// A venue's Stripe Connect Express account (docs/specs/05-product.md section
// 12 item 10; 13 "Payouts"; 14, P4d). For the venue's owner only:
//   action 'onboard'    creates the venue's Express account once (keyed on
//                       the venue), and returns a Stripe onboarding link
//   action 'dashboard'  returns a link to the venue's Stripe Express
//                       dashboard, where it sees its bank payouts (Stripe's
//                       own schedule)
// Whether the account can receive payouts is only ever learnt from Stripe's
// account.updated webhook (stripe-webhook/payouts.ts), never from the app.
// Links come back to connect-return, which opens the app again.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { idempotencyKeys } from '../_shared/money.ts';

export type Deps = {
  stripe: Stripe;
  db: Db;
  /** connect-return's URL, which sends the browser back into the app. */
  returnUrl: string;
  /** For the link's idempotency key: a link is single-use, so each minute's
   *  request is its own. */
  now: () => Date;
};
export type Caller = { id: string; email?: string | null };
export type Body = { venueId?: unknown; action?: unknown };
export type Result = { status: number; body: Record<string, unknown> };

type Account = { venue_id: string; venue_name: string; stripe_account_id: string | null; payouts_enabled: boolean };

const ERROR_STATUS: Record<string, number> = { venue_not_found: 404, not_venue_staff: 403 };

export async function connectOnboarding(deps: Deps, caller: Caller, body: Body): Promise<Result> {
  const venueId = typeof body.venueId === 'string' ? body.venueId : null;
  const action = body.action === 'dashboard' ? 'dashboard' : body.action === 'onboard' ? 'onboard' : null;
  if (!venueId || !action) return { status: 400, body: { error: 'invalid_request' } };

  let account: Account;
  try {
    account = await rpc<Account>(deps.db, 'connect_account_for_venue', { p_venue_id: venueId, p_profile_id: caller.id });
  } catch (err) {
    const code = err instanceof DbError ? err.message : 'failed';
    return { status: ERROR_STATUS[code] ?? 500, body: { error: code } };
  }
  const minute = Math.floor(deps.now().getTime() / 60_000);

  if (action === 'dashboard') {
    if (!account.stripe_account_id) return { status: 409, body: { error: 'not_onboarded' } };
    const link = await deps.stripe.accounts.createLoginLink(account.stripe_account_id, {}, {
      idempotencyKey: `connect-login-${venueId}-${minute}`,
    });
    return { status: 200, body: { url: link.url } };
  }

  let accountId = account.stripe_account_id;
  if (!accountId) {
    const created = await deps.stripe.accounts.create(
      {
        type: 'express',
        country: 'CY',
        email: caller.email ?? undefined,
        business_profile: { name: account.venue_name },
        capabilities: { transfers: { requested: true } },
        metadata: { venue_id: venueId },
      },
      { idempotencyKey: idempotencyKeys.connectAccount(venueId) },
    );
    accountId = await rpc<string>(deps.db, 'connect_account_created', { p_venue_id: venueId, p_account_id: created.id });
  }
  const back = (state: 'return' | 'refresh') =>
    `${deps.returnUrl}?venueId=${encodeURIComponent(venueId)}&state=${state}`;
  const link = await deps.stripe.accountLinks.create(
    { account: accountId, type: 'account_onboarding', return_url: back('return'), refresh_url: back('refresh') },
    { idempotencyKey: `connect-link-${venueId}-${minute}` },
  );
  return { status: 200, body: { url: link.url } };
}

/** connect-return: the browser comes back from Stripe; open the app's
 *  Payouts screen (it loads the account's state from the server). */
export function returnToApp(url: URL, appScheme: string): Response {
  const venueId = url.searchParams.get('venueId') ?? '';
  const state = url.searchParams.get('state') === 'refresh' ? 'refresh' : 'return';
  const target = `${appScheme}://venue-payouts?venueId=${encodeURIComponent(venueId)}&stripe=${state}`;
  return new Response(null, { status: 302, headers: { Location: target } });
}
