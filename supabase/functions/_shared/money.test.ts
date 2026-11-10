// The server's money maths (docs/specs/13-payments-bookings.md, "Prices and
// fees"). The same worked examples as supabase/tests/pay-modes-1-amounts.test.sql,
// so the SQL and TypeScript can't drift apart.
import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import {
  CANCEL_KEEP_PER_PLAYER_CENTS,
  cardChargeCents,
  creditPayment,
  FEE_EACH_PAYS_CENTS,
  FEE_PAY_ALL_CENTS,
  idempotencyKeys,
  shareAmounts,
  wholeTeamCancelFeeCents,
} from './money.ts';

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
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 80, payment_method: 'card', credit_cents: 500 }), 180,
    'credit pays part of the pitch');
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 0, payment_method: 'card', credit_cents: 600 }), 0);
});

// The same examples as supabase/tests/pay-cancellations-7-credit.test.sql.
Deno.test('venue credit pays the pitch part with no fee; a shortfall is paid by card plus the normal fee', () => {
  deepStrictEqual(creditPayment(600, 80, 500), { creditCents: 500, feeCents: 80, cardCents: 180 }, '500 credit: 100 + 80');
  deepStrictEqual(creditPayment(600, 80, 800), { creditCents: 600, feeCents: 0, cardCents: 0 }, 'covered: no fee');
  deepStrictEqual(creditPayment(600, 80, 600), { creditCents: 600, feeCents: 0, cardCents: 0 }, 'exactly covered');
  deepStrictEqual(creditPayment(600, 0, 500), { creditCents: 500, feeCents: 0, cardCents: 100 }, 'Premium: no fee');
  deepStrictEqual(creditPayment(600, 80, 0), { creditCents: 0, feeCents: 80, cardCents: 680 }, 'no credit');
  // The booker paying for everyone (decided 10 November).
  deepStrictEqual(creditPayment(6000, 550, 7000), { creditCents: 6000, feeCents: 0, cardCents: 0 }, 'pay for everyone, covered');
  deepStrictEqual(creditPayment(6000, 550, 5000), { creditCents: 5000, feeCents: 550, cardCents: 1550 },
    'pay for everyone, shortfall: 1000 + 55 x 10');
  deepStrictEqual(creditPayment(6000, 495, 5000), { creditCents: 5000, feeCents: 495, cardCents: 1495 },
    'Premium booker: their own spot stays fee-free');
  throws(() => creditPayment(600, 80, -1), /invalid_money_input/);
  throws(() => creditPayment(600.5, 80, 0), /invalid_money_input/);
});

Deno.test('cancelling the whole team: 100 per other player whose payment was taken', () => {
  strictEqual(CANCEL_KEEP_PER_PLAYER_CENTS, 100);
  strictEqual(wholeTeamCancelFeeCents(9), 900, '9 paid players: 900');
  strictEqual(wholeTeamCancelFeeCents(6), 600, '6 taken, 3 held: 600');
  strictEqual(wholeTeamCancelFeeCents(0), 0);
  throws(() => wholeTeamCancelFeeCents(-1), /invalid_money_input/);
  throws(() => wholeTeamCancelFeeCents(1.5), /invalid_money_input/);
});

Deno.test('idempotency keys are built from our ids and stable on retry', () => {
  const card = { shareId: 's1', amountCents: 680, method: 'card', captureMethod: 'manual', previousIntentId: null } as const;
  strictEqual(idempotencyKeys.shareIntent(card), 'share-s1-680-card-manual-after-none');
  strictEqual(idempotencyKeys.shareIntent(card), idempotencyKeys.shareIntent({ ...card }), 'the same request, the same key');
  strictEqual(idempotencyKeys.shareIntent({ ...card, previousIntentId: 'pi_old' }), 'share-s1-680-card-manual-after-pi_old');
  strictEqual(idempotencyKeys.legacyShareIntent('s1', null), 'share-s1-after-none');
  strictEqual(idempotencyKeys.capture('s1'), 'capture-share-s1');
  strictEqual(idempotencyKeys.cancelIntent('pi_1'), 'cancel-pi_1');
  strictEqual(idempotencyKeys.refund('pi_1', 680), 'refund-pi_1-680');
  strictEqual(idempotencyKeys.guaranteeHold('g1', 'pm_1', 1), 'guarantee-g1-pm_1-attempt-1');
  strictEqual(idempotencyKeys.guaranteeCard('g1', 'pm_1'), 'guarantee-card-g1-after-pm_1');
  strictEqual(idempotencyKeys.guaranteeCard('g1', null), 'guarantee-card-g1-after-none');
  strictEqual(idempotencyKeys.customer('p1'), 'customer-p1');
  strictEqual(idempotencyKeys.shareCardSetup('s1', 'cash', null), 'setup-share-s1-cash-after-none');
  strictEqual(idempotencyKeys.shareCardSetup('s1', 'card', null, 'seti_old'), 'setup-share-s1-card-after-none-setup-seti_old');
  strictEqual(idempotencyKeys.cancelFee('f1', 1), 'cancel-fee-f1-attempt-1');
  strictEqual(idempotencyKeys.cancelFee('f1', 2), 'cancel-fee-f1-attempt-2', 'each retry is a new request');
});

Deno.test('P4c keys: a top-up and the guarantee collection are one request each, retries included', () => {
  strictEqual(idempotencyKeys.topUp('i1'), 'top-up-i1');
  strictEqual(idempotencyKeys.topUp('i1'), idempotencyKeys.topUp('i1'), 'a retry after no answer is the same request');
  strictEqual(idempotencyKeys.collectGuarantee('c1'), 'collect-guarantee-c1');
});

Deno.test('P4c keys: paying a debt or a cash part names the amount and the payment it replaces', () => {
  strictEqual(idempotencyKeys.owed('debt', 'd1', 680, null), 'owed-debt-d1-680-after-none');
  strictEqual(idempotencyKeys.owed('cash', 's1', 600, 'pi_old'), 'owed-cash-s1-600-after-pi_old');
  const keys = new Set([
    idempotencyKeys.owed('debt', 'd1', 680, null),
    idempotencyKeys.owed('debt', 'd1', 680, 'pi_old'),
    idempotencyKeys.owed('debt', 'd1', 750, null),
    idempotencyKeys.owed('cash', 'd1', 680, null),
  ]);
  strictEqual(keys.size, 4);
});

Deno.test('a retry with a different amount, method or timing gets a new key', () => {
  const card = { shareId: 's1', amountCents: 680, method: 'card', captureMethod: 'manual', previousIntentId: null } as const;
  const keys = new Set([
    idempotencyKeys.shareIntent(card),
    idempotencyKeys.shareIntent({ ...card, amountCents: 80, method: 'cash' }),
    idempotencyKeys.shareIntent({ ...card, captureMethod: 'automatic' }),
    idempotencyKeys.shareIntent({ ...card, amountCents: 600 }),
  ]);
  strictEqual(keys.size, 4);
});

Deno.test('a guarantee hold on a new card, or a new attempt, gets a new key', () => {
  const keys = new Set([
    idempotencyKeys.guaranteeHold('g1', 'pm_1', 1),
    idempotencyKeys.guaranteeHold('g1', 'pm_2', 1),
    idempotencyKeys.guaranteeHold('g1', 'pm_1', 2),
  ]);
  strictEqual(keys.size, 3);
});

Deno.test('a refund is keyed on the intent and what is left, whatever the reason, so two runs make one refund', () => {
  strictEqual(idempotencyKeys.refund('pi_1', 680), idempotencyKeys.refund('pi_1', 680));
  strictEqual(idempotencyKeys.refund('pi_1', 380), 'refund-pi_1-380', 'a later partial refund is a new request');
});
