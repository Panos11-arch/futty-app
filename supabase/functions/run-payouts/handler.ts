// The payout job (docs/specs/13-payments-bookings.md "Payouts", decided 7
// and 16 November; 14, P4d), every few minutes:
//   1. the database works out each transfer (prepare_payouts): one per
//      booking whose money is final (after its collection; a pay-all
//      booking when its collection time comes; a cancelled one once its
//      refunds are done), of what the ledger says the venue earned on it,
//      less anything the venue owes; only for venues that are live, whose
//      Futty payouts have started (payouts_from), and whose Express account
//      is from this Stripe mode and has finished onboarding;
//   2. transfers draw on Futty's AVAILABLE Stripe balance (no
//      source_transaction), and card money is pending in Stripe for days
//      first. So the available EUR balance is read, and pending payouts are
//      sent oldest first while they fit. The first that doesn't fit, and
//      every one after it, is waiting (payout_waiting): no attempt counted,
//      no alert, tried on the next run. A transfer Stripe refuses with
//      balance_insufficient is waiting too;
//   3. each transfer is made from Futty's balance to the venue's account
//      (separate charges and transfers), keyed on the payout row, so a
//      retry after no answer is the same transfer; the answer is recorded
//      (payout_sent writes the ledger); any other error is retried after a
//      back-off, and the founders are alerted at the third.
// One transfer failing never stops the others; running it twice moves no
// money twice.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from '../_shared/db.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import { errorText } from '../_shared/release.ts';

export type Deps = {
  stripe: Stripe;
  db: Db;
  /** The mode of the Stripe key (sk_live_: live): only accounts of this
   *  mode are paid. */
  livemode: boolean;
};

type Due = {
  payout_id: string;
  venue_id: string;
  booking_id: string;
  amount_cents: number;
  stripe_account_id: string;
  attempts: number;
};

/** Futty's available EUR balance at Stripe, in cents. */
async function availableEur(stripe: Stripe): Promise<number> {
  const balance = await stripe.balance.retrieve();
  return (balance.available ?? []).filter((b) => b.currency === 'eur').reduce((sum, b) => sum + b.amount, 0);
}

export async function runPayouts(deps: Deps) {
  const summary = { sent: 0, waiting: 0, retry: 0 };
  const runId = await rpc<string>(deps.db, 'prepare_payouts', { p_livemode: deps.livemode });
  const due = (await rpc<Due[]>(deps.db, 'payouts_due', { p_livemode: deps.livemode })) ?? [];

  if (due.length > 0) {
    let available: number | null = null;
    try {
      available = await availableEur(deps.stripe);
    } catch (err) {
      // Nothing is sent without knowing the balance; the payouts stay as
      // they are and the next run tries again.
      console.error('run-payouts: reading the Stripe balance failed:', err);
    }

    if (available !== null) {
      let short = false;
      for (const payout of due) {
        if (short || payout.amount_cents > available) {
          short = true;
          await wait(deps, payout, summary);
          continue;
        }
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
          available -= transfer.amount;
          await rpc(deps.db, 'payout_sent', {
            p_payout_id: payout.payout_id,
            p_transfer_id: transfer.id,
            p_amount_cents: transfer.amount,
          });
          summary.sent += 1;
        } catch (err) {
          if ((err as { code?: string })?.code === 'balance_insufficient') {
            short = true;
            await wait(deps, payout, summary);
            continue;
          }
          console.error(`run-payouts: payout ${payout.payout_id} failed:`, err);
          try {
            await rpc(deps.db, 'payout_errored', { p_payout_id: payout.payout_id, p_error: errorText(err) });
          } catch (recordErr) {
            console.error(`run-payouts: recording payout ${payout.payout_id}'s failure failed:`, recordErr);
          }
          summary.retry += 1;
        }
      }
    }
  }

  await rpc(deps.db, 'finish_payout_run', { p_run_id: runId });
  return summary;
}

/** Waiting for card money to clear in Stripe: no attempt, no alert. */
async function wait(deps: Deps, payout: Due, summary: { waiting: number }) {
  summary.waiting += 1;
  try {
    await rpc(deps.db, 'payout_waiting', { p_payout_id: payout.payout_id });
  } catch (err) {
    console.error(`run-payouts: marking payout ${payout.payout_id} as waiting failed:`, err);
  }
}
