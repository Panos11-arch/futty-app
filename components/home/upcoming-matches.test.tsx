import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { UpcomingMatches, UPCOMING_SHOWN } from '@/components/home/upcoming-matches';

let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void) =>
      useEffect(() => {
        mockFocus = effect;
        effect();
      }, [effect]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

type HookState = { status: string; [key: string]: unknown };
let mockBookings: HookState = { status: 'loading' };
let mockVenues: HookState = { status: 'loading' };
const mockReloadBookings = jest.fn();
const mockReloadVenues = jest.fn();
jest.mock('@/lib/use-my-bookings', () => ({ useMyBookings: () => ({ ...mockBookings, reload: mockReloadBookings }) }));
jest.mock('@/lib/use-venues', () => ({ useVenues: () => ({ ...mockVenues, cities: [], reload: mockReloadVenues }) }));

const booking = (id: string, day = '2026-11-14') => ({
  id,
  venue_id: 'v1',
  booking_day: day,
  start_time: '19:00:00',
  end_time: '20:00:00',
  pitches: 1,
  capacity: 10,
  format: '5-a-side',
});
const venue = { id: 'v1', name: 'Nuevo Campo', city: 'Nicosia', is_live: true };

describe('Home "Upcoming matches" (image 01)', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });
  beforeEach(() => {
    mockVenues = { status: 'ready', venues: [venue] };
    mockReloadBookings.mockClear();
    mockReloadVenues.mockClear();
    jest.mocked(router.push).mockClear();
  });

  it('loading: a skeleton, no heading yet', async () => {
    mockBookings = { status: 'loading' };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(screen.getByTestId('next-game-skeleton')).toBeTruthy();
    expect(screen.queryByText('Upcoming matches')).toBeNull();
  });

  it('nothing booked: hidden, no empty card', async () => {
    mockBookings = { status: 'ready', bookings: [] };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('an error: one line with Try again, which reloads', async () => {
    mockBookings = { status: 'error', message: 'offline' };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(screen.getByText('Could not load your bookings.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReloadBookings).toHaveBeenCalledTimes(1);
  });

  it('a booking: venue and Cyprus time; tapping opens the booking', async () => {
    mockBookings = { status: 'ready', bookings: [booking('b1')] };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(screen.getByText('Upcoming matches')).toBeTruthy();
    const card = screen.getByTestId('home-upcoming-b1');
    expect(card).toHaveTextContent(/Nuevo Campo/);
    expect(card).toHaveTextContent(/Sat 14 Nov · 19:00–20:00/);
    // No photo block on Home (image 01; Dimitris, 26 November).
    expect(screen.queryByTestId('next-game-photo-placeholder')).toBeNull();
    expect(screen.queryByLabelText(/^Photo of /)).toBeNull();
    await fireEvent.press(card);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('before venues load, the card still shows with a stand-in name', async () => {
    mockBookings = { status: 'ready', bookings: [booking('b1')] };
    mockVenues = { status: 'loading' };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(screen.getByTestId('home-upcoming-b1')).toHaveTextContent(/Booked venue/);
  });

  it(`shows at most ${UPCOMING_SHOWN}; See all opens My bookings`, async () => {
    const days = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
    mockBookings = { status: 'ready', bookings: days.map((d, i) => booking(`b${i + 1}`, d)) };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(screen.getByTestId(`home-upcoming-b${UPCOMING_SHOWN}`)).toBeTruthy();
    expect(screen.queryByTestId(`home-upcoming-b${UPCOMING_SHOWN + 1}`)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'See all' }));
    expect(router.push).toHaveBeenCalledWith('/my-bookings');
  });

  it('no See all when every booking shows', async () => {
    mockBookings = { status: 'ready', bookings: [booking('b1')] };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(screen.queryByRole('button', { name: 'See all' })).toBeNull();
  });

  it('reloads on return to Home (e.g. after a cancel) and on pull to refresh, not on first load', async () => {
    mockBookings = { status: 'ready', bookings: [booking('b1')] };
    await render(<UpcomingMatches refreshSignal={0} />);
    expect(mockReloadBookings).not.toHaveBeenCalled();
    await act(async () => mockFocus!());
    expect(mockReloadBookings).toHaveBeenCalledTimes(1);
    await screen.rerender(<UpcomingMatches refreshSignal={1} />);
    expect(mockReloadBookings).toHaveBeenCalledTimes(2);
    expect(mockReloadVenues).toHaveBeenCalledTimes(1);
  });
});
