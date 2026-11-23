// Test data only: booking_detail's 'v2' as the server returns it (B3).
import type { BookingV2Info } from './booking-opposition';

export function v2Fixture(overrides: Partial<BookingV2Info> = {}): BookingV2Info {
  return {
    kind: 'half',
    pitch_label: 'Pitch 2',
    captain_of: 'a',
    my_side: 'a',
    sides: [
      { side: 'a', captain: { id: 'u1', name: 'Andreas' }, team: null, payment_mode: 'pay_all', players: 5, state: 'held' },
      {
        side: 'b',
        captain: { id: 'u2', name: 'Bambos' },
        team: { id: 't2', name: 'Lions' },
        payment_mode: 'each_pays_responsible',
        players: 5,
        state: 'unpaid',
      },
    ],
    roster_sides: { s1: 'a', s2: 'b', s3: 'b' },
    opposition: { found: true, open: false, invited: 2 },
    posts: { players: null, opposition: null },
    no_opponent: null,
    ...overrides,
  };
}
