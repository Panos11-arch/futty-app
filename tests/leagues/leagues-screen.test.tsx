// S9: Home → Leagues (image 12; sofascore-01, 05, 06).
import './mocks';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import LeaguesScreen from '@/app/(tabs)/leagues';
import { cyprusDateKey } from '@/lib/days';
import type { DayFixture } from '@/lib/match/day-fixtures';
import { shiftDayKey } from '@/lib/match/day-fixtures';

const g = globalThis as { mockSearchParams?: Record<string, string> };

const league = (over: Record<string, unknown>) => ({
  id: 'l1',
  name: 'Limassol 5-a-side League',
  format: '5-a-side',
  scope: 'Limassol',
  stage: 'signup',
  start_date: null,
  season_weeks: null,
  capacity: 8,
  parent_league_id: null,
  ...over,
});

const fixture = (over: Partial<DayFixture>): DayFixture => ({
  id: 'f1',
  league_id: 'l1',
  scheduled_day: '2026-11-26',
  scheduled_time: '20:00:00',
  status: 'agreed',
  home_score: null,
  away_score: null,
  forfeit_result: null,
  home_team: { id: 'ta', name: 'Lions' },
  away_team: { id: 'tb', name: 'Tigers' },
  league: { id: 'l1', name: 'Limassol 5-a-side League', format: '5-a-side', scope: 'Limassol', parent_league_id: null },
  ...over,
});

let mockLeagues: Record<string, unknown>;
let mockMyTeams: Record<string, unknown>;
let mockPremiumOn = false;
const mockLeaguesReload = jest.fn();
const mockListPins = jest.fn();
const mockPin = jest.fn();
const mockUnpin = jest.fn();
const mockFixturesOnDay = jest.fn();
const mockPinT = jest.fn();
const mockUnpinT = jest.fn();
let mockTournaments: Record<string, unknown>;
const mockTournamentsReload = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/premium', () => {
  const actual = jest.requireActual<typeof import('@/lib/premium')>('@/lib/premium');
  return {
    ...actual,
    leagueFormatOpen: (format: string, on: boolean = mockPremiumOn) => actual.leagueFormatOpen(format, on),
  };
});
jest.mock('@/lib/use-leagues', () => ({ useLeagues: () => ({ ...mockLeagues, reload: mockLeaguesReload }) }));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ ...mockMyTeams, reload: jest.fn() }) }));
jest.mock('@/lib/match/pins', () => ({
  listPins: () => mockListPins(),
  pinCompetition: (...a: unknown[]) => mockPin(...a),
  unpinCompetition: (...a: unknown[]) => mockUnpin(...a),
  pinTournament: (...a: unknown[]) => mockPinT(...a),
  unpinTournament: (...a: unknown[]) => mockUnpinT(...a),
}));
jest.mock('@/lib/match/use-tournament', () => ({
  useTournaments: () => ({ ...mockTournaments, reload: mockTournamentsReload }),
}));
jest.mock('@/lib/match/day-fixtures', () => ({
  ...jest.requireActual('@/lib/match/day-fixtures'),
  listLeagueFixturesOnDay: (day: string) => mockFixturesOnDay(day),
}));

const today = cyprusDateKey(new Date());

beforeEach(() => {
  jest.clearAllMocks();
  g.mockSearchParams = {};
  mockPremiumOn = false;
  mockLeagues = {
    status: 'ready',
    leagues: [
      league({}),
      league({ id: 'l9', format: '9-a-side', name: 'Limassol 9s', stage: 'signup' }),
      league({ id: 'n7', format: '7-a-side', scope: 'Nicosia', name: 'Nicosia 7-a-side League', stage: 'season' }),
    ],
  };
  mockMyTeams = { status: 'ready', teams: [] };
  mockListPins.mockResolvedValue({ pins: [], error: null });
  mockPin.mockResolvedValue({ error: null });
  mockUnpin.mockResolvedValue({ error: null });
  mockFixturesOnDay.mockResolvedValue({ fixtures: [], error: null });
  mockPinT.mockResolvedValue({ error: null });
  mockUnpinT.mockResolvedValue({ error: null });
  mockTournaments = { status: 'ready', tournaments: [] };
});

const tournament = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  country: 'CY',
  format: '5-a-side',
  status: 'coming_soon',
  comingSoon: true,
  startDate: null,
  endDate: null,
  venueId: null,
  venueName: null,
  maxTeams: 16,
  teamsCount: 0,
  entryFeeCents: 1200,
  championTeamId: null,
  ...over,
});

async function openLeagues() {
  await render(<LeaguesScreen />);
  await screen.findByTestId('leagues-list');
}

async function expand(scope: string) {
  await fireEvent.press(screen.getByTestId(`leagues-group-${scope}`));
}

describe('Leagues screen: header and tabs', () => {
  it('a night header with MATCHES | LEAGUES, LEAGUES first', async () => {
    await openLeagues();
    expect(screen.getByText('Leagues')).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Matches', 'Leagues']);
    expect(screen.getByTestId('leagues-tab-leagues').props.accessibilityState).toEqual({ selected: true });
  });

  it('switching tabs keeps the URL in step and keeps the other tab mounted', async () => {
    await openLeagues();
    await fireEvent.press(screen.getByTestId('leagues-tab-matches'));
    expect(router.setParams).toHaveBeenCalledWith({ tab: 'matches' });
    expect(screen.getByTestId('leagues-panel-leagues', { includeHiddenElements: true })).toBeTruthy();
    await screen.findByText('No matches');
  });

  it('?tab=matches opens on MATCHES', async () => {
    g.mockSearchParams = { tab: 'matches' };
    await render(<LeaguesScreen />);
    expect(screen.getByTestId('leagues-tab-matches').props.accessibilityState).toEqual({ selected: true });
    await screen.findByText('No matches');
  });
});

describe('LEAGUES tab', () => {
  it('loading shows a skeleton', async () => {
    mockLeagues = { status: 'loading' };
    await render(<LeaguesScreen />);
    expect(screen.getByTestId('leagues-skeleton')).toBeTruthy();
  });

  it('error: one line, and Try again loads leagues and pins again', async () => {
    mockLeagues = { status: 'error', message: 'offline' };
    await render(<LeaguesScreen />);
    expect(screen.getByText('Could not load leagues.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockLeaguesReload).toHaveBeenCalled();
    expect(mockListPins).toHaveBeenCalledTimes(2);
  });

  it('a pins error is a load error too', async () => {
    mockListPins.mockResolvedValueOnce({ pins: [], error: 'offline' });
    await render(<LeaguesScreen />);
    await screen.findByText('Could not load leagues.');
  });

  it('All: the Cyprus Open League, then each city with a league; no Pinned while nothing is pinned', async () => {
    await openLeagues();
    expect(screen.queryByText('PINNED (0)')).toBeNull();
    expect(screen.getByText('ALL')).toBeTruthy();
    expect(screen.getByText('Cyprus Open League')).toBeTruthy();
    expect(screen.getByText('Island-wide · Coming soon')).toBeTruthy();
    const groups = screen.getAllByTestId(/^leagues-group-/).map((g) => g.props.testID);
    expect(groups).toEqual(['leagues-group-island-wide', 'leagues-group-nicosia', 'leagues-group-limassol']);
    expect(screen.getAllByText('5 leagues')).toHaveLength(2);
  });

  it('a city opens to all five formats, each with its name and stage, and closes again', async () => {
    await openLeagues();
    await expand('limassol');
    expect(screen.getByTestId('leagues-group-limassol').props.accessibilityState).toEqual({ expanded: true });
    expect(screen.getByText('Limassol 5-a-side League · Sign-up open')).toBeTruthy();
    expect(screen.getByText('Limassol 6-a-side League · Coming soon')).toBeTruthy();
    expect(screen.getByText('Limassol 7-a-side League · Coming soon')).toBeTruthy();
    for (const format of ['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side']) {
      expect(screen.getByTestId(`leagues-row-child-limassol-${format}`)).toBeTruthy();
    }
    await expand('limassol');
    expect(screen.queryByTestId('leagues-row-child-limassol-5-a-side')).toBeNull();
  });

  it('9 and 11-a-side show Coming soon while Team Premium is off, even with a league in sign-up', async () => {
    await openLeagues();
    await expand('limassol');
    expect(screen.getByText('Limassol 9s · Coming soon')).toBeTruthy();
    expect(screen.getByText('Limassol 11-a-side League · Coming soon')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('leagues-row-child-limassol-9-a-side'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/leagues/coming-soon',
      params: { name: 'Limassol 9s', scope: 'limassol', format: '9-a-side' },
    });
  });

  it('with Team Premium on, a 9-a-side league in sign-up opens its page', async () => {
    mockPremiumOn = true;
    await openLeagues();
    await expand('limassol');
    expect(screen.getByText('Limassol 9s · Sign-up open')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('leagues-row-child-limassol-9-a-side'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/[id]', params: { id: 'l9' } });
  });

  it('a format with no season opens Coming soon with its name, city and format', async () => {
    await openLeagues();
    await expand('nicosia');
    await fireEvent.press(screen.getByTestId('leagues-row-child-nicosia-5-a-side'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/leagues/coming-soon',
      params: { name: 'Nicosia 5-a-side League', scope: 'nicosia', format: '5-a-side' },
    });
  });

  it('a league in sign-up or running opens its page', async () => {
    await openLeagues();
    await expand('nicosia');
    await fireEvent.press(screen.getByTestId('leagues-row-child-nicosia-7-a-side'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/[id]', params: { id: 'n7' } });
  });

  it('Pin saves on the server, shows Pinned (1) at once, and Pinned closes and opens', async () => {
    await openLeagues();
    await expand('limassol');
    await fireEvent.press(screen.getByTestId('leagues-pin-child-limassol-5-a-side'));
    expect(mockPin).toHaveBeenCalledWith('limassol', '5-a-side');
    expect(screen.getByText('PINNED (1)')).toBeTruthy();
    expect(screen.getByTestId('leagues-row-pinned-limassol-5-a-side')).toBeTruthy();
    // In Pinned and in the city: one pin, shown twice.
    expect(screen.getAllByRole('button', { name: 'Unpin Limassol 5-a-side League' })).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('leagues-pinned-toggle'));
    expect(screen.queryByTestId('leagues-row-pinned-limassol-5-a-side')).toBeNull();
    await fireEvent.press(screen.getByTestId('leagues-pinned-toggle'));
    expect(screen.getByTestId('leagues-row-pinned-limassol-5-a-side')).toBeTruthy();
  });

  it('Unpin from Pinned removes it; a refused unpin puts it back with one line', async () => {
    mockListPins.mockResolvedValue({ pins: [{ target_type: 'league', scope: 'limassol', format: '5-a-side' }], error: null });
    mockUnpin.mockResolvedValueOnce({ error: 'offline' });
    await openLeagues();
    await fireEvent.press(screen.getByTestId('leagues-pin-pinned-limassol-5-a-side'));
    expect(mockUnpin).toHaveBeenCalledWith('limassol', '5-a-side');
    await screen.findByText('Could not save your pin. Try again.');
    expect(screen.getByText('PINNED (1)')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('leagues-pin-pinned-limassol-5-a-side'));
    await waitFor(() => expect(screen.queryByText('PINNED (1)')).toBeNull());
  });

  it('Matchmaking stays reachable', async () => {
    await openLeagues();
    await fireEvent.press(screen.getByTestId('leagues-matchmaking'));
    expect(router.push).toHaveBeenCalledWith('/matchmaking');
  });

  it('pull to refresh reloads leagues and pins', async () => {
    await openLeagues();
    const list = screen.getByTestId('leagues-list');
    await fireEvent(list, 'refresh');
    expect(mockLeaguesReload).toHaveBeenCalled();
    expect(mockListPins).toHaveBeenCalledTimes(2);
  });

  it('no tournaments or EFEK until they exist', async () => {
    await openLeagues();
    expect(screen.queryByText('Tournaments')).toBeNull();
    expect(screen.queryByText('EFEK')).toBeNull();
  });
});

describe('LEAGUES tab: tournaments (S10A)', () => {
  it('a tournaments error is a load error; Try again reloads them', async () => {
    mockTournaments = { status: 'error', message: 'offline' };
    await render(<LeaguesScreen />);
    expect(screen.getByText('Could not load leagues.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockTournamentsReload).toHaveBeenCalled();
  });

  it('loading tournaments shows the skeleton', async () => {
    mockTournaments = { status: 'loading' };
    await render(<LeaguesScreen />);
    expect(screen.getByTestId('leagues-skeleton')).toBeTruthy();
  });

  it('the Tournaments group, last, opens to its tournaments (image 12)', async () => {
    mockTournaments = { status: 'ready', tournaments: [tournament()] };
    await openLeagues();
    expect(screen.getByText('Tournaments')).toBeTruthy();
    expect(screen.getByText('1 coming soon')).toBeTruthy();
    expect(screen.queryByTestId('leagues-row-child-tournament-t1')).toBeNull();
    await expand('tournaments');
    expect(within(screen.getByTestId('leagues-row-child-tournament-t1')).getByText('Tournament · Coming soon')).toBeTruthy();
  });

  it('a Coming soon tournament opens Coming soon with 16 teams', async () => {
    mockTournaments = { status: 'ready', tournaments: [tournament()] };
    await openLeagues();
    await expand('tournaments');
    await fireEvent.press(screen.getByTestId('leagues-row-child-tournament-t1'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/leagues/coming-soon',
      params: { kind: 'tournament', name: 'Nuevo Campo Cup', scope: 'limassol', format: '5-a-side', teams: '16' },
    });
  });

  it('once sign-up opens, a tournament opens its page', async () => {
    mockTournaments = { status: 'ready', tournaments: [tournament({ status: 'registration', comingSoon: false })] };
    await openLeagues();
    await expand('tournaments');
    expect(screen.getByText('Tournament · Sign-up open')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('leagues-row-child-tournament-t1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/tournament/[id]', params: { id: 't1' } });
  });

  it('Pin saves a tournament pin and shows it under Pinned; unpin removes it', async () => {
    mockTournaments = { status: 'ready', tournaments: [tournament()] };
    await openLeagues();
    await expand('tournaments');
    await fireEvent.press(screen.getByTestId('leagues-pin-child-tournament-t1'));
    expect(mockPinT).toHaveBeenCalledWith('t1');
    expect(mockPin).not.toHaveBeenCalled();
    expect(screen.getByText('PINNED (1)')).toBeTruthy();
    const pinned = screen.getByTestId('leagues-row-pinned-tournament-t1');
    expect(within(pinned).getByText('Nuevo Campo Cup')).toBeTruthy();
    expect(within(pinned).getByText('NC', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('leagues-pin-pinned-tournament-t1'));
    expect(mockUnpinT).toHaveBeenCalledWith('t1');
    expect(screen.queryByTestId('leagues-row-pinned-tournament-t1')).toBeNull();
  });

  it('a tournament pin from the server shows beside league pins', async () => {
    mockTournaments = { status: 'ready', tournaments: [tournament()] };
    mockListPins.mockResolvedValue({
      pins: [
        { target_type: 'league', scope: 'limassol', format: '5-a-side' },
        { target_type: 'tournament', tournament_id: 't1' },
      ],
      error: null,
    });
    await openLeagues();
    expect(screen.getByText('PINNED (2)')).toBeTruthy();
    expect(screen.getByTestId('leagues-row-pinned-limassol-5-a-side')).toBeTruthy();
    expect(screen.getByTestId('leagues-row-pinned-tournament-t1')).toBeTruthy();
  });

  it('pull to refresh reloads tournaments too', async () => {
    await openLeagues();
    await fireEvent(screen.getByTestId('leagues-list'), 'refresh');
    expect(mockTournamentsReload).toHaveBeenCalled();
  });
});

describe('MATCHES tab', () => {
  async function openMatches() {
    g.mockSearchParams = { tab: 'matches' };
    await render(<LeaguesScreen />);
  }

  it('loading shows a skeleton', async () => {
    mockFixturesOnDay.mockReturnValue(new Promise(() => {}));
    await openMatches();
    expect(screen.getByTestId('matches-skeleton')).toBeTruthy();
    expect(mockFixturesOnDay).toHaveBeenCalledWith(today);
  });

  it('error: one line and Try again', async () => {
    mockFixturesOnDay.mockResolvedValueOnce({ fixtures: [], error: 'offline' });
    await openMatches();
    await screen.findByText('Could not load matches.');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No matches');
  });

  it('empty: one line and Next day', async () => {
    await openMatches();
    await screen.findByText('No matches');
    const buttons = screen.getAllByRole('button', { name: 'Next day' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockFixturesOnDay).toHaveBeenLastCalledWith(shiftDayKey(today, 1)));
  });

  it('◂ Today ▸ moves a day at a time', async () => {
    await openMatches();
    await screen.findByText('No matches');
    expect(screen.getByText('Today')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('matches-day-prev'));
    await waitFor(() => expect(mockFixturesOnDay).toHaveBeenLastCalledWith(shiftDayKey(today, -1)));
    await fireEvent.press(screen.getByTestId('matches-day-next'));
    await fireEvent.press(screen.getByTestId('matches-day-next'));
    await waitFor(() => expect(mockFixturesOnDay).toHaveBeenLastCalledWith(shiftDayKey(today, 1)));
  });

  it('the day opens a date picker', async () => {
    await openMatches();
    await screen.findByText('No matches');
    await fireEvent.press(screen.getByTestId('matches-day'));
    expect(screen.getByText('Pick a day')).toBeTruthy();
  });

  it('fixtures by competition: badge, name, area, star; time or FT, both teams and scores; my teams first', async () => {
    mockMyTeams = { status: 'ready', teams: [{ team: { id: 'mine', name: 'Mine FC' }, role: 'captain' }] };
    mockFixturesOnDay.mockResolvedValue({
      fixtures: [
        fixture({ id: 'a', status: 'completed', home_score: 3, away_score: 1 }),
        fixture({
          id: 'b',
          scheduled_time: '18:30:00',
          home_team: { id: 'mine', name: 'Mine FC' },
          league: { id: 'n7', name: 'Nicosia 7-a-side League', format: '7-a-side', scope: 'Nicosia', parent_league_id: null },
        }),
      ],
      error: null,
    });
    await openMatches();
    await screen.findByTestId('matches-list');
    const groups = screen.getAllByTestId(/^matches-group-/).map((g) => g.props.testID);
    expect(groups).toEqual(['matches-group-league:nicosia:7-a-side', 'matches-group-league:limassol:5-a-side']);
    const limassol = within(screen.getByTestId('matches-group-league:limassol:5-a-side'));
    expect(limassol.getByText('Limassol 5-a-side League')).toBeTruthy();
    expect(limassol.getByText('Limassol')).toBeTruthy();
    expect(limassol.getByText('FT')).toBeTruthy();
    expect(limassol.getByText('3')).toBeTruthy();
    expect(screen.getByText('18:30')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Full time, Lions v Tigers, 3 1' })).toBeTruthy();
  });

  it('a team name opens the team; the row opens the fixture', async () => {
    mockFixturesOnDay.mockResolvedValue({ fixtures: [fixture({})], error: null });
    await openMatches();
    await fireEvent.press(await screen.findByTestId('matches-team-tb'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'tb' } });
    await fireEvent.press(screen.getByTestId('matches-fixture-f1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fixture-chat', params: { fixtureId: 'f1' } });
  });

  it('the star and the Pin on LEAGUES change the same pin', async () => {
    mockFixturesOnDay.mockResolvedValue({ fixtures: [fixture({})], error: null });
    await openMatches();
    await fireEvent.press(await screen.findByTestId('matches-star-league:limassol:5-a-side'));
    expect(mockPin).toHaveBeenCalledWith('limassol', '5-a-side');
    expect(screen.getByRole('button', { name: 'Unpin Limassol 5-a-side League' })).toBeTruthy();

    await fireEvent.press(screen.getByTestId('leagues-tab-leagues'));
    expect(screen.getByText('PINNED (1)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('leagues-pin-pinned-limassol-5-a-side'));
    expect(mockUnpin).toHaveBeenCalledWith('limassol', '5-a-side');
    await fireEvent.press(screen.getByTestId('leagues-tab-matches'));
    expect(screen.getByRole('button', { name: 'Pin Limassol 5-a-side League' })).toBeTruthy();
  });

  it('Filter by format and city; Clear shows everything again', async () => {
    mockFixturesOnDay.mockResolvedValue({
      fixtures: [
        fixture({ id: 'a' }),
        fixture({ id: 'b', league: { id: 'n7', name: 'N', format: '7-a-side', scope: 'Nicosia', parent_league_id: null } }),
      ],
      error: null,
    });
    await openMatches();
    await screen.findByTestId('matches-list');
    await fireEvent.press(screen.getByTestId('matches-filter'));
    await fireEvent.press(screen.getByTestId('matches-filter-format-7-a-side'));
    await fireEvent.press(screen.getByTestId('matches-filter-apply'));
    expect(screen.queryByTestId('matches-fixture-a')).toBeNull();
    expect(screen.getByTestId('matches-fixture-b')).toBeTruthy();
    expect(screen.getByText('Filter (1)')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('matches-filter'));
    await fireEvent.press(screen.getByTestId('matches-filter-format-all'));
    await fireEvent.press(screen.getByTestId('matches-filter-city-limassol'));
    await fireEvent.press(screen.getByTestId('matches-filter-apply'));
    expect(screen.getByTestId('matches-fixture-a')).toBeTruthy();
    expect(screen.queryByTestId('matches-fixture-b')).toBeNull();

    await fireEvent.press(screen.getByTestId('matches-filter'));
    await fireEvent.press(screen.getByTestId('matches-filter-clear'));
    expect(screen.getByTestId('matches-fixture-b')).toBeTruthy();
    expect(screen.getByTestId('matches-filter').props.accessibilityLabel).toBe('Filter');
  });

  it('no Live toggle and no bell (match alerts are not specified yet)', async () => {
    mockFixturesOnDay.mockResolvedValue({ fixtures: [fixture({})], error: null });
    await openMatches();
    await screen.findByTestId('matches-list');
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByLabelText(/alert|bell|follow/i)).toBeNull();
  });
});

describe('Words', () => {
  it('buttons and tabs are 1-3 words', async () => {
    mockFixturesOnDay.mockResolvedValue({ fixtures: [], error: null });
    await openLeagues();
    await fireEvent.press(screen.getByTestId('leagues-tab-matches'));
    await screen.findByText('No matches');
    const labels = [
      ...screen.getAllByRole('tab'),
      screen.getByTestId('matches-filter'),
      ...screen.getAllByRole('button', { name: 'Next day' }),
      screen.getByTestId('matches-day-prev'),
    ].map((el) => el.props.accessibilityLabel as string);
    for (const label of labels) expect(label.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
  });
});
