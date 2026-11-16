// P4d: the Payouts screen's words. Every amount is the server's.
import { bookingMoney, overview } from '@/lib/payouts.fixtures';
import {
  accountWords,
  balanceWords,
  bookingMoneyLines,
  cyprusWhen,
  describePayoutError,
  openStripe,
  payoutRowWords,
  payoutStatus,
  STRIPE_RETURN_URL,
  type StripeDeps,
} from '@/lib/payouts';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

describe('accountWords: the Stripe account in plain words, with the one thing to do', () => {
  it.each([
    ['not_started', 'Set up payouts', { label: 'Set up payouts', kind: 'onboard' }],
    ['in_progress', 'Finish setting up payouts', { label: 'Finish setup', kind: 'onboard' }],
    ['needs_information', 'Stripe needs more information', { label: 'Update details', kind: 'onboard' }],
    ['disconnected', 'Payouts are disconnected', null],
    ['ready', 'Payouts are on', { label: 'Open Stripe dashboard', kind: 'dashboard' }],
  ] as const)('%s', (status, title, action) => {
    const words = accountWords({ status, venue_live: true, requirements_due: 2 });
    expect(words.title).toBe(title);
    expect(words.action).toEqual(action);
  });

  it('needs information: how many details, from Stripe', () => {
    expect(accountWords({ status: 'needs_information', venue_live: true, requirements_due: 1 }).body)
      .toBe('Stripe needs one more detail before it can send you money.');
    expect(accountWords({ status: 'needs_information', venue_live: true, requirements_due: 3 }).body)
      .toBe('Stripe needs 3 more details before it can send you money.');
  });

  it('ready but not live: payouts start once the venue is live', () => {
    expect(accountWords({ status: 'ready', venue_live: false, requirements_due: 0 }).title).toBe('Payouts start when your venue is live');
  });
});

describe('balanceWords: money not sent yet', () => {
  it('nothing waiting: nothing to say', () => {
    expect(balanceWords(overview())).toEqual([]);
  });

  it('being sent, in the next payout, and owed to Futty', () => {
    expect(balanceWords(overview({ sending_cents: 6000, ready_cents: 5895, owed_to_futty_cents: 105 }))).toEqual([
      '€60.00 is being sent now.',
      '€58.95 goes in the next payout, within minutes.',
      "You owe Futty €1.05 (for example Stripe's fee on a booking you cancelled). It comes off your next payout.",
    ]);
  });

  it('waiting for setup', () => {
    expect(balanceWords(overview({ can_receive: false, ready_cents: 6000 }))).toEqual(['€60.00 is waiting for payouts to be set up.']);
  });
});

describe('payouts and bookings', () => {
  it('a payout row', () => {
    const [two, one] = overview().payouts;
    expect(payoutRowWords(two)).toEqual({
      title: 'Nuevo Campo on Tuesday 17 Nov at 20:00',
      subtitle: 'Tue 17 Nov, 23:05 · and 1 earlier booking',
      amount: '€58.95',
    });
    expect(payoutRowWords(one).subtitle).toBe('Mon 16 Nov, 22:00');
    expect(payoutRowWords({ ...two, bookings: 3 }).subtitle).toContain('and 2 earlier bookings');
  });

  it('statuses', () => {
    expect(payoutStatus('pending')).toEqual({ pill: 'pending', words: 'Being sent' });
    expect(payoutStatus('sent')).toEqual({ pill: 'paid', words: 'Sent to Stripe' });
    expect(payoutStatus('reversed')).toEqual({ pill: 'refunded', words: 'Reversed' });
  });

  it('Cyprus time', () => {
    expect(cyprusWhen('2026-11-16T10:00:00Z')).toBe('Mon 16 Nov, 12:00');
  });

  it("what a booking paid: the server's amounts as they are", () => {
    expect(bookingMoneyLines(bookingMoney())).toEqual([
      { label: 'Paid by players in the app', amount: '€68.00' },
      { label: "Futty's service fee, after Stripe's fee", amount: '€4.50' },
      { label: "Stripe's fee", amount: '€3.50' },
      { label: 'Your money from the app', amount: '€60.00' },
      { label: 'Sent to you so far', amount: '€60.00' },
    ]);
  });

  it("a cancelled booking: the venue owes Stripe's fee, shown below zero", () => {
    const lines = bookingMoneyLines(bookingMoney({
      taken_cents: 2040, refunded_cents: 2040, futty_cents: -105, stripe_fee_cents: 105, owed_to_futty_cents: 105,
      venue_cents: -105, transferred_cents: -105,
    }));
    expect(lines).toEqual([
      { label: 'Paid by players in the app', amount: '€20.40' },
      { label: 'Given back to players', amount: '€20.40' },
      { label: "Stripe's fee", amount: '€1.05' },
      { label: 'You owe Futty for this booking', amount: '€1.05' },
      { label: 'Your money from the app', amount: '-€1.05' },
      { label: 'Sent to you so far', amount: '-€1.05' },
    ]);
  });

  it('cash at the venue and credit, either way', () => {
    const labels = (money: Parameters<typeof bookingMoneyLines>[0]) => bookingMoneyLines(money).map((l) => `${l.label}: ${l.amount}`);
    expect(labels(bookingMoney({ paid_at_venue_cents: 1200, credit_held_cents: 580 }))).toEqual(expect.arrayContaining([
      'Paid to you at the venue (never sent): €12.00',
      'Credit given to players (you hold it): €5.80',
    ]));
    expect(labels(bookingMoney({ credit_held_cents: -580 }))).toContain('Paid with credit players held: €5.80');
  });
});

describe('openStripe', () => {
  function deps(overrides: Partial<StripeDeps> = {}): StripeDeps {
    return {
      invoke: jest.fn(async () => ({ data: { url: 'https://connect.stripe.com/setup/x' }, error: null })),
      openAuthSession: jest.fn(async () => ({ type: 'success' })),
      errorCode: jest.fn(async () => 'not_venue_staff'),
      ...overrides,
    };
  }

  it("opens Stripe's link, coming back to the Payouts screen", async () => {
    const d = deps();
    await expect(openStripe('v1', 'onboard', d)).resolves.toBeNull();
    expect(d.invoke).toHaveBeenCalledWith({ venueId: 'v1', action: 'onboard' });
    expect(d.openAuthSession).toHaveBeenCalledWith('https://connect.stripe.com/setup/x', STRIPE_RETURN_URL);
    expect(STRIPE_RETURN_URL).toBe('futtyapp://venue-payouts');
  });

  it("the function's refusal, in words; nothing opened", async () => {
    const d = deps({ invoke: jest.fn(async () => ({ data: null, error: new Error('x') })) });
    await expect(openStripe('v1', 'dashboard', d)).resolves.toBe("Only the venue's owner can see its payouts.");
    expect(d.openAuthSession).not.toHaveBeenCalled();
    const empty = deps({ invoke: jest.fn(async () => ({ data: {}, error: null })) });
    await expect(openStripe('v1', 'onboard', empty)).resolves.toBe("Payouts couldn't be loaded. Try again.");
  });

  it.each([
    ['venue_not_found', 'This venue could not be found.'],
    ['not_onboarded', 'Set up payouts first.'],
    ['payout_not_found', 'That payout could not be found.'],
    ['stripe_unavailable', "Stripe didn't answer. Try again in a minute."],
    ['anything', "Payouts couldn't be loaded. Try again."],
  ])('%s', (code, words) => expect(describePayoutError(code)).toBe(words));
});
