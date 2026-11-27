import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import TeamProfileScreen from '@/app/team-profile';
import { testIdsInOrder } from '../ads/test-ids';

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
let mockTeamRow: Record<string, unknown> = team;
const mockCompetitions = jest.fn();

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
    maybeSingle: () => Promise.resolve({ data: mockTeamRow, error: null }),
  };
  return { supabase: { from: () => query } };
});
jest.mock('@/lib/teams', () => ({
  ...jest.requireActual('@/lib/teams'),
  fetchTeamCompetitions: (...a: unknown[]) => mockCompetitions(...a),
  getTeamRoster: () =>
    Promise.resolve({
      data: [
        { profile_id: 'a', username: 'ann', full_name: null, role: 'captain', avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null },
        { profile_id: 'b', username: 'bea', full_name: 'Bea Kyprianou', role: 'player', avatar_style: 'kit', avatar_kit_colour: 'kitGreen', avatar_number: 7 },
      ],
      error: null,
    }),
}));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => mockMyTeams }));
// G4a: the shared banner as a marker (its own rules: components/ads/ad-banner.test.tsx).
jest.mock('@/components/ads/ad-banner', () => jest.requireActual('../ads/test-ids').adBannerMarker());
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
const mockSeasonCalls: unknown[][] = [];
const mockPowerCalls: string[] = [];
let mockPower: Record<string, unknown> = { status: 'ready', rows: [], reload: jest.fn() };
jest.mock('@/lib/match/use-stats', () => ({
  useTeamSeasonStats: (...args: unknown[]) => {
    mockSeasonCalls.push(args);
    return {
      status: 'ready',
      stats: {
        played: 8,
        won: 5,
        drawn: 1,
        lost: 2,
        win_pct: 63,
        goals_for: 11,
        goals_against: 6,
        clean_sheets: 2,
        longest_win_run: 3,
        motm: 1,
        average_rating: 7,
      },
      reload: jest.fn(),
    };
  },
  useTeamRecentMatches: () => ({ status: 'ready', rows: [], reload: jest.fn() }),
  useTeamPowerRanking: (teamId: string) => {
    mockPowerCalls.push(teamId);
    return mockPower;
  },
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => {
  mockHeadToHeadCalls.length = 0;
  mockPowerCalls.length = 0;
  mockPower = { status: 'ready', rows: [], reload: jest.fn() };
  mockToggle.mockReset().mockResolvedValue({ error: null });
  mockTeamRow = team;
  mockCompetitions.mockReset().mockResolvedValue([]);
});

async function renderReady() {
  await render(<TeamProfileScreen />);
  await waitFor(() => expect(screen.getByText('Tigers')).toBeTruthy());
}

describe('Team profile', () => {
  it('A12: the roster shows each player’s kit avatar, and initials for the rest', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await render(<TeamProfileScreen />);
    expect(await screen.findByLabelText('Bea Kyprianou, shirt 7')).toBeTruthy();
    expect(screen.getAllByTestId('avatar-kit')).toHaveLength(1);
    expect(screen.getByLabelText('ann')).toBeTruthy();
  });

  it('shows the team’s form in the server’s order', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    expect(screen.getAllByTestId('form-chip').map((c) => c.props.accessibilityLabel)).toEqual([
      'won',
      'lost by forfeit',
      'drew',
    ]);
  });

  it('A7: the season from team_season_stats, not the old counters; this year, then all time', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    expect(screen.getByLabelText('Win rate 63%')).toBeTruthy();
    expect(screen.getByLabelText('Best run 3 wins')).toBeTruthy();
    expect(screen.queryByLabelText('Win rate 50%')).toBeNull();
    expect(mockSeasonCalls.at(-1)).toEqual(['tigers', { kind: 'year', year: expect.any(Number) }]);
    await fireEvent.press(screen.getByText('All time'));
    expect(mockSeasonCalls.at(-1)).toEqual(['tigers', { kind: 'all' }]);
    expect(screen.getByText('No confirmed matches yet')).toBeTruthy();
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

  it('S15: its power ranking position in each format where it is listed; a row opens that ranking', async () => {
    const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
    router.push.mockClear();
    mockMyTeams = { status: 'ready', teams: [] };
    mockPower = {
      status: 'ready',
      rows: [
        { format: '5-a-side', rank: 3, points: 1012.4, matches: 5 },
        { format: '9-a-side', rank: 1, points: 1046.6, matches: 4 },
      ],
      reload: jest.fn(),
    };
    await renderReady();
    expect(mockPowerCalls).toContain('tigers');
    expect(screen.getByText('Power ranking')).toBeTruthy();
    expect(screen.getByText('#3 · 1012')).toBeTruthy();
    expect(screen.getByText('#1 · 1047')).toBeTruthy();
    expect(screen.getByLabelText('5-a-side: number 3, 1012 points')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('team-power-ranking-9'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/rankings', params: { view: 'power', format: '9-a-side' } });
  });

  it('S15: no power ranking section when the team is listed nowhere', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    expect(screen.queryByTestId('team-power-ranking')).toBeNull();
  });

  it('S15: the power ranking can fail on its own, with Try again', async () => {
    const reload = jest.fn();
    mockMyTeams = { status: 'ready', teams: [] };
    mockPower = { status: 'error', message: 'boom', reload };
    await renderReady();
    await fireEvent.press(screen.getByText('Try again'));
    expect(reload).toHaveBeenCalled();
  });

  it('G4a: another team’s page ends with a banner ad', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    const ids = testIdsInOrder();
    expect(ids).toContain('team-profile-ad');
    expect(ids[ids.length - 1]).toBe('team-profile-ad');
  });

  it('S20A: the team badge in its kit colour', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    mockTeamRow = { ...team, kit_colour: 'kitSky' };
    await renderReady();
    expect(screen.getByTestId('team-badge')).toBeTruthy();
  });

  it('S20A: a member opens their profile', async () => {
    const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
    router.push.mockClear();
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    await fireEvent.press(screen.getByRole('button', { name: 'Bea Kyprianou, Player' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'b' } });
  });

  it('S20A: Leagues lists where it plays; a row opens the competition', async () => {
    const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
    router.push.mockClear();
    mockMyTeams = { status: 'ready', teams: [] };
    mockCompetitions.mockResolvedValue([
      { league_id: 'l1', name: 'Nicosia 5s', format: '5-a-side', running: true },
      { league_id: 'l2', name: 'Paphos 7s', format: '7-a-side', running: false },
    ]);
    await renderReady();
    expect(await screen.findByText('Leagues')).toBeTruthy();
    expect(mockCompetitions).toHaveBeenCalledWith('tigers');
    await fireEvent.press(screen.getByTestId('team-league-l1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/[id]', params: { id: 'l1' } });
    expect(screen.getByText('Paphos 7s')).toBeTruthy();
  });

  it('S20A: no Leagues section when it plays in none', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await renderReady();
    await waitFor(() => expect(mockCompetitions).toHaveBeenCalled());
    expect(screen.queryByText('Leagues')).toBeNull();
  });

  it('S20A: Leagues can fail on its own, with Try again', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    mockCompetitions.mockRejectedValueOnce(new Error("Couldn't load. Try again."));
    await renderReady();
    expect(await screen.findByText("Couldn't load. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId('team-leagues-retry'));
    await waitFor(() => expect(mockCompetitions).toHaveBeenCalledTimes(2));
  });

  it('S20A: a deleted team shows its history read-only, with no Follow', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    mockTeamRow = { ...team, deleted_at: '2026-11-27T10:00:00Z' };
    await renderReady();
    expect(screen.getByText('Deleted team')).toBeTruthy();
    expect(screen.queryByTestId('follow-button')).toBeNull();
    expect(screen.getByText('Recent matches')).toBeTruthy();
    expect(mockCompetitions).not.toHaveBeenCalled();
  });

  it('G4a: never on a team the viewer plays for, nor before that is known', async () => {
    mockMyTeams = { status: 'ready', teams: [{ team, role: 'player' }] };
    await renderReady();
    expect(screen.queryByTestId('team-profile-ad')).toBeNull();
    mockMyTeams = { status: 'loading' };
    await renderReady();
    expect(screen.queryByTestId('team-profile-ad')).toBeNull();
  });
});
