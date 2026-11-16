// The daily money check (docs/specs/13-payments-bookings.md "The books
// always balance"; 14, P4d): for every booking, venue + Futty + Stripe fees
// + refunds = what was taken (money_balance), and no money that was due
// before the last payout run is missing a transfer. The database alerts the
// founders (admin_alerts: books_unbalanced, payout_missing), once each.
// It also reports what is waiting for card money to clear in Stripe (the
// total, and the oldest waiting payout), which is not a failure.
import { type Db, rpc } from '../_shared/db.ts';

export type Deps = { db: Db };
export type Summary = {
  checked: number;
  unbalanced: number;
  missing_transfers: number;
  waiting_for_balance_cents: number;
  oldest_waiting: { payout_id: string; amount_cents: number; created_at: string; waiting_since: string } | null;
};

export async function reconcileMoney(deps: Deps): Promise<Summary> {
  const summary = await rpc<Summary>(deps.db, 'reconcile_money');
  if (summary.unbalanced > 0 || summary.missing_transfers > 0) {
    console.error('reconcile-money: problems found, see admin_alerts:', JSON.stringify(summary));
  }
  if (summary.waiting_for_balance_cents > 0) {
    console.log('reconcile-money: waiting for card money to clear in Stripe:', JSON.stringify({
      waiting_for_balance_cents: summary.waiting_for_balance_cents,
      oldest_waiting: summary.oldest_waiting,
    }));
  }
  return summary;
}
