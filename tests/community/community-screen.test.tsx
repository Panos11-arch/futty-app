import './mocks';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import CommunityScreen, { CommunityContent } from '@/app/(tabs)/community';

import { post, result, suggestion } from './fixtures';

const mockFetchFeed = jest.fn();
const mockFetchSuggestions = jest.fn();
const mockDismiss = jest.fn();
const mockSearchPlayers = jest.fn();
const mockListTeams = jest.fn();
const mockSearchTeams = jest.fn();
const mockCreateTeam = jest.fn();
const mockFollowToggle = jest.fn();
const mockBlockToggle = jest.fn();
const mockSubmitReport = jest.fn();
const mockShareInvite = jest.fn();
const mockLoadContacts = jest.fn();
let mockContacts: Record<string, unknown> = { status: 'loading' };
let mockUnread = 0;

jest.mock('@/lib/community', () => ({
  ...jest.requireActual('@/lib/community'),
  fetchFeed: (...a: unknown[]) => mockFetchFeed(...a),
  fetchFollowSuggestions: (...a: unknown[]) => mockFetchSuggestions(...a),
  dismissFollowSuggestion: (...a: unknown[]) => mockDismiss(...a),
  searchPlayers: (...a: unknown[]) => mockSearchPlayers(...a),
  listTeams: () => mockListTeams(),
}));
jest.mock('@/lib/booking-opposition', () => ({ searchTeams: (...a: unknown[]) => mockSearchTeams(...a) }));
jest.mock('@/lib/teams', () => ({
  ...jest.requireActual('@/lib/teams'),
  createTeam: (...a: unknown[]) => mockCreateTeam(...a),
}));
jest.mock('@/lib/use-messages', () => ({ useUnreadMessages: () => mockUnread }));
let mockRequests = 0;
jest.mock('@/lib/use-friends', () => ({ useFriendRequestCount: () => mockRequests }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/use-follows', () => ({
  useFollows: () => ({
    status: 'ready',
    isFollowing: (_type: string, id: string) => id === 'p-followed',
    toggle: mockFollowToggle,
    reload: jest.fn(),
  }),
}));
jest.mock('@/lib/use-contacts', () => ({ useContacts: () => ({ ...mockContacts, load: mockLoadContacts }) }));
jest.mock('@/lib/use-blocks', () => ({
  useBlocks: () => ({ status: 'ready', isBlocked: () => false, toggle: mockBlockToggle, reload: jest.fn() }),
}));
jest.mock('@/lib/moderation', () => ({ submitReport: (...a: unknown[]) => mockSubmitReport(...a) }));
jest.mock('@/lib/invite', () => ({ shareContactInvite: (...a: unknown[]) => mockShareInvite(...a) }));

const ann = { id: 'c1', name: 'Ann Lee', phones: [], match: { profileId: 'p-ann', username: 'ann' } };
const bob = { id: 'c2', name: 'Bob Day', phones: [], match: { profileId: 'p-followed', username: null } };
const cy = { id: 'c3', name: 'Cy Tan', phones: [], match: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockUnread = 0;
  mockRequests = 0;
  mockContacts = { status: 'loading' };
  mockFetchFeed.mockResolvedValue({ data: [], error: null });
  mockFetchSuggestions.mockResolvedValue({ data: [], error: null });
  mockDismiss.mockResolvedValue({ error: null });
  mockSearchPlayers.mockResolvedValue({ data: [], error: null });
  mockListTeams.mockResolvedValue({ data: [{ id: 'tm1', name: 'Tigers', city: 'Paphos' }], error: null });
  mockSearchTeams.mockResolvedValue([]);
  mockFollowToggle.mockResolvedValue({ error: null });
  mockBlockToggle.mockResolvedValue({ error: null });
  mockSubmitReport.mockResolvedValue({ error: null });
  mockShareInvite.mockResolvedValue(undefined);
});

async function openFindPlayers() {
  await fireEvent.press(screen.getByRole('tab', { name: 'Find players' }));
}

describe('Community screen (image 18)', () => {
  it('renders the screen with the band', async () => {
    await render(<CommunityScreen />);
    expect(screen.getByTestId('community-screen')).toBeTruthy();
    expect(screen.getByTestId('community-band')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'For you' }).props.accessibilityState).toEqual({ selected: true });
  });

  it('Messages opens S13 inbox, with the unread count', async () => {
    mockUnread = 2;
    await render(<CommunityContent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Messages, 2 unread' }));
    expect(router.push).toHaveBeenCalledWith('/messages');
  });

  it('S20: Friends, next to Messages, opens Friends with the requests waiting', async () => {
    mockRequests = 3;
    await render(<CommunityContent />);
    // The count is in the button's label for VoiceOver; the badge itself is hidden from it.
    expect(screen.getByTestId('community-friends-badge', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Friends, 3 friend requests' }));
    expect(router.push).toHaveBeenCalledWith('/friends');
  });

  it('S20: no badge without requests; one request reads in the singular', async () => {
    await render(<CommunityContent />);
    expect(screen.getByTestId('community-friends')).toBeTruthy();
    expect(screen.queryByTestId('community-friends-badge', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Friends' })).toBeTruthy();
  });

  it('S20: one request', async () => {
    mockRequests = 1;
    await render(<CommunityContent />);
    expect(screen.getByRole('button', { name: 'Friends, 1 friend request' })).toBeTruthy();
  });

  describe('For you', () => {
    it('loads For you, skeleton first', async () => {
      mockFetchFeed.mockReturnValue(new Promise(() => {}));
      await render(<CommunityContent />);
      expect(screen.getByTestId('community-feed-for-you-skeleton')).toBeTruthy();
      expect(mockFetchFeed).toHaveBeenCalledWith('for_you');
    });

    it('empty: one line and Create post, which opens My bookings', async () => {
      await render(<CommunityContent />);
      expect(await screen.findByText('No posts yet.')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Create post' }));
      expect(router.push).toHaveBeenCalledWith('/my-bookings');
    });

    it('error: one line and Try again', async () => {
      mockFetchFeed.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
      await render(<CommunityContent />);
      expect(await screen.findByText("Couldn't load posts.")).toBeTruthy();
      mockFetchFeed.mockResolvedValueOnce({ data: [post()], error: null });
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Anna')).toBeTruthy();
    });

    it('posts and results', async () => {
      mockFetchFeed.mockResolvedValue({ data: [result(), post()], error: null });
      await render(<CommunityContent />);
      expect(await screen.findByText('3 : 2')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Join squad' })).toBeTruthy();
      expect(screen.queryByText(/^(Like|Comment)/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    });

    it('Your posts shows my posts', async () => {
      await render(<CommunityContent />);
      await fireEvent.press(screen.getByRole('button', { name: 'Your posts' }));
      await waitFor(() => expect(mockFetchFeed).toHaveBeenCalledWith('mine'));
      expect(screen.getByTestId('community-feed-mine')).toBeTruthy();
    });
  });

  describe('Following', () => {
    it('loads once opened; empty points to Find players', async () => {
      await render(<CommunityContent />);
      expect(mockFetchFeed).not.toHaveBeenCalledWith('following');
      await fireEvent.press(screen.getByRole('tab', { name: 'Following' }));
      await waitFor(() => expect(mockFetchFeed).toHaveBeenCalledWith('following'));
      await fireEvent.press(await screen.findByRole('button', { name: 'Find players' }));
      expect(screen.getByRole('tab', { name: 'Find players' }).props.accessibilityState).toEqual({ selected: true });
    });
  });

  describe('Search', () => {
    it('opens Find players with the search field', async () => {
      await render(<CommunityContent />);
      await fireEvent.press(screen.getByLabelText('Search players and teams'));
      expect(screen.getByRole('tab', { name: 'Find players' }).props.accessibilityState).toEqual({ selected: true });
      expect(screen.getByTestId('community-search-input').props.autoFocus).toBe(true);
    });

    it('searches players from 2 characters, with Follow', async () => {
      mockSearchPlayers.mockResolvedValue({ data: [{ id: 'u1', username: 'anna_z', full_name: 'Anna Zorba' }], error: null });
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.changeText(screen.getByLabelText('Search'), 'an');
      expect(await screen.findByText('Anna Zorba')).toBeTruthy();
      expect(mockSearchPlayers).toHaveBeenCalledWith('an');
      await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
      expect(mockFollowToggle).toHaveBeenCalledWith('player', 'u1');
      await fireEvent.press(screen.getByRole('button', { name: 'Anna Zorba, @anna_z' }));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'u1' } });
    });

    it('no players found, and a search error with Try again', async () => {
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.changeText(screen.getByLabelText('Search'), 'zz');
      expect(await screen.findByText('No players found.')).toBeTruthy();
      mockSearchPlayers.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
      await fireEvent.changeText(screen.getByLabelText('Search'), 'zzz');
      expect(await screen.findByText("Couldn't search.")).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('No players found.')).toBeTruthy();
    });

    it('searches teams on the Teams switch', async () => {
      mockSearchTeams.mockResolvedValue([{ id: 'tm2', name: 'Lions', city: null }]);
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('tab', { name: 'Teams' }));
      await fireEvent.changeText(screen.getByLabelText('Search'), 'li');
      expect(await screen.findByText('Lions')).toBeTruthy();
      expect(mockSearchTeams).toHaveBeenCalledWith('li', expect.any(Set));
    });
  });

  describe('Find players: suggestions', () => {
    it('hidden when there are none', async () => {
      await render(<CommunityContent />);
      await openFindPlayers();
      await waitFor(() => expect(mockFetchSuggestions).toHaveBeenCalledWith(8));
      expect(screen.queryByText('Start following some accounts')).toBeNull();
    });

    it('cards, See all, follow and dismiss', async () => {
      mockFetchSuggestions.mockResolvedValue({ data: [suggestion()], error: null });
      await render(<CommunityContent />);
      await openFindPlayers();
      expect(await screen.findByText('Start following some accounts')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'See all' }));
      expect(router.push).toHaveBeenCalledWith('/follow-suggestions');
      await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
      expect(mockFollowToggle).toHaveBeenCalledWith('player', 'u-nikos');
      await fireEvent.press(screen.getByRole('button', { name: 'Dismiss Nikos' }));
      expect(mockDismiss).toHaveBeenCalledWith('u-nikos');
      await waitFor(() => expect(screen.queryByText('Start following some accounts')).toBeNull());
    });

    it('error with Try again', async () => {
      mockFetchSuggestions.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
      await render(<CommunityContent />);
      await openFindPlayers();
      expect(await screen.findByText("Couldn't load suggestions.")).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(mockFetchSuggestions).toHaveBeenCalledTimes(2);
    });
  });

  describe('Find players: from your contacts (was Contacts)', () => {
    it('reads contacts only when opened', async () => {
      await render(<CommunityContent />);
      await openFindPlayers();
      expect(mockLoadContacts).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: 'From your contacts' }));
      expect(mockLoadContacts).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('contacts-skeleton')).toBeTruthy();
    });

    it('denied: one line and Try again', async () => {
      mockContacts = { status: 'denied' };
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('button', { name: 'From your contacts' }));
      expect(screen.getByText('Allow contacts to find friends on Futty.')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(mockLoadContacts).toHaveBeenCalledTimes(2);
    });

    it('error: inline with retry', async () => {
      mockContacts = { status: 'error', message: 'nope' };
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('button', { name: 'From your contacts' }));
      expect(screen.getByText('Could not load contacts: nope')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(mockLoadContacts).toHaveBeenCalledTimes(2);
    });

    it('empty', async () => {
      mockContacts = { status: 'ready', matched: [], unmatched: [] };
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('button', { name: 'From your contacts' }));
      expect(screen.getByText('No contacts with phone numbers found.')).toBeTruthy();
    });

    it('on Futty: follow and open; invite the rest', async () => {
      mockContacts = { status: 'ready', matched: [ann, bob], unmatched: [cy] };
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('button', { name: 'From your contacts' }));
      expect(screen.getByText('On Futty (2)')).toBeTruthy();
      expect(screen.getByText('Invite to Futty (1)')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Ann Lee, @ann' }));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'p-ann' } });
      await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
      expect(mockFollowToggle).toHaveBeenCalledWith('player', 'p-ann');
      await fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
      expect(mockShareInvite).toHaveBeenCalledWith('Cy Tan');
      await screen.findByRole('button', { name: 'Sent' });
    });

    it('block and report a contact, unchanged', async () => {
      mockContacts = { status: 'ready', matched: [ann], unmatched: [] };
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('button', { name: 'From your contacts' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Block or report this player' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Block' }));
      expect(mockBlockToggle).toHaveBeenCalledWith('p-ann');
      await fireEvent.press(screen.getByRole('button', { name: 'Report' }));
      await fireEvent.changeText(screen.getByLabelText('Report this player'), ' spam ');
      await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
      await waitFor(() =>
        expect(mockSubmitReport).toHaveBeenCalledWith({
          reporterId: 'me',
          reportedUserId: 'p-ann',
          context: 'player',
          reason: 'spam',
        }),
      );
      expect(await screen.findByText('Report submitted — thanks.')).toBeTruthy();
    });
  });

  describe('Find players: teams (was Teams)', () => {
    it('listed on the Teams switch, opens the team and follows', async () => {
      await render(<CommunityContent />);
      await openFindPlayers();
      expect(mockListTeams).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('tab', { name: 'Teams' }));
      await screen.findByText('Tigers');
      expect(mockListTeams).toHaveBeenCalledTimes(1);
      await fireEvent.press(screen.getByRole('button', { name: 'Tigers, Paphos' }));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'tm1' } });
      await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
      expect(mockFollowToggle).toHaveBeenCalledWith('team', 'tm1');
    });

    it('error: Try again runs listTeams again', async () => {
      mockListTeams.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('tab', { name: 'Teams' }));
      expect(await screen.findByText('Could not load: offline')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByText('Tigers');
      expect(mockListTeams).toHaveBeenCalledTimes(2);
    });

    it('empty: Create a team opens New team', async () => {
      mockListTeams.mockResolvedValue({ data: [], error: null });
      await render(<CommunityContent />);
      await openFindPlayers();
      await fireEvent.press(screen.getByRole('tab', { name: 'Teams' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Create a team' }));
      expect(screen.getByLabelText('Team name')).toBeTruthy();
    });
  });

  describe('+ button', () => {
    it('New post opens My bookings', async () => {
      await render(<CommunityContent />);
      await fireEvent.press(screen.getByRole('button', { name: 'Create a post or team' }));
      await fireEvent.press(screen.getByRole('button', { name: 'New post' }));
      expect(router.push).toHaveBeenCalledWith('/my-bookings');
    });

    it('New team creates the team on the server and opens it', async () => {
      mockCreateTeam.mockResolvedValue({ data: { id: 'tm9' }, error: null });
      await render(<CommunityContent />);
      await fireEvent.press(screen.getByRole('button', { name: 'Create a post or team' }));
      await fireEvent.press(screen.getByRole('button', { name: 'New team' }));
      await fireEvent.changeText(screen.getByLabelText('Team name'), ' Kato United ');
      await fireEvent.press(screen.getByRole('button', { name: 'Limassol' }));
      await act(async () => {
        await fireEvent.press(screen.getByRole('button', { name: 'Create team' }));
      });
      expect(mockCreateTeam).toHaveBeenCalledWith('Kato United', 'Limassol', 11, 0);
      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'tm9' } }),
      );
    });

    it('a refused team says why', async () => {
      mockCreateTeam.mockResolvedValue({ data: null, error: { message: 'name_required' } });
      await render(<CommunityContent />);
      await fireEvent.press(screen.getByRole('button', { name: 'Create a post or team' }));
      await fireEvent.press(screen.getByRole('button', { name: 'New team' }));
      await fireEvent.changeText(screen.getByLabelText('Team name'), 'X');
      await fireEvent.press(screen.getByRole('button', { name: 'Create team' }));
      expect(await screen.findByText('Give the team a name.')).toBeTruthy();
    });
  });

  it('Words: every button on the feed is 1-3 words', async () => {
    mockFetchFeed.mockResolvedValue({ data: [result(), post(), post({ item_id: 'p2', post_type: 'opposition' })], error: null });
    await render(<CommunityContent />);
    await screen.findByText('3 : 2');
    const words = ['All', 'Your posts', 'Join squad', 'Accept as opponent'];
    for (const label of words) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(label.split(' ').length).toBeLessThanOrEqual(3);
    }
  });
});
