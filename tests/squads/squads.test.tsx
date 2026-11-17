import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import SquadsScreen from '@/app/squads';

const params = globalThis as { mockSearchParams?: Record<string, string> };
let mockPosts: Record<string, unknown>;
let mockMyTeams: Record<string, unknown>;
const mockReload = jest.fn();
const mockUseSquadPosts = jest.fn();
const mockLeave = jest.fn();
const mockOffer = jest.fn();
const mockCancelOffer = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
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
