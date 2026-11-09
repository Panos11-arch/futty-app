// Stripe events for bookings made since P4a (docs/specs/13-payments-bookings.md,
// "When money is held and taken"). Every state change here comes from a
// verified webhook event and is made by a database function that also writes
// the money ledger:
//   payment_intent.amount_capturable_updated  a share is held; it's taken
//                                             60 minutes later by run-payment-jobs
//   payment_intent.succeeded                  a share is taken (at once when
//                                             paid less than 6 hours before kickoff)
//   setup_intent.succeeded                    a card saved for a share with
//                                             nothing to charge
// When the booker's card is saved and their guarantee is already due (kickoff
// less than 72 hours away), the guarantee hold is placed straight away.
//
// Returns false for anything that isn't a P4a share, so index.ts falls back
// to the old handling for bookings made before P4a.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from '../_shared/db.ts';
import { type DueGuarantee, placeGuaranteeHold } from '../_shared/guarantee.ts';

export type Deps = { stripe: Stripe; db: Db };

type ShareResult = { result: string; guarantee_id?: string | null; guarantee_due?: boolean };

function paymentMethodId(pm: string | { id: string } | null | undefined): string | null {
  if (!pm) return null;
  return typeof pm === 'string' ? pm : pm.id;
}

async function placeIfDue(deps: Deps, result: ShareResult) {
  if (!result.guarantee_due || !result.guarantee_id) return;
  const [guarantee] = await rpc<DueGuarantee[]>(deps.db, 'guarantees_due_for_hold', { p_guarantee_id: result.guarantee_id });
  if (guarantee) await placeGuaranteeHold(deps, guarantee);
}

export async function handlePaymentModeEvent(event: Stripe.Event, deps: Deps): Promise<boolean> {
  if (event.type === 'setup_intent.succeeded') {
    const setupIntent = event.data.object as Stripe.SetupIntent;
    if (setupIntent.metadata?.kind !== 'share_card') return false;
    const result = await rpc<ShareResult>(deps.db, 'share_card_saved', {
      p_share_id: setupIntent.metadata.share_id,
      p_setup_intent_id: setupIntent.id,
      p_payment_method_id: paymentMethodId(setupIntent.payment_method as string | null),
    });
    await placeIfDue(deps, result);
    return true;
  }

  if (event.type !== 'payment_intent.amount_capturable_updated' && event.type !== 'payment_intent.succeeded') {
    return false;
  }
  const intent = event.data.object as Stripe.PaymentIntent;
  // Guarantee holds are recorded by whoever placed them (placeGuaranteeHold).
  if (intent.metadata?.kind === 'guarantee') return true;

  const held = event.type === 'payment_intent.amount_capturable_updated';
  const result = await rpc<ShareResult>(deps.db, held ? 'share_payment_held' : 'share_payment_captured', {
    p_intent_id: intent.id,
    p_amount_cents: held ? intent.amount_capturable : intent.amount_received,
    p_payment_method_id: paymentMethodId(intent.payment_method as string | { id: string } | null),
  });
  if (result.result === 'legacy' || result.result === 'unknown') return false;

  await placeIfDue(deps, result);
  return true;
}
