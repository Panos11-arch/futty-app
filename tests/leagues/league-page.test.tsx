// The temporary league page (S9, until S10): the old Play → Leagues
// standings and join flow, moved unchanged, for one league.
import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import LeaguePage from '@/app/(tabs)/leagues/[id]';
import { StandingsTable } from '@/components/match/league-sections';
import { colors } from '@/constants/futty-theme';
import type { StandingsRow } from '@/lib/use-league-standings';

const g = globalThis as { mockSearchParams?: Record<string, string> };

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
const mockLeaguesReload = jest.fn();
const mockCreateTeam = jest.fn();

jest.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    in: () => Promise.resolve({ data: [{ team_id: 'mine' }] }),
  };
  return { supabase: { from: () => chain } };
});
jest.mock('@/lib/use-leagues', () => ({ useLeagues: () => ({ ...mockLeagues, reload: mockLeaguesReload }) }));
jest.mock('@/lib/use-league-standings', () => ({
  useLeagueStandings: (id: string) => ({ ...(mockStandings[id] ?? { status: 'loading' }), reload: jest.fn() }),
}));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ ...mockMyTeams, reload: jest.fn() }) }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/lib/leagues', () => ({ registerTeamForLeague: jest.fn(), startLeagueSeason: jest.fn() }));
jest.mock('@/lib/teams', () => ({
  ...jest.requireActual('@/lib/teams'),
  createTeam: (...args: unknown[]) => mockCreateTeam(...args),
  getTeamRoster: () => Promise.resolve({ data: [] }),
}));
jest.mock('@/components/messages/message-captain', () => ({ MessageCaptainButton: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  g.mockSearchParams = { id: 'L1' };
  mockLeagues = { status: 'ready', leagues: [islandLeague, nicosiaHub] };
  mockStandings = {
    L1: { status: 'ready', rows: [row('mine', 'Tigers', 3), row('other', 'Lions', 1)] },
    L2: { status: 'ready', rows: [] },
  };
  mockMyTeams = { status: 'ready', teams: [] };
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

describe('League page', () => {
  it('loading shows a skeleton', async () => {
    mockLeagues = { status: 'loading' };
    await render(<LeaguePage />);
    expect(screen.getByTestId('league-page-skeleton')).toBeTruthy();
  });

  it('error: one line and Try again reloads', async () => {
    mockLeagues = { status: 'error', message: 'offline' };
    await render(<LeaguePage />);
    expect(screen.getByText('Could not load this league.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockLeaguesReload).toHaveBeenCalled();
  });

  it('a league that no longer exists: one line and Back to leagues', async () => {
    g.mockSearchParams = { id: 'gone' };
    await render(<LeaguePage />);
    expect(screen.getByText('League not found')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Back to leagues' })[0]);
    expect(router.back).toHaveBeenCalled();
  });

  it('an island-wide league: its name, area and stage in the header, the table, and Your fixtures', async () => {
    await render(<LeaguePage />);
    expect(screen.getByText('5-a-side Island League')).toBeTruthy();
    expect(screen.getByText('Island-wide · 5-a-side league · In season')).toBeTruthy();
    expect(screen.getAllByTestId('standings-row')).toHaveLength(2);
    await fireEvent.press(screen.getByRole('button', { name: 'Your fixtures' }));
    expect(router.push).toHaveBeenCalledWith('/upcoming-fixtures');
    await fireEvent.press(screen.getByRole('button', { name: 'Back to Leagues' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('highlights only the user’s own team', async () => {
    mockStandings.L1 = { status: 'ready', rows: [row('mine', 'Tigers', 3), row('other', 'Lions', 1), row('third', 'Bears', 2)] };
    mockMyTeams = { status: 'ready', teams: [{ team: { id: 'mine', name: 'Tigers' }, role: 'player' }] };
    await render(<LeaguePage />);
    const mine = screen.getAllByTestId('standings-row-mine');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveTextContent(/Tigers/);
    expect(background('standings-row')).toEqual([undefined, undefined]);
  });

  it('a city hub in sign-up: the join flow creates a team with the same arguments', async () => {
    g.mockSearchParams = { id: 'L2' };
    mockCreateTeam.mockResolvedValue({ data: null, error: { message: 'x', code: 'P0001' } });
    await render(<LeaguePage />);
    expect(screen.getByText('Nicosia Open')).toBeTruthy();
    expect(screen.getByText('Open for signups · 8 spots')).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: 'Register a new team' }));
    await fireEvent.changeText(screen.getByLabelText('Team name'), '  Pumas ');
    await fireEvent.press(screen.getAllByRole('button', { name: '2' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(mockCreateTeam).toHaveBeenCalledWith('Pumas', 'Nicosia', 5, 2));
  });
});
