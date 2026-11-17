import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { CommunityContent } from '@/app/(tabs)/community';

let mockContacts: Record<string, unknown>;
const mockLoad = jest.fn();
const mockFollowToggle = jest.fn();
const mockBlockToggle = jest.fn();
const mockSubmitReport = jest.fn();
const mockShareInvite = jest.fn();
const mockListTeams = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/use-contacts', () => ({ useContacts: () => ({ ...mockContacts, load: mockLoad }) }));
jest.mock('@/lib/use-follows', () => ({
  useFollows: () => ({
    status: 'ready',
    isFollowing: (_type: string, id: string) => id === 'p-followed',
    toggle: mockFollowToggle,
    reload: jest.fn(),
  }),
}));
jest.mock('@/lib/use-blocks', () => ({
  useBlocks: () => ({ status: 'ready', isBlocked: () => false, toggle: mockBlockToggle, reload: jest.fn() }),
}));
jest.mock('@/lib/moderation', () => ({ submitReport: (...args: unknown[]) => mockSubmitReport(...args) }));
jest.mock('@/lib/invite', () => ({ shareContactInvite: (...args: unknown[]) => mockShareInvite(...args) }));
jest.mock('@/lib/community', () => ({ listTeams: () => mockListTeams() }));

const ann = { id: 'c1', name: 'Ann Lee', phones: [], match: { profileId: 'p-ann', username: 'ann' } };
const bob = { id: 'c2', name: 'Bob Day', phones: [], match: { profileId: 'p-followed', username: null } };
const cy = { id: 'c3', name: 'Cy Tan', phones: [], match: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockFollowToggle.mockResolvedValue({ error: null });
  mockBlockToggle.mockResolvedValue({ error: null });
  mockSubmitReport.mockResolvedValue({ error: null });
  mockShareInvite.mockResolvedValue(undefined);
  mockListTeams.mockResolvedValue({ data: [{ id: 'tm1', name: 'Tigers', city: 'Paphos' }], error: null });
});

describe('Community segment', () => {
  it('loads contacts once on open and shows a skeleton', async () => {
    mockContacts = { status: 'loading' };
    const view = await render(<CommunityContent />);
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('contacts-skeleton')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('denied: explains and retries the same load', async () => {
    mockContacts = { status: 'denied' };
    await render(<CommunityContent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it('error: inline with retry', async () => {
    mockContacts = { status: 'error', message: 'nope' };
    await render(<CommunityContent />);
    expect(screen.getByText('Could not load contacts: nope')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it('empty', async () => {
    mockContacts = { status: 'ready', matched: [], unmatched: [] };
    const view = await render(<CommunityContent />);
    expect(screen.getByText('No contacts with phone numbers found.')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('populated: avatar, name, one row of actions, same calls', async () => {
    mockContacts = { status: 'ready', matched: [ann, bob], unmatched: [cy] };
    const view = await render(<CommunityContent />);
    expect(view.toJSON()).toMatchSnapshot();
    expect(screen.getByText('On Futty (2)')).toBeTruthy();
    expect(screen.getByText('Invite to Futty (1)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Ann Lee' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'p-ann' } });

    await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
    expect(mockFollowToggle).toHaveBeenCalledWith('player', 'p-ann');

    await fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
    expect(mockShareInvite).toHaveBeenCalledWith('Cy Tan');
    await screen.findByRole('button', { name: 'Sent' });
  });

  it('block and report a contact with the same calls', async () => {
    mockContacts = { status: 'ready', matched: [ann], unmatched: [] };
    await render(<CommunityContent />);
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
      })
    );
    expect(await screen.findByText('Report submitted — thanks.')).toBeTruthy();
  });

  it('teams: listed once opened, opens the team profile and follows', async () => {
    mockContacts = { status: 'ready', matched: [], unmatched: [] };
    await render(<CommunityContent />);
    expect(mockListTeams).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Teams' }));
    await screen.findByText('Tigers');
    expect(mockListTeams).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Tigers' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'tm1' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
    expect(mockFollowToggle).toHaveBeenCalledWith('team', 'tm1');
  });
});
