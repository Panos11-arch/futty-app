import { fireEvent, render, screen } from '@testing-library/react-native';

import { BookingsListView } from '@/components/venue/bookings-list-view';
import { bookingsList, LEAKED_EMAIL, LEAKED_PHONE } from '@/lib/venue-money.fixtures';

// The venue's bookings (P6d; spec 14 P6, added 11 November): source and
// status filters and a date range, Cyprus today to today+6 by default, at
// most 31 days (decided 14 November), refused in the app before any call.

const mockRpc = jest.fn((_fn: string, _args: unknown) => Promise.resolve({ data: bookingsList() as unknown, error: null }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const sent = () => mockRpc.mock.calls.map(([fn, args]) => ({ fn, ...(args as object) }));
const last = () => sent().at(-1);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
  // 23:30 in Cyprus on 29 December: the range runs into the new year.
  jest.setSystemTime(new Date('2026-12-29T21:30:00Z'));
  mockRpc.mockClear();
});

afterEach(() => jest.useRealTimers());

async function draw() {
  await render(<BookingsListView venueId="v1" />);
  await screen.findByText(/Maria Georgiou/);
}

describe('BookingsListView: filters', () => {
  it('starts on Cyprus today to today+6, every source and status', async () => {
    await draw();
    expect(sent()).toEqual([
      { fn: 'venue_bookings_list', p_venue_id: 'v1', p_from: '2026-12-29', p_to: '2027-01-04', p_source: null, p_status: null },
    ]);
  });

  it('each source and status chip sends its value', async () => {
    await draw();
    await fireEvent.press(screen.getByRole('button', { name: 'Walk-in' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_source: 'walk_in', p_status: null });
    await fireEvent.press(screen.getByRole('button', { name: 'Phone' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_source: 'phone' });
    await fireEvent.press(screen.getByRole('button', { name: 'App' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_source: 'app' });
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelled' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_source: 'app', p_status: 'cancelled' });
    await fireEvent.press(screen.getByRole('button', { name: 'Waiting for payment' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_status: 'pending_payment' });
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmed' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_status: 'confirmed' });
    await fireEvent.press(screen.getByRole('button', { name: 'All statuses' }));
    await fireEvent.press(screen.getByRole('button', { name: 'All sources' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_source: null, p_status: null });
  });

  it('31 days is fetched; 32 is refused with no call', async () => {
    await draw();
    // To: 4 Jan -> 28 Jan is 31 days from 29 Dec.
    for (let i = 0; i < 24; i += 1) {
      await fireEvent.press(screen.getByRole('button', { name: 'Later end date' }));
    }
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_from: '2026-12-29', p_to: '2027-01-28' });
    const count = mockRpc.mock.calls.length;

    await fireEvent.press(screen.getByRole('button', { name: 'Later end date' }));
    expect(screen.getByText('Pick a range of 31 days or less.')).toBeTruthy();
    expect(mockRpc.mock.calls.length).toBe(count);

    // Back inside the cap, it loads again.
    await fireEvent.press(screen.getByRole('button', { name: 'Earlier end date' }));
    await screen.findByText(/Maria Georgiou/);
    expect(last()).toMatchObject({ p_to: '2027-01-28' });
    expect(mockRpc.mock.calls.length).toBe(count + 1);
  });

  it('an end before the start is refused with no call', async () => {
    await draw();
    const count = mockRpc.mock.calls.length;
    for (let i = 0; i < 7; i += 1) {
      await fireEvent.press(screen.getByRole('button', { name: 'Later start date' }));
    }
    expect(screen.getByText('Pick an end date on or after the start date.')).toBeTruthy();
    // 6 steps reach from = to (a 1-day range, which loads); the 7th is refused.
    expect(mockRpc.mock.calls.length).toBe(count + 6);
    expect(last()).toMatchObject({ p_from: '2027-01-04', p_to: '2027-01-04' });
  });
});

describe('BookingsListView: rows', () => {
  it("shows the walk-in's phone and prices, and an app booking's joined count", async () => {
    await draw();
    expect(screen.getByTestId('booking-cb1')).toHaveTextContent(/\+35799000001/);
    expect(screen.getByTestId('booking-cb1')).toHaveTextContent(/Your price €60\.00 · charged €50\.00/);
    expect(screen.getByTestId('booking-b1')).toHaveTextContent(/7 of 10 in/);
    expect(screen.getByTestId('booking-b2')).toHaveTextContent(/Cancelled/);
  });

  it("never shows a player's email or phone", async () => {
    await draw();
    expect(screen.queryByText(new RegExp(LEAKED_EMAIL))).toBeNull();
    expect(screen.queryByText(new RegExp(LEAKED_PHONE.replace('+', '\\+')))).toBeNull();
  });

  it('nothing in range', async () => {
    mockRpc.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));
    await render(<BookingsListView venueId="v1" />);
    expect(await screen.findByText('No bookings in these dates.')).toBeTruthy();
  });
});
