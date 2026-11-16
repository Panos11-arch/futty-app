// Stripe events for venue payouts (P4d; docs/specs/13-payments-bookings.md
// "Payouts"). Each state change is made by a database function:
//   account.updated                  (Connect) what the venue's Express
//                                    account can do: whether it can
//                                    receive payouts (onboarding finished)
//   account.application.deauthorized (Connect) the venue disconnected
//                                    Futty: no more transfers; alerted
//   transfer.created                 a transfer run-payouts made, when its
//                                    API answer was lost (payout_sent is
//                                    idempotent)
//   transfer.reversed                someone reversed a transfer in Stripe:
//                                    recorded, alerted; reversed in full,
//                                    the money goes again on the next run
// Returns true when it handled the event.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';

export type Deps = { db: Db };

export async function handlePayoutEvent(event: Stripe.Event, deps: Deps): Promise<boolean> {
  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    await rpc(deps.db, 'connect_account_updated', {
      p_account_id: account.id,
      p_details_submitted: account.details_submitted ?? false,
      p_charges_enabled: account.charges_enabled ?? false,
      p_payouts_enabled: account.payouts_enabled ?? false,
      p_requirements_due: account.requirements?.currently_due?.length ?? 0,
      p_disabled_reason: account.requirements?.disabled_reason ?? null,
    });
    return true;
  }

  if (event.type === 'account.application.deauthorized') {
    if (event.account) await rpc(deps.db, 'connect_account_deauthorized', { p_account_id: event.account });
    return true;
  }

  if (event.type === 'transfer.created') {
    const transfer = event.data.object as Stripe.Transfer;
    const payoutId = transfer.metadata?.payout_id;
    if (!payoutId) return true; // Not one of run-payouts' transfers.
    try {
      await rpc(deps.db, 'payout_sent', {
        p_payout_id: payoutId,
        p_transfer_id: transfer.id,
        p_amount_cents: transfer.amount,
      });
    } catch (err) {
      // Already recorded with this transfer, or reversed since: nothing to do.
      if (!(err instanceof DbError && err.message === 'payout_not_pending')) throw err;
    }
    return true;
  }

  if (event.type === 'transfer.reversed') {
    const transfer = event.data.object as Stripe.Transfer;
    // Every reversal on the transfer, oldest first, each recorded once,
    // with the total reversed up to it.
    const reversals = [...(transfer.reversals?.data ?? [])].sort((a, b) => a.created - b.created);
    let total = 0;
    for (const reversal of reversals) {
      total += reversal.amount;
      await rpc(deps.db, 'payout_reversed', {
        p_transfer_id: transfer.id,
        p_reversal_id: reversal.id,
        p_amount_cents: reversal.amount,
        p_reversed_total_cents: total,
      });
    }
    return true;
  }

  return false;
}
