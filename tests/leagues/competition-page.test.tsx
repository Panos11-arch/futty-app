// S10: the competition page (image 13; SofaScore 07-20) on the server's
// reads. Every tab: loading, empty, error and data; every tap goes where it
// should. The message button on a fixture row shows only where the captain
// chat would open (not to a minor's captain, not across a block).
import './mocks';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Modal } from 'react-native';

import CompetitionPage, { competitionSubtitle } from '@/app/(tabs)/leagues/[id]';
import { seasonStatus } from '@/components/competition/overview-tab';
import { loadWithFile } from '@/components/ui/test-utils';
import type {
  Competition,
  CompetitionAwards,
  CompetitionMatch,
  CompetitionPowerRow,
  CompetitionStandings,
  PlayerStatRow,
  StatsCategory,
} from '@/lib/match/competition-api';

loadWithFile(Modal);

const g = globalThis as { mockSearchParams?: Record<string, string> };

type HookState = Record<string, unknown>;
const mockState: {
  competition: HookState;
  standings: HookState;
  matches: HookState;
  playerStats: HookState;
  stats: HookState;
  statsAll: HookState;
  awards: HookState;
  power: HookState;
  contacts: unknown[];
} = {} as never;
const mockArgs: Record<string, unknown[][]> = {};
const mockReload = jest.fn(() => Promise.resolve());
const track = (name: string, args: unknown[]) => {
  (mockArgs[name] ??= []).push(args);
};

jest.mock('@/lib/match/use-competition', () => ({
  useCompetition: (...a: unknown[]) => (track('competition', a), { ...mockState.competition, reload: mockReload }),
  useCompetitionStandings: (...a: unknown[]) => (track('standings', a), { ...mockState.standings, reload: mockReload }),
  useCompetitionMatches: (...a: unknown[]) => (track('matches', a), { ...mockState.matches, reload: mockReload }),
  useCompetitionPlayerStats: (...a: unknown[]) => (track('playerStats', a), { ...mockState.playerStats, reload: mockReload }),
  useCompetitionStats: (...a: unknown[]) => (
    track('stats', a), { ...(a[2] ? mockState.statsAll : mockState.stats), reload: mockReload }
  ),
  useCompetitionAwards: (...a: unknown[]) => (track('awards', a), { ...mockState.awards, reload: mockReload }),
  useCompetitionPowerRanking: (...a: unknown[]) => (track('power', a), { ...mockState.power, reload: mockReload }),
  useCaptainContacts: (...a: unknown[]) => (track('contacts', a), mockState.contacts),
}));

const mockToggle = jest.fn();
let mockPinned = false;
jest.mock('@/lib/match/use-competition-pins', () => ({
  useCompetitionPins: () => ({
    status: 'ready',
    isPinned: () => mockPinned,
    toggle: (...a: unknown[]) => mockToggle(...a),
    toggleError: null,
  }),
}));

let mockLeagues: HookState;
jest.mock('@/lib/use-leagues', () => ({ useLeagues: () => ({ ...mockLeagues, reload: mockReload }) }));
let mockMyTeams: HookState;
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ ...mockMyTeams, reload: jest.fn() }) }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/lib/use-league-teams', () => ({ useLeagueTeams: () => ({ status: 'ready', rows: [], reload: jest.fn() }) }));
jest.mock('@/lib/leagues', () => ({ registerTeamForLeague: jest.fn(), startLeagueSeason: jest.fn() }));
jest.mock('@/lib/supabase', () => {
  const chain = { select: () => chain, in: () => Promise.resolve({ data: [] }) };
  return { supabase: { from: () => chain } };
});
const mockOpenChat = jest.fn();
jest.mock('@/lib/messages', () => ({
  ...jest.requireActual('@/lib/messages'),
  openCaptainConversation: (...a: unknown[]) => mockOpenChat(...a),
}));

// ---- Data -------------------------------------------------------------------

const hub = {
  id: 'L1',
  name: 'Limassol 5s',
  format: '5-a-side',
  scope: 'Limassol',
  stage: 'signup',
  start_date: '2026-12-01',
  season_weeks: 10,
  capacity: 8,
  parent_league_id: null,
};

const competition = (over: Partial<Competition> = {}): Competition => ({
  id: 'L1',
  name: 'Limassol 5s',
  area: 'Limassol',
  format: '5-a-side',
  stage: 'signup',
  isPinned: false,
  seasons: [{ id: 'S1', name: 'Season 1', number: 1, startDate: '2026-12-01', finished: false }],
  season: {
    id: 'S1',
    name: 'Season 1',
    number: 1,
    stage: 'season',
    startDate: '2026-12-01',
    endDate: '2027-02-08',
    finished: false,
    tables: [{ id: 'S1', name: 'Season 1' }],
  },
  featured: null,
  titles: [],
  ...over,
});

const player = (id: string, name: string) => ({
  profileId: id,
  name,
  avatarStyle: null,
  avatarKitColour: null,
  avatarNumber: null,
  avatarIllustration: null,
});

const standingRow = (teamId: string, teamName: string, pos: number, over = {}) => ({
  pos,
  teamId,
  teamName,
  played: 3,
  won: 2,
  drawn: 1,
  lost: 0,
  goalsFor: 9,
  goalsAgainst: 4,
  goalDiff: 5,
  points: 7,
  form: ['W', 'D', 'W'] as ('W' | 'D' | 'L')[],
  zone: null,
  ...over,
});

const standings: CompetitionStandings = {
  rules: 'Teams level on points: goal difference, then goals scored, then head-to-head points, then team name.',
  tables: [
    {
      id: 'S1',
      name: 'Season 1',
      rows: [
        standingRow('tigers', 'Tigers', 1, { zone: 'promotion' }),
        standingRow('lions', 'Lions', 2, { won: 1, points: 4, goalDiff: -2 }),
        standingRow('minors', 'Minors', 3),
      ],
    },
  ],
};

const fixture = (over: Partial<CompetitionMatch>): CompetitionMatch => ({
  fixture_id: 'f1',
  table_id: 'S1',
  table_name: 'Season 1',
  matchday: 1,
  kickoff_at: '2026-12-07T17:00:00Z',
  status: 'completed',
  forfeit_result: null,
  home_team_id: 'tigers',
  home_team_name: 'Tigers',
  away_team_id: 'lions',
  away_team_name: 'Lions',
  home_score: 3,
  away_score: 1,
  match_id: 'm1',
  ...over,
});

const fixtures = [
  fixture({}),
  fixture({ fixture_id: 'f2', matchday: 2, kickoff_at: '2026-12-14T17:00:00Z', away_team_id: 'minors', away_team_name: 'Minors', status: 'agreed', home_score: null, away_score: null, match_id: null }),
  fixture({ fixture_id: 'f3', matchday: null, kickoff_at: null, home_team_id: 'lions', home_team_name: 'Lions', away_team_id: 'minors', away_team_name: 'Minors', status: 'unscheduled', home_score: null, away_score: null, match_id: null }),
];

const statRow = (id: string, name: string, over: Partial<PlayerStatRow> = {}): PlayerStatRow => ({
  ...player(id, name),
  teamId: 'tigers',
  teamName: 'Tigers',
  rating: 7.5,
  matches: 3,
  goals: 1,
  assists: 1,
  motm: 0,
  cleanSheets: 0,
  goalsConcededPerMatch: 1.33,
  ...over,
});

const awards = (over: Partial<CompetitionAwards> = {}): CompetitionAwards => ({
  premiumOnly: false,
  matchdays: [1, 2],
  player: null,
  team: {
    format: '5-a-side',
    matchday: null,
    shape: { keepers: 1, defenders: 1, midfielders: 2, strikers: 1 },
    players: [
      { ...player('p1', 'Ana'), slot: 'fwd', sort: 1, best: true, teamId: 'tigers', teamName: 'Tigers', rating: 8.6, matches: 3, goals: 4, assists: 1 },
    ],
  },
  ...over,
});

const power: CompetitionPowerRow[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
  position: i + 1,
  team_id: id,
  team_name: `Team ${id.toUpperCase()}`,
  points: 1046 - i * 10,
  matches: 4,
  app_rank: i + 3,
  position_change: i === 0 ? 2 : i === 1 ? -1 : null,
  last_results: ['W'],
}));

const statsCategories: StatsCategory[] = [
  {
    category: 'rating',
    rows: [
      { ...player('p1', 'Ana'), teamId: 'tigers', teamName: 'Tigers', value: 8.79 },
      { ...player('p2', 'Ben'), teamId: 'lions', teamName: 'Lions', value: 8.24 },
      { ...player('p3', 'Cleo'), teamId: 'lions', teamName: 'Lions', value: 7.91 },
      { ...player('p4', 'Dan'), teamId: 'lions', teamName: 'Lions', value: 7.1 },
    ],
  },
  { category: 'goals', rows: [{ ...player('p1', 'Ana'), teamId: 'tigers', teamName: 'Tigers', value: 10 }] },
  { category: 'assists', rows: [] },
];

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockArgs)) delete mockArgs[k];
  g.mockSearchParams = { id: 'L1' };
  mockPinned = false;
  mockLeagues = { status: 'ready', leagues: [hub] };
  mockMyTeams = { status: 'ready', teams: [{ team: { id: 'tigers', name: 'Tigers' }, role: 'captain' }] };
  Object.assign(mockState, {
    competition: { status: 'ready', competition: competition() },
    standings: { status: 'ready', standings },
    matches: { status: 'ready', matches: fixtures },
    playerStats: { status: 'ready', rows: [], premium: false },
    stats: { status: 'ready', categories: statsCategories },
    statsAll: { status: 'ready', categories: [statsCategories[0]] },
    awards: { status: 'ready', awards: awards() },
    power: { status: 'ready', rows: power },
    contacts: [],
  });
});

async function openTab(name: string) {
  await fireEvent.press(screen.getByTestId(`competition-tab-${name}`));
  return screen.getByTestId(`competition-panel-${name}`);
}

// ---- Page and header --------------------------------------------------------

describe('competition page', () => {
  it('loading: a skeleton in the Overview’s shape', async () => {
    mockState.competition = { status: 'loading' };
    await render(<CompetitionPage />);
    expect(screen.getByTestId('league-page-skeleton')).toBeTruthy();
  });

  it('a league that no longer exists: one line and Back to leagues', async () => {
    mockState.competition = { status: 'error', message: 'competition_not_found' };
    await render(<CompetitionPage />);
    expect(screen.getByText('League not found')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to leagues' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('any other error: one line and Try again', async () => {
    mockState.competition = { status: 'error', message: 'offline' };
    await render(<CompetitionPage />);
    expect(screen.getByText('Couldn’t load this league.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
  });

  it('header: name, area and format, back; no bell, no followers, no Share', async () => {
    await render(<CompetitionPage />);
    expect(mockArgs.competition[0]).toEqual(['L1', null]);
    expect(screen.getByText('Limassol 5s')).toBeTruthy();
    expect(screen.getByText('Limassol · 5-a-side')).toBeTruthy();
    expect(screen.queryByText(/followers/i)).toBeNull();
    expect(screen.queryByLabelText(/share/i)).toBeNull();
    expect(screen.queryByLabelText(/bell|alerts/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('league-page-back'));
    expect(router.back).toHaveBeenCalled();
  });

  it('island-wide leagues say Cyprus', () => {
    expect(competitionSubtitle({ area: 'Island-wide', format: '11-a-side' })).toBe('Cyprus · 11-a-side');
  });

  it('the star pins it (S9’s pin) and says which way it goes', async () => {
    await render(<CompetitionPage />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pin Limassol 5s' }));
    expect(mockToggle).toHaveBeenCalledWith('Limassol', '5-a-side');
  });

  it('a pinned competition offers Unpin', async () => {
    mockPinned = true;
    await render(<CompetitionPage />);
    expect(screen.getByRole('button', { name: 'Unpin Limassol 5s' })).toBeTruthy();
  });

  it('season ▾ only with more than one season; picking one reloads with it', async () => {
    await render(<CompetitionPage />);
    expect(screen.queryByTestId('competition-season')).toBeNull();
    await screen.unmount();
    mockState.competition = {
      status: 'ready',
      competition: competition({
        seasons: [
          { id: 'S2', name: 'Season 2', number: 2, startDate: '2027-03-01', finished: false },
          { id: 'S1', name: 'Season 1', number: 1, startDate: '2026-12-01', finished: true },
        ],
      }),
    };
    await render(<CompetitionPage />);
    await fireEvent.press(screen.getByTestId('competition-season'));
    await fireEvent.press(screen.getByTestId('competition-seasons-S2'));
    expect(router.setParams).toHaveBeenCalledWith({ season: 'S2' });
  });

  it('?season= and ?tab= open that season and tab', async () => {
    g.mockSearchParams = { id: 'L1', season: 'S1', tab: 'standings' };
    await render(<CompetitionPage />);
    expect(mockArgs.competition[0]).toEqual(['L1', 'S1']);
    expect(screen.getByTestId('competition-panel-standings')).toBeTruthy();
    expect(screen.queryByTestId('competition-panel-overview')).toBeNull();
  });

  it('the tabs: Overview, Matches, Standings, Player stats (Premium), Stats, Power rankings; no Knockout', async () => {
    await render(<CompetitionPage />);
    for (const name of ['Overview', 'Matches', 'Standings', 'Player stats, Premium', 'Stats', 'Power rankings']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('tab', { name: /knockout/i })).toBeNull();
  });
});

// ---- Overview ---------------------------------------------------------------

describe('Overview', () => {
  it('season status from the server’s dates', () => {
    const s = competition().season;
    expect(seasonStatus(s, '2026-11-27')).toBe('Upcoming');
    expect(seasonStatus(s, '2026-12-10')).toBe('In progress');
    expect(seasonStatus({ ...s, finished: true }, '2027-03-01')).toBe('Finished');
    expect(seasonStatus({ ...s, startDate: null }, '2026-12-10')).toBe('Sign-up open');
  });

  it('season card: name, progress bar and dates, and the join flow while sign-up is open', async () => {
    await render(<CompetitionPage />);
    const card = screen.getByTestId('competition-season-card');
    expect(card).toHaveTextContent(/Season 1/);
    expect(screen.getByTestId('competition-progress')).toHaveTextContent(/1 Dec.*8 Feb/);
    expect(await within(card).findByRole('button', { name: 'Register a new team' })).toBeTruthy();
  });

  it('no join flow while a city league’s season runs', async () => {
    mockLeagues = { status: 'ready', leagues: [{ ...hub, stage: 'season' }] };
    await render(<CompetitionPage />);
    expect(screen.queryByRole('button', { name: 'Register a new team' })).toBeNull();
  });

  it('Player of the season: image 13’s placeholder until someone has 3 matches', async () => {
    await render(<CompetitionPage />);
    const card = screen.getByTestId('competition-player-of-season');
    expect(card).toHaveTextContent(/Shown after 3 matches/);
    expect(card).toHaveTextContent(/Highest average rating/);
  });

  it('Player of the season: photo, name, team, rating; See more opens Stats; the name opens the profile', async () => {
    mockState.awards = {
      status: 'ready',
      awards: awards({ player: { ...player('p9', 'Zoe'), teamId: 'lions', teamName: 'Lions', rating: 8.79, matches: 4 } }),
    };
    await render(<CompetitionPage />);
    const card = screen.getByTestId('competition-player-of-season');
    expect(card).toHaveTextContent(/Zoe/);
    expect(within(card).getByLabelText('Rating 8.8')).toBeTruthy();
    await fireEvent.press(within(card).getByRole('link', { name: 'Open Zoe' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'p9' } });
    await fireEvent.press(within(card).getByRole('link', { name: 'Open Lions' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'lions' } });
    await fireEvent.press(screen.getByTestId('competition-player-see-more'));
    expect(screen.getByTestId('competition-panel-stats')).toBeTruthy();
  });

  it('Power rankings: the top 4 only, ▲▼, and Go to power rankings', async () => {
    await render(<CompetitionPage />);
    const card = screen.getByTestId('competition-power-top');
    expect(within(card).getAllByRole('link')).toHaveLength(4);
    expect(card).toHaveTextContent(/Team A/);
    expect(card).not.toHaveTextContent(/Team E/);
    expect(card).toHaveTextContent(/▲2/);
    await fireEvent.press(screen.getByTestId('competition-power-go'));
    expect(screen.getByTestId('competition-panel-power')).toBeTruthy();
  });

  it('no power rankings: the section is hidden', async () => {
    mockState.power = { status: 'ready', rows: [] };
    await render(<CompetitionPage />);
    expect(screen.queryByTestId('competition-power-top')).toBeNull();
  });

  it('Team of the season: the pitch, a dismissable info line and the matchday dropdown', async () => {
    await render(<CompetitionPage />);
    expect(screen.getByTestId('competition-team-pitch')).toBeTruthy();
    expect(screen.getByTestId('totw-pitch-player-p1')).toBeTruthy();
    expect(mockArgs.awards.at(-1)).toEqual(['S1', null]);
    await fireEvent.press(screen.getByTestId('competition-team-info-close'));
    expect(screen.queryByTestId('competition-team-info')).toBeNull();
    await fireEvent.press(screen.getByTestId('competition-team-matchday'));
    expect(screen.getByTestId('competition-team-matchdays-season')).toBeTruthy();
    expect(screen.queryByText('Not scheduled')).toBeNull();
    await fireEvent.press(screen.getByTestId('competition-team-matchdays-2'));
    expect(mockArgs.awards.at(-1)).toEqual(['S1', 2]);
  });

  it('no team yet: Team of the season is hidden', async () => {
    mockState.awards = { status: 'ready', awards: awards({ team: null, matchdays: [] }) };
    await render(<CompetitionPage />);
    expect(screen.queryByTestId('competition-team-of-season')).toBeNull();
  });

  it('featured: both teams and the score; tapping opens the match', async () => {
    mockState.competition = {
      status: 'ready',
      competition: competition({
        featured: {
          kind: 'result',
          fixtureId: 'f1',
          matchId: 'm1',
          kickoffAt: '2026-12-07T17:00:00Z',
          home: { teamId: 'tigers', name: 'Tigers', score: 3 },
          away: { teamId: 'lions', name: 'Lions', score: 1 },
        },
      }),
    };
    await render(<CompetitionPage />);
    const card = screen.getByTestId('competition-featured');
    expect(card).toHaveTextContent(/3 - 1/);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Tigers v Lions' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm1' } });
  });

  it('titles: past champions with a Title holder tag; hidden while empty', async () => {
    await render(<CompetitionPage />);
    expect(screen.queryByTestId('competition-titles')).toBeNull();
    await screen.unmount();
    mockState.competition = {
      status: 'ready',
      competition: competition({
        titles: [
          { seasonId: 'S2', name: 'Season 2', number: 2, year: 2027, teamId: 'tigers', teamName: 'Tigers', holder: true },
          { seasonId: 'S1', name: 'Season 1', number: 1, year: 2026, teamId: 'lions', teamName: 'Lions', holder: false },
        ],
      }),
    };
    await render(<CompetitionPage />);
    expect(within(screen.getByTestId('competition-title-S2')).getByText('Title holder')).toBeTruthy();
    expect(within(screen.getByTestId('competition-title-S1')).queryByText('Title holder')).toBeNull();
  });

  it('no Discussion section (S7b)', async () => {
    await render(<CompetitionPage />);
    expect(screen.queryByText(/discussion/i)).toBeNull();
  });
});

// ---- Matches ----------------------------------------------------------------

describe('Matches', () => {
  it('loading, error with Try again', async () => {
    mockState.matches = { status: 'loading' };
    await render(<CompetitionPage />);
    await openTab('matches');
    expect(screen.getByTestId('competition-matches-skeleton')).toBeTruthy();
    await screen.unmount();
    mockState.matches = { status: 'error', message: 'x' };
    await render(<CompetitionPage />);
    await openTab('matches');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
  });

  it('empty: one line and My fixtures', async () => {
    mockState.matches = { status: 'ready', matches: [] };
    await render(<CompetitionPage />);
    await openTab('matches');
    expect(screen.getByText('No matches yet')).toBeTruthy();
  });

  it('by date: day sections, Not scheduled last; rows show FT and the score; a played row opens its match', async () => {
    await render(<CompetitionPage />);
    const panel = await openTab('matches');
    expect(mockArgs.matches.at(-1)).toEqual(['S1', null]);
    expect(panel).toHaveTextContent(/Mon 7 Dec.*Mon 14 Dec.*Not scheduled/);
    expect(screen.getByTestId('competition-match-f1')).toHaveTextContent(/07\/12\/26.*FT/);
    await fireEvent.press(screen.getByTestId('competition-match-f1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm1' } });
    await fireEvent.press(screen.getByTestId('league-page-fixtures'));
    expect(router.push).toHaveBeenCalledWith('/upcoming-fixtures');
  });

  it('by round: a picker, then that round', async () => {
    await render(<CompetitionPage />);
    const panel = await openTab('matches');
    await fireEvent.press(screen.getByTestId('competition-matches-round'));
    expect(screen.getByTestId('competition-rounds-null')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('competition-rounds-2'));
    expect(panel).toHaveTextContent(/Matchday 2/);
    expect(screen.queryByTestId('competition-match-f1')).toBeNull();
    expect(screen.getByTestId('competition-match-f2')).toBeTruthy();
  });

  it('by team: a team search, then the server is asked for that team', async () => {
    await render(<CompetitionPage />);
    await openTab('matches');
    await fireEvent.press(screen.getByTestId('competition-matches-team'));
    await fireEvent.changeText(screen.getByTestId('competition-teams-search'), 'lio');
    expect(screen.queryByTestId('competition-teams-tigers')).toBeNull();
    await fireEvent.press(screen.getByTestId('competition-teams-lions'));
    expect(mockArgs.matches.at(-1)).toEqual(['S1', 'lions']);
  });

  it('message button: on my team’s row with an adult captain; not to a minor’s captain', async () => {
    mockState.contacts = [
      { my_team_id: 'tigers', team_id: 'lions', can_message: true },
      { my_team_id: 'tigers', team_id: 'minors', can_message: false },
    ];
    mockOpenChat.mockResolvedValue({ conversationId: 'c1', error: null });
    await render(<CompetitionPage />);
    await openTab('matches');
    expect(mockArgs.contacts.at(-1)).toEqual([['S1']]);
    // Tigers v Lions: allowed.
    expect(screen.getByTestId('league-message-captain-f1')).toBeTruthy();
    expect(screen.getByTestId('league-message-captain')).toBeTruthy();
    // Tigers v Minors: an adult and a minor, so no button.
    expect(screen.queryByTestId('league-message-captain-f2')).toBeNull();
    // Lions v Minors: not my team.
    expect(screen.queryByTestId('league-message-captain-f3')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Message the captain of Lions' }));
    expect(mockOpenChat).toHaveBeenCalledWith('tigers', 'lions');
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'c1' } }));
  });

  it('message button: hidden across a block', async () => {
    mockState.contacts = [{ my_team_id: 'tigers', team_id: 'lions', can_message: false }];
    await render(<CompetitionPage />);
    await openTab('matches');
    expect(screen.queryByTestId('league-message-captain-f1')).toBeNull();
    expect(screen.queryByTestId('league-message-captain')).toBeNull();
  });

  it('a chat refused after all says why in one line', async () => {
    mockState.contacts = [{ my_team_id: 'tigers', team_id: 'lions', can_message: true }];
    mockOpenChat.mockResolvedValue({ conversationId: null, error: { message: 'blocked' } });
    await render(<CompetitionPage />);
    await openTab('matches');
    await fireEvent.press(screen.getByTestId('league-message-captain-f1'));
    expect(await screen.findByTestId('competition-matches-chat-error')).toHaveTextContent("You can't message this player.");
  });
});

// ---- Standings --------------------------------------------------------------

describe('Standings', () => {
  it('loading, error and empty', async () => {
    mockState.standings = { status: 'loading' };
    await render(<CompetitionPage />);
    await openTab('standings');
    expect(screen.getByTestId('competition-standings-skeleton')).toBeTruthy();
    await screen.unmount();
    mockState.standings = { status: 'error', message: 'x' };
    await render(<CompetitionPage />);
    await openTab('standings');
    expect(screen.getByText('Couldn’t load the standings.')).toBeTruthy();
    await screen.unmount();
    mockState.standings = { status: 'ready', standings: { rules: '', tables: [] } };
    await render(<CompetitionPage />);
    await openTab('standings');
    expect(screen.getByText('No standings yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'See matches' }));
    expect(screen.getByTestId('competition-panel-matches')).toBeTruthy();
  });

  it('Short: Pos, Team, P, Diff, Pts; my team on its own testID', async () => {
    await render(<CompetitionPage />);
    await openTab('standings');
    expect(screen.getAllByTestId('standings-table')).toHaveLength(1);
    expect(screen.getAllByTestId('standings-row-mine')).toHaveLength(1);
    expect(screen.getAllByTestId('standings-row')).toHaveLength(2);
    const mine = screen.getByTestId('standings-row-mine');
    expect(mine.props.accessibilityLabel).toBe('1, Tigers, played 3, goal difference +5, points 7, Promotion');
    expect(screen.queryByText('GF')).toBeNull();
  });

  it('Full adds W, D, L, GF, GA; Form adds the last-five circles', async () => {
    await render(<CompetitionPage />);
    await openTab('standings');
    await fireEvent.press(screen.getByTestId('standings-view-full'));
    for (const h of ['W', 'D', 'L', 'GF', 'GA']) expect(screen.getAllByText(h, { includeHiddenElements: true }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('standings-row-mine').props.accessibilityLabel).toBe(
      '1, Tigers, played 3, won 2, drawn 1, lost 0, goals for 9, goals against 4, goal difference +5, points 7, Promotion',
    );
    await fireEvent.press(screen.getByTestId('standings-view-form'));
    expect(screen.getAllByText('Form', { includeHiddenElements: true }).length).toBe(2); // the selector and the column
    expect(screen.queryByText('GF', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('standings-row-mine').props.accessibilityLabel).toMatch(/form won, drew, won/);
  });

  it('a zone line with its legend, and Rules opens the server’s tiebreakers', async () => {
    await render(<CompetitionPage />);
    await openTab('standings');
    expect(screen.getByTestId('standings-zone-promotion')).toHaveTextContent('Promotion');
    expect(screen.queryByTestId('standings-rules-text')).toBeNull();
    await fireEvent.press(screen.getByTestId('standings-rules'));
    expect(screen.getByTestId('standings-rules-text')).toHaveTextContent(standings.rules);
  });

  it('a team name opens the team page', async () => {
    await render(<CompetitionPage />);
    await openTab('standings');
    await fireEvent.press(within(screen.getByTestId('standings-row-mine')).getByRole('link', { name: 'Open Tigers' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'tigers' } });
  });
});

// ---- Player stats -----------------------------------------------------------

describe('Player stats', () => {
  it('without Premium the server refuses: the PRO card and Get Premium, no rows', async () => {
    mockState.playerStats = { status: 'ready', rows: [], premium: true };
    await render(<CompetitionPage />);
    await openTab('player-stats');
    expect(screen.getByText('Rank players by any stat')).toBeTruthy();
    expect(screen.queryByTestId(/competition-player-stats-row-/)).toBeNull();
    await fireEvent.press(screen.getByTestId('competition-get-premium'));
    expect(router.push).toHaveBeenCalledWith('/account/premium');
  });

  it('loading, error and empty', async () => {
    mockState.playerStats = { status: 'loading' };
    await render(<CompetitionPage />);
    await openTab('player-stats');
    expect(screen.getByTestId('competition-player-stats-skeleton')).toBeTruthy();
    await screen.unmount();
    mockState.playerStats = { status: 'error', message: 'x' };
    await render(<CompetitionPage />);
    await openTab('player-stats');
    expect(screen.getByText('Couldn’t load the player stats.')).toBeTruthy();
    await screen.unmount();
    mockState.playerStats = { status: 'ready', rows: [], premium: false };
    await render(<CompetitionPage />);
    await openTab('player-stats');
    expect(screen.getByText('No player stats yet')).toBeTruthy();
  });

  it('Premium: rated rows; sort by a column; Attack and Defence chips; a team filter asks the server', async () => {
    mockState.playerStats = {
      status: 'ready',
      premium: false,
      rows: [statRow('p1', 'Ana', { rating: 8, goals: 1 }), statRow('p2', 'Ben', { rating: 7, goals: 5 })],
    };
    await render(<CompetitionPage />);
    await openTab('player-stats');
    const order = () => screen.getAllByTestId(/competition-player-stats-row-/).map((r) => r.props.testID);
    expect(order()).toEqual(['competition-player-stats-row-p1', 'competition-player-stats-row-p2']);
    await fireEvent.press(screen.getByRole('button', { name: 'Sort by Goals' }));
    expect(order()).toEqual(['competition-player-stats-row-p2', 'competition-player-stats-row-p1']);
    await fireEvent.press(screen.getByTestId('competition-player-stats-attack'));
    expect(screen.getByRole('button', { name: 'Sort by Man of the match' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('competition-player-stats-defence'));
    expect(screen.getByRole('button', { name: 'Sort by Goals conceded per match' })).toBeTruthy();
    expect(screen.queryByText(/position/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('competition-player-stats-team'));
    await fireEvent.press(screen.getByTestId('competition-player-stats-teams-lions'));
    expect(mockArgs.playerStats.at(-1)).toEqual(['S1', 'lions']);
    await fireEvent.press(within(screen.getByTestId('competition-player-stats-row-p1')).getByRole('link', { name: 'Open Ana' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'p1' } });
  });
});

// ---- Stats ------------------------------------------------------------------

describe('Stats', () => {
  it('Players: top 3 per card, empty categories hidden, See all loads the whole list', async () => {
    await render(<CompetitionPage />);
    await openTab('stats');
    expect(mockArgs.stats.at(-1)).toEqual(['S1', 'players']);
    const rating = screen.getByTestId('competition-stats-card-rating');
    expect(rating).toHaveTextContent(/Average rating/);
    expect(rating).not.toHaveTextContent(/Dan/);
    expect(screen.queryByTestId('competition-stats-card-assists')).toBeNull();
    await fireEvent.press(screen.getByTestId('competition-stats-see-all-rating'));
    expect(mockArgs.stats.at(-1)).toEqual(['S1', 'players', 'rating', 100]);
    expect(within(screen.getByTestId('competition-stats-all')).getByText('Dan')).toBeTruthy();
  });

  it('each card’s info line closes', async () => {
    await render(<CompetitionPage />);
    await openTab('stats');
    expect(screen.getByTestId('competition-stats-info-goals')).toHaveTextContent('Goals scored this season.');
    await fireEvent.press(screen.getByTestId('competition-stats-info-goals-close'));
    expect(screen.queryByTestId('competition-stats-info-goals')).toBeNull();
  });

  it('Teams and Performances ask for their tab; a performance opens its match', async () => {
    await render(<CompetitionPage />);
    await openTab('stats');
    await fireEvent.press(screen.getByTestId('competition-stats-teams'));
    expect(mockArgs.stats.at(-1)).toEqual(['S1', 'teams']);
    mockState.stats = {
      status: 'ready',
      categories: [
        {
          category: 'goals',
          rows: [
            {
              ...player('p1', 'Ana'),
              teamId: 'tigers',
              value: 4,
              matchId: 'm1',
              homeTeamName: 'Tigers',
              homeScore: 5,
              awayTeamName: 'Lions',
              awayScore: 1,
            },
          ],
        },
      ],
    };
    await fireEvent.press(screen.getByTestId('competition-stats-performances'));
    expect(mockArgs.stats.at(-1)).toEqual(['S1', 'performances']);
    expect(screen.getByTestId('competition-stats-card-goals')).toHaveTextContent(/Most goals.*Tigers 5-1 Lions/);
    await fireEvent.press(screen.getByRole('link', { name: 'Open the match, Tigers 5-1 Lions' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm1' } });
  });

  it('empty and error', async () => {
    mockState.stats = { status: 'ready', categories: [] };
    await render(<CompetitionPage />);
    await openTab('stats');
    expect(screen.getByText('No stats yet')).toBeTruthy();
    await screen.unmount();
    mockState.stats = { status: 'error', message: 'x' };
    await render(<CompetitionPage />);
    await openTab('stats');
    expect(screen.getByText('Couldn’t load the stats.')).toBeTruthy();
  });
});

// ---- Power rankings ---------------------------------------------------------

describe('Power rankings', () => {
  it('this competition’s teams in the server’s (app-wide) order, with their breakdown rows', async () => {
    await render(<CompetitionPage />);
    await openTab('power');
    expect(mockArgs.power.at(-1)).toEqual(['S1']);
    const rows = screen.getAllByTestId(/^power-ranking-row-/).map((r) => r.props.testID);
    expect(rows).toEqual(['a', 'b', 'c', 'd', 'e'].map((id) => `power-ranking-row-${id}`));
  });

  it('empty: one line and See standings', async () => {
    mockState.power = { status: 'ready', rows: [] };
    await render(<CompetitionPage />);
    await openTab('power');
    await fireEvent.press(screen.getByRole('button', { name: 'See standings' }));
    expect(screen.getByTestId('competition-panel-standings')).toBeTruthy();
  });
});
