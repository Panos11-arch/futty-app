// The daily money check (docs/specs/13-payments-bookings.md "The books
// always balance"; 14, P4d): for every booking, venue + Futty + Stripe fees
// + refunds = what was taken (money_balance), and no money that was due
// before the last payout run is missing a transfer. The database alerts the
// founders (admin_alerts: books_unbalanced, payout_missing), once each.
import { type Db, rpc } from '../_shared/db.ts';

export type Deps = { db: Db };
export type Summary = { checked: number; unbalanced: number; missing_transfers: number };

export async function reconcileMoney(deps: Deps): Promise<Summary> {
  const summary = await rpc<Summary>(deps.db, 'reconcile_money');
  if (summary.unbalanced > 0 || summary.missing_transfers > 0) {
    console.error('reconcile-money: problems found, see admin_alerts:', JSON.stringify(summary));
  }
  return summary;
}
