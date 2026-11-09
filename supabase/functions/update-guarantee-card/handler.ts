// The booker replaces the card behind their guarantee (docs/specs/13-payments-
// bookings.md, step 3, decided 9 November): an on-session SetupIntent the
// app confirms, 3-D Secure included. When Stripe confirms it (stripe-webhook,
// setup_intent.succeeded, kind 'guarantee_card'), the new card replaces the
// old one and the hold is retried at once if it's due.
//
// Only the booker, on their own live booking, before kickoff.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { idempotencyKeys } from '../_shared/money.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Result = { status: number; body: Record<string, unknown> };

type Guarantee = { guarantee_id: string; stripe_customer_id: string | null; stripe_payment_method_id: string | null };

const ERROR_STATUS: Record<string, number> = { not_found: 404, not_your_booking: 403 };

export async function updateGuaranteeCard(deps: Deps, callerId: string, body: { bookingId?: string }): Promise<Result> {
  if (!body.bookingId) return { status: 400, body: { error: 'invalid_request' } };

  let guarantee: Guarantee;
  try {
    guarantee = await rpc<Guarantee>(deps.db, 'guarantee_for_card_update', {
      p_booking_id: body.bookingId,
      p_profile_id: callerId,
    });
  } catch (err) {
    if (!(err instanceof DbError)) throw err;
    return { status: ERROR_STATUS[err.message] ?? 409, body: { error: err.message } };
  }
  if (!guarantee.stripe_customer_id) return { status: 409, body: { error: 'no_saved_card' } };

  const setupIntent = await deps.stripe.setupIntents.create({
    customer: guarantee.stripe_customer_id,
    usage: 'off_session',
    automatic_payment_methods: { enabled: true },
    metadata: {
      kind: 'guarantee_card',
      guarantee_id: guarantee.guarantee_id,
      profile_id: callerId,
      booking_id: body.bookingId,
    },
  }, { idempotencyKey: idempotencyKeys.guaranteeCard(guarantee.guarantee_id, guarantee.stripe_payment_method_id) });

  return {
    status: 200,
    body: { setupIntentClientSecret: setupIntent.client_secret, customerId: guarantee.stripe_customer_id },
  };
}
