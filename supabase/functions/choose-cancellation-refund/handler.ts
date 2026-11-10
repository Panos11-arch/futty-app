// A player whose share is given back after the booker or the venue
// cancelled chooses how (docs/specs/13-payments-bookings.md, "Cancellations
// and refunds", and the 10 November decision): venue credit, issued at
// once, or a card refund (5-10 working days), sent now. They have 48 hours;
// without a choice, run-payment-jobs sends the card refund then. Only the
// player can choose, once (choose_cancellation_refund checks it with the
// verified caller). A refund that fails here is retried by the job.
import type Stripe from 'npm:stripe@^22';
import { type CancellationWork, runCancellationLine } from '../_shared/cancellation.ts';
import { type Db, DbError, rpc } from '../_shared/db.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Body = { lineId?: string; choice?: 'card' | 'credit' };
export type Result = { status: number; body: Record<string, unknown> };

const ERROR_STATUS: Record<string, number> = { refund_not_found: 404, not_your_refund: 403 };

export async function chooseCancellationRefund(deps: Deps, callerId: string, body: Body): Promise<Result> {
  if (!body.lineId || (body.choice !== 'card' && body.choice !== 'credit')) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
  let chosen: { result: 'refund' | 'credited'; refund_cents?: number; credit_cents?: number };
  try {
    chosen = await rpc(deps.db, 'choose_cancellation_refund', {
      p_line_id: body.lineId,
      p_profile_id: callerId,
      p_choice: body.choice,
    });
  } catch (err) {
    if (!(err instanceof DbError)) throw err;
    return { status: ERROR_STATUS[err.message] ?? 409, body: { error: err.message } };
  }

  if (chosen.result === 'credited') {
    return { status: 200, body: { choice: 'credit', creditCents: chosen.credit_cents } };
  }
  const [line] = await rpc<CancellationWork[]>(deps.db, 'cancellation_line_work', { p_line_id: body.lineId });
  const sent = line ? await runCancellationLine(deps, line) : true;
  return { status: 200, body: { choice: 'card', refundCents: chosen.refund_cents, pending: !sent } };
}
