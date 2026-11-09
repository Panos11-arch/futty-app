// PaymentIntent-shaped objects for tests, as Stripe returns them when the
// charge and its balance transaction are expanded.
import type Stripe from 'npm:stripe@^22';

export function intent(
  id: string,
  status: Stripe.PaymentIntent.Status,
  {
    amount = 680,
    feeCents = 80,
    stripeFee = 35,
    refunded = 0,
    captureMethod = 'manual',
    method = 'card',
    metadata = {},
  }: {
    amount?: number;
    feeCents?: number;
    stripeFee?: number;
    refunded?: number;
    captureMethod?: string;
    method?: string;
    metadata?: Record<string, string>;
  } = {},
) {
  const taken = status === 'succeeded';
  return {
    id,
    object: 'payment_intent',
    status,
    amount,
    amount_capturable: status === 'requires_capture' ? amount : 0,
    amount_received: taken ? amount : 0,
    capture_method: captureMethod,
    client_secret: `${id}_secret`,
    payment_method: 'pm_1',
    metadata: { kind: 'share', share_id: 's1', booking_id: 'b1', method, fee_cents: String(feeCents), ...metadata },
    latest_charge: taken
      ? {
        id: `ch_${id}`,
        amount_captured: amount,
        amount_refunded: refunded,
        balance_transaction: { id: `txn_${id}`, fee: stripeFee },
      }
      : null,
  };
}
