// Test data for the venue dashboard's Today screens, shaped exactly as
// venue_day_board, venue_booking_roster and cancellation_quote(…, 'venue')
// return it (supabase/migrations/*_pay_dashboard_reads.sql,
// *_pay_dashboard_guards.sql). Amounts are the server's, in cents.
import type { CancellationLine, CancellationQuote } from '@/lib/booking-actions';
import type { AppRoster, BoardBooking, BoardPitch, CounterRoster, DayBoard, RosterPlayer } from '@/lib/venue-today';

export const PITCH_1: BoardPitch = { id: 'p1', name: 'Pitch 1', size: '5-a-side', formats: ['5-a-side'], is_open: true };
export const PITCH_2: BoardPitch = {
  id: 'p2',
  name: 'Pitch 2',
  size: '7-a-side',
  formats: ['5-a-side', '7-a-side'],
  is_open: true,
};

export function appBooking(overrides: Partial<BoardBooking> = {}): BoardBooking {
  return {
    id: 'b-app',
    kind: 'app',
    status: 'confirmed',
    start_time: '18:00:00',
    end_time: '19:00:00',
    format: '5-a-side',
    capacity: 10,
    note: null,
    pitch_ids: ['p1'],
    booker_name: 'Nikos Georgiou',
    payment_mode: 'each_pays_own_spot',
    joined: 7,
    unpaid: 1,
    cash_to_tick: 2,
    ...overrides,
  };
}

export function walkIn(overrides: Partial<BoardBooking> = {}): BoardBooking {
  return {
    id: 'b-walk',
    kind: 'counter',
    status: 'confirmed',
    start_time: '20:00:00',
    end_time: '21:00:00',
    format: '5-a-side',
    capacity: 10,
    note: null,
    pitch_ids: ['p2'],
    source: 'walk_in',
    contact_name: 'Andreas',
    venue_price_cents: 5000,
    charged_cents: 4550,
    paid_method: 'cash',
    ...overrides,
  };
}

export function phoneBooking(overrides: Partial<BoardBooking> = {}): BoardBooking {
  return walkIn({
    id: 'b-phone',
    start_time: '21:00:00',
    end_time: '22:30:00',
    source: 'phone',
    contact_name: 'Maria',
    charged_cents: 5000,
    paid_method: null,
    ...overrides,
  });
}

export function dayBoard(overrides: Partial<DayBoard> = {}): DayBoard {
  return {
    venue_id: 'v1',
    day: '2026-11-16',
    pitches: [PITCH_1, PITCH_2],
    bookings: [appBooking(), walkIn()],
    blocks: [],
    flags: [],
    ...overrides,
  };
}

function player(overrides: Partial<RosterPlayer>): RosterPlayer {
  return {
    share_id: 's1',
    profile_id: 'u1',
    name: 'Nikos Georgiou',
    is_booker: false,
    payment_method: 'card',
    state: 'in_app',
    amount_cents: 680,
    pitch_cents: 600,
    fee_cents: 80,
    cash_cents: 0,
    checked_in: false,
    ...overrides,
  };
}

export function appRoster(overrides: Partial<AppRoster> = {}): AppRoster {
  return {
    booking_id: 'b-app',
    kind: 'app',
    status: 'confirmed',
    booking_day: '2026-11-16',
    start_time: '18:00:00',
    end_time: '19:00:00',
    format: '5-a-side',
    capacity: 10,
    note: null,
    payment_mode: 'each_pays_own_spot',
    booker_name: 'Nikos Georgiou',
    match_id: 'm1',
    collection_started: false,
    can_run_collection: false,
    players: [
      player({ share_id: 's1', profile_id: 'u1', name: 'Nikos Georgiou', is_booker: true, checked_in: true }),
      player({
        share_id: 's2',
        profile_id: 'u2',
        name: 'Eleni',
        payment_method: 'cash',
        state: 'cash',
        amount_cents: 80,
        cash_cents: 600,
      }),
      player({
        share_id: 's3',
        profile_id: 'u3',
        name: 'Marios',
        payment_method: 'cash',
        state: 'cash_paid',
        amount_cents: 80,
        cash_cents: 600,
      }),
      player({ share_id: 's4', profile_id: 'u4', name: 'Petros', state: 'unpaid' }),
    ],
    ...overrides,
  };
}

export function counterRoster(overrides: Partial<CounterRoster> = {}): CounterRoster {
  return {
    booking_id: 'b-walk',
    kind: 'counter',
    status: 'confirmed',
    booking_day: '2026-11-16',
    start_time: '20:00:00',
    end_time: '21:00:00',
    format: '5-a-side',
    capacity: 10,
    note: null,
    source: 'walk_in',
    contact: { id: 'c1', name: 'Andreas', phone: '+35799000001' },
    venue_price_cents: 5000,
    charged_cents: 4550,
    paid_method: null,
    paid_at: null,
    cancelled_at: null,
    players: [],
    ...overrides,
  };
}

function line(overrides: Partial<CancellationLine & { cash_cents: number; cash_back_cents: number }>) {
  return {
    share_id: 's1',
    guarantee_id: null,
    profile_id: 'u1',
    is_booker: false,
    window: 'venue',
    action: 'refund_choice',
    paid_cents: 680,
    fee_cents: 80,
    credit_used_cents: 0,
    value_cents: 680,
    kept_cents: 0,
    credit_cents: 0,
    refund_cents: 680,
    needs_capture: false,
    stripe_intent_id: 'pi_1',
    cash_cents: 0,
    cash_back_cents: 0,
    cash_credit_cents: 0,
    ...overrides,
  } as CancellationLine;
}

/** The venue cancels the roster above: everyone gets back what they paid. */
export function venueQuote(overrides: Partial<CancellationQuote> = {}): CancellationQuote {
  return {
    booking_id: 'b-app',
    scope: 'venue',
    kickoff_at: '2026-11-16T16:00:00Z',
    refunds_stop_at: '2026-11-16T10:00:00Z',
    cancels_booking: true,
    lines: [
      line({ share_id: 's1', profile_id: 'u1', is_booker: true }),
      // Cash player: €0.80 fee by card back, €6.00 cash not yet ticked.
      line({ share_id: 's2', profile_id: 'u2', paid_cents: 80, value_cents: 80, refund_cents: 80, cash_cents: 0 }),
      // Ticked cash: €0.80 by card, €6.00 handed back at the counter.
      line({
        share_id: 's3',
        profile_id: 'u3',
        paid_cents: 80,
        value_cents: 80,
        refund_cents: 80,
        cash_cents: 600,
        cash_back_cents: 600,
      }),
      // Unpaid: nothing was taken.
      line({
        share_id: 's4',
        profile_id: 'u4',
        action: 'release',
        paid_cents: 0,
        fee_cents: 0,
        value_cents: 0,
        refund_cents: 0,
        stripe_intent_id: null,
      }),
    ],
    booker_fee: null,
    guarantee_hold_placed: false,
    quote: 'q-1',
    ...overrides,
  };
}
