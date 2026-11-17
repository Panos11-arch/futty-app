import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { LeaguesContent, StandingsTable } from '@/app/(tabs)/leagues';
import { colors } from '@/constants/futty-theme';
import type { StandingsRow } from '@/lib/use-league-standings';

const row = (id: string, name: string, won: number): StandingsRow => ({
  id: `row-${id}`,
  league_id: 'L1',
  team_id: id,
  team_name: name,
  team_city: 'Nicosia',
  played: 4,
  won,
  drawn: 1,
  lost: 3 - won,
  goals_for: 9,
  goals_against: 11,
  pts_adjustment: 0,
});

const islandLeague = {
  id: 'L1',
  name: '5-a-side Island League',
  format: '5-a-side',
  scope: 'Island-wide',
  stage: 'season',
  start_date: null,
  season_weeks: null,
  capacity: 0,
  parent_league_id: null,
};
const nicosiaHub = { ...islandLeague, id: 'L2', name: 'Nicosia Open', scope: 'Nicosia', stage: 'signup', capacity: 8 };

let mockLeagues: Record<string, unknown>;
let mockStandings: Record<string, Record<string, unknown>>;
let mockMyTeams: Record<string, unknown>;
let mockFixtures: Record<string, unknown>[] = [];
const mockLeaguesReload = jest.fn();
const mockStandingsReload = jest.fn();
const mockCreateTeam = jest.fn();
const mockRegister = jest.fn();

jest.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    in: () => Promise.resolve({ data: [{ team_id: 'mine' }] }),
  };
  return { supabase: { from: () => chain } };
});
jest.mock('@/lib/use-leagues', () => ({ useLeagues: () => ({ ...mockLeagues, reload: mockLeaguesReload }) }));
jest.mock('@/lib/use-league-standings', () => ({
  useLeagueStandings: (id: string) => ({ ...(mockStandings[id] ?? { status: 'loading' }), reload: mockStandingsReload }),
}));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ ...mockMyTeams, reload: jest.fn() }) }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/lib/use-fixtures', () => ({
  useMyFixtures: () => ({ status: 'ready', fixtures: mockFixtures, reload: jest.fn() }),
  useMyCaptainTeamIds: () => new Set<string>(),
}));
jest.mock('@/lib/leagues', () => ({
  registerTeamForLeague: (...args: unknown[]) => mockRegister(...args),
  startLeagueSeason: jest.fn(),
}));
jest.mock('@/lib/teams', () => ({
  ...jest.requireActual('@/lib/teams'),
  createTeam: (...args: unknown[]) => mockCreateTeam(...args),
  getTeamRoster: () => Promise.resolve({ data: [] }),
}));
jest.mock('@/components/match/fixture-score-entry', () => ({ FixtureScoreEntry: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockLeagues = { status: 'ready', leagues: [islandLeague, nicosiaHub] };
  mockStandings = {
    L1: { status: 'ready', rows: [row('mine', 'Tigers', 3), row('other', 'Lions', 1)] },
    L2: { status: 'ready', rows: [] },
  };
  mockMyTeams = { status: 'ready', teams: [] };
  mockFixtures = [];
});

function background(testID: string) {
  return screen.getAllByTestId(testID).map((r) => StyleSheet.flatten(r.props.style).backgroundColor);
}

describe('StandingsTable', () => {
  it('highlights the given team with brandSoft and nothing else', async () => {
    await render(<StandingsTable rows={[row('mine', 'Tigers', 3), row('other', 'Lions', 1)]} highlightTeamIds={new Set(['mine'])} />);
    expect(screen.getAllByTestId('standings-row-mine')).toHaveLength(1);
    expect(background('standings-row-mine')).toEqual([colors.brandSoft]);
    expect(background('standings-row')).toEqual([undefined]);
  });

  it('shows points and goal difference as before, in aligned tabular columns', async () => {
    await render(<StandingsTable rows={[row('mine', 'Tigers', 3)]} highlightTeamIds={new Set()} />);
    expect(screen.getByText('10')).toBeTruthy(); // 3 won x 3 + 1 drawn
    expect(screen.getByText('-2')).toBeTruthy();
    for (const label of ['P', 'W', 'D', 'L', 'F', 'A', 'GD', 'Pts']) expect(screen.getByText(label)).toBeTruthy();
    const pts = StyleSheet.flatten(screen.getByText('10').props.style);
    expect(pts.fontVariant).toEqual(['tabular-nums']);
    expect(pts.textAlign).toBe('right');
  });

  it('says so when no team is registered', async () => {
    await render(<StandingsTable rows={[]} highlightTeamIds={new Set()} />);
    expect(screen.getByText('No teams registered yet.')).toBeTruthy();
  });
});

describe('Leagues segment', () => {
  it('loading shows a skeleton', async () => {
    mockLeagues = { status: 'loading' };
    const view = await render(<LeaguesContent />);
    expect(screen.getByTestId('leagues-skeleton')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('error retries the same load', async () => {
    mockLeagues = { status: 'error', message: 'offline' };
    await render(<LeaguesContent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockLeaguesReload).toHaveBeenCalled();
  });

  it('empty: no league for the format or city', async () => {
    mockLeagues = { status: 'ready', leagues: [] };
    const view = await render(<LeaguesContent />);
    expect(screen.getByText('No 5-a-side league found yet.')).toBeTruthy();
    expect(screen.getByText('No Nicosia league found yet.')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('populated: tables and the same navigation', async () => {
    mockFixtures = [
      { id: 'f1', status: 'unscheduled', home_team: { name: 'Tigers' }, away_team: { name: 'Lions' }, home_team_id: 'mine', away_team_id: 'other' },
    ];
    const view = await render(<LeaguesContent />);
    await waitFor(() => expect(screen.getByText('Nicosia Open')).toBeTruthy());
    expect(screen.getByText('5-a-side Island League')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();

    await fireEvent.press(screen.getByRole('button', { name: 'Matchmaking' }));
    expect(router.push).toHaveBeenCalledWith('/matchmaking');
    await fireEvent.press(screen.getByRole('button', { name: 'Upcoming fixtures' }));
    expect(router.push).toHaveBeenCalledWith('/upcoming-fixtures');
  });

  it('creates a team with the same arguments', async () => {
    mockCreateTeam.mockResolvedValue({ data: null, error: { message: 'x', code: 'P0001' } });
    await render(<LeaguesContent />);
    const register = await screen.findAllByRole('button', { name: 'Register a new team' });
    await fireEvent.press(register[0]);
    await fireEvent.changeText(screen.getByLabelText('Team name'), '  Pumas ');
    await fireEvent.press(screen.getAllByRole('button', { name: '2' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(mockCreateTeam).toHaveBeenCalledWith('Pumas', 'Nicosia', 5, 2));
  });
});
