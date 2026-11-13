import { fireEvent, render, screen } from '@testing-library/react-native';

import { MyBookingsView, type MyBookingsViewProps } from '@/components/booking/my-bookings-view';
import type { MyBooking } from '@/lib/use-my-bookings';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const booking: MyBooking = {
  id: 'b1',
  venue_id: 'v1',
  booking_day: '2026-11-16',
  start_time: '19:00:00',
  end_time: '20:00:00',
  pitches: 1,
  capacity: 10,
  format: '5-a-side',
};

function props(overrides: Partial<MyBookingsViewProps> = {}): MyBookingsViewProps {
  return {
    bookings: { status: 'ready', bookings: [booking, { ...booking, id: 'b2', start_time: '21:00:00', end_time: '22:00:00' }], reload: jest.fn() },
    venues: [{ id: 'v1', name: 'Nuevo Campo', city: 'Nicosia' }],
    linkedBooking: null,
    onOpen: jest.fn(),
    ...overrides,
  };
}

describe('MyBookingsView', () => {
  it('each row opens that booking’s detail', async () => {
    const p = props();
    await render(<MyBookingsView {...p} />);
    expect(p.onOpen).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('booking-b2'));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
    expect(p.onOpen).toHaveBeenCalledWith('b2');
  });

  it('a ?booking= link from the calendar opens that booking once', async () => {
    const p = props({ linkedBooking: 'b1' });
    const view = await render(<MyBookingsView {...p} />);
    expect(p.onOpen).toHaveBeenCalledTimes(1);
    expect(p.onOpen).toHaveBeenCalledWith('b1');

    // Re-rendering with the same link (coming back to the list) doesn't open it again.
    await view.rerender(<MyBookingsView {...p} onOpen={p.onOpen} />);
    expect(p.onOpen).toHaveBeenCalledTimes(1);
  });

  it('the link opens the booking even while the list is still loading', async () => {
    const p = props({ linkedBooking: 'b9', bookings: { status: 'loading', reload: jest.fn() } });
    await render(<MyBookingsView {...p} />);
    expect(p.onOpen).toHaveBeenCalledWith('b9');
  });

  it('no bookings: says so', async () => {
    await render(<MyBookingsView {...props({ bookings: { status: 'ready', bookings: [], reload: jest.fn() } })} />);
    expect(screen.getByText('No upcoming bookings. Book a pitch to see it here.')).toBeTruthy();
  });
});
