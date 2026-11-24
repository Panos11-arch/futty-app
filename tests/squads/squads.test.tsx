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
// B4: Booking v2 quotes and my publishable games; none unless a test sets them.
const mockQuotes = jest.fn();
const mockPublishable = jest.fn();
const mockPublish = jest.fn();
const mockUnpublish = jest.fn();
jest.mock('@/lib/booking-opposition', () => ({
  ...jest.requireActual('@/lib/booking-opposition'),
  publishBooking: (...args: unknown[]) => mockPublish(...args),
  unpublishPost: (...args: unknown[]) => mockUnpublish(...args),
}));
jest.mock('@/lib/booking-posts', () => ({
  ...jest.requireActual('@/lib/booking-posts'),
  getBookingPostQuotes: (...args: unknown[]) => mockQuotes(...args),
  fetchPublishableBookings: (...args: unknown[]) => mockPublishable(...args),
}));

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
  mockQuotes.mockResolvedValue(new Map());
  mockPublishable.mockResolvedValue([]);
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

// B4 (spec 13 "Publish game"): Booking v2 posts, priced by the server for
// their side, with Join, Accept as opponent, Unpublish and "Your games".
describe('Squads: Booking v2 posts', () => {
  const v2Quote = (over: Record<string, unknown> = {}) => ({
    post_id: 'pp1',
    kind: 'players',
    side: 'a',
    mine: false,
    open: true,
    closes_at: '2099-11-20T18:00:00Z',
    join_cents: 480,
    join_pitch_cents: 400,
    join_fee_cents: 80,
    pay_all_cents: null,
    each_pays_cents: null,
    guarantee_cents: null,
    ...over,
  });
  const v2Opposition = { ...oppositionPost, id: 'op2', side: 'b', team_id: null, team_name: null, players_needed: 5 };
  const game = {
    booking_id: 'bk1',
    venue_name: 'Arena',
    booking_day: '2099-11-20',
    start_time: '20:00:00',
    end_time: '21:00:00',
    format: '5-a-side',
    pitch_label: 'Pitch 1',
    kind: 'half',
    side: 'a',
    open_spots: 4,
    players_post_id: null,
    opposition_post_id: null,
    can_publish_players: true,
    can_publish_opposition: true,
  };

  it('a players post: the server\'s price for its side, and Join', async () => {
    mockQuotes.mockResolvedValue(new Map([['pp1', v2Quote()]]));
    mockPosts = { status: 'ready', posts: [playersPost] };
    await render(<SquadsScreen />);
    expect(await screen.findByText('€4.80 each')).toBeTruthy();
    expect(mockQuotes).toHaveBeenCalledWith(['pp1']);
    expect(screen.queryByRole('button', { name: 'Join and pay my share' })).toBeNull();
    await fireEvent.press(screen.getByTestId('post-join'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/join-squad-post', params: { postId: 'pp1' } });
  });

  it('my own post: Unpublish closes it and the list reloads', async () => {
    mockQuotes.mockResolvedValue(new Map([['pp1', v2Quote({ mine: true })]]));
    mockUnpublish.mockResolvedValue(null);
    mockPosts = { status: 'ready', posts: [playersPost] };
    await render(<SquadsScreen />);
    await fireEvent.press(await screen.findByTestId('post-unpublish'));
    await waitFor(() => expect(mockUnpublish).toHaveBeenCalledWith('pp1'));
    expect(mockReload).toHaveBeenCalled();
  });

  it('a game I joined: View booking', async () => {
    mockQuotes.mockResolvedValue(new Map([['pp1', v2Quote({ open: false })]]));
    mockPosts = { status: 'ready', posts: [{ ...playersPost, joined_by_me: true }] };
    await render(<SquadsScreen />);
    await fireEvent.press(await screen.findByTestId('post-view-booking'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it('a closed post leaves the list', async () => {
    mockQuotes.mockResolvedValue(new Map([['pp1', v2Quote({ open: false })]]));
    mockPosts = { status: 'ready', posts: [playersPost] };
    await render(<SquadsScreen />);
    expect(await screen.findByText('Nothing open right now — check back soon.')).toBeTruthy();
  });

  it('an opposition post: side B\'s price and Accept as opponent, never the old offer', async () => {
    params.mockSearchParams = { view: 'opposition' };
    let resolve: (m: Map<string, unknown>) => void = () => {};
    mockQuotes.mockReturnValue(new Promise((r) => (resolve = r)));
    mockPosts = { status: 'ready', posts: [v2Opposition] };
    await render(<SquadsScreen />);
    // Still loading: no action at all.
    expect(screen.queryByRole('button', { name: 'Offer to play them' })).toBeNull();
    resolve(
      new Map([
        ['op2', v2Quote({ post_id: 'op2', kind: 'opposition', side: 'b', join_cents: null, pay_all_cents: 2275, each_pays_cents: 480, guarantee_cents: 2000 })],
      ]),
    );
    expect(await screen.findByText('€22.75 for your side, or €4.80 each')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('post-accept-opponent'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/opposition-invite', params: { postId: 'op2' } });
  });

  it('Your games: publish my open spots, then the list reloads', async () => {
    mockPublishable.mockResolvedValue([game]);
    mockPublish.mockResolvedValue(null);
    mockPosts = { status: 'ready', posts: [] };
    await render(<SquadsScreen />);
    await fireEvent.press(await screen.findByTestId('publish-game-button-bk1'));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith('bk1', 'players'));
    expect(mockReload).toHaveBeenCalled();
    expect(mockPublishable).toHaveBeenCalledTimes(2);
  });

  it('Your games on the opposition view: publish an opposition post; unpublish one', async () => {
    params.mockSearchParams = { view: 'opposition' };
    mockPublishable.mockResolvedValue([game, { ...game, booking_id: 'bk2', opposition_post_id: 'op9' }]);
    mockPublish.mockResolvedValue(null);
    mockUnpublish.mockResolvedValue(null);
    mockPosts = { status: 'ready', posts: [] };
    await render(<SquadsScreen />);
    await fireEvent.press(await screen.findByTestId('publish-game-button-bk1'));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith('bk1', 'opposition'));
    await fireEvent.press(await screen.findByTestId('publish-game-button-bk2'));
    await waitFor(() => expect(mockUnpublish).toHaveBeenCalledWith('op9'));
  });

  it('Your games: the server\'s refusal in words', async () => {
    mockPublishable.mockResolvedValue([game]);
    mockPublish.mockResolvedValue('This game is full.');
    mockPosts = { status: 'ready', posts: [] };
    await render(<SquadsScreen />);
    await fireEvent.press(await screen.findByTestId('publish-game-button-bk1'));
    expect(await screen.findByText('This game is full.')).toBeTruthy();
  });
});
