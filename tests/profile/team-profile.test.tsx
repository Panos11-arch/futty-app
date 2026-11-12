import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import TeamProfileScreen from '@/app/team-profile';

const team = {
  id: 'tigers',
  name: 'Tigers',
  city: 'Nicosia',
  created_by: 'x',
  xp: 0,
  played: 10,
  won: 5,
  drawn: 2,
  lost: 3,
  goals: 20,
  roster_size: 7,
  substitute_slots: 2,
  premium_9aside: false,
  premium_11aside: false,
  created_at: '',
};
const lions = { ...team, id: 'lions', name: 'Lions' };
const pumas = { ...team, id: 'pumas', name: 'Pumas' };

let mockMyTeams: Record<string, unknown>;
const mockHeadToHeadCalls: unknown[][] = [];
const mockToggle = jest.fn();

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({ teamId: 'tigers' }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: team, error: null }),
  };
  return { supabase: { from: () => query } };
});
jest.mock('@/lib/teams', () => ({
  getTeamRoster: () => Promise.resolve({ data: [{ profile_id: 'a', username: 'ann', full_name: null, role: 'captain' }], error: null }),
}));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => mockMyTeams }));
jest.mock('@/lib/use-follows', () => ({
  useFollows: () => ({ status: 'ready', isFollowing: () => false, toggle: mockToggle, reload: jest.fn() }),
}));
jest.mock('@/lib/match/use-profile-matches', () => ({
  useTeamForm: () => ({ status: 'ready', form: ['W', 'L_forfeit', 'D'], reload: jest.fn() }),
  useHeadToHead: (...args: unknown[]) => {
    mockHeadToHeadCalls.push(args);
    return {
      status: 'ready',
      record: { team_id: args[0], opponent_team_id: args[1], played: 4, won: 2, drawn: 1, lost: 1, goals_for: 9, goals_against: 7, last_3: [] },
      reload: jest.fn(),
    };
  },
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => {
  mockHeadToHeadCalls.length = 0;
  mockToggle.mockReset().mockResolvedValue({ error: null });
});

async function renderReady() {
  await render(<TeamProfileScreen />);
  await waitFor(() => expect(screen.getByText('Tigers')).toBeTruthy());
}

describe('Team profile', () => {
  it('shows the team’s form in the server’s order', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    expect(screen.getAllByTestId('form-chip').map((c) => c.props.accessibilityLabel)).toEqual([
      'won',
      'lost by forfeit',
      'drew',
    ]);
  });

  it('a viewer outside the team can follow it', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    await fireEvent.press(screen.getByText('Follow'));
    expect(mockToggle).toHaveBeenCalledWith('team', 'tigers');
  });

  it('a member of the team gets no follow button', async () => {
    mockMyTeams = { status: 'ready', teams: [{ team, role: 'player' }] };
    await renderReady();
    expect(screen.queryByTestId('follow-button')).toBeNull();
  });

  it('no head-to-head unless the viewer captains another team', async () => {
    mockMyTeams = { status: 'ready', teams: [{ team: lions, role: 'player' }] };
    await renderReady();
    expect(screen.queryByTestId('team-head-to-head')).toBeNull();
  });

  it('a captain of another team sees the head-to-head, from their team’s side', async () => {
    mockMyTeams = { status: 'ready', teams: [{ team: lions, role: 'captain' }] };
    await renderReady();
    expect(screen.getByTestId('team-head-to-head')).toBeTruthy();
    expect(mockHeadToHeadCalls.at(-1)).toEqual(['lions', 'tigers']);
    expect(screen.getByTestId('h2h-goals').props.children).toBe('9 – 7');
  });

  it('a captain of two teams picks which one', async () => {
    mockMyTeams = { status: 'ready', teams: [{ team: lions, role: 'captain' }, { team: pumas, role: 'captain' }] };
    await renderReady();
    await fireEvent.press(screen.getByText('Pumas'));
    expect(mockHeadToHeadCalls.at(-1)).toEqual(['pumas', 'tigers']);
  });
});
