import './mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ProfileCard } from '@/app/(tabs)/profile';
import TransactionsScreen from '@/app/account/payments/transactions';

let mockRpcResult: { data: unknown; error: { message: string } | null } | null;
const mockRpc = jest.fn();
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
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
let mockLevel: Record<string, unknown> = { status: 'loading' };
jest.mock('@/lib/match/use-levels', () => ({
  STARTING_LEVEL_ROUTE: '/starting-level',
  usePlayerLevel: () => ({ ...mockLevel, reload: jest.fn() }),
}));

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

describe('ProfileCard (player profiles)', () => {
  it("another player's card (player profiles): the level, no XP, no offer to set it", async () => {
    mockLevel = {
      status: 'ready',
      level: { level: 4.2, provisional: false, reliabilityPct: 40, competitiveMatches: 8, source: 'questionnaire' },
    };
    const view = await render(<ProfileCard profile={profile as never} editable={false} />);
    expect(screen.getByTestId('player-level-value')).toHaveTextContent('4.2');
    expect(screen.queryByText('Provisional')).toBeNull();
    expect(screen.getByText('Reliability 40%')).toBeTruthy();
    expect(screen.queryByText(/XP|tier/)).toBeNull();

    mockLevel = { status: 'ready', level: null };
    await view.rerender(<ProfileCard profile={profile as never} editable={false} />);
    expect(screen.getByText('No level yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set your starting level' })).toBeNull();
  });

  it("A12: another player's card shows their kit but can't be edited", async () => {
    mockLevel = { status: 'ready', level: null };
    const other = { ...profile, avatar_style: 'kit', avatar_kit_colour: 'kitBlack', avatar_number: 5 };
    await render(<ProfileCard profile={other as never} editable={false} />);
    expect(screen.getByLabelText('Ann Lee, shirt 5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit avatar' })).toBeNull();
  });
});
