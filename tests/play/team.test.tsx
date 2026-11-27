import './mocks';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
const mockPending = jest.fn();
const mockCancelInvite = jest.fn();
const mockRemove = jest.fn();
const mockPass = jest.fn();
const mockLeave = jest.fn();
const mockDelete = jest.fn();

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
  fetchPendingTeamInvites: (...args: unknown[]) => mockPending(...args),
  cancelTeamInvite: (...args: unknown[]) => mockCancelInvite(...args),
  removeTeamMember: (...args: unknown[]) => mockRemove(...args),
  passCaptaincy: (...args: unknown[]) => mockPass(...args),
  leaveTeam: (...args: unknown[]) => mockLeave(...args),
  deleteTeam: (...args: unknown[]) => mockDelete(...args),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'a' } }) }));
jest.mock('@/lib/invite', () => ({ shareTeamInvite: jest.fn() }));

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRoster.mockResolvedValue({ data: [{ profile_id: 'a', username: 'cap', role: 'captain' }], error: null });
  mockPending.mockResolvedValue([]);
  for (const m of [mockCancelInvite, mockRemove, mockPass, mockLeave, mockDelete]) m.mockResolvedValue({ error: null });
});

const twoMembers = {
  data: [
    { profile_id: 'a', username: 'cap', full_name: 'Ana Cap', role: 'captain' },
    { profile_id: 'b', username: 'ben', full_name: 'Ben Player', role: 'player' },
  ],
  error: null,
};

async function openRoster() {
  await fireEvent.press(await screen.findByRole('button', { name: 'View team' }));
}

describe('S20A: members, captain tools, leave and delete', () => {
  it('shows the team kit badge', async () => {
    mockTeams = { status: 'ready', teams: [{ team: { ...team, kit_colour: 'kitRed' }, role: 'player' }] };
    await render(<TeamContent />);
    expect(await screen.findByTestId('team-badge')).toBeTruthy();
  });

  it('a member name opens their profile', async () => {
    mockGetRoster.mockResolvedValue(twoMembers);
    mockTeams = { status: 'ready', teams: [{ team, role: 'player' }] };
    await render(<TeamContent />);
    await openRoster();
    await fireEvent.press(screen.getByRole('button', { name: 'Ben Player' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'b' } });
  });

  it('a player sees no captain tools and can leave', async () => {
    mockGetRoster.mockResolvedValue(twoMembers);
    mockTeams = { status: 'ready', teams: [{ team, role: 'player' }] };
    await render(<TeamContent />);
    await openRoster();
    expect(screen.queryByTestId('team-member-actions-b')).toBeNull();
    expect(mockPending).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('team-leave'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('team-leave-confirm'));
    });
    expect(mockLeave).toHaveBeenCalledWith('t1');
    expect(mockReload).toHaveBeenCalled();
  });

  it('captain: Make captain and Remove from a member row', async () => {
    mockGetRoster.mockResolvedValue(twoMembers);
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    await render(<TeamContent />);
    await openRoster();
    expect(screen.queryByTestId('team-member-actions-a')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Options for Ben Player' }));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('team-member-make-captain'));
    });
    expect(mockPass).toHaveBeenCalledWith('t1', 'b');
    expect(mockReload).toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('team-member-actions-b'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('team-member-remove'));
    });
    expect(mockRemove).toHaveBeenCalledWith('t1', 'b');
  });

  it('captain: a refused action says why in one line', async () => {
    mockGetRoster.mockResolvedValue(twoMembers);
    mockRemove.mockResolvedValue({ error: { message: 'not_captain' } });
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    await render(<TeamContent />);
    await openRoster();
    await fireEvent.press(screen.getByTestId('team-member-actions-b'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('team-member-remove'));
    });
    expect(await screen.findByText('Only the captain can do that.')).toBeTruthy();
  });

  it('captain: Pending lists open invites and cancels one; hidden when none', async () => {
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    mockPending.mockResolvedValueOnce([{ invite_id: 'i1', profile_id: 'c', name: 'Cy Friend', role: 'player' }]);
    await render(<TeamContent />);
    expect(await screen.findByText('Pending')).toBeTruthy();
    expect(mockPending).toHaveBeenCalledWith('t1');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel invite to Cy Friend' }));
    });
    expect(mockCancelInvite).toHaveBeenCalledWith('i1');
    await waitFor(() => expect(screen.queryByText('Pending')).toBeNull());
  });

  it('captain: Pending failed to load: one line and Try again', async () => {
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    mockPending.mockRejectedValueOnce(new Error("Couldn't load. Try again."));
    await render(<TeamContent />);
    expect(await screen.findByText("Couldn't load. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId('team-pending-retry'));
    await waitFor(() => expect(mockPending).toHaveBeenCalledTimes(2));
  });

  it('the last member deletes the team instead of leaving', async () => {
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    await render(<TeamContent />);
    await screen.findByRole('button', { name: 'View team' });
    expect(screen.queryByTestId('team-leave')).toBeNull();
    await fireEvent.press(screen.getByTestId('team-delete'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('team-delete-confirm'));
    });
    expect(mockDelete).toHaveBeenCalledWith('t1');
    expect(mockReload).toHaveBeenCalled();
  });

  it('a refused delete says why and keeps the team', async () => {
    mockDelete.mockResolvedValue({ error: { message: 'team_in_competition' } });
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    await render(<TeamContent />);
    await fireEvent.press(await screen.findByTestId('team-delete'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('team-delete-confirm'));
    });
    expect(await screen.findByText('This team is in a league. Try after it ends.')).toBeTruthy();
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('Words: buttons are 1-3 words', async () => {
    mockGetRoster.mockResolvedValue(twoMembers);
    mockTeams = { status: 'ready', teams: [{ team, role: 'captain' }] };
    await render(<TeamContent />);
    await openRoster();
    for (const label of ['Leave team', 'Hide team']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
      expect(label.split(' ').length).toBeLessThanOrEqual(3);
    }
  });
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
