import {
  checkoutAmountsV2,
  guaranteeCents,
  guaranteeLine,
  KIND_LINES,
  checkoutCancellationLine,
  creditOffered,
  modeForWay,
  pitchDetails,
  wayLine,
  wayPriceLabel,
} from './booking-v2';
import { checkoutDataFixture, premiumQuoteV2Fixture, quoteV2Fixture } from './booking-v2.fixtures';
import { describeBookingErrorMessage } from './booking-errors';
import { primeRules } from './rules.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

beforeEach(() => primeRules());

const whole = { kind: 'whole' as const, cash: false, credit: false };
const half = { kind: 'half' as const, cash: false, credit: false };

describe('Booking v2 checkout amounts (spec 13 worked examples, €40 5-a-side)', () => {
  it('example 1: whole pitch, pay for everyone: €40.00 + 10 × €0.55 = €45.50 in one payment', () => {
    const a = checkoutAmountsV2(checkoutDataFixture(), { ...whole, way: 'pay_all' });
    expect(a).toEqual({
      lines: [
        { label: 'Pitch', cents: 4000 },
        { label: 'Service fee', cents: 550 },
      ],
      totalCents: 4550,
      cashCents: null,
    });
  });

  it('example 2: whole pitch, pay for myself: €4.80 each, €40.00 held for unpaid spots', () => {
    const data = checkoutDataFixture();
    const choice = { ...whole, way: 'pay_for_myself' as const };
    expect(checkoutAmountsV2(data, choice)?.totalCents).toBe(480);
    expect(wayPriceLabel(data.quote, 'whole', 'pay_for_myself')).toBe('€4.80 each');
    expect(guaranteeCents(data.quote, choice)).toBe(4000);
    expect(guaranteeLine(4000)).toBe('We hold €40.00 on your card for unpaid spots, taken 2 hours after the game.');
  });

  it('example 3: cash, whole pitch only: €0.80 now, €4.00 at the venue, the €40.00 guarantee', () => {
    const data = checkoutDataFixture();
    const choice = { ...whole, way: 'pay_for_myself' as const, cash: true };
    expect(checkoutAmountsV2(data, choice)).toEqual({
      lines: [{ label: 'Service fee', cents: 80 }],
      totalCents: 80,
      cashCents: 400,
    });
    expect(guaranteeCents(data.quote, choice)).toBe(4000);
  });

  it('example 4: half pitch, pay for everyone: €20.00 + 5 × €0.55 = €22.75', () => {
    const a = checkoutAmountsV2(checkoutDataFixture(), { ...half, way: 'pay_all' });
    expect(a).toEqual({
      lines: [
        { label: "Your team's half", cents: 2000 },
        { label: 'Service fee', cents: 275 },
      ],
      totalCents: 2275,
      cashCents: null,
    });
    expect(wayPriceLabel(quoteV2Fixture(), 'half', 'pay_all')).toBe('€22.75');
  });

  it('example 5: half pitch, pay for myself: €4.80 each, his side’s half (€20.00) held', () => {
    const data = checkoutDataFixture();
    const choice = { ...half, way: 'pay_for_myself' as const };
    expect(checkoutAmountsV2(data, choice)?.totalCents).toBe(480);
    expect(guaranteeCents(data.quote, choice)).toBe(2000);
    expect(guaranteeLine(2000)).toBe('We hold €20.00 on your card for unpaid spots, taken 2 hours after the game.');
  });

  it('cash is never priced on a half pitch', () => {
    const a = checkoutAmountsV2(checkoutDataFixture(), { ...half, way: 'pay_for_myself', cash: true });
    expect(a?.cashCents).toBeNull();
    expect(a?.totalCents).toBe(480);
  });

  it('example 11: a Premium booker pays €4.00 for myself and €44.95 for everyone', () => {
    const data = checkoutDataFixture(premiumQuoteV2Fixture());
    expect(checkoutAmountsV2(data, { ...whole, way: 'pay_for_myself' })).toEqual({
      lines: [
        { label: 'Your part of the pitch', cents: 400 },
        { label: 'Service fee', cents: 0 },
      ],
      totalCents: 400,
      cashCents: null,
    });
    expect(checkoutAmountsV2(data, { ...whole, way: 'pay_all' })?.totalCents).toBe(4495);
    expect(wayPriceLabel(data.quote, 'whole', 'pay_all')).toBe('€44.95');
  });

  describe('credit: booking_quote’s split, on a whole pitch, as today', () => {
    const data = checkoutDataFixture(quoteV2Fixture(), {
      available_cents: 3000,
      expires_at: '2027-11-01T10:00:00Z',
      with_credit: {
        pay_all: { credit_cents: 3000, fee_cents: 550, card_cents: 1550 },
        pay_for_myself: { credit_cents: 400, fee_cents: 0, card_cents: 0 },
      },
    });

    it('paying for everyone: the pitch, the credit as a minus line, the fee, and the card part', () => {
      expect(checkoutAmountsV2(data, { ...whole, way: 'pay_all', credit: true })).toEqual({
        lines: [
          { label: 'Pitch', cents: 4000 },
          { label: 'Your credit', cents: -3000 },
          { label: 'Service fee', cents: 550 },
        ],
        totalCents: 1550,
        cashCents: null,
      });
    });

    it('paying for myself: no fee when credit covers the share (spec 13 "Paying with venue credit")', () => {
      expect(checkoutAmountsV2(data, { ...whole, way: 'pay_for_myself', credit: true })).toEqual({
        lines: [
          { label: 'Your part of the pitch', cents: 400 },
          { label: 'Your credit', cents: -400 },
          { label: 'Service fee', cents: 0 },
        ],
        totalCents: 0,
        cashCents: null,
      });
    });

    it('never on a half pitch, and never when the server sent no split for that way', () => {
      expect(checkoutAmountsV2(data, { ...half, way: 'pay_all', credit: true })?.totalCents).toBe(2275);
      expect(checkoutAmountsV2(data, { ...half, way: 'pay_for_myself', credit: true })?.totalCents).toBe(480);
      const noSplit = checkoutDataFixture(quoteV2Fixture(), {
        ...data.credit!,
        with_credit: { pay_all: null, pay_for_myself: data.credit!.with_credit.pay_for_myself },
      });
      expect(creditOffered(noSplit.credit, { kind: 'whole', way: 'pay_all' })).toBe(false);
      expect(creditOffered(noSplit.credit, { kind: 'whole', way: 'pay_for_myself' })).toBe(true);
    });
  });

  it('no way to pay chosen: nothing to show', () => {
    expect(checkoutAmountsV2(checkoutDataFixture(), { ...whole, way: null })).toBeNull();
  });

  it('only pay for myself has a guarantee', () => {
    expect(guaranteeCents(quoteV2Fixture(), { ...whole, way: 'pay_all' })).toBeNull();
  });

  it('book_slot gets "pay_all" or "each_pays_responsible"; never "just my spot" or Losers pay', () => {
    expect(modeForWay('pay_all')).toBe('pay_all');
    expect(modeForWay('pay_for_myself')).toBe('each_pays_responsible');
  });
});

describe('Booking v2 checkout words (spec 15 Words rules)', () => {
  it('one line for each kind and each way to pay', () => {
    expect(KIND_LINES).toEqual({ whole: 'You bring both teams.', half: 'Opponents pay half.' });
    expect(wayLine('whole', 'pay_all')).toBe('You pay the whole pitch now.');
    expect(wayLine('half', 'pay_all')).toBe("You pay your team's half now.");
    expect(wayLine('whole', 'pay_for_myself')).toBe('You pay your share. You cover unpaid spots.');
    expect(wayLine('half', 'pay_for_myself')).toBe('You pay your share. You cover unpaid spots.');
  });

  it('a pitch in one line: indoor or outdoor, then its surface', () => {
    expect(pitchDetails({ indoor: false, surface: 'Artificial grass' })).toBe('Outdoor · Artificial grass');
    expect(pitchDetails({ indoor: true, surface: null })).toBe('Indoor');
    // A combination of indoor and outdoor pitches, or of mixed surfaces, says neither.
    expect(pitchDetails({ indoor: null, surface: null })).toBe('');
  });

  it('the cancellation line: spec 13’s free hour, with the server’s numbers', () => {
    expect(checkoutCancellationLine({ fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 })).toBe(
      "Free to cancel for 1 hour after paying, if it's more than 6 hours before kickoff.",
    );
    expect(checkoutCancellationLine({ fee_cents: 100, free_minutes: 90, refund_cutoff_hours: 8 })).toBe(
      "Free to cancel for 90 minutes after paying, if it's more than 8 hours before kickoff.",
    );
  });

  it('a pitch taken just now names it, as spec 13 says', () => {
    expect(describeBookingErrorMessage('pitch_not_free', 'Pitch 2')).toBe('Pitch 2 is no longer free. Pick another.');
    expect(describeBookingErrorMessage('pitch_not_free')).toBe('That pitch is no longer free. Pick another.');
  });

  it('the Booking v2 refusals in words', () => {
    expect(describeBookingErrorMessage('just_my_spot_removed')).toBe('Choose Pay for everyone or Pay for myself.');
    expect(describeBookingErrorMessage('cash_whole_pitch_only')).toBe('Cash is for a whole pitch only.');
    expect(describeBookingErrorMessage('half_pitch_not_available')).toBe("Half pitches aren't available yet. Book the whole pitch.");
    expect(describeBookingErrorMessage('invalid_pitch_choice')).toBe("That pitch can't be booked for this game. Pick another.");
  });
});
