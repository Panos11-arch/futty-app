import { renderHook, waitFor } from '@testing-library/react-native';

import { useMyBookings, useMyUnscoredBookings, type MyBooking } from '@/lib/use-my-bookings';

import { onPhoneIn, restorePhoneZone, ZONES_AND_SEASONS } from '../tests/phone-time-zone';

let mockRows: MyBooking[] = [];
const mockGte = jest.fn();

jest.mock('@/lib/auth', () => {
  const auth = { user: { id: 'me' } };
  return { useAuth: () => auth };
});
jest.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    gte: (...args: unknown[]) => {
      mockGte(...args);
      return query;
    },
    order: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mockRows, error: null }).then(resolve),
  };
  return { supabase: { from: () => query } };
});

function booking(id: string, day: string, end: string): MyBooking {
  return { id, venue_id: 'v1', booking_day: day, start_time: '22:00:00', end_time: end, pitches: 1, capacity: 10, format: '5v5' };
}

// Booking days and times are Cyprus time (Asia/Nicosia). Whether a game is still
// to come, and which day is "today", must not depend on the phone's zone.
const NOW = {
  // 23:15 on Friday in Cyprus: the 22:00–23:00 game is over, 22:30–23:30 is not.
  winter: { now: '2026-11-20T21:15:00Z', today: '2026-11-20' },
  summer: { now: '2027-07-16T20:15:00Z', today: '2027-07-16' },
} as const;

describe.each(ZONES_AND_SEASONS)('my bookings, phone on %s in %s', (zone, season) => {
  const { now, today } = NOW[season];
  beforeEach(() => {
    onPhoneIn(zone);
    jest.useFakeTimers({ now: new Date(now), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockGte.mockClear();
    mockRows = [booking('ended', today, '23:00:00'), booking('playing', today, '23:30:00')];
  });
  afterEach(() => {
    jest.useRealTimers();
    restorePhoneZone();
  });

  it('useMyBookings asks from the Cyprus date and keeps games not yet over in Cyprus', async () => {
    const { result } = await renderHook(() => useMyBookings());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGte).toHaveBeenCalledWith('booking_day', today);
    expect((result.current as { bookings: MyBooking[] }).bookings.map((b) => b.id)).toEqual(['playing']);
  });

  it('useMyUnscoredBookings keeps games already over in Cyprus', async () => {
    const { result } = await renderHook(() => useMyUnscoredBookings());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect((result.current as { bookings: MyBooking[] }).bookings.map((b) => b.id)).toEqual(['ended']);
  });
});
