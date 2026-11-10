// The collection job (docs/specs/13-payments-bookings.md, "When money is held
// and taken" steps 7-9, "Short games, top-ups and 6 v 6", "Cash, debt and
// venue credit"; 14, P4c), every minute:
//   1. 6 hours before kickoff, a short game's players are told what they'll
//      each pay extra ("You're 8 of 10 ..."), once;
//   2. after the match, an unticked cash player is asked to pay by card or
//      remain in debt to the venue, once;
//   3. the booker's whole-team cancellation charge still unpaid at the
//      original kickoff becomes their debt to Futty;
//   4. 2 hours after the match (or when the venue's staff ask, once the
//      match has ended), each booking is collected:
//        - any payment still open on an unpaid share is checked at Stripe
//          first: one going through is left to its webhook (the booking
//          waits for the next run), any other is cancelled so it can never
//          be paid as well;
//        - the database writes what each joined player owes now
//          (start_collection);
//        - every short-game top-up is charged off-session to the player's
//          saved card, no fee (Futty absorbs Stripe's); a declined card is
//          final (still owed), no answer is retried with the same key;
//        - once every top-up has an answer, the database settles
//          (settle_collection): in responsible mode what's still unpaid is
//          taken from the booker's hold here (partial capture; Stripe
//          releases the rest), or the whole hold released; otherwise it's
//          a debt, which the database already wrote.
// Every Stripe call is keyed on our row ids. One booking failing never stops
// the others; running it twice changes nothing the second time.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from '../_shared/db.ts';
import { cardProblemText, isCardProblem, type StripeErrorLike } from '../_shared/guarantee.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import { errorText, releaseIntent, releaseOrQueue, stripeFeeCents } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };

type Due = { booking_id: string; collection_id: string | null };
type OpenIntent = { share_id: string; kind: 'payment' | 'setup' | 'cash'; intent_id: string };
type TopUp = {
  item_id: string;
  collection_id: string;
  booking_id: string;
  share_id: string;
  profile_id: string;
  amount_cents: number;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  previous_intent_id: string | null;
  attempts: number;
};
type Settle = {
  result: 'waiting' | 'done' | 'guarantee';
  collection_id: string;
  booking_id?: string;
  guarantee_id?: string | null;
  stripe_intent_id?: string | null;
  action?: 'capture' | 'release';
  capture_cents?: number;
  futty_cents?: number;
};
type Outcome = 'done' | 'waiting' | 'retry';
type TopUpOutcome = 'paid' | 'unpaid' | 'retry';

const EXPAND = ['latest_charge.balance_transaction'];

export async function runCollection(deps: Deps) {
  const summary = { warned: 0, prompted: 0, futtyDebts: 0, collected: 0, waiting: 0, retry: 0, failed: 0 };

  try {
    summary.warned = await rpc<number>(deps.db, 'send_short_game_warnings');
  } catch (err) {
    console.error('run-collection: short-game warnings failed:', err);
  }
  try {
    summary.prompted = await rpc<number>(deps.db, 'send_cash_prompts');
  } catch (err) {
    console.error('run-collection: cash prompts failed:', err);
  }
  try {
    summary.futtyDebts = await rpc<number>(deps.db, 'cancellation_fees_to_debts');
  } catch (err) {
    console.error('run-collection: cancellation charges to debts failed:', err);
  }

  for (const due of await rpc<Due[]>(deps.db, 'collections_due')) {
    try {
      const outcome = await collectBooking(deps, due);
      if (outcome === 'done') summary.collected += 1;
      else summary[outcome] += 1;
    } catch (err) {
      // Found again on the next run.
      console.error(`run-collection: booking ${due.booking_id} failed:`, err);
      summary.failed += 1;
    }
  }
  return summary;
}

async function collectBooking(deps: Deps, due: Due): Promise<Outcome> {
  let collectionId = due.collection_id;
  if (!collectionId) {
    if (!(await closeOpenPayments(deps, due.booking_id))) return 'waiting';
    const started = await rpc<{ collection_id: string }>(deps.db, 'start_collection', { p_booking_id: due.booking_id });
    collectionId = started.collection_id;
  }

  let retry = false;
  for (const topUp of await rpc<TopUp[]>(deps.db, 'collection_top_ups_due', { p_collection_id: collectionId })) {
    if ((await chargeTopUp(deps, topUp)) === 'retry') retry = true;
  }

  const settle = await rpc<Settle>(deps.db, 'settle_collection', { p_collection_id: collectionId });
  if (settle.result === 'waiting') return retry ? 'retry' : 'waiting';
  if (settle.result === 'done') return 'done';
  return await settleGuarantee(deps, settle);
}

/** Every payment still open on an unpaid share (or an unticked cash part):
 *  false while one is going through (its webhook decides), otherwise each
 *  is cancelled and true. */
async function closeOpenPayments(deps: Deps, bookingId: string): Promise<boolean> {
  const open = await rpc<OpenIntent[]>(deps.db, 'collection_open_intents', { p_booking_id: bookingId });
  for (const item of open) {
    if (item.kind === 'setup') {
      const setupIntent = await deps.stripe.setupIntents.retrieve(item.intent_id);
      if (setupIntent.status === 'processing' || setupIntent.status === 'succeeded') return false;
      if (setupIntent.status !== 'canceled') {
        await deps.stripe.setupIntents.cancel(item.intent_id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(item.intent_id) });
      }
      continue;
    }
    const intent = await deps.stripe.paymentIntents.retrieve(item.intent_id, { expand: EXPAND });
    if (intent.status === 'processing' || intent.status === 'requires_capture') return false;
    if (intent.status === 'succeeded') {
      // Paid: its webhook settles the share, unless the money was given back.
      const charge = intent.latest_charge as Stripe.Charge | string | null;
      if (!(typeof charge === 'object' && charge && charge.amount_refunded > 0)) return false;
      continue;
    }
    if (intent.status !== 'canceled') {
      await deps.stripe.paymentIntents.cancel(item.intent_id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(item.intent_id) });
    }
  }
  return true;
}

/** One top-up, off-session on the player's saved card. */
async function chargeTopUp(deps: Deps, topUp: TopUp): Promise<TopUpOutcome> {
  const { stripe, db } = deps;
  try {
    if (topUp.previous_intent_id) {
      // An earlier try got no final answer: what happened to it decides.
      const previous = await stripe.paymentIntents.retrieve(topUp.previous_intent_id, { expand: EXPAND });
      if (previous.status === 'succeeded') return await recordTopUp(deps, topUp, previous);
      if (previous.status === 'processing') return await errored(db, topUp, previous.id, 'processing');
      return await notPaid(deps, topUp, previous.id, previous.status, previous.status !== 'canceled');
    }
  } catch (err) {
    return await errored(db, topUp, null, errorText(err));
  }

  if (!topUp.stripe_customer_id || !topUp.stripe_payment_method_id) {
    return await notPaid(deps, topUp, null, 'no_saved_card', false);
  }

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create({
      amount: topUp.amount_cents,
      currency: 'eur',
      customer: topUp.stripe_customer_id,
      payment_method: topUp.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      expand: EXPAND,
      // No share_id here: the webhook must never take this for a share.
      metadata: {
        kind: 'top_up',
        item_id: topUp.item_id,
        collection_id: topUp.collection_id,
        booking_id: topUp.booking_id,
        fee_cents: '0',
      },
    }, { idempotencyKey: idempotencyKeys.topUp(topUp.item_id) });
  } catch (err) {
    const error = err as StripeErrorLike;
    if (!isCardProblem(error)) return await errored(db, topUp, null, errorText(err));
    const leftOver = error.raw?.payment_intent?.id ?? null;
    return await notPaid(deps, topUp, leftOver, cardProblemText(error), leftOver !== null);
  }

  if (intent.status === 'succeeded') return await recordTopUp(deps, topUp, intent);
  if (intent.status === 'processing') return await errored(db, topUp, intent.id, 'processing');
  // e.g. requires_action: the bank wants the player present.
  return await notPaid(deps, topUp, intent.id, intent.status, true);
}

async function recordTopUp(deps: Deps, topUp: TopUp, intent: Stripe.PaymentIntent): Promise<TopUpOutcome> {
  const result = await rpc<{ result: string; reason?: string }>(deps.db, 'collection_top_up_paid', {
    p_item_id: topUp.item_id,
    p_intent_id: intent.id,
    p_amount_cents: intent.amount_received,
    p_stripe_fee_cents: stripeFeeCents(intent),
  });
  if (result.result === 'refund') {
    await releaseOrQueue(deps, {
      booking_id: topUp.booking_id, share_id: topUp.share_id, intent_id: intent.id, reason: result.reason ?? 'refused',
    });
    return 'unpaid';
  }
  return 'paid';
}

/** The card said no: still owed (covered by the hold or a debt). Anything
 *  left open on it is cancelled so it can't be paid later. */
async function notPaid(
  deps: Deps,
  topUp: TopUp,
  intentId: string | null,
  error: string,
  cancelLeftOver: boolean,
): Promise<TopUpOutcome> {
  await rpc(deps.db, 'collection_top_up_failed', { p_item_id: topUp.item_id, p_intent_id: intentId, p_error: error });
  if (cancelLeftOver && intentId) {
    await releaseOrQueue(deps, { booking_id: topUp.booking_id, share_id: topUp.share_id, intent_id: intentId, reason: 'top_up_failed' });
  }
  return 'unpaid';
}

async function errored(db: Db, topUp: TopUp, intentId: string | null, error: string): Promise<TopUpOutcome> {
  console.error(`run-collection: top-up ${topUp.item_id}: no answer from Stripe (${error}), retrying after a back-off`);
  await rpc(db, 'collection_top_up_errored', { p_item_id: topUp.item_id, p_intent_id: intentId, p_error: error });
  return 'retry';
}

/** The guarantee step: take what's unpaid from the hold, or release it. */
async function settleGuarantee(deps: Deps, settle: Settle): Promise<Outcome> {
  const intentId = settle.stripe_intent_id!;
  const item = {
    booking_id: settle.booking_id!,
    guarantee_id: settle.guarantee_id ?? null,
    intent_id: intentId,
    reason: 'collection_nothing_owed',
  };
  try {
    if (settle.action === 'release') {
      await releaseIntent(deps, item);
      await done(deps.db, settle.collection_id, 'released', 0, 0);
      return 'done';
    }

    let intent = await deps.stripe.paymentIntents.retrieve(intentId, { expand: EXPAND });
    if (intent.status === 'requires_capture') {
      intent = await deps.stripe.paymentIntents.capture(
        intentId,
        { amount_to_capture: settle.capture_cents!, expand: EXPAND },
        { idempotencyKey: idempotencyKeys.collectGuarantee(settle.collection_id) },
      );
    }
    if (intent.status === 'succeeded') {
      await done(deps.db, settle.collection_id, 'captured', intent.amount_received, stripeFeeCents(intent));
      return 'done';
    }
    if (intent.status === 'canceled') {
      // The hold expired or was cancelled: the booker owes it instead.
      await rpc(deps.db, 'record_intent_cancelled', {
        p_booking_id: item.booking_id,
        p_share_id: null,
        p_guarantee_id: item.guarantee_id,
        p_intent_id: intentId,
        p_reason: 'collection_hold_gone',
      });
      await done(deps.db, settle.collection_id, 'gone', 0, 0);
      return 'done';
    }
    throw new Error(`cannot_collect: ${intentId} is ${intent.status}`);
  } catch (err) {
    console.error(`run-collection: guarantee for collection ${settle.collection_id} failed, retried later:`, err);
    await rpc(deps.db, 'collection_failed', { p_collection_id: settle.collection_id, p_error: errorText(err) });
    return 'retry';
  }
}

function done(db: Db, collectionId: string, outcome: string, amountCents: number, stripeFee: number) {
  return rpc(db, 'collection_guarantee_done', {
    p_collection_id: collectionId,
    p_outcome: outcome,
    p_amount_cents: amountCents,
    p_stripe_fee_cents: stripeFee,
  });
}
