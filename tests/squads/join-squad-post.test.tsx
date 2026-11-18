import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import JoinSquadPostScreen from '@/app/join-squad-post';

import { CYPRUS_LATE_KICKOFF, onPhoneIn, restorePhoneZone, ZONES_AND_SEASONS } from '../phone-time-zone';

const g = globalThis as {
  mockSearchParams?: Record<string, string>;
  mockInitPaymentSheet?: jest.Mock;
  mockPresentPaymentSheet?: jest.Mock;
};
let mockPosts: Record<string, unknown>;
let mockPrice: { share_cents: number; fee_cents: number | null; pitch_cents: number | null } | null;
let mockShare: { id: string } | null;
const mockReload = jest.fn();
const mockRpc = jest.fn();
const mockJoin = jest.fn();
const mockLeave = jest.fn();
const mockCancelPending = jest.fn();
const mockBlockNotice = jest.fn();
const mockCreateSharePayment = jest.fn();

jest.mock('@/lib/supabase', () => {
  const shareQuery = {
    select: () => shareQuery,
    eq: () => shareQuery,
    maybeSingle: () => Promise.resolve({ data: mockShare, error: null }),
  };
  return {
    supabase: {
      rpc: (...args: unknown[]) => {
        mockRpc(...args);
        return { maybeSingle: () => Promise.resolve({ data: mockPrice }) };
      },
      from: () => shareQuery,
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'me' } }, error: null }) },
    },
  };
});
jest.mock('@/lib/use-squad-posts', () => ({ useSquadPosts: () => ({ ...mockPosts, reload: mockReload }) }));
jest.mock('@/lib/squads', () => ({
  ...jest.requireActual('@/lib/squads'),
  joinSquadPost: (...args: unknown[]) => mockJoin(...args),
  leaveSquadPost: (...args: unknown[]) => mockLeave(...args),
  cancelPendingShare: (...args: unknown[]) => mockCancelPending(...args),
  getSquadPostBlockNotice: (...args: unknown[]) => mockBlockNotice(...args),
}));
jest.mock('@/lib/booking-shares', () => ({
  createSharePayment: (...args: unknown[]) => mockCreateSharePayment(...args),
}));

const post = {
  id: 'pp1',
  type: 'players',
  venue_id: 'v1',
  venue_name: 'Arena',
  venue_city: 'Nicosia',
  scheduled_at: '2099-11-20T18:00:00Z',
  format: '5-a-side',
  level: 'Gold',
  posted_by: 'x',
  team_id: null,
  players_needed: 3,
  status: 'open',
  matched_team_id: null,
  venue_booking_id: 'b1',
  created_at: '',
  payment_mode: 'split',
  position_needed: null,
  level_needed: null,
  joined_count: 1,
  joined_by_me: false,
  roster: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  g.mockSearchParams = { postId: 'pp1' };
  g.mockInitPaymentSheet = jest.fn().mockResolvedValue({ error: null });
  g.mockPresentPaymentSheet = jest.fn().mockResolvedValue({ error: null });
  mockPosts = { status: 'ready', posts: [post] };
  mockPrice = { share_cents: 680, fee_cents: 80, pitch_cents: 600 };
  mockShare = { id: 'share1' };
  mockBlockNotice.mockResolvedValue(null);
  mockJoin.mockResolvedValue({ error: null });
  mockCreateSharePayment.mockResolvedValue({ data: { clientSecret: 'cs_1' }, error: null });
});

describe('Join squad post', () => {
  it('loading shows a skeleton', async () => {
    mockPosts = { status: 'loading' };
    const view = await render(<JoinSquadPostScreen />);
    expect(screen.getByTestId('join-skeleton')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('error: inline with a retry of the same load', async () => {
    mockPosts = { status: 'error', message: 'offline' };
    await render(<JoinSquadPostScreen />);
    expect(screen.getByText('Could not load this post.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s price unchanged, split as the server returned it', async () => {
    const view = await render(<JoinSquadPostScreen />);
    await screen.findByText('€6.80');
    expect(mockRpc).toHaveBeenCalledWith('squad_post_price', { p_post_id: 'pp1' });
    expect(screen.getByText('Your share')).toBeTruthy();
    expect(screen.getByText('€6.00')).toBeTruthy();
    expect(screen.getByText('€0.80')).toBeTruthy();
    expect(screen.getByText('2 open spots')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('the pitch line is the server’s pitch_cents, never the share minus the fee', async () => {
    // Deliberately not 690 − 80: the screen must show what the server sent.
    mockPrice = { share_cents: 690, fee_cents: 80, pitch_cents: 599 };
    await render(<JoinSquadPostScreen />);
    await screen.findByText('€6.90');
    expect(screen.getByText('€5.99')).toBeTruthy();
    expect(screen.queryByText('€6.10')).toBeNull();
  });

  it('no pitch part from the server: just the share', async () => {
    mockPrice = { share_cents: 680, fee_cents: 80, pitch_cents: null };
    await render(<JoinSquadPostScreen />);
    await screen.findByText('€6.80');
    expect(screen.queryByText('Pitch')).toBeNull();
    expect(screen.queryByText('Service fee')).toBeNull();
  });

  it('no fee: just the share, nothing added', async () => {
    mockPrice = { share_cents: 1234, fee_cents: null, pitch_cents: null };
    await render(<JoinSquadPostScreen />);
    await screen.findByText('€12.34');
    expect(screen.queryByText('Service fee')).toBeNull();
  });

  it('shows the venue’s block notice as a warning', async () => {
    mockBlockNotice.mockResolvedValue({ title: 'Pitch closed', body: 'Rain' });
    await render(<JoinSquadPostScreen />);
    expect(await screen.findByText('Pitch closed')).toBeTruthy();
    expect(mockBlockNotice).toHaveBeenCalledWith('pp1');
  });

  it('join and pay: the same calls in the same order, then back', async () => {
    await render(<JoinSquadPostScreen />);
    await screen.findByText('€6.80');
    await fireEvent.press(screen.getByRole('button', { name: 'Join and pay my share' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(mockJoin).toHaveBeenCalledWith('pp1');
    expect(mockCreateSharePayment).toHaveBeenCalledWith('share1');
    expect(g.mockInitPaymentSheet).toHaveBeenCalledWith(
      expect.objectContaining({ merchantDisplayName: 'Futty', paymentIntentClientSecret: 'cs_1' })
    );
    expect(g.mockPresentPaymentSheet).toHaveBeenCalled();
  });

  it('the last spot opens the booking confirmation', async () => {
    mockPosts = { status: 'ready', posts: [{ ...post, joined_count: 2 }] };
    await render(<JoinSquadPostScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Join and pay my share' }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({ pathname: '/fixture-confirmed', params: { kind: 'booking', id: 'b1' } })
    );
  });

  it('a cancelled payment rolls the join back, as before', async () => {
    g.mockPresentPaymentSheet = jest.fn().mockResolvedValue({ error: { code: 'Canceled', message: 'x' } });
    await render(<JoinSquadPostScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Join and pay my share' }));
    await waitFor(() => expect(mockCancelPending).toHaveBeenCalledWith('b1'));
    expect(mockLeave).toHaveBeenCalledWith('pp1');
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('Join squad post: order, wallet options, double taps, failures', () => {
  it('calls join, payment start, sheet set-up and sheet in that order, with the wallet options', async () => {
    const { walletPayOptions } = jest.requireActual<typeof import('@/lib/wallet-pay')>('@/lib/wallet-pay');
    await render(<JoinSquadPostScreen />);
    await screen.findByText('€6.80');
    await fireEvent.press(screen.getByRole('button', { name: 'Join and pay my share' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(g.mockInitPaymentSheet).toHaveBeenCalledWith({
      merchantDisplayName: 'Futty',
      ...walletPayOptions,
      paymentIntentClientSecret: 'cs_1',
    });
    const order = [mockJoin, mockCreateSharePayment, g.mockInitPaymentSheet!, g.mockPresentPaymentSheet!].map(
      (m) => m.mock.invocationCallOrder[0]
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('a second tap while busy does nothing', async () => {
    let finishJoin: (v: { error: null }) => void = () => {};
    mockJoin.mockReturnValue(new Promise((resolve) => (finishJoin = resolve)));
    await render(<JoinSquadPostScreen />);
    await screen.findByText('€6.80');
    const button = screen.getByRole('button', { name: 'Join and pay my share' });
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(mockJoin).toHaveBeenCalledTimes(1);
    finishJoin({ error: null });
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('a failed payment start rolls the join back and says why', async () => {
    mockCreateSharePayment.mockResolvedValue({ data: null, error: null });
    await render(<JoinSquadPostScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Join and pay my share' }));
    expect(await screen.findByText('Couldn\'t start payment.')).toBeTruthy();
    expect(mockLeave).toHaveBeenCalledWith('pp1');
    expect(mockCancelPending).toHaveBeenCalledWith('b1');
    expect(g.mockInitPaymentSheet).not.toHaveBeenCalled();
  });
});

// Every date and time is Cyprus time (Asia/Nicosia), whatever zone the phone is in.
describe.each(ZONES_AND_SEASONS)('Join squad post times, phone on %s in %s', (zone, season) => {
  const kickoff = CYPRUS_LATE_KICKOFF[season];
  beforeEach(() => onPhoneIn(zone));
  afterEach(restorePhoneZone);

  it('shows the Cyprus day and kick-off', async () => {
    mockPosts = { status: 'ready', posts: [{ ...post, scheduled_at: kickoff.iso }] };
    await render(<JoinSquadPostScreen />);
    expect(screen.getByText(`Gold · Nicosia · ${kickoff.date} · ${kickoff.clock}`)).toBeTruthy();
  });
});
