// Stripe events for bookings made since P4a (docs/specs/13-payments-bookings.md,
// "When money is held and taken"). Every state change here comes from a
// verified webhook event and is made by a database function that also writes
// the money ledger:
//   payment_intent.amount_capturable_updated  a share is held; taken when its
//                                             free hour ends (run-payment-jobs)
//   payment_intent.succeeded                  a share is taken (at once when
//                                             paid less than 6 hours before kickoff)
//   setup_intent.succeeded                    a card saved for a share with
//                                             nothing to charge, or a booker's
//                                             new guarantee card
// The share is found by the share id in the intent's metadata. The event's
// time (when Stripe says the card was held or charged) decides the
// 15-minute payment window and whether a share is non-refundable.
// Money on an intent the share no longer uses (it was replaced), on a
// cancelled booking, or refused (late, wrong amount, notice not accepted)
// is released or refunded at once and recorded, or queued if Stripe fails.
// When the booker's card is saved and their guarantee is already due, the
// guarantee hold is placed straight away.
//
// Returns false for anything that isn't a P4a share, so index.ts falls back
// to the old handling for bookings made before P4a.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from '../_shared/db.ts';
import { type DueGuarantee, placeGuaranteeHold } from '../_shared/guarantee.ts';
import { metadataFeeCents, releaseBookingMoney, releaseOrQueue, stripeFeeCents } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };

type ShareResult = {
  result: string;
  reason?: string;
  booking_id?: string;
  share_id?: string;
  guarantee_id?: string | null;
  guarantee_due?: boolean;
};

function paymentMethodId(pm: string | { id: string } | null | undefined): string | null {
  if (!pm) return null;
  return typeof pm === 'string' ? pm : pm.id;
}

async function placeIfDue(deps: Deps, result: ShareResult) {
  if (!result.guarantee_due || !result.guarantee_id) return;
  const [guarantee] = await rpc<DueGuarantee[]>(deps.db, 'guarantees_due_for_hold', { p_guarantee_id: result.guarantee_id });
  if (guarantee) await placeGuaranteeHold(deps, guarantee);
}

/** What the database decided: release or refund this intent, or (the
 *  booker paid after the 15-minute window) everything on the booking. */
async function follow(deps: Deps, result: ShareResult, intentId: string | null) {
  if ((result.result === 'release' || result.result === 'refund') && intentId && result.booking_id) {
    await releaseOrQueue(deps, {
      booking_id: result.booking_id,
      share_id: result.share_id ?? null,
      intent_id: intentId,
      reason: result.reason ?? 'refused',
    });
  } else if (result.result === 'expired' && result.booking_id) {
    await releaseBookingMoney(deps, result.booking_id, 'payment_window_expired');
  } else {
    await placeIfDue(deps, result);
  }
}

export async function handlePaymentModeEvent(event: Stripe.Event, deps: Deps): Promise<boolean> {
  const at = new Date(event.created * 1000).toISOString();

  if (event.type === 'setup_intent.succeeded') {
    const setupIntent = event.data.object as Stripe.SetupIntent;
    const pm = paymentMethodId(setupIntent.payment_method as string | { id: string } | null);
    if (setupIntent.metadata?.kind === 'share_card') {
      const result = await rpc<ShareResult>(deps.db, 'share_card_saved', {
        p_share_id: setupIntent.metadata.share_id,
        p_setup_intent_id: setupIntent.id,
        p_payment_method_id: pm,
        p_at: at,
      });
      await follow(deps, result, null);
      return true;
    }
    if (setupIntent.metadata?.kind === 'guarantee_card') {
      const result = await rpc<ShareResult>(deps.db, 'guarantee_card_replaced', {
        p_guarantee_id: setupIntent.metadata.guarantee_id,
        p_profile_id: setupIntent.metadata.profile_id,
        p_payment_method_id: pm,
      });
      await placeIfDue(deps, result);
      return true;
    }
    return false;
  }

  if (event.type !== 'payment_intent.amount_capturable_updated' && event.type !== 'payment_intent.succeeded') {
    return false;
  }
  const intent = event.data.object as Stripe.PaymentIntent;
  // Guarantee holds are recorded by whoever placed them (placeGuaranteeHold).
  if (intent.metadata?.kind === 'guarantee') return true;
  const shareId = intent.metadata?.share_id;
  if (!shareId) return false;
  const pm = paymentMethodId(intent.payment_method as string | { id: string } | null);

  let result: ShareResult;
  if (event.type === 'payment_intent.amount_capturable_updated') {
    result = await rpc<ShareResult>(deps.db, 'share_payment_held', {
      p_share_id: shareId,
      p_intent_id: intent.id,
      p_amount_cents: intent.amount_capturable,
      p_payment_method_id: pm,
      p_at: at,
    });
  } else {
    // Bookings before P4a carry no fee in their metadata; the database
    // answers 'legacy' for them before any of this is used.
    const p4a = intent.metadata?.fee_cents !== undefined;
    const full = p4a
      ? await deps.stripe.paymentIntents.retrieve(intent.id, { expand: ['latest_charge.balance_transaction'] })
      : intent;
    result = await rpc<ShareResult>(deps.db, 'share_payment_captured', {
      p_share_id: shareId,
      p_intent_id: intent.id,
      p_amount_cents: full.amount_received,
      p_payment_method_id: pm,
      p_fee_cents: p4a ? metadataFeeCents(full) : null,
      p_stripe_fee_cents: p4a ? stripeFeeCents(full) : null,
      p_at: at,
    });
  }
  if (result.result === 'legacy' || result.result === 'unknown') return false;

  await follow(deps, result, intent.id);
  return true;
}
