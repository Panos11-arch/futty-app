import {
  checkoutAmounts,
  dateStrip,
  endTime,
  GAME_LENGTHS,
  showNonRefundable,
  showPlayersPerSide,
  timeGrid,
  whoHasntPaid,
} from './booking-search';
import { quoteFixture } from './booking-search.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('dateStrip', () => {
  it('runs from the server’s today through the booking window (7 days after today)', () => {
    const days = dateStrip('2026-11-12', 7);
    expect(days).toHaveLength(8);
    expect(days[0]).toBe('2026-11-12');
    expect(days[7]).toBe('2026-11-19');
  });

  it('runs 14 days after today for Premium, across a month end', () => {
    const days = dateStrip('2026-11-25', 14);
    expect(days).toHaveLength(15);
    expect(days[14]).toBe('2026-12-09');
  });
});

describe('timeGrid', () => {
  const earlier = new Date('2026-11-12T10:00:00Z');

  it('lists every half hour from 07:00 on a later day', () => {
    const grid = timeGrid('2026-11-16', earlier, 60);
    expect(grid[0]).toBe('07:00');
    expect(grid[1]).toBe('07:30');
    expect(grid).toHaveLength(33);
  });

  it('hides start times where the game would run past midnight', () => {
    expect(timeGrid('2026-11-16', earlier, 60).slice(-1)).toEqual(['23:00']);
    expect(timeGrid('2026-11-16', earlier, 90).slice(-1)).toEqual(['22:30']);
    expect(timeGrid('2026-11-16', earlier, 120).slice(-1)).toEqual(['22:00']);
    expect(timeGrid('2026-11-16', earlier, 60)).not.toContain('23:30');
  });

  describe.each(['America/New_York', 'Asia/Tokyo', 'UTC'])('with the phone in %s', (zone) => {
    const original = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = zone;
    });
    afterAll(() => {
      process.env.TZ = original;
    });

    it('hides times already past in Cyprus today', () => {
      // 16:10 UTC on 12 Nov = 18:10 in Cyprus (winter, UTC+2).
      const grid = timeGrid('2026-11-12', new Date('2026-11-12T16:10:00Z'), 60);
      expect(grid[0]).toBe('18:30');
      expect(grid).not.toContain('18:00');
    });
  });
});

describe('endTime', () => {
  it('adds the game length on the half-hour grid', () => {
    expect(endTime('18:30', 90)).toBe('20:00');
    expect(endTime('23:00', 60)).toBe('24:00');
  });

  it('is null when the game would run past midnight', () => {
    expect(endTime('23:30', 60)).toBeNull();
  });

  it('offers 60, 90 and 120 minutes', () => {
    expect(GAME_LENGTHS).toEqual([60, 90, 120]);
  });
});

describe('showPlayersPerSide', () => {
  it('only for 5-a-side when a venue allows 6 v 6', () => {
    expect(showPlayersPerSide('5-a-side', true)).toBe(true);
    expect(showPlayersPerSide('5-a-side', false)).toBe(false);
    expect(showPlayersPerSide('7-a-side', true)).toBe(false);
    expect(showPlayersPerSide(null, true)).toBe(false);
  });
});

describe('showNonRefundable', () => {
  const now = new Date('2026-11-16T11:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const minute = 60_000;

  it('shows at 5h59m before kickoff, when the server’s non_refundable flag is set', () => {
    const quote = { non_refundable: true, kickoff_at: at(359 * minute), refunds_stop_at: at(-minute) };
    expect(showNonRefundable(quote, now)).toBe(true);
  });

  it('does not show at 6h01m before kickoff, when the server’s non_refundable flag is not set', () => {
    const quote = { non_refundable: false, kickoff_at: at(361 * minute), refunds_stop_at: at(minute) };
    expect(showNonRefundable(quote, now)).toBe(false);
  });

  it('exactly 6 hours before kickoff is not "less than 6 hours"', () => {
    expect(showNonRefundable({ non_refundable: false, refunds_stop_at: at(0) }, now)).toBe(false);
  });

  it('shows once the clock passes the server’s refunds-stop time while the screen is open', () => {
    const quote = { non_refundable: false, refunds_stop_at: at(minute) };
    expect(showNonRefundable(quote, new Date(now.getTime() + 2 * minute))).toBe(true);
  });
});

describe('checkoutAmounts', () => {
  const quote = quoteFixture();

  it('pay for everyone: the server’s pitch, fee and total, unchanged', () => {
    expect(checkoutAmounts(quote, { mode: 'pay_all', cash: false, credit: false })).toEqual({
      lines: [
        { label: 'Pitch', cents: 6000 },
        { label: 'Service fee', cents: 550 },
      ],
      totalCents: 6550,
      cashCents: null,
    });
  });

  it.each(['each_pays_responsible', 'each_pays_own_spot'] as const)('%s by card: your share', (mode) => {
    expect(checkoutAmounts(quote, { mode, cash: false, credit: false })).toEqual({
      lines: [
        { label: 'Your part of the pitch', cents: 600 },
        { label: 'Service fee', cents: 80 },
      ],
      totalCents: 680,
      cashCents: null,
    });
  });

  it('cash: the service fee by card now, the pitch part in cash at the venue', () => {
    expect(checkoutAmounts(quote, { mode: 'each_pays_own_spot', cash: true, credit: false })).toEqual({
      lines: [{ label: 'Service fee', cents: 80 }],
      totalCents: 80,
      cashCents: 600,
    });
  });

  it('credit: the server’s credit, fee and card amounts (spec 13: €50 credit on €60 → €15.50)', () => {
    const withCredit = quoteFixture({
      pay_all: {
        pitch_cents: 6000,
        fee_cents: 550,
        card_cents: 6550,
        with_credit: { credit_cents: 5000, fee_cents: 550, card_cents: 1550 },
      },
      credit: { available_cents: 5000, expires_at: '2027-11-01T00:00:00Z' },
    });
    expect(checkoutAmounts(withCredit, { mode: 'pay_all', cash: false, credit: true })).toEqual({
      lines: [
        { label: 'Pitch', cents: 6000 },
        { label: 'Your credit', cents: -5000 },
        { label: 'Service fee', cents: 550 },
      ],
      totalCents: 1550,
      cashCents: null,
    });
  });

  it('ignores credit when the server returned none', () => {
    expect(checkoutAmounts(quote, { mode: 'pay_all', cash: false, credit: true })?.totalCents).toBe(6550);
  });

  it('nothing to show before a mode is chosen', () => {
    expect(checkoutAmounts(quote, { mode: null, cash: false, credit: false })).toBeNull();
  });
});

describe('whoHasntPaid', () => {
  const base = { profile_id: 'p', name: null, username: null, is_booker: false, is_me: false, amount_cents: null, cash_cents: null };

  it('lists only unpaid players, "You" for the caller', () => {
    expect(
      whoHasntPaid([
        { ...base, share_id: 's1', name: 'Dimitris', state: 'in_app' },
        { ...base, share_id: 's2', name: 'Andreas', state: 'cash' },
        { ...base, share_id: 's3', name: 'Maria', state: 'cash_paid' },
        { ...base, share_id: 's4', name: 'Nikos', state: 'covered' },
        { ...base, share_id: 's5', is_me: true, name: 'Me', state: 'unpaid' },
        { ...base, share_id: 's6', username: 'eleni7', state: 'unpaid' },
      ]),
    ).toEqual(['You', 'eleni7']);
  });
});

describe('checkoutAmounts: Gipedo Pano (P8)', () => {
  it('the server’s hold: the pitch and 10 x 55, held on the card (6550)', () => {
    expect(checkoutAmounts(quoteFixture(), { mode: 'gipedo_pano', cash: false, credit: false })).toEqual({
      lines: [
        { label: 'Pitch', cents: 6000 },
        { label: 'Service fee', cents: 550 },
      ],
      totalCents: 6550,
      cashCents: null,
    });
  });

  it('never with cash or credit', () => {
    const withCredit = quoteFixture({
      pay_all: { pitch_cents: 6000, fee_cents: 550, card_cents: 6550, with_credit: { credit_cents: 5000, fee_cents: 550, card_cents: 1550 } },
    });
    expect(checkoutAmounts(withCredit, { mode: 'gipedo_pano', cash: true, credit: true })?.totalCents).toBe(6550);
  });

  it('a Premium captain’s hold is the server’s 6495', () => {
    const premium = quoteFixture({
      gipedo_pano: { pitch_cents: 6000, fee_cents: 495, hold_cents: 6495, available: true, unavailable_reason: null },
    });
    expect(checkoutAmounts(premium, { mode: 'gipedo_pano', cash: false, credit: false })?.totalCents).toBe(6495);
  });
});
