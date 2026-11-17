import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { TeamContent } from '@/app/(tabs)/team';

const team = {
  id: 't1',
  name: 'Tigers',
  city: 'Nicosia',
  created_by: 'me',
  xp: 120,
  played: 10,
  won: 5,
  drawn: 2,
  lost: 3,
  goals: 20,
  roster_size: 3,
  substitute_slots: 1,
  premium_9aside: false,
  premium_11aside: true,
  created_at: '',
};

let mockTeams: Record<string, unknown>;
const mockReload = jest.fn();
const mockGetRoster = jest.fn();
const mockFind = jest.fn();
const mockInvite = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ ...mockTeams, reload: mockReload }) }));
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ status: 'ready', profile: { username: 'cap' }, reload: jest.fn() }),
}));
jest.mock('@/lib/premium', () => ({ TEAM_PREMIUM_ENABLED: true }));
jest.mock('@/lib/teams', () => ({
  ...jest.requireActual('@/lib/teams'),
  getTeamRoster: (...args: unknown[]) => mockGetRoster(...args),
  findProfileByUsername: (...args: unknown[]) => mockFind(...args),
  inviteTeamMember: (...args: unknown[]) => mockInvite(...args),
}));
jest.mock('@/lib/invite', () => ({ shareTeamInvite: jest.fn() }));

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRoster.mockResolvedValue({ data: [{ profile_id: 'a', username: 'cap', role: 'captain' }], error: null });
});

describe('Teams segment', () => {
  it('shows a skeleton while loading', async () => {
    mockTeams = { status: 'loading' };
    const view = await render(<TeamContent />);
    expect(screen.getByTestId('teams-skeleton')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('shows an inline error that retries the same load', async () => {
    mockTeams = { status: 'error', message: 'offline' };
    await render(<TeamContent />);
    expect(screen.getByText('Could not load your teams: offline')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('empty: says so and links to leagues as before', async () => {
    mockTeams = { status: 'ready', teams: [] };
    const view = await render(<TeamContent />);
    expect(view.toJSON()).toMatchSnapshot();
    await fireEvent.press(screen.getByRole('button', { name: 'Register one when you join a league' }));
    expect(router.push).toHaveBeenCalledWith('/leagues');
  });

  it('populated: team card, stats in tabular figures, roster on demand', async () => {
    mockTeams = { status: 'ready', teams: [{ team, role: 'player' }] };
    const view = await render(<TeamContent />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'View team' })).toBeTruthy());
    expect(mockGetRoster).toHaveBeenCalledWith('t1');
    expect(screen.getByLabelText('Win rate 50%')).toBeTruthy();
    expect(screen.getByText('Roster (3 + 1 subs)')).toBeTruthy();
    expect(screen.queryByText('Team Premium')).toBeNull();
    expect(view.toJSON()).toMatchSnapshot();

    await fireEvent.press(screen.getByRole('button', { name: 'View team' }));
    expect(screen.getByText('Captain')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide team' })).toBeTruthy();
  });

  it('switches team with the chips', async () => {
    const lions = { ...team, id: 't2', name: 'Lions' };
    mockTeams = { status: 'ready', teams: [{ team, role: 'player' }, { team: lions, role: 'player' }] };
    await render(<TeamContent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Lions' }));
    await waitFor(() => expect(mockGetRoster).toHaveBeenLastCalledWith('t2'));
  });

  it('captain: invites by username with the same calls', async () => {
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    mockFind.mockResolvedValue({ data: [{ id: 'p9', username: 'ann' }], error: null });
    mockInvite.mockResolvedValue({ error: null });
    await render(<TeamContent />);
    const field = await screen.findByLabelText('Add a player (2 slots left)');
    await fireEvent.changeText(field, ' ann ');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Invite' })[0]);
    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith('t1', 'p9', 'player'));
    expect(mockFind).toHaveBeenCalledWith('ann');
    expect(screen.getByText('Invite sent to ann — they join once they accept.')).toBeTruthy();
  });

  it('captain on iOS: Team Premium Buy opens the same plan screen; active shows a refund link', async () => {
    Platform.OS = 'ios';
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    await render(<TeamContent />);
    await screen.findByText('Team Premium');
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request a refund' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Buy' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/premium-plan',
      params: { plan: 'team-9-a-side', teamId: 't1' },
    });
  });
});

describe('Teams segment roster retry', () => {
  it('clears the error when Try again loads the roster', async () => {
    mockTeams = { status: 'ready', teams: [{ team, role: 'player' }] };
    mockGetRoster.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await render(<TeamContent />);
    await screen.findByText('Could not load roster: offline');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'View team' });
    expect(screen.queryByText('Could not load roster: offline')).toBeNull();
    expect(mockGetRoster).toHaveBeenCalledTimes(2);
  });
});
