import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import { NextBookingCard, type NextBookingCardProps } from '@/components/booking/next-game-card';
import type { RosterEntry } from '@/lib/booking-search';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

function entry(overrides: Partial<RosterEntry> & Pick<RosterEntry, 'share_id' | 'state'>): RosterEntry {
  return {
    profile_id: `p-${overrides.share_id}`,
    name: null,
    username: null,
    is_booker: false,
    is_me: false,
    amount_cents: null,
    cash_cents: null,
    ...overrides,
  };
}

const roster: RosterEntry[] = [
  entry({ share_id: 's1', name: 'Dimitris', is_me: true, is_booker: true, state: 'in_app', amount_cents: 680 }),
  entry({ share_id: 's2', name: 'Andreas', state: 'cash' }),
  entry({ share_id: 's3', name: 'Maria', state: 'unpaid' }),
  entry({ share_id: 's4', name: 'Nikos', state: 'unpaid' }),
];

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: { roster: [] }, error: null });
  jest.mocked(router.push).mockClear();
});

const booking: NextBookingCardProps['booking'] = {
  id: 'b1',
  venue_id: 'v1',
  booking_day: '2026-11-14',
  start_time: '19:00:00',
  end_time: '20:00:00',
  format: '5-a-side',
};
const venue = { name: 'Nuevo Campo', city: 'Nicosia' };

describe('NextBookingCard', () => {
  it('shows the venue, city and format', async () => {
    await render(<NextBookingCard booking={booking} venue={venue} onPress={jest.fn()} />);
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
    expect(screen.getByText('Nicosia')).toBeTruthy();
    expect(screen.getByText('5-a-side')).toBeTruthy();
  });

  describe.each(['America/New_York', 'Asia/Tokyo', 'UTC'])('with the phone in %s', (zone) => {
    const original = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = zone;
    });
    afterAll(() => {
      process.env.TZ = original;
    });

    it('shows the day and time in Cyprus time', async () => {
      await render(<NextBookingCard booking={booking} venue={venue} onPress={jest.fn()} />);
      expect(screen.getByText('Sat 14 Nov · 19:00–20:00')).toBeTruthy();
    });
  });

  it('shows the venue initials when there is no photo', async () => {
    await render(<NextBookingCard booking={booking} venue={venue} onPress={jest.fn()} />);
    expect(screen.getByTestId('next-game-photo-placeholder')).toBeTruthy();
    expect(screen.getByText('NC')).toBeTruthy();
  });

  it('copes with an unknown venue', async () => {
    await render(<NextBookingCard booking={booking} venue={null} onPress={jest.fn()} />);
    expect(screen.getByText('Booked venue')).toBeTruthy();
  });

  it('opens what the caller asks when pressed', async () => {
    const onPress = jest.fn();
    await render(<NextBookingCard booking={booking} venue={venue} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: /Next game, Nuevo Campo/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hides the weather slot until something is passed in', async () => {
    await render(<NextBookingCard booking={booking} venue={venue} onPress={jest.fn()} />);
    expect(screen.queryByTestId('next-game-weather')).toBeNull();
  });

  it('shows the weather slot when given', async () => {
    await render(
      <NextBookingCard booking={booking} venue={venue} onPress={jest.fn()} weather={<Text>Clear, 18°C</Text>} />,
    );
    expect(screen.getByTestId('next-game-weather')).toBeTruthy();
    expect(screen.getByText('Clear, 18°C')).toBeTruthy();
  });

  it('keeps its props: booking, venue, onPress, weather and testID (contract 5)', async () => {
    const props: NextBookingCardProps = {
      booking,
      venue: { name: 'Nuevo Campo', city: 'Nicosia', photoUrl: null },
      onPress: jest.fn(),
      weather: <Text>Clear</Text>,
      testID: 'next-game',
    };
    await render(<NextBookingCard {...props} />);
    expect(screen.getByTestId('next-game')).toBeTruthy();
  });

  it('loads who’s in from booking_detail for this booking', async () => {
    mockRpc.mockResolvedValue({ data: { roster }, error: null });
    await render(<NextBookingCard booking={booking} venue={venue} />);
    await waitFor(() => expect(screen.getByTestId('next-game-roster')).toBeTruthy());
    expect(mockRpc).toHaveBeenCalledWith('booking_detail', { p_booking_id: 'b1' });
    expect(screen.getByLabelText('4 players')).toBeTruthy();
    expect(screen.getByText('4 in')).toBeTruthy();
  });

  it('shows who hasn’t paid, and no amounts', async () => {
    mockRpc.mockResolvedValue({ data: { roster }, error: null });
    await render(<NextBookingCard booking={booking} venue={venue} />);
    const unpaid = within(await screen.findByTestId('next-game-unpaid'));
    expect(unpaid.getByText('Unpaid')).toBeTruthy();
    expect(unpaid.getByText('Not paid yet: Maria, Nikos')).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('shows no unpaid line when everyone has paid or pays cash', async () => {
    mockRpc.mockResolvedValue({ data: { roster: roster.slice(0, 2) }, error: null });
    await render(<NextBookingCard booking={booking} venue={venue} />);
    await screen.findByTestId('next-game-roster');
    expect(screen.queryByTestId('next-game-unpaid')).toBeNull();
  });

  it('shows the card without the roster if booking_detail fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not_in_booking' } });
    await render(<NextBookingCard booking={booking} venue={venue} />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
    expect(screen.queryByTestId('next-game-roster')).toBeNull();
    expect(screen.queryByText('Unpaid')).toBeNull();
  });

  it('opens the booking’s detail (/booking/{id}) when no onPress is given', async () => {
    await render(<NextBookingCard booking={booking} venue={venue} />);
    await fireEvent.press(screen.getByRole('button', { name: /Next game, Nuevo Campo/ }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('an onPress from the caller wins over the default', async () => {
    const onPress = jest.fn();
    await render(<NextBookingCard booking={booking} venue={venue} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: /Next game, Nuevo Campo/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });
});
