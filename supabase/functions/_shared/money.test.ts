// The server's money maths (docs/specs/13-payments-bookings.md, "Prices and
// fees"). The same worked examples as supabase/tests/pay-modes-1-amounts.test.sql,
// so the SQL and TypeScript can't drift apart.
import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { cardChargeCents, FEE_EACH_PAYS_CENTS, FEE_PAY_ALL_CENTS, idempotencyKeys, shareAmounts } from './money.ts';

const each = { pitchCents: 6000, players: 10, mode: 'each_pays_own_spot', isBooker: false, isPremium: false, method: 'card' } as const;

Deno.test('fees: 80 when each pays, 55 when the booker pays for everyone', () => {
  strictEqual(FEE_EACH_PAYS_CENTS, 80);
  strictEqual(FEE_PAY_ALL_CENTS, 55);
});

Deno.test('every worked example from the spec, exact amounts', () => {
  const cases = [
    { label: 'EUR 60 5 v 5, each pays', input: each, want: [600, 80, 680, 0] },
    { label: 'responsible booker', input: { ...each, mode: 'each_pays_responsible', isBooker: true }, want: [600, 80, 680, 0] },
    { label: 'EUR 61.11, booker', input: { ...each, pitchCents: 6111, isBooker: true }, want: [612, 80, 692, 0] },
    { label: 'EUR 61.11, others', input: { ...each, pitchCents: 6111 }, want: [611, 80, 691, 0] },
    { label: '6 v 6', input: { ...each, players: 12 }, want: [500, 80, 580, 0] },
    { label: 'pay for everyone 5 v 5', input: { ...each, mode: 'pay_all', isBooker: true }, want: [6000, 550, 6550, 0] },
    { label: 'pay for everyone 6 v 6', input: { ...each, mode: 'pay_all', isBooker: true, players: 12 }, want: [6000, 660, 6660, 0] },
    { label: 'Premium booker pays for everyone', input: { ...each, mode: 'pay_all', isBooker: true, isPremium: true }, want: [6000, 495, 6495, 0] },
    { label: 'player in a paid-for booking', input: { ...each, mode: 'pay_all' }, want: [0, 0, 0, 0] },
    { label: 'Premium own share', input: { ...each, isPremium: true }, want: [600, 0, 600, 0] },
    { label: 'cash player', input: { ...each, method: 'cash' }, want: [600, 80, 80, 600] },
    { label: 'Premium cash player', input: { ...each, mode: 'each_pays_responsible', isPremium: true, method: 'cash' }, want: [600, 0, 0, 600] },
  ] as const;
  for (const { label, input, want } of cases) {
    const got = shareAmounts(input);
    deepStrictEqual([got.pitchCents, got.feeCents, got.cardCents, got.cashCents], [...want], label);
  }
});

Deno.test('refuses what the server refuses', () => {
  throws(() => shareAmounts({ ...each, mode: 'pay_all', isBooker: true, method: 'cash' }), /cash_not_allowed/);
  throws(() => shareAmounts({ ...each, mode: 'pay_later' as never }), /invalid_payment_mode/);
  throws(() => shareAmounts({ ...each, method: 'cheque' as never }), /invalid_payment_method/);
  throws(() => shareAmounts({ ...each, players: 0 }), /invalid_money_input/);
  throws(() => shareAmounts({ ...each, pitchCents: -1 }), /invalid_money_input/);
  throws(() => shareAmounts({ ...each, pitchCents: 60.5 }), /invalid_money_input/);
});

Deno.test('the card charge follows from a share\'s breakdown', () => {
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 80, payment_method: 'card' }), 680);
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 80, payment_method: 'cash' }), 80);
  strictEqual(cardChargeCents({ pitch_cents: 6000, fee_cents: 495, payment_method: 'card' }), 6495);
});

Deno.test('idempotency keys are built from our ids and stable on retry', () => {
  strictEqual(idempotencyKeys.shareIntent('s1', null), 'share-s1-after-none');
  strictEqual(idempotencyKeys.shareIntent('s1', 'pi_old'), 'share-s1-after-pi_old');
  strictEqual(idempotencyKeys.capture('s1'), 'capture-share-s1');
  strictEqual(idempotencyKeys.capture('s1'), idempotencyKeys.capture('s1'));
  strictEqual(idempotencyKeys.cancelIntent('pi_1'), 'cancel-pi_1');
  strictEqual(idempotencyKeys.refundShare('s1'), 'refund-share-s1');
  strictEqual(idempotencyKeys.refundBooking('b1'), 'refund-booking-b1');
  strictEqual(idempotencyKeys.guaranteeHold('g1', 1), 'guarantee-g1-attempt-1');
  strictEqual(idempotencyKeys.customer('p1'), 'customer-p1');
  strictEqual(idempotencyKeys.shareCardSetup('s1'), 'setup-share-s1');
});
