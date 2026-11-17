// venue_setup replies for the P6e setup screens' tests, shaped as
// supabase/migrations/20261117120506_pay_venue_setup.sql returns them.
import type { VenueSetup } from '@/lib/venue-setup';

export const PITCH_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const PITCH_B = 'aaaaaaaa-0000-4000-8000-000000000002';
export const PITCH_C = 'aaaaaaaa-0000-4000-8000-000000000003';

export function venueSetup(overrides: Partial<VenueSetup> = {}): VenueSetup {
  return {
    venue: { id: 'v1', name: 'Pitch Point', allows_6v6_on_5s: false },
    hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '08:00', closes: '23:00' })).concat([
      { weekday: 6, opens: '09:00', closes: '24:00' },
    ]),
    closures: [{ id: 'c1', starts_on: '2026-12-24', ends_on: '2026-12-26', reason: 'Christmas' }],
    prices: [
      {
        format: '5-a-side',
        price_cents: 5000,
        peak_cents: 6000,
        weekend_cents: 5500,
        peak_weekdays: [1, 2, 3, 4, 5],
        peak_starts: '17:00',
        peak_ends: null,
        weekend_weekdays: [6, 7],
      },
      {
        format: '7-a-side',
        price_cents: 7000,
        peak_cents: null,
        weekend_cents: null,
        peak_weekdays: [1, 2, 3, 4, 5],
        peak_starts: '17:00',
        peak_ends: null,
        weekend_weekdays: [6, 7],
      },
    ],
    pitches: [
      {
        id: PITCH_A,
        name: 'Pitch A',
        size: '5-a-side',
        formats: ['5-a-side'],
        surface: '3G',
        indoor: false,
        description: null,
        is_open: true,
        sort_order: 1,
        has_bookings: true,
        has_future_bookings: true,
      },
      {
        id: PITCH_B,
        name: 'Pitch B',
        size: '5-a-side',
        formats: ['5-a-side'],
        surface: null,
        indoor: true,
        description: 'Under the roof',
        is_open: true,
        sort_order: 2,
        has_bookings: true,
        has_future_bookings: false,
      },
      {
        id: PITCH_C,
        name: 'Pitch C',
        size: '7-a-side',
        formats: ['7-a-side'],
        surface: null,
        indoor: false,
        description: null,
        is_open: false,
        sort_order: 3,
        has_bookings: false,
        has_future_bookings: false,
      },
    ],
    combinations: [{ id: 'k1', format: '7-a-side', pitch_ids: [PITCH_A, PITCH_B] }],
    ...overrides,
  };
}
