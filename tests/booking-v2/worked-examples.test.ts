// B5: spec 13's Booking v2 worked examples (1-6b and 11; Losers pay, 7a-10b,
// is B1d), walked end to end through the app's own code: the checkout's
// amounts (checkoutAmountsV2), booking and paying (payForSlot, payShare),
// side B accepting an invite or a public post (acceptOpposition,
// acceptOppositionPost), "Pay the whole pitch and play" (payOtherHalf) and
// joining a published game (booking_post_quotes). The server is faked with
// the payloads its functions return for each example (the SQL tests assert
// those same amounts against the real database: pay-b1b, pay-b1c, pay-b3,
// pay-b4); Stripe's payment sheet is a fake that records what it was given.
//
// For every example the app shows exactly the server's amount, pays the
// share the server made, and never sends an amount of its own.
import { payForSlot, payShare, type PaymentSheet } from '@/lib/booking-checkout';
import { acceptOpposition, payOtherHalf, payWholeLabel } from '@/lib/booking-opposition';
import { acceptOppositionPost, getBookingPostQuotes, joinPriceText } from '@/lib/booking-posts';
import { checkoutAmountsV2, guaranteeCents, modeForWay, type CheckoutChoiceV2 } from '@/lib/booking-v2';
import { checkoutDataFixture, premiumQuoteV2Fixture, quoteV2Fixture } from '@/lib/booking-v2.fixtures';

type Call = { kind: 'rpc' | 'invoke'; name: string; args: unknown };
const mockCalls: Call[] = [];
const mockRpcReplies = new Map<string, unknown>();
const mockInvokeReplies = new Map<string, unknown>();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      mockCalls.push({ kind: 'rpc', name, args });
      return Promise.resolve({ data: mockRpcReplies.get(name) ?? null, error: null });
    },
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        mockCalls.push({ kind: 'invoke', name, args: opts.body });
        return Promise.resolve({ data: mockInvokeReplies.get(name) ?? null, error: null });
      },
    },
  },
}));
jest.mock('@/lib/edge-functions', () => ({ describeFunctionError: async (e: Error) => e.message }));

/** Stripe's payment sheet: records the client secret it was given. */
function fakeSheet() {
  const secrets: string[] = [];
  const sheet: PaymentSheet = {
    init: async (params) => {
      secrets.push(params.paymentIntentClientSecret ?? params.setupIntentClientSecret ?? '');
      return {};
    },
    present: async () => ({}),
  };
  return { sheet, secrets };
}

/** No request the app sends carries an amount: the server prices everything. */
function expectNoAmountSent() {
  const amountKey = /cents|amount|price|fee|total|capacity/i;
  const scan = (value: unknown, path: string) => {
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        expect(`${path}.${k}`).not.toMatch(amountKey);
        scan(v, `${path}.${k}`);
      }
    }
  };
  for (const c of mockCalls) scan(c.args, c.name);
}

const slot = { venueId: 'v1', day: '2026-11-26', start: '20:00', end: '21:00', format: '5-a-side', pitches: 1 };
const card = { method: 'card' as const, acceptNonRefundable: false, useCredit: false };
const whole: Omit<CheckoutChoiceV2, 'way'> = { kind: 'whole', cash: false, credit: false };
const half: Omit<CheckoutChoiceV2, 'way'> = { kind: 'half', cash: false, credit: false };

/** The booker books and pays: book_slot, then his share's payment for the server's amount. */
async function bookAndPay(choice: CheckoutChoiceV2, serverCents: number) {
  mockRpcReplies.set('book_slot', { id: 'bk1', amount_cents: 4000 });
  mockRpcReplies.set('list_booking_shares', [{ id: 'sh-booker', is_booker: true, status: 'pending' }]);
  mockInvokeReplies.set('create-share-payment', { clientSecret: 'cs_booker', amountCents: serverCents });
  const { sheet, secrets } = fakeSheet();
  const outcome = await payForSlot(
    {
      slot: slot as never,
      mode: modeForWay(choice.way!),
      kind: choice.kind,
      pitchIds: ['p2'],
      pay: { ...card, method: choice.cash ? 'cash' : 'card' },
      bookingId: null,
    },
    sheet,
  );
  return { outcome, secrets };
}

beforeEach(() => {
  mockCalls.length = 0;
  mockRpcReplies.clear();
  mockInvokeReplies.clear();
});

describe('Booking v2 worked examples, through the app (€40.00 5-a-side, 5 v 5)', () => {
  it('1. whole pitch, pay for everyone: the booker pays €45.50 in one payment', async () => {
    const choice = { ...whole, way: 'pay_all' as const };
    expect(checkoutAmountsV2(checkoutDataFixture(), choice)?.totalCents).toBe(4550);
    expect(guaranteeCents(quoteV2Fixture(), choice)).toBeNull();
    const { outcome, secrets } = await bookAndPay(choice, 4550);
    expect(outcome).toEqual({ status: 'paid', bookingId: 'bk1' });
    expect(mockCalls.find((c) => c.name === 'book_slot')?.args).toMatchObject({ p_mode: 'pay_all', p_kind: 'whole', p_pitch_ids: ['p2'] });
    expect(mockCalls.find((c) => c.name === 'create-share-payment')?.args).toEqual({ shareId: 'sh-booker', ...card });
    expect(secrets).toEqual(['cs_booker']);
    expectNoAmountSent();
  });

  it('2. whole pitch, pay for myself: €4.80 each, the booker\'s €40.00 guarantee', async () => {
    const choice = { ...whole, way: 'pay_for_myself' as const };
    expect(checkoutAmountsV2(checkoutDataFixture(), choice)?.totalCents).toBe(480);
    expect(guaranteeCents(quoteV2Fixture(), choice)).toBe(4000);
    const { outcome } = await bookAndPay(choice, 480);
    expect(outcome.status).toBe('paid');
    expect(mockCalls.find((c) => c.name === 'book_slot')?.args).toMatchObject({ p_mode: 'each_pays_responsible', p_kind: 'whole' });
    expectNoAmountSent();
  });

  it('3. whole pitch, cash: €0.80 in the app, €4.00 at the venue, the €40.00 guarantee', async () => {
    const choice = { ...whole, way: 'pay_for_myself' as const, cash: true };
    const a = checkoutAmountsV2(checkoutDataFixture(), choice);
    expect(a?.totalCents).toBe(80);
    expect(a?.cashCents).toBe(400);
    expect(guaranteeCents(quoteV2Fixture(), choice)).toBe(4000);
    await bookAndPay(choice, 80);
    expect(mockCalls.find((c) => c.name === 'create-share-payment')?.args).toMatchObject({ method: 'cash' });
    expectNoAmountSent();
  });

  it('4. half pitch, both sides pay for everyone: €22.75 each captain', async () => {
    const choice = { ...half, way: 'pay_all' as const };
    expect(checkoutAmountsV2(checkoutDataFixture(), choice)?.totalCents).toBe(2275);
    const { outcome } = await bookAndPay(choice, 2275);
    expect(outcome.status).toBe('paid');
    expect(mockCalls.find((c) => c.name === 'book_slot')?.args).toMatchObject({ p_mode: 'pay_all', p_kind: 'half' });

    // Side B's captain accepts the invite and pays his €22.75 within the window.
    mockRpcReplies.set('accept_opposition', { booking_id: 'bk1', share_id: 'sh-b', amount_cents: 2275 });
    mockInvokeReplies.set('create-share-payment', { clientSecret: 'cs_b', amountCents: 2275 });
    const accepted = await acceptOpposition('inv1', 'pay_all');
    expect(accepted).toEqual({ accepted: { booking_id: 'bk1', share_id: 'sh-b', amount_cents: 2275 } });
    const { sheet, secrets } = fakeSheet();
    expect(await payShare('sh-b', card, sheet)).toEqual({ status: 'paid' });
    expect(secrets).toEqual(['cs_b']);
    expect(mockCalls.find((c) => c.name === 'accept_opposition')?.args).toEqual({ p_invite_id: 'inv1', p_mode: 'pay_all' });
    expectNoAmountSent();
  });

  it('5. side A pays for everyone, side B for myself: €4.80 each on side B, his €20.00 guarantee', async () => {
    expect(guaranteeCents(quoteV2Fixture(), { ...half, way: 'pay_for_myself' })).toBe(2000);
    expect(checkoutAmountsV2(checkoutDataFixture(), { ...half, way: 'pay_for_myself' })?.totalCents).toBe(480);

    // Side B accepts a public opposition post (B4) paying for myself.
    mockRpcReplies.set('accept_opposition_post', { booking_id: 'bk1', share_id: 'sh-b', amount_cents: 480 });
    expect(await acceptOppositionPost('op1', 'each_pays_responsible')).toEqual({
      accepted: { booking_id: 'bk1', share_id: 'sh-b', amount_cents: 480 },
    });

    // A side B player joins side B's published spots: €4.80; side A's: nothing.
    mockRpcReplies.set('booking_post_quotes', [
      { post_id: 'pb', kind: 'players', side: 'b', mine: false, open: true, closes_at: '', join_cents: 480, join_pitch_cents: 400, join_fee_cents: 80, pay_all_cents: null, each_pays_cents: null, guarantee_cents: null },
      { post_id: 'pa', kind: 'players', side: 'a', mine: false, open: true, closes_at: '', join_cents: 0, join_pitch_cents: 0, join_fee_cents: 0, pay_all_cents: null, each_pays_cents: null, guarantee_cents: null },
    ]);
    const quotes = await getBookingPostQuotes(['pb', 'pa']);
    expect(joinPriceText(quotes!.get('pb')!)).toBe('€4.80 each');
    expect(joinPriceText(quotes!.get('pa')!)).toBe('Paid by the captain');
    expectNoAmountSent();
  });

  it.each([
    ['6a', 'pay for everyone', 2275, 'Pay €22.75 and play'],
    ['6b', 'pay for myself', 2400, 'Pay €24.00 and play'],
  ])('%s. no opponent, %s: "Pay the whole pitch and play" is one payment of the server\'s amount', async (_n, _way, cents, label) => {
    expect(payWholeLabel(cents)).toBe(label);
    mockInvokeReplies.set('pay-other-half', { clientSecret: 'cs_other_half' });
    const { sheet, secrets } = fakeSheet();
    expect(await payOtherHalf('bk1', sheet)).toEqual({ status: 'paid' });
    expect(mockCalls).toEqual([{ kind: 'invoke', name: 'pay-other-half', args: { bookingId: 'bk1' } }]);
    expect(secrets).toEqual(['cs_other_half']);
  });

  it('11. a Premium player: €4.00 paying for myself; a Premium booker paying for everyone €44.95', async () => {
    const data = checkoutDataFixture(premiumQuoteV2Fixture());
    expect(checkoutAmountsV2(data, { ...whole, way: 'pay_for_myself' })?.totalCents).toBe(400);
    expect(checkoutAmountsV2(data, { ...whole, way: 'pay_all' })?.totalCents).toBe(4495);
    await bookAndPay({ ...whole, way: 'pay_all' }, 4495);
    expectNoAmountSent();
  });

  it('a payment the server says is already covered opens no sheet', async () => {
    mockInvokeReplies.set('create-share-payment', { clientSecret: null, paid: true });
    const { sheet, secrets } = fakeSheet();
    expect(await payShare('sh1', card, sheet)).toEqual({ status: 'paid' });
    expect(secrets).toEqual([]);
  });
});
