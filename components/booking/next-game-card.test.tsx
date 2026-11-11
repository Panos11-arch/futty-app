import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { NextBookingCard, type NextBookingCardProps } from '@/components/booking/next-game-card';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

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

  it('shows no roster or paid state without data (P5 adds them)', async () => {
    await render(<NextBookingCard booking={booking} venue={venue} onPress={jest.fn()} />);
    expect(screen.queryByText('Unpaid')).toBeNull();
    expect(screen.queryByText('Paid')).toBeNull();
  });
});
