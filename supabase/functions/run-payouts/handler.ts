// The payout job (docs/specs/13-payments-bookings.md "Payouts", decided 7
// and 16 November; 14, P4d), every few minutes:
//   1. the database works out each transfer (prepare_payouts): one per
//      booking whose money is final (after its collection; a pay-all
//      booking when its collection time comes; a cancelled one once its
//      refunds are done), of what the ledger says the venue earned on it,
//      less anything the venue owes; only for venues that are live and have
//      finished Stripe onboarding;
//   2. each transfer is made from Futty's Stripe balance to the venue's
//      Express account (separate charges and transfers), keyed on the
//      payout row, so a retry after no answer is the same transfer;
//   3. the answer is recorded (payout_sent writes the ledger); an error is
//      retried after a back-off, and the founders are alerted at the third.
// One transfer failing never stops the others; running it twice moves no
// money twice.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from '../_shared/db.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import { errorText } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };

type Due = {
  payout_id: string;
  venue_id: string;
  booking_id: string;
  amount_cents: number;
  stripe_account_id: string;
  attempts: number;
};

export async function runPayouts(deps: Deps) {
  const summary = { sent: 0, retry: 0 };
  const runId = await rpc<string>(deps.db, 'prepare_payouts');
  const due = await rpc<Due[]>(deps.db, 'payouts_due');

  for (const payout of due ?? []) {
    try {
      const transfer = await deps.stripe.transfers.create(
        {
          amount: payout.amount_cents,
          currency: 'eur',
          destination: payout.stripe_account_id,
          // Stripe's grouping for separate charges and transfers: the booking.
          transfer_group: `booking-${payout.booking_id}`,
          description: 'Futty: pitch money for a booking',
          metadata: { payout_id: payout.payout_id, booking_id: payout.booking_id, venue_id: payout.venue_id },
        },
        { idempotencyKey: idempotencyKeys.payout(payout.payout_id) },
      );
      await rpc(deps.db, 'payout_sent', {
        p_payout_id: payout.payout_id,
        p_transfer_id: transfer.id,
        p_amount_cents: transfer.amount,
      });
      summary.sent += 1;
    } catch (err) {
      console.error(`run-payouts: payout ${payout.payout_id} failed:`, err);
      try {
        await rpc(deps.db, 'payout_errored', { p_payout_id: payout.payout_id, p_error: errorText(err) });
      } catch (recordErr) {
        console.error(`run-payouts: recording payout ${payout.payout_id}'s failure failed:`, recordErr);
      }
      summary.retry += 1;
    }
  }

  await rpc(deps.db, 'finish_payout_run', { p_run_id: runId });
  return summary;
}
