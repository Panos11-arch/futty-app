// A venue's Stripe Connect Express account (docs/specs/05-product.md section
// 12 item 10; 13 "Payouts"; 14, P4d). For the venue's owner only:
//   action 'onboard'    creates the venue's Express account once (keyed on
//                       the venue), and returns a Stripe onboarding link
//   action 'dashboard'  returns a link to the venue's Stripe Express
//                       dashboard, where it sees its bank payouts (Stripe's
//                       own schedule)
// Whether the account can receive payouts is only ever learnt from Stripe's
// account.updated webhook (stripe-webhook/payouts.ts), never from the app.
// An account from the other Stripe mode (a test-mode account once Futty is
// on live keys) is ignored: onboarding creates one in the current mode,
// which replaces it.
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
  /** The mode of the Stripe key (sk_live_: live). */
  livemode: boolean;
};
export type Caller = { id: string; email?: string | null };
export type Body = { venueId?: unknown; action?: unknown };
export type Result = { status: number; body: Record<string, unknown> };

type Account = {
  venue_id: string;
  venue_name: string;
  stripe_account_id: string | null;
  livemode: boolean | null;
  payouts_enabled: boolean;
};

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
  // Only an account from this Stripe mode counts.
  const current = account.stripe_account_id && account.livemode === deps.livemode ? account.stripe_account_id : null;

  if (action === 'dashboard') {
    if (!current) return { status: 409, body: { error: 'not_onboarded' } };
    const link = await deps.stripe.accounts.createLoginLink(current, {}, {
      idempotencyKey: `connect-login-${venueId}-${minute}`,
    });
    return { status: 200, body: { url: link.url } };
  }

  let accountId = current;
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
      { idempotencyKey: idempotencyKeys.connectAccount(venueId, deps.livemode) },
    );
    accountId = await rpc<string>(deps.db, 'connect_account_created', {
      p_venue_id: venueId,
      p_account_id: created.id,
      // An account is created in the mode of the key that creates it.
      p_livemode: deps.livemode,
    });
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
