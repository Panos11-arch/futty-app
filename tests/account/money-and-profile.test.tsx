import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import ProfileScreen from '@/app/(tabs)/profile';
import TransactionsScreen from '@/app/account/payments/transactions';

let mockRpcResult: { data: unknown; error: { message: string } | null } | null;
let mockProfile: Record<string, unknown>;
const mockRpc = jest.fn();
const mockProfileReload = jest.fn();
const mockSignOut = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      mockRpc(...args);
      return mockRpcResult ? Promise.resolve(mockRpcResult) : new Promise(() => {});
    },
  },
}));
jest.mock('@/lib/use-venues', () => ({
  useVenues: () => ({ status: 'ready', venues: [{ id: 'v1', name: 'Arena' }], cities: [], reload: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { email: 'ann@example.com' }, signOut: mockSignOut }) }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ ...mockProfile, reload: mockProfileReload }) }));
jest.mock('@/components/match/player-match-sections', () => ({ PlayerMatchSections: () => null }));

const tx = (over: Record<string, unknown>) => ({
  id: 't1',
  booking_id: 'b1',
  amount_cents: 680,
  status: 'paid',
  paid_at: null,
  is_booker: false,
  venue_id: 'v1',
  booking_day: '2026-11-20',
  start_time: '19:00:00',
  format: '5-a-side',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRpcResult = null;
});

describe('Transactions', () => {
  it('loading', async () => {
    await render(<TransactionsScreen />);
    expect(screen.getByTestId('transactions-skeleton')).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith('list_my_transactions');
  });

  it('empty', async () => {
    mockRpcResult = { data: [], error: null };
    await render(<TransactionsScreen />);
    expect(await screen.findByText('No booking payments yet.')).toBeTruthy();
  });

  it('error, inline', async () => {
    mockRpcResult = { data: null, error: { message: 'offline' } };
    await render(<TransactionsScreen />);
    expect(await screen.findByText('Could not load: offline')).toBeTruthy();
  });

  it('renders the server’s amounts unchanged, right-aligned and tabular, with a StatusPill', async () => {
    mockRpcResult = {
      data: [
        tx({}),
        tx({ id: 't2', amount_cents: 1234, status: 'pending', is_booker: true }),
        tx({ id: 't3', amount_cents: 5, status: 'refunded' }),
        tx({ id: 't4', amount_cents: 100000, status: 'cancelled' }),
      ],
      error: null,
    };
    const view = await render(<TransactionsScreen />);
    await screen.findByText('€6.80');
    for (const amount of ['€6.80', '€12.34', '€0.05', '€1000.00']) {
      const text = screen.getByText(amount);
      const style = Object.assign({}, ...[text.props.style].flat(3).filter(Boolean));
      expect(style.fontVariant).toEqual(['tabular-nums']);
      expect(style.textAlign).toBe('right');
    }
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('Refunded')).toBeTruthy();
    expect(screen.getByText(/· Cancelled/)).toBeTruthy();
    expect(screen.getByText('Arena (your booking)')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();

    await fireEvent.press(screen.getByRole('button', { name: 'Finish payment' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/booking-payment', params: { bookingId: 'b1' } });
  });
});

const profile = {
  id: 'me',
  full_name: 'Ann Lee',
  username: 'ann',
  position: 'Striker',
  xp: 120,
  played: 10,
  won: 4,
  goals: 7,
  is_premium: false,
  role: 'player',
};

describe('Profile', () => {
  it('loading shows a skeleton', async () => {
    mockProfile = { status: 'loading' };
    await render(<ProfileScreen />);
    expect(screen.getByTestId('profile-skeleton')).toBeTruthy();
  });

  it('error retries the same load', async () => {
    mockProfile = { status: 'error', message: 'offline' };
    await render(<ProfileScreen />);
    mockProfileReload.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockProfileReload).toHaveBeenCalledTimes(1);
  });

  it('missing profile says so', async () => {
    mockProfile = { status: 'missing' };
    await render(<ProfileScreen />);
    expect(screen.getByText(/couldn’t find your profile/)).toBeTruthy();
  });

  it('avatar, name, level badge, stat tiles in tabular figures, then grouped rows', async () => {
    mockProfile = { status: 'ready', profile };
    const view = await render(<ProfileScreen />);
    expect(view.toJSON()).toMatchSnapshot();
    expect(screen.getByText('Ann Lee')).toBeTruthy();
    expect(screen.getByText('@ann')).toBeTruthy();
    expect(screen.getByTestId('level-badge')).toBeTruthy();
    expect(screen.getByLabelText('Games 10')).toBeTruthy();
    expect(screen.getByLabelText('Win rate 40%')).toBeTruthy();
    expect(screen.getByLabelText('Goals 7')).toBeTruthy();
    expect(screen.getByText('Silver tier · personal level')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Venue dashboard' })).toBeNull();
  });

  it('keeps the same navigation and sign out', async () => {
    mockProfile = { status: 'ready', profile: { ...profile, role: 'venue_owner' } };
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    expect(router.push).toHaveBeenLastCalledWith('/edit-profile');
    await fireEvent.press(screen.getByRole('button', { name: 'Go Premium, Futty Premium' }));
    expect(router.push).toHaveBeenLastCalledWith('/account/premium');
    await fireEvent.press(screen.getByRole('button', { name: 'Venue dashboard' }));
    expect(router.push).toHaveBeenLastCalledWith('/venue-dashboard');
    await fireEvent.press(screen.getByRole('button', { name: 'Account & settings' }));
    expect(router.push).toHaveBeenLastCalledWith('/account');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it.each([
    ['My bookings', '/my-bookings'],
    ['Payments', '/account/payments'],
    ['Help', '/account/help'],
  ])('the %s row opens %s', async (label, target) => {
    mockProfile = { status: 'ready', profile };
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(target);
  });

  it('shows no shortcut rows until the profile has loaded', async () => {
    mockProfile = { status: 'error', message: 'offline' };
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'My bookings' })).toBeNull();
  });
});
