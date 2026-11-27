// S10A admin screens (Account → Tournaments, Futty admins only): the list,
// create and edit, and running a tournament (sign-up, groups, kick-offs,
// results with penalties, the organiser's draw, close). Every call goes to
// its admin_* function with the right arguments; refusals show one line.
import '../leagues/mocks';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Modal } from 'react-native';

import AdminTournamentScreen, { mainAction, needsResult } from '@/app/admin/tournaments/[id]';
import EditTournamentScreen from '@/app/admin/tournaments/[id]/edit';
import AdminTournamentsScreen from '@/app/admin/tournaments';
import NewTournamentScreen from '@/app/admin/tournaments/new';
import { groupsComplete, placeTeam } from '@/components/competition/tournament/admin-groups-sheet';
import { loadWithFile } from '@/components/ui/test-utils';
import type { Tournament, TournamentFixture, TournamentHeader } from '@/lib/match/tournament-api';

loadWithFile(Modal);

const g = globalThis as { mockSearchParams?: Record<string, string> };

type HookState = Record<string, unknown>;
const mockState: { list: HookState; tournament: HookState; matches: HookState; standings: HookState } = {} as never;
const mockReload = jest.fn(() => Promise.resolve());
jest.mock('@/lib/match/use-tournament', () => ({
  useTournaments: () => ({ ...mockState.list, reload: mockReload }),
  useTournament: () => ({ ...mockState.tournament, reload: mockReload }),
  useTournamentMatches: () => ({ ...mockState.matches, reload: mockReload }),
  useTournamentStandings: () => ({ ...mockState.standings, reload: mockReload }),
}));
const mockApi: Record<string, jest.Mock> = {
  adminCreateTournament: jest.fn(),
  adminUpdateTournament: jest.fn(),
  adminOpenRegistration: jest.fn(),
  adminDrawGroups: jest.fn(),
  adminSetGroups: jest.fn(),
  adminSetFixtureTime: jest.fn(),
  adminSetResult: jest.fn(),
  adminSetDrawOrder: jest.fn(),
  adminCloseTournament: jest.fn(),
};
jest.mock('@/lib/match/tournament-api', () => {
  const actual = jest.requireActual('@/lib/match/tournament-api');
  const wrap = (name: string) => (...a: unknown[]) => mockApi[name](...a);
  return {
    ...actual,
    adminCreateTournament: wrap('adminCreateTournament'),
    adminUpdateTournament: wrap('adminUpdateTournament'),
    adminOpenRegistration: wrap('adminOpenRegistration'),
    adminDrawGroups: wrap('adminDrawGroups'),
    adminSetGroups: wrap('adminSetGroups'),
    adminSetFixtureTime: wrap('adminSetFixtureTime'),
    adminSetResult: wrap('adminSetResult'),
    adminSetDrawOrder: wrap('adminSetDrawOrder'),
    adminCloseTournament: wrap('adminCloseTournament'),
  };
});
jest.mock('@/lib/use-venues', () => ({
  useVenues: () => ({ status: 'ready', venues: [{ id: 'v1', name: 'Nuevo Campo', city: 'Limassol', surface: null, is_live: true }] }),
}));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const header = (over: Partial<TournamentHeader> = {}): TournamentHeader => ({
  id: 'T1',
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

const fixture = (over: Partial<TournamentFixture> = {}): TournamentFixture => ({
  fixtureId: 'f1',
  stage: 'group',
  group: 'A',
  slot: 'A-1',
  kickoffAt: null,
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

const teams = Array.from({ length: 16 }, (_, i) => ({
  teamId: `t${i + 1}`,
  teamName: `Team ${i + 1}`,
  kitColour: 'kitRed',
  group: null,
  groupPos: null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  g.mockSearchParams = { id: 'T1' };
  mockState.list = { status: 'ready', tournaments: [header()] };
  mockState.tournament = { status: 'ready', tournament: header() as Tournament };
  mockState.matches = { status: 'ready', matches: [] };
  mockState.standings = { status: 'ready', standings: { rules: '', groups: [] } };
  for (const fn of Object.values(mockApi)) fn.mockResolvedValue({ error: null });
  mockApi.adminCreateTournament.mockResolvedValue({ id: 'NEW', error: null });
});

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const pressAsync = (id: string) =>
  act(async () => {
    await fireEvent.press(screen.getByTestId(id));
  });

describe('Tournaments list', () => {
  it('lists each with its stage, "Coming soon" and teams in; a row opens it; Create', async () => {
    await render(<AdminTournamentsScreen />);
    expect(screen.getByText('Coming soon · Coming soon · 0 of 16 teams')).toBeTruthy();
    await press('admin-tournament-T1');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/admin/tournaments/[id]', params: { id: 'T1' } });
    await press('admin-tournaments-create');
    expect(router.push).toHaveBeenCalledWith('/admin/tournaments/new');
  });

  it('loading, error with Try again, and empty with Create', async () => {
    mockState.list = { status: 'loading' };
    const view = await render(<AdminTournamentsScreen />);
    expect(screen.getByTestId('admin-tournaments-skeleton')).toBeTruthy();
    await act(async () => view.unmount());
    mockState.list = { status: 'error', message: 'x' };
    const again = await render(<AdminTournamentsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
    await act(async () => again.unmount());
    mockState.list = { status: 'ready', tournaments: [] };
    await render(<AdminTournamentsScreen />);
    expect(screen.getByText('No tournaments yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    expect(router.push).toHaveBeenCalledWith('/admin/tournaments/new');
  });
});

describe('Create', () => {
  it('without dates (Coming soon): sends the server fields, then opens it', async () => {
    await render(<NewTournamentScreen />);
    await fireEvent.changeText(screen.getByTestId('admin-tournament-name'), 'Nuevo Campo Cup');
    await press('admin-tournament-area-limassol');
    await press('admin-tournament-venue-v1');
    await fireEvent.changeText(screen.getByTestId('admin-tournament-fee'), '12');
    await fireEvent.changeText(screen.getByTestId('admin-tournament-minutes'), '50');
    await pressAsync('admin-tournament-save');
    expect(mockApi.adminCreateTournament).toHaveBeenCalledWith({
      name: 'Nuevo Campo Cup',
      area: 'Limassol',
      venueId: 'v1',
      format: '5-a-side',
      startDate: null,
      endDate: null,
      registrationDeadline: null,
      squadSubs: 2,
      entryFeeCents: 1200,
      matchMinutes: 50,
    });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/admin/tournaments/[id]', params: { id: 'NEW' } });
  });

  it('a bad field says what to fix and sends nothing; a refusal says why', async () => {
    await render(<NewTournamentScreen />);
    await pressAsync('admin-tournament-save');
    expect(screen.getByTestId('admin-tournament-error')).toHaveTextContent('Add a name and an area.');
    expect(mockApi.adminCreateTournament).not.toHaveBeenCalled();
    mockApi.adminCreateTournament.mockResolvedValue({ id: null, error: { message: 'not_admin' } });
    await fireEvent.changeText(screen.getByTestId('admin-tournament-name'), 'Cup');
    await press('admin-tournament-area-nicosia');
    await fireEvent.changeText(screen.getByTestId('admin-tournament-fee'), '5');
    await fireEvent.changeText(screen.getByTestId('admin-tournament-minutes'), '40');
    await pressAsync('admin-tournament-save');
    expect(screen.getByTestId('admin-tournament-error')).toHaveTextContent('Only Futty admins can do this.');
  });
});

describe('Edit details', () => {
  it('sends only what changed, then goes back', async () => {
    await render(<EditTournamentScreen />);
    await fireEvent.changeText(screen.getByTestId('admin-tournament-start'), '2026-12-06');
    await pressAsync('admin-tournament-save');
    expect(mockApi.adminUpdateTournament).toHaveBeenCalledWith('T1', { startDate: '2026-12-06' });
    expect(router.back).toHaveBeenCalled();
  });

  it('loading and error', async () => {
    mockState.tournament = { status: 'loading' };
    const view = await render(<EditTournamentScreen />);
    expect(screen.queryByTestId('admin-tournament-form')).toBeNull();
    await act(async () => view.unmount());
    mockState.tournament = { status: 'error', message: 'x' };
    await render(<EditTournamentScreen />);
    expect(screen.getByText('Couldn’t load this tournament.')).toBeTruthy();
  });

  it('a refused edit says why and stays', async () => {
    mockApi.adminUpdateTournament.mockResolvedValue({ error: { message: 'format_locked' } });
    await render(<EditTournamentScreen />);
    await press('admin-tournament-format-7-a-side');
    await pressAsync('admin-tournament-save');
    expect(screen.getByTestId('admin-tournament-error')).toHaveTextContent('Teams have signed up, so the format can’t change.');
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('Run a tournament', () => {
  it('one main action per stage', () => {
    const t = (status: Tournament['status']) => ({ ...header(), status }) as Tournament;
    expect(mainAction(t('coming_soon'), [])?.label).toBe('Open sign-up');
    expect(mainAction(t('registration'), [])?.label).toBe('Draw groups');
    expect(mainAction(t('groups'), [])).toBeNull();
    expect(mainAction(t('knockout'), [fixture({ stage: 'final', status: 'scheduled' })])).toBeNull();
    expect(mainAction(t('knockout'), [fixture({ stage: 'final', status: 'completed' })])?.label).toBe('Close');
    expect(mainAction(t('finished'), [])).toBeNull();
  });

  it('a match needs a result once its kick-off has passed', () => {
    const now = new Date('2026-12-06T20:00:00Z');
    expect(needsResult(fixture({ kickoffAt: '2026-12-06T17:00:00Z' }), now)).toBe(true);
    expect(needsResult(fixture({ kickoffAt: '2026-12-07T17:00:00Z' }), now)).toBe(false);
    expect(needsResult(fixture({ kickoffAt: '2026-12-06T17:00:00Z', status: 'completed' }), now)).toBe(false);
    expect(needsResult(fixture({ kickoffAt: '2026-12-06T17:00:00Z', homeTeamId: null }), now)).toBe(false);
    expect(needsResult(fixture(), now)).toBe(false);
  });

  it('Open sign-up', async () => {
    await render(<AdminTournamentScreen />);
    await pressAsync('admin-open-registration');
    expect(mockApi.adminOpenRegistration).toHaveBeenCalledWith('T1');
    expect(mockReload).toHaveBeenCalled();
    await press('admin-edit-details');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/admin/tournaments/[id]/edit', params: { id: 'T1' } });
  });

  it('Draw groups; a refusal says why', async () => {
    mockState.tournament = { status: 'ready', tournament: { ...header({ status: 'registration', comingSoon: false, teamsCount: 12 }), teams } };
    mockApi.adminDrawGroups.mockResolvedValue({ error: { message: 'teams_missing' } });
    await render(<AdminTournamentScreen />);
    await pressAsync('admin-draw-groups');
    expect(mockApi.adminDrawGroups).toHaveBeenCalledWith('T1');
    expect(screen.getByTestId('admin-tournament-error')).toHaveTextContent('The groups need all 16 teams. Wait for sign-ups.');
  });

  it('Set groups: four per group, in the order picked', async () => {
    mockState.tournament = { status: 'ready', tournament: { ...header({ status: 'registration', comingSoon: false, teamsCount: 16 }), teams } };
    await render(<AdminTournamentScreen />);
    await press('admin-set-groups');
    expect(screen.getByTestId('admin-groups-save')).toBeDisabled();
    const letters = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 16; i++) await press(`admin-groups-t${i + 1}-${letters[Math.floor(i / 4)]}`);
    await pressAsync('admin-groups-save');
    expect(mockApi.adminSetGroups).toHaveBeenCalledWith('T1', {
      A: ['t1', 't2', 't3', 't4'],
      B: ['t5', 't6', 't7', 't8'],
      C: ['t9', 't10', 't11', 't12'],
      D: ['t13', 't14', 't15', 't16'],
    });
  });

  it('placing teams: moves between groups, never five in one', () => {
    let groups = { A: ['1', '2', '3', '4'], B: [], C: [], D: [] } as Record<'A' | 'B' | 'C' | 'D', string[]>;
    expect(placeTeam(groups, '5', 'A')).toBe(groups);
    groups = placeTeam(groups, '1', 'B');
    expect(groups).toEqual({ A: ['2', '3', '4'], B: ['1'], C: [], D: [] });
    expect(placeTeam(groups, '1', 'B')).toEqual({ A: ['2', '3', '4'], B: [], C: [], D: [] });
    expect(groupsComplete(groups)).toBe(false);
  });

  it('a group level on everything: the organiser’s draw, highest first', async () => {
    mockState.tournament = { status: 'ready', tournament: header({ status: 'groups', comingSoon: false }) as Tournament };
    const row = (teamId: string, teamName: string) => ({
      pos: 1, teamId, teamName, kitColour: 'kitRed', played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, goalDiff: 0, points: 4, qualifies: true,
    });
    mockState.standings = {
      status: 'ready',
      standings: { rules: '', groups: [{ group: 'B', needsDraw: true, rows: [row('x', 'Owls'), row('y', 'Bulls')] }] },
    };
    await render(<AdminTournamentScreen />);
    await press('admin-needs-draw-B');
    expect(screen.getByTestId('admin-draw-save')).toBeDisabled();
    await press('admin-draw-y');
    await press('admin-draw-x');
    await pressAsync('admin-draw-save');
    expect(mockApi.adminSetDrawOrder).toHaveBeenCalledWith('T1', 'B', ['y', 'x']);
  });

  it('a match: set its kick-off in Cyprus time; a bad time says so', async () => {
    mockState.tournament = { status: 'ready', tournament: header({ status: 'groups', comingSoon: false }) as Tournament };
    mockState.matches = { status: 'ready', matches: [fixture()] };
    await render(<AdminTournamentScreen />);
    expect(screen.getByText('Group stage')).toBeTruthy();
    await press('admin-fixture-f1');
    await fireEvent.changeText(screen.getByTestId('admin-fixture-day'), '2026-12-06');
    await fireEvent.changeText(screen.getByTestId('admin-fixture-time'), '7pm');
    await pressAsync('admin-fixture-set-time');
    expect(screen.getByTestId('admin-fixture-error')).toHaveTextContent('Pick a valid kick-off time.');
    await fireEvent.changeText(screen.getByTestId('admin-fixture-time'), '19:00');
    await pressAsync('admin-fixture-set-time');
    expect(mockApi.adminSetFixtureTime).toHaveBeenCalledWith('f1', '2026-12-06T17:00:00.000Z');
  });

  it('a played group match needs a result: the score, no penalties', async () => {
    mockState.tournament = { status: 'ready', tournament: header({ status: 'groups', comingSoon: false }) as Tournament };
    mockState.matches = { status: 'ready', matches: [fixture({ kickoffAt: '2026-01-01T17:00:00Z' })] };
    await render(<AdminTournamentScreen />);
    expect(screen.getByText('Needs a result')).toBeTruthy();
    await press('admin-fixture-pending-f1');
    await press('admin-fixture-home-plus');
    await press('admin-fixture-away-plus');
    expect(screen.queryByTestId('admin-fixture-home-pens-plus')).toBeNull();
    await pressAsync('admin-fixture-save-result');
    expect(mockApi.adminSetResult).toHaveBeenCalledWith('f1', 1, 1, null);
  });

  it('a level knockout result needs the shootout; refusals show one line', async () => {
    mockState.tournament = { status: 'ready', tournament: header({ status: 'knockout', comingSoon: false }) as Tournament };
    mockState.matches = { status: 'ready', matches: [fixture({ fixtureId: 'q1', stage: 'qf', group: null, slot: 'QF1' })] };
    mockApi.adminSetResult.mockResolvedValueOnce({ error: { message: 'next_round_played' } });
    await render(<AdminTournamentScreen />);
    await press('admin-fixture-q1');
    await press('admin-fixture-home-pens-plus');
    await press('admin-fixture-home-pens-plus');
    await press('admin-fixture-home-pens-plus');
    await press('admin-fixture-away-pens-plus');
    await pressAsync('admin-fixture-save-result');
    expect(mockApi.adminSetResult).toHaveBeenCalledWith('q1', 0, 0, { home: 3, away: 1 });
    expect(screen.getByTestId('admin-fixture-error')).toHaveTextContent('The next round has started. This can’t change now.');
  });

  it('Close once the final is played', async () => {
    mockState.tournament = { status: 'ready', tournament: header({ status: 'knockout', comingSoon: false }) as Tournament };
    mockState.matches = {
      status: 'ready',
      matches: [fixture({ fixtureId: 'fin', stage: 'final', group: null, slot: 'F', status: 'completed', homeScore: 2, awayScore: 1 })],
    };
    await render(<AdminTournamentScreen />);
    expect(within(screen.getByTestId('admin-fixture-fin')).getByText(/F · .*2–1/)).toBeTruthy();
    await pressAsync('admin-close');
    expect(mockApi.adminCloseTournament).toHaveBeenCalledWith('T1');
  });

  it('loading and error', async () => {
    mockState.tournament = { status: 'loading' };
    const view = await render(<AdminTournamentScreen />);
    expect(screen.getByTestId('admin-tournament-skeleton')).toBeTruthy();
    await act(async () => view.unmount());
    mockState.tournament = { status: 'error', message: 'x' };
    await render(<AdminTournamentScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
  });
});
