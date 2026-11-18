import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import SquadsScreen from '@/app/squads';

import { CYPRUS_LATE_KICKOFF, onPhoneIn, restorePhoneZone, ZONES_AND_SEASONS } from '../phone-time-zone';

const params = globalThis as { mockSearchParams?: Record<string, string> };
let mockPosts: Record<string, unknown>;
let mockMyTeams: Record<string, unknown>;
const mockReload = jest.fn();
const mockUseSquadPosts = jest.fn();
const mockLeave = jest.fn();
const mockOffer = jest.fn();
const mockCancelOffer = jest.fn();
const mockPrices = jest.fn();

let mockShare: { id: string } | null = null;
const mockInvoke = jest.fn();
const mockCreateSharePayment = jest.fn();

jest.mock('@/lib/supabase', () => {
  const shareQuery = {
    select: () => shareQuery,
    eq: () => shareQuery,
    maybeSingle: () => Promise.resolve({ data: mockShare, error: null }),
  };
  return { supabase: { from: () => shareQuery, functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } };
});
jest.mock('@/lib/booking-shares', () => ({
  createSharePayment: (...args: unknown[]) => mockCreateSharePayment(...args),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/use-squad-posts', () => ({
  useSquadPosts: (type: string) => {
    mockUseSquadPosts(type);
    return { ...mockPosts, reload: mockReload };
  },
}));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => mockMyTeams }));
jest.mock('@/lib/squads', () => ({
  ...jest.requireActual('@/lib/squads'),
  leaveSquadPost: (...args: unknown[]) => mockLeave(...args),
  offerOpposition: (...args: unknown[]) => mockOffer(...args),
  cancelOppositionOffer: (...args: unknown[]) => mockCancelOffer(...args),
  getSquadPostPrices: (...args: unknown[]) => mockPrices(...args),
}));
jest.mock('@/components/match/head-to-head', () => ({ TeamHeadToHead: () => null }));

const base = {
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
  roster: [{ profileId: 'p1', name: 'Ann', tier: 'Gold', isHousePlayer: false }],
};
const playersPost = { ...base, id: 'pp1', type: 'players' };
const oppositionPost = {
  ...base,
  id: 'op1',
  type: 'opposition',
  team_id: 'their-team',
  team_name: 'Lions',
  team_level: 'Silver',
  players_needed: null,
  roster: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  params.mockSearchParams = {};
  mockMyTeams = { status: 'ready', teams: [] };
  mockPrices.mockResolvedValue(new Map());
});

describe('Squads', () => {
  it.each([
    ['loading', { status: 'loading' }],
    ['empty', { status: 'ready', posts: [] }],
  ])('%s', async (_, state) => {
    mockPosts = state;
    const view = await render(<SquadsScreen />);
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('error retries the same load', async () => {
    mockPosts = { status: 'error', message: 'offline' };
    await render(<SquadsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('opens on the view the link names and switches with the segmented control', async () => {
    params.mockSearchParams = { view: 'opposition' };
    mockPosts = { status: 'ready', posts: [] };
    await render(<SquadsScreen />);
    expect(mockUseSquadPosts).toHaveBeenLastCalledWith('opposition');
    await fireEvent.press(screen.getByRole('tab', { name: 'Need players' }));
    expect(mockUseSquadPosts).toHaveBeenLastCalledWith('players');
  });

  it('need players: a Card with venue, time, format, level, spots left, one action', async () => {
    mockPosts = { status: 'ready', posts: [playersPost] };
    const view = await render(<SquadsScreen />);
    expect(view.toJSON()).toMatchSnapshot();
    expect(screen.getByText('Nicosia · 5-a-side · Gold')).toBeTruthy();
    expect(screen.getByLabelText('Spots left: 2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Join and pay my share' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/join-squad-post', params: { postId: 'pp1' } });
  });

  it('need players: each card shows the server’s price per player, unchanged', async () => {
    mockPrices.mockResolvedValue(
      new Map([
        ['pp1', { share_cents: 680, fee_cents: 80, pitch_cents: 600 }],
        ['pp2', { share_cents: 1234, fee_cents: null, pitch_cents: null }],
      ])
    );
    mockPosts = { status: 'ready', posts: [playersPost, { ...playersPost, id: 'pp2' }, { ...playersPost, id: 'pp3' }] };
    await render(<SquadsScreen />);
    expect(await screen.findByLabelText('Price: €6.80 each')).toBeTruthy();
    expect(screen.getByLabelText('Price: €12.34 each')).toBeTruthy();
    expect(mockPrices).toHaveBeenCalledWith(['pp1', 'pp2', 'pp3']);
    // pp3 has no price from the server: its card shows none.
    expect(screen.getAllByLabelText(/^Price:/)).toHaveLength(2);
  });

  it('need players: no price while it loads or when it fails', async () => {
    let resolve: (value: null) => void = () => {};
    mockPrices.mockReturnValue(new Promise((r) => (resolve = r)));
    mockPosts = { status: 'ready', posts: [playersPost] };
    await render(<SquadsScreen />);
    expect(screen.queryByLabelText(/^Price:/)).toBeNull();
    resolve(null);
    await waitFor(() => expect(mockPrices).toHaveBeenCalled());
    expect(screen.queryByLabelText(/^Price:/)).toBeNull();
    expect(screen.getByLabelText('Spots left: 2')).toBeTruthy();
  });

  it('need opposition: no prices asked for', async () => {
    params.mockSearchParams = { view: 'opposition' };
    mockPosts = { status: 'ready', posts: [oppositionPost] };
    await render(<SquadsScreen />);
    expect(mockPrices).not.toHaveBeenCalled();
  });

  it('need players: full posts cannot be joined; my own spot can be cancelled', async () => {
    mockLeave.mockResolvedValue({ error: null });
    mockPosts = {
      status: 'ready',
      posts: [
        { ...playersPost, joined_count: 3 },
        { ...playersPost, id: 'pp2', joined_by_me: true },
      ],
    };
    await render(<SquadsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Full' }));
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mockLeave).toHaveBeenCalledWith('pp2'));
    expect(mockReload).toHaveBeenCalled();
  });

  it('need opposition: offer with a chosen team calls the same function', async () => {
    params.mockSearchParams = { view: 'opposition' };
    mockMyTeams = { status: 'ready', teams: [{ role: 'captain', team: { id: 'mine', name: 'Tigers' } }] };
    mockOffer.mockResolvedValue({ error: null });
    mockPosts = { status: 'ready', posts: [{ ...oppositionPost, venue_booking_id: null }] };
    const view = await render(<SquadsScreen />);
    expect(view.toJSON()).toMatchSnapshot();
    await fireEvent.press(screen.getByRole('button', { name: 'Offer to play them' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tigers' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Offer and pay my share' }));
    await waitFor(() => expect(mockOffer).toHaveBeenCalledWith('op1', 'mine'));
    expect(mockReload).toHaveBeenCalled();
  });

  it('need opposition, matched: view fixture and cancel as before', async () => {
    params.mockSearchParams = { view: 'opposition' };
    mockMyTeams = { status: 'ready', teams: [{ role: 'captain', team: { id: 'mine', name: 'Tigers' } }] };
    mockCancelOffer.mockResolvedValue({ error: null });
    mockPosts = {
      status: 'ready',
      posts: [{ ...oppositionPost, status: 'matched', matched_team_id: 'mine', matched_team_name: 'Tigers' }],
    };
    await render(<SquadsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Matched vs Tigers — view fixture' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fixture-confirmed', params: { kind: 'squad', id: 'op1' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mockCancelOffer).toHaveBeenCalledWith('op1'));
  });
});

describe('Squads: offer and pay my share (Gipedo Pano hold)', () => {
  const g = globalThis as { mockInitPaymentSheet?: jest.Mock; mockPresentPaymentSheet?: jest.Mock };

  beforeEach(() => {
    params.mockSearchParams = { view: 'opposition' };
    mockMyTeams = { status: 'ready', teams: [{ role: 'captain', team: { id: 'mine', name: 'Tigers' } }] };
    mockPosts = { status: 'ready', posts: [{ ...oppositionPost, payment_mode: 'gipedo_pano' }] };
    mockShare = { id: 'share9' };
    mockOffer.mockResolvedValue({ error: null });
    mockCancelOffer.mockResolvedValue({ error: null });
    mockInvoke.mockResolvedValue({ error: null });
    mockCreateSharePayment.mockResolvedValue({ data: { clientSecret: 'cs_9' }, error: null });
    g.mockInitPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    g.mockPresentPaymentSheet = jest.fn().mockResolvedValue({ error: null });
  });

  async function offer() {
    await render(<SquadsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Offer to play them' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tigers' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Offer and pay my share' }));
  }

  it('places the hold with the same calls, in order, then tells both rosters', async () => {
    const { walletPayOptions } = jest.requireActual<typeof import('@/lib/wallet-pay')>('@/lib/wallet-pay');
    await offer();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('notify-opposition-matched', { body: { postId: 'op1', payerProfileId: 'me' } })
    );
    expect(mockOffer).toHaveBeenCalledWith('op1', 'mine');
    expect(mockCreateSharePayment).toHaveBeenCalledWith('share9');
    expect(g.mockInitPaymentSheet).toHaveBeenCalledWith({
      merchantDisplayName: 'Futty',
      ...walletPayOptions,
      paymentIntentClientSecret: 'cs_9',
    });
    const order = [mockOffer, mockCreateSharePayment, g.mockInitPaymentSheet!, g.mockPresentPaymentSheet!, mockInvoke].map(
      (m) => m.mock.invocationCallOrder[0]
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(mockCancelOffer).not.toHaveBeenCalled();
    expect(mockReload).toHaveBeenCalled();
  });

  it('a cancelled sheet withdraws the offer and shows no error', async () => {
    g.mockPresentPaymentSheet = jest.fn().mockResolvedValue({ error: { code: 'Canceled', message: 'Canceled' } });
    await offer();
    await waitFor(() => expect(mockCancelOffer).toHaveBeenCalledWith('op1'));
    expect(screen.queryByText('Canceled')).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a failed payment start withdraws the offer and shows why', async () => {
    mockCreateSharePayment.mockResolvedValue({ data: null, error: null });
    await offer();
    await waitFor(() => expect(mockCancelOffer).toHaveBeenCalledWith('op1'));
    expect(await screen.findByText('Couldn\'t start payment.')).toBeTruthy();
    expect(g.mockInitPaymentSheet).not.toHaveBeenCalled();
  });

  it('no share (not a Gipedo Pano booking): nothing to pay, the match is on', async () => {
    mockShare = null;
    await offer();
    await waitFor(() => expect(mockReload).toHaveBeenCalled());
    expect(mockCreateSharePayment).not.toHaveBeenCalled();
  });
});

// Every date and time is Cyprus time (Asia/Nicosia), whatever zone the phone is in.
describe.each(ZONES_AND_SEASONS)('Squads times, phone on %s in %s', (zone, season) => {
  const kickoff = CYPRUS_LATE_KICKOFF[season];
  beforeEach(() => onPhoneIn(zone));
  afterEach(restorePhoneZone);

  it.each([
    ['need players', { ...playersPost, scheduled_at: kickoff.iso }],
    ['need opposition', { ...oppositionPost, scheduled_at: kickoff.iso }],
  ])('%s: the post shows its Cyprus day and kick-off', async (_, post) => {
    mockPosts = { status: 'ready', posts: [post] };
    await render(<SquadsScreen />);
    expect(screen.getByText(`${kickoff.date} · ${kickoff.clock}`)).toBeTruthy();
  });
});
