// Test data only: booking_detail and cancellation_quote responses shaped as
// the server returns them (supabase/migrations/20261112090000_pay_booking_screens.sql,
// 20261109180834_pay_cancellations_plan.sql), with spec 13's amounts.
import type { CancellationLine, CancellationQuote } from './booking-actions';
import { detailFixture } from './booking-search.fixtures';
import type { BookingDetail, RosterEntry } from './booking-search';

function entry(overrides: Partial<RosterEntry> & Pick<RosterEntry, 'share_id' | 'profile_id' | 'name'>): RosterEntry {
  return {
    username: null,
    is_booker: false,
    is_me: false,
    state: 'in_app',
    amount_cents: null,
    cash_cents: null,
    ...overrides,
  };
}

/** The booker's view of a 6 v 6 each-pays booking: every amount is sent. */
export function bookerDetail(overrides: Partial<BookingDetail> = {}): BookingDetail {
  const base = detailFixture({
    me: { share_id: 's1', status: 'authorized', amount_cents: 580, pitch_cents: 500, fee_cents: 80 },
    booking: { capacity: 12, players_per_side: 6, payment_mode: 'each_pays_responsible' },
  });
  return {
    ...base,
    is_booker: true,
    roster: [
      entry({ share_id: 's1', profile_id: 'p1', name: 'Dimitris', is_booker: true, is_me: true, state: 'in_app', amount_cents: 580, cash_cents: 0 }),
      entry({ share_id: 's2', profile_id: 'p2', name: 'Andreas', state: 'cash', amount_cents: 80, cash_cents: 500 }),
      entry({ share_id: 's3', profile_id: 'p3', name: 'Maria', state: 'cash_paid', amount_cents: 80, cash_cents: 500 }),
      entry({ share_id: 's4', profile_id: 'p4', name: 'Nikos', state: 'unpaid', amount_cents: 580, cash_cents: 0 }),
    ],
    next_cutoff: { kind: 'refunds_stop', at: '2026-11-16T11:00:00+00:00' },
    can_cancel: { my_spot: true, whole_team: true },
    ...overrides,
  };
}

/** Andreas's view of the same booking: only his own amounts are sent. */
export function playerDetail(overrides: Partial<BookingDetail> = {}): BookingDetail {
  const base = detailFixture({
    me: { share_id: 's2', status: 'authorized', payment_method: 'cash', amount_cents: 80, pitch_cents: 0, fee_cents: 80, cash_cents: 500 },
    booking: { capacity: 12, players_per_side: 6, payment_mode: 'each_pays_responsible' },
  });
  return {
    ...base,
    is_booker: false,
    roster: [
      entry({ share_id: 's1', profile_id: 'p1', name: 'Dimitris', is_booker: true, state: 'in_app' }),
      entry({ share_id: 's2', profile_id: 'p2', name: 'Andreas', is_me: true, state: 'cash', amount_cents: 80, cash_cents: 500 }),
      entry({ share_id: 's3', profile_id: 'p3', name: 'Maria', state: 'cash_paid' }),
      entry({ share_id: 's4', profile_id: 'p4', name: 'Nikos', state: 'unpaid' }),
    ],
    next_cutoff: { kind: 'free_hour_ends', at: '2026-11-16T08:42:00+00:00' },
    can_cancel: { my_spot: true, whole_team: false },
    ...overrides,
  };
}

export function line(overrides: Partial<CancellationLine> & Pick<CancellationLine, 'profile_id' | 'action'>): CancellationLine {
  return {
    share_id: `share-${overrides.profile_id}`,
    guarantee_id: null,
    is_booker: false,
    window: 'middle',
    value_cents: 0,
    kept_cents: 0,
    credit_cents: 0,
    refund_cents: 0,
    ...overrides,
  };
}

/** A player cancels their own €6.80 spot in the middle window: €1 kept, €5.80 credit. */
export function mySpotQuote(overrides: Partial<CancellationQuote> = {}): CancellationQuote {
  return {
    booking_id: 'b1',
    scope: 'my_spot',
    kickoff_at: '2026-11-16T17:00:00+00:00',
    refunds_stop_at: '2026-11-16T11:00:00+00:00',
    cancels_booking: false,
    lines: [line({ profile_id: 'p2', action: 'keep_and_credit', value_cents: 680, kept_cents: 100, credit_cents: 580 })],
    booker_fee: null,
    quote: 'q1',
    ...overrides,
  };
}

/** The booker cancels the whole team: 6 other payments taken, so €6.00. */
export function wholeTeamQuote(overrides: Partial<CancellationQuote> = {}): CancellationQuote {
  return {
    booking_id: 'b1',
    scope: 'whole_team',
    kickoff_at: '2026-11-16T17:00:00+00:00',
    refunds_stop_at: '2026-11-16T11:00:00+00:00',
    cancels_booking: true,
    lines: [
      line({ profile_id: 'p1', is_booker: true, action: 'keep_and_credit', value_cents: 580, kept_cents: 100, credit_cents: 480 }),
      line({ profile_id: 'p2', window: 'other', action: 'refund_choice', value_cents: 580, refund_cents: 580 }),
      line({ profile_id: 'p3', window: 'other', action: 'release', value_cents: 580, refund_cents: 580 }),
      line({ profile_id: 'p4', window: 'other', action: 'none' }),
      line({ profile_id: 'p1', share_id: null, guarantee_id: 'g1', is_booker: true, window: null, action: 'release' }),
    ],
    booker_fee: { profile_id: 'p1', players: 6, amount_cents: 600 },
    quote: 'q2',
    ...overrides,
  };
}
