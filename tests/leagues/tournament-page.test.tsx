// S10A: the tournament page (image 13; SofaScore 07-20) on the server's
// reads. Every tab: loading, empty, error and data; registration from the
// captain's teams; the fixed knockout with AP; Coming soon even from a link.
import './mocks';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Modal } from 'react-native';

import TournamentPage, { tournamentSubtitle } from '@/app/(tabs)/leagues/tournament/[id]';
import { stageState } from '@/components/competition/tournament/tournament-overview';
import { teamsToRegister } from '@/components/competition/tournament/registration-sheet';
import { loadWithFile } from '@/components/ui/test-utils';
import type { KnockoutSlot, Tournament, TournamentFixture } from '@/lib/match/tournament-api';

jest.mock('@/components/ads/ad-banner', () => jest.requireActual('../ads/test-ids').adBannerMarker());

loadWithFile(Modal);

const g = globalThis as { mockSearchParams?: Record<string, string> };

type HookState = Record<string, unknown>;
const mockState: { tournament: HookState; standings: HookState; matches: HookState; knockout: HookState } = {} as never;
const mockReload = jest.fn(() => Promise.resolve());
const mockMatchesArgs: unknown[][] = [];

jest.mock('@/lib/match/use-tournament', () => ({
  useTournament: () => ({ ...mockState.tournament, reload: mockReload }),
  useTournamentStandings: () => ({ ...mockState.standings, reload: mockReload }),
  useTournamentMatches: (...a: unknown[]) => (mockMatchesArgs.push(a), { ...mockState.matches, reload: mockReload }),
  useTournamentKnockout: () => ({ ...mockState.knockout, reload: mockReload }),
}));
const mockAwardsArgs: unknown[][] = [];
jest.mock('@/lib/match/use-competition', () => ({
  useCompetitionAwards: (...a: unknown[]) => (
    mockAwardsArgs.push(a), { status: 'ready', awards: { premiumOnly: false, matchdays: [], player: null, team: null }, reload: mockReload }
  ),
  useCompetitionPowerRanking: () => ({ status: 'ready', rows: [], reload: mockReload }),
  useCompetitionStats: () => ({ status: 'ready', categories: [], reload: mockReload }),
  useCompetitionPlayerStats: () => ({ status: 'ready', rows: [], premium: false, reload: mockReload }),
}));
const mockToggleTournament = jest.fn();
let mockPinned = false;
jest.mock('@/lib/match/use-competition-pins', () => ({
  useCompetitionPins: () => ({
    status: 'ready',
    isTournamentPinned: () => mockPinned,
    toggleTournament: (...a: unknown[]) => mockToggleTournament(...a),
    toggleError: null,
  }),
}));
let mockMyTeams: HookState;
const mockMyTeamsReload = jest.fn(() => Promise.resolve());
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ ...mockMyTeams, reload: mockMyTeamsReload }) }));
const mockRegister = jest.fn();
const mockSetSquad = jest.fn();
jest.mock('@/lib/match/tournament-api', () => ({
  ...jest.requireActual('@/lib/match/tournament-api'),
  registerTeam: (...a: unknown[]) => mockRegister(...a),
  setSquad: (...a: unknown[]) => mockSetSquad(...a),
}));
const mockRoster = jest.fn();
jest.mock('@/lib/teams', () => ({
  ...jest.requireActual('@/lib/teams'),
  getTeamRoster: (...a: unknown[]) => mockRoster(...a),
}));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));
const mockHaptic = jest.requireMock<{ haptic: Record<'tap' | 'success' | 'error', jest.Mock> }>('@/lib/haptics').haptic;
// S20A's new-team sheet as a marker: it hands back the new team.
jest.mock('@/components/community/new-team-sheet', () => {
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ...jest.requireActual('@/components/community/new-team-sheet'),
    NewTeamSheet: ({ visible, onCreated }: { visible: boolean; onCreated?: (id: string) => void }) =>
      visible ? (
        <RN.Pressable testID="mock-new-team-created" onPress={() => onCreated?.('new-team')}>
          <RN.Text>New team</RN.Text>
        </RN.Pressable>
      ) : null,
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// ---- Data -------------------------------------------------------------------

const player = (id: string, name: string) => ({
  profileId: id,
  name,
  avatarStyle: null,
  avatarKitColour: null,
  avatarNumber: null,
  avatarIllustration: null,
});

const tournament = (over: Partial<Tournament> = {}): Tournament => ({
  id: 'T1',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  country: 'CY',
  format: '5-a-side',
  status: 'registration',
  comingSoon: false,
  startDate: null,
  endDate: null,
  venueId: null,
  venueName: null,
  maxTeams: 16,
  teamsCount: 3,
  entryFeeCents: 1200,
  championTeamId: null,
  registrationDeadline: null,
  matchMinutes: 50,
  squadMin: 5,
  squadMax: 7,
  progress: { played: 0, total: 0 },
  featured: null,
  teams: [],
  myTeams: [],
  ...over,
});

const team = (id: string, name: string, role = 'captain', kit: string | null = 'kitGreen') => ({
  role,
  team: { id, name, kit_colour: kit, deleted_at: null },
});

const roster = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ profile_id: `p${i + 1}`, username: null, full_name: `Player ${i + 1}`, role: 'player', joined_at: '' }));

const fixture = (over: Partial<TournamentFixture> = {}): TournamentFixture => ({
  fixtureId: 'f1',
  stage: 'group',
  group: 'A',
  slot: 'A-1',
  kickoffAt: '2026-12-06T17:00:00Z',
  status: 'scheduled',
  homeTeamId: 'ta',
  homeTeamName: 'Kato United',
  homeKitColour: 'kitRed',
  awayTeamId: 'tb',
  awayTeamName: 'Paphos 5',
  awayKitColour: 'kitBlue',
  homeScore: null,
  awayScore: null,
  homePens: null,
  awayPens: null,
  decidedBy: null,
  winnerTeamId: null,
  matchId: null,
  ...over,
});

const slot = (name: string, stage: KnockoutSlot['stage'], homeSource: string, awaySource: string, over: Partial<KnockoutSlot> = {}): KnockoutSlot => ({
  stage,
  slot: name,
  homeSource,
  awaySource,
  ...over,
});

const SLOTS: KnockoutSlot[] = [
  slot('QF1', 'qf', 'A1', 'D2'),
  slot('QF2', 'qf', 'A2', 'B1'),
  slot('QF3', 'qf', 'B2', 'C1'),
  slot('QF4', 'qf', 'C2', 'D1'),
  slot('SF1', 'sf', 'Winner QF1', 'Winner QF3'),
  slot('SF2', 'sf', 'Winner QF2', 'Winner QF4'),
  slot('F', 'final', 'Winner SF1', 'Winner SF2'),
];

const groupRow = (teamId: string, teamName: string, pos: number, points: number) => ({
  pos,
  teamId,
  teamName,
  kitColour: 'kitRed',
  played: 3,
  won: points / 3,
  drawn: 0,
  lost: 3 - points / 3,
  goalsFor: 5,
  goalsAgainst: 3,
  goalDiff: 2,
  points,
  qualifies: pos <= 2,
});

const RULES = "Teams level on points: goal difference, then goals scored, then head-to-head, then the organiser's draw.";

beforeEach(() => {
  jest.clearAllMocks();
  mockMatchesArgs.length = 0;
  mockAwardsArgs.length = 0;
  g.mockSearchParams = { id: 'T1' };
  mockPinned = false;
  mockState.tournament = { status: 'ready', tournament: tournament() };
  mockState.standings = { status: 'ready', standings: { rules: RULES, groups: [] } };
  mockState.matches = { status: 'ready', matches: [] };
  mockState.knockout = { status: 'ready', slots: SLOTS };
  mockMyTeams = { status: 'ready', teams: [team('c1', 'Kato United')] };
  mockRoster.mockResolvedValue({ data: roster(6), error: null });
  mockRegister.mockResolvedValue({ error: null });
  mockSetSquad.mockResolvedValue({ error: null });
});

async function openPage() {
  await render(<TournamentPage />);
}

const tab = (name: string) => fireEvent.press(screen.getByTestId(`competition-tab-${name}`));

// ---- Tests ------------------------------------------------------------------

describe('Tournament page: states', () => {
  it('loading shows the skeleton', async () => {
    mockState.tournament = { status: 'loading' };
    await openPage();
    expect(screen.getByTestId('league-page-skeleton')).toBeTruthy();
  });

  it('not found: one line and Back to leagues', async () => {
    mockState.tournament = { status: 'error', message: 'tournament_not_found' };
    await openPage();
    expect(screen.getByText('Tournament not found')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to leagues' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('an error: one line and Try again', async () => {
    mockState.tournament = { status: 'error', message: 'offline' };
    await openPage();
    expect(screen.getByText('Couldn’t load this tournament.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
  });

  it('Coming soon, even from a link, opens the Coming soon screen (image 17)', async () => {
    mockState.tournament = { status: 'ready', tournament: tournament({ status: 'coming_soon', comingSoon: true }) };
    await openPage();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/leagues/coming-soon',
      params: { kind: 'tournament', name: 'Nuevo Campo Cup', scope: 'limassol', format: '5-a-side', teams: '16' },
    });
    expect(screen.queryByTestId('competition-tab-overview')).toBeNull();
  });
});

describe('Tournament page: header', () => {
  it('name, "Limassol · 5-a-side tournament", the NC badge and the tournament tabs with Knockout', async () => {
    await openPage();
    expect(screen.getByText('Nuevo Campo Cup')).toBeTruthy();
    expect(screen.getByText('Limassol · 5-a-side tournament')).toBeTruthy();
    expect(screen.getByText('NC', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual([
      'Overview',
      'Matches',
      'Standings',
      'Player stats, Premium',
      'Knockout',
      'Stats',
      'Power rankings',
    ]);
    expect(tournamentSubtitle({ area: 'island-wide', format: '7-a-side' })).toBe('Cyprus · 7-a-side tournament');
  });

  it('the star pins the tournament', async () => {
    await openPage();
    await fireEvent.press(screen.getByTestId('competition-pin'));
    expect(mockToggleTournament).toHaveBeenCalledWith('T1');
  });

  it('?tab=knockout opens the Knockout tab', async () => {
    g.mockSearchParams = { id: 'T1', tab: 'knockout' };
    await openPage();
    expect(screen.getByTestId('tournament-knockout')).toBeTruthy();
  });
});

describe('Overview', () => {
  it('sign-up open: the stage, "Coming soon" for the dates, the entry fee line, teams in and Register team', async () => {
    await openPage();
    expect(within(screen.getByTestId('tournament-stage-card')).getByText('Sign-up open')).toBeTruthy();
    expect(within(screen.getByTestId('tournament-stage-card')).getByText('Coming soon')).toBeTruthy();
    expect(screen.getByTestId('tournament-dates')).toHaveTextContent('Coming soon');
    expect(screen.getByTestId('tournament-entry-fee')).toHaveTextContent('€12 per player, paid to the organiser');
    expect(screen.getByTestId('tournament-teams-count')).toHaveTextContent('3 of 16 teams');
    expect(screen.getByTestId('tournament-register')).toBeTruthy();
    // No awards before the groups start.
    expect(screen.queryByTestId('competition-player-of-season')).toBeNull();
  });

  it('dates and the venue once set', async () => {
    mockState.tournament = {
      status: 'ready',
      tournament: tournament({ startDate: '2026-12-06', endDate: '2026-12-14', venueName: 'Nuevo Campo' }),
    };
    await openPage();
    expect(screen.getByTestId('tournament-dates')).toHaveTextContent('6–14 Dec · Nuevo Campo');
    expect(within(screen.getByTestId('tournament-stage-card')).getByText('Upcoming')).toBeTruthy();
  });

  it('my team and its squad; a player opens their profile; Edit squad while the server allows it', async () => {
    mockState.tournament = {
      status: 'ready',
      tournament: tournament({
        myTeams: [
          { teamId: 'c1', teamName: 'Kato United', kitColour: 'kitGreen', isCaptain: true, canEditSquad: true, squad: [player('p1', 'Andreas')] },
        ],
      }),
    };
    await openPage();
    expect(within(screen.getByTestId('tournament-my-squad')).getByText('Kato United')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tournament-squad-p1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'p1' } });
    expect(screen.getByTestId('tournament-edit-squad')).toBeTruthy();
    expect(screen.queryByTestId('tournament-register')).toBeNull();
  });

  it('in the group stage: progress, the awards as "of the tournament", read with the tournament id', async () => {
    mockState.tournament = {
      status: 'ready',
      tournament: tournament({ status: 'groups', progress: { played: 6, total: 24 } }),
    };
    await openPage();
    expect(within(screen.getByTestId('tournament-stage-card')).getByText('Group stage')).toBeTruthy();
    expect(screen.getByTestId('tournament-progress').props.accessibilityValue.now).toBe(25);
    expect(screen.getByText('Player of the tournament')).toBeTruthy();
    expect(mockAwardsArgs[0][0]).toBe('T1');
    expect(screen.queryByTestId('tournament-registration')).toBeNull();
  });

  it('stage states', () => {
    expect(stageState({ status: 'finished', startDate: null, endDate: null })).toBe('Finished');
    expect(stageState({ status: 'knockout', startDate: null, endDate: null })).toBe('In progress');
    expect(stageState({ status: 'registration', startDate: '2026-12-06', endDate: null })).toBe('Upcoming');
    expect(stageState({ status: 'registration', startDate: null, endDate: null })).toBe('Coming soon');
  });
});

describe('Registration', () => {
  it('only my captained teams not yet in can register', () => {
    const mine = [team('c1', 'A'), team('p1', 'B', 'player'), { role: 'captain', team: { id: 'gone', name: 'C', deleted_at: 'x' } }, team('c2', 'D')];
    expect(
      teamsToRegister(mine as never, { myTeams: [{ teamId: 'c2' } as never] }).map((m) => m.team.id),
    ).toEqual(['c1']);
  });

  it('Register team: the team, its kit, the squad from its players, then Register sends it', async () => {
    await openPage();
    await fireEvent.press(screen.getByTestId('tournament-register'));
    await screen.findByTestId('tournament-register-roster');
    expect(mockRoster).toHaveBeenCalledWith('c1');
    expect(screen.getByTestId('tournament-register-kit-green')).toBeSelected();
    // Six players, all picked (within 5–7).
    expect(screen.getByText('Squad 6 of 5–7')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tournament-register-kit-sky'));
    await fireEvent.press(screen.getByTestId('tournament-register-player-p6'));
    expect(screen.getByText('Squad 5 of 5–7')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('tournament-register-submit'));
    });
    expect(mockRegister).toHaveBeenCalledWith('T1', 'c1', 'kitSky', ['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(mockHaptic.success).toHaveBeenCalled();
    expect(mockReload).toHaveBeenCalled();
  });

  it('a squad outside the limits can’t be sent', async () => {
    mockRoster.mockResolvedValue({ data: roster(9), error: null });
    await openPage();
    await fireEvent.press(screen.getByTestId('tournament-register'));
    await screen.findByTestId('tournament-register-roster');
    // Nine is more than 7: nobody picked to start.
    expect(screen.getByText('Squad 0 of 5–7')).toBeTruthy();
    expect(screen.getByTestId('tournament-register-submit')).toBeDisabled();
  });

  it('a refused registration says why in one line', async () => {
    mockRegister.mockResolvedValue({ error: { message: 'player_in_other_squad' } });
    await openPage();
    await fireEvent.press(screen.getByTestId('tournament-register'));
    await screen.findByTestId('tournament-register-roster');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('tournament-register-submit'));
    });
    expect(screen.getByTestId('tournament-register-error')).toHaveTextContent('A player is already in another squad. Remove them.');
    expect(mockHaptic.error).toHaveBeenCalled();
  });

  it('the roster failing to load says so', async () => {
    mockRoster.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await openPage();
    await fireEvent.press(screen.getByTestId('tournament-register'));
    await screen.findByText('Couldn’t load the players. Try again.');
  });

  it('Edit squad saves the squad', async () => {
    mockState.tournament = {
      status: 'ready',
      tournament: tournament({
        myTeams: [
          {
            teamId: 'c1',
            teamName: 'Kato United',
            kitColour: 'kitGreen',
            isCaptain: true,
            canEditSquad: true,
            squad: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => player(id, id)),
          },
        ],
      }),
    };
    await openPage();
    await fireEvent.press(screen.getByTestId('tournament-edit-squad'));
    await screen.findByTestId('tournament-register-roster');
    await fireEvent.press(screen.getByTestId('tournament-register-player-p6'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('tournament-register-submit'));
    });
    expect(mockSetSquad).toHaveBeenCalledWith('T1', 'c1', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('no team to register: one line and Make a team, which comes back to registration', async () => {
    mockMyTeams = { status: 'ready', teams: [] };
    await openPage();
    await fireEvent.press(screen.getByTestId('tournament-register'));
    expect(within(screen.getByTestId('tournament-register-empty')).getByText('No team to register')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tournament-register-make-team'));
    // The new team, once made, is mine to register.
    mockMyTeamsReload.mockImplementationOnce(() => {
      mockMyTeams = { status: 'ready', teams: [team('new-team', 'Owls')] };
      return Promise.resolve();
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('mock-new-team-created'));
    });
    expect(mockMyTeamsReload).toHaveBeenCalled();
    await screen.findByTestId('tournament-register-roster');
    expect(mockRoster).toHaveBeenCalledWith('new-team');
  });
});

describe('Matches', () => {
  it('By date by default, with AP and the shootout after penalties', async () => {
    mockState.matches = {
      status: 'ready',
      matches: [
        fixture({
          fixtureId: 'q1',
          stage: 'qf',
          group: null,
          slot: 'QF1',
          status: 'completed',
          homeScore: 1,
          awayScore: 1,
          homePens: 4,
          awayPens: 3,
          winnerTeamId: 'ta',
        }),
      ],
    };
    await openPage();
    await tab('matches');
    expect(screen.getByTestId('tournament-matches-date')).toBeSelected();
    const row = screen.getByTestId('tournament-match-q1');
    expect(within(row).getByText('AP')).toBeTruthy();
    expect(screen.getByTestId('tournament-match-pens-q1')).toHaveTextContent('AP 4–3');
  });

  it('By group and By round', async () => {
    mockState.matches = {
      status: 'ready',
      matches: [fixture({ fixtureId: 'a1' }), fixture({ fixtureId: 'b1', group: 'B' }), fixture({ fixtureId: 's1', stage: 'sf', group: null, slot: 'SF1' })],
    };
    await openPage();
    await tab('matches');
    await fireEvent.press(screen.getByTestId('tournament-matches-group'));
    expect(screen.getByText('Group A')).toBeTruthy();
    expect(screen.getByText('Group B')).toBeTruthy();
    expect(screen.queryByTestId('tournament-match-s1')).toBeNull();
    await fireEvent.press(screen.getByTestId('tournament-matches-round'));
    expect(screen.getByText('Semi-finals')).toBeTruthy();
  });

  it('a team name opens the team; a row with a match opens it', async () => {
    mockState.matches = { status: 'ready', matches: [fixture({ matchId: 'm9' })] };
    await openPage();
    await tab('matches');
    await fireEvent.press(screen.getAllByRole('link', { name: 'Open Kato United' })[0]);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'ta' } });
    await fireEvent.press(screen.getByTestId('tournament-match-f1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm9' } });
  });

  it('loading, error with Try again, and empty with one button', async () => {
    mockState.matches = { status: 'loading' };
    const view = await render(<TournamentPage />);
    await tab('matches');
    expect(screen.getByTestId('tournament-matches-skeleton')).toBeTruthy();
    await act(async () => view.unmount());
    mockState.matches = { status: 'error', message: 'x' };
    const again = await render(<TournamentPage />);
    await tab('matches');
    expect(screen.getByText('Couldn’t load the matches.')).toBeTruthy();
    await act(async () => again.unmount());
    mockState.matches = { status: 'ready', matches: [] };
    await render(<TournamentPage />);
    await tab('matches');
    expect(screen.getByText('No matches yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'See standings' }));
    expect(screen.getByTestId('tournament-standings')).toBeTruthy();
  });

  it('By team reads one team’s matches', async () => {
    mockState.tournament = {
      status: 'ready',
      tournament: tournament({ teams: [{ teamId: 'ta', teamName: 'Kato United', kitColour: 'kitRed', group: 'A', groupPos: 1 }] }),
    };
    await openPage();
    await tab('matches');
    await fireEvent.press(screen.getByTestId('tournament-matches-team'));
    await fireEvent.press(screen.getByText('Kato United'));
    expect(mockMatchesArgs[mockMatchesArgs.length - 1]).toEqual(['T1', 'ta']);
  });
});

describe('Standings', () => {
  it('one table per group, the top two marked for the quarter-finals, my team highlighted, and Rules', async () => {
    mockState.standings = {
      status: 'ready',
      standings: {
        rules: RULES,
        groups: [
          { group: 'A', needsDraw: false, rows: [groupRow('c1', 'Kato United', 1, 9), groupRow('t2', 'Lions', 2, 6), groupRow('t3', 'Owls', 3, 3), groupRow('t4', 'Bulls', 4, 0)] },
          { group: 'B', needsDraw: false, rows: [] },
        ],
      },
    };
    await openPage();
    await tab('standings');
    expect(screen.getByTestId('tournament-group-A')).toBeTruthy();
    expect(screen.queryByTestId('tournament-group-B')).toBeNull();
    expect(screen.getAllByTestId('tournament-standings-qualifies')).toHaveLength(2);
    expect(screen.getByTestId('tournament-standings-row-mine').props.accessibilityLabel).toContain('Kato United');
    await fireEvent.press(screen.getByTestId('tournament-standings-rules'));
    expect(screen.getByTestId('tournament-standings-rules-text')).toHaveTextContent(RULES);
  });

  it('before the groups: one line and See matches; loading and error', async () => {
    await openPage();
    await tab('standings');
    expect(screen.getByText('No groups yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'See matches' }));
    expect(screen.getByTestId('competition-tab-matches').props.accessibilityState).toEqual({ selected: true });
  });

  it('loading and error', async () => {
    mockState.standings = { status: 'loading' };
    const view = await render(<TournamentPage />);
    await tab('standings');
    expect(screen.getByTestId('tournament-standings-skeleton')).toBeTruthy();
    await act(async () => view.unmount());
    mockState.standings = { status: 'error', message: 'x' };
    await render(<TournamentPage />);
    await tab('standings');
    expect(screen.getByText('Couldn’t load the standings.')).toBeTruthy();
  });
});

describe('Knockout', () => {
  it('the fixed quarter-finals in bracket order, then SF1 = W QF1 v W QF3 and SF2 = W QF2 v W QF4, then the final', async () => {
    await openPage();
    await tab('knockout');
    const ids = screen
      .getAllByTestId(/^tournament-knockout-(QF\d|SF\d|F)$/)
      .map((el) => el.props.testID);
    expect(ids).toEqual([
      'tournament-knockout-QF1',
      'tournament-knockout-QF3',
      'tournament-knockout-QF2',
      'tournament-knockout-QF4',
      'tournament-knockout-SF1',
      'tournament-knockout-SF2',
      'tournament-knockout-F',
    ]);
    expect(screen.getByTestId('tournament-knockout-QF1-home')).toHaveTextContent('A1');
    expect(screen.getByTestId('tournament-knockout-QF1-away')).toHaveTextContent('D2');
    expect(screen.getByTestId('tournament-knockout-QF2-home')).toHaveTextContent('A2');
    expect(screen.getByTestId('tournament-knockout-QF2-away')).toHaveTextContent('B1');
    expect(screen.getByTestId('tournament-knockout-QF3-home')).toHaveTextContent('B2');
    expect(screen.getByTestId('tournament-knockout-QF3-away')).toHaveTextContent('C1');
    expect(screen.getByTestId('tournament-knockout-QF4-home')).toHaveTextContent('C2');
    expect(screen.getByTestId('tournament-knockout-QF4-away')).toHaveTextContent('D1');
    expect(screen.getByTestId('tournament-knockout-SF1-home')).toHaveTextContent('Winner QF1');
    expect(screen.getByTestId('tournament-knockout-SF1-away')).toHaveTextContent('Winner QF3');
    expect(screen.getByTestId('tournament-knockout-SF2-home')).toHaveTextContent('Winner QF2');
    expect(screen.getByTestId('tournament-knockout-SF2-away')).toHaveTextContent('Winner QF4');
  });

  it('a known team opens its page; a drawn game shows AP with the shootout; the champion when finished', async () => {
    const final = slot('F', 'final', 'Winner SF1', 'Winner SF2', {
      fixtureId: 'fF',
      status: 'completed',
      homeTeamId: 'ta',
      homeTeamName: 'Kato United',
      homeKitColour: 'kitRed',
      awayTeamId: 'tb',
      awayTeamName: 'Paphos 5',
      awayKitColour: 'kitBlue',
      homeScore: 2,
      awayScore: 2,
      homePens: 5,
      awayPens: 4,
      winnerTeamId: 'ta',
      matchId: null,
    });
    mockState.knockout = { status: 'ready', slots: [...SLOTS.slice(0, 6), final] };
    mockState.tournament = { status: 'ready', tournament: tournament({ status: 'finished', championTeamId: 'ta' }) };
    await openPage();
    await tab('knockout');
    expect(screen.getByTestId('tournament-knockout-F-status')).toHaveTextContent('AP 5–4');
    expect(within(screen.getByTestId('tournament-champion')).getByText('Kato United')).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId('tournament-knockout-F')).getByRole('link', { name: 'Open Paphos 5' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'tb' } });
  });

  it('no champion before the close', async () => {
    await openPage();
    await tab('knockout');
    expect(screen.queryByTestId('tournament-champion')).toBeNull();
  });

  it('loading and error with Try again', async () => {
    mockState.knockout = { status: 'loading' };
    const view = await render(<TournamentPage />);
    await tab('knockout');
    expect(screen.getByTestId('tournament-knockout-skeleton')).toBeTruthy();
    await act(async () => view.unmount());
    mockState.knockout = { status: 'error', message: 'x' };
    await render(<TournamentPage />);
    await tab('knockout');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
  });
});

describe('Words', () => {
  it('buttons and tabs are 1-3 words', async () => {
    await openPage();
    const labels = [
      ...screen.getAllByRole('tab').map((t) => (t.props.accessibilityLabel as string).replace(', Premium', '')),
      screen.getByTestId('tournament-register').props.accessibilityLabel as string,
    ];
    for (const label of labels) expect(label.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
  });
});
