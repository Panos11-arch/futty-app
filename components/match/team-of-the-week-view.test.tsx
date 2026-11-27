// S15: Rankings → Team of the Week (images 15, 27; decision 1k): the week
// and its caption, the General/League and area pickers (your city first),
// the pitch and the Player of the week, and a Premium banner for viewers
// who aren't Premium.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TeamOfTheWeekView } from '@/components/match/team-of-the-week-view';
import { testIdsInOrder } from '../../tests/ads/test-ids';
import type { TeamOfTheWeek, TeamOfTheWeekPlayer, TeamShape } from '@/lib/match/stats-api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
// G4a: the shared banner as a marker (its own rules: components/ads/ad-banner.test.tsx).
jest.mock('@/components/ads/ad-banner', () => jest.requireActual('../../tests/ads/test-ids').adBannerMarker());
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let mockProfile: Record<string, unknown> = { status: 'ready', profile: { city: 'Limassol', is_premium: true } };
jest.mock('@/lib/use-profile', () => ({ useProfile: () => mockProfile }));

let mockWeeks: Record<string, unknown> = { status: 'loading', reload: jest.fn() };
let mockTeams: Record<string, unknown> = { status: 'loading', reload: jest.fn() };
let mockPlayers: Record<string, unknown> = { status: 'loading', reload: jest.fn() };
const mockTeamsArgs: unknown[][] = [];
const mockPlayersArgs: unknown[] = [];
jest.mock('@/lib/match/use-stats', () => ({
  useTeamOfTheWeekWeeks: () => mockWeeks,
  useTeamsOfTheWeek: (...args: unknown[]) => {
    mockTeamsArgs.push(args);
    return mockTeams;
  },
  useTeamOfTheWeekPlayers: (team: unknown) => {
    mockPlayersArgs.push(team);
    return mockPlayers;
  },
}));

const team = (over: Partial<TeamOfTheWeek>): TeamOfTheWeek => ({
  id: 'all',
  week_start: '2026-11-16',
  kind: 'general',
  area: 'all',
  area_key: '',
  area_name: 'All Cyprus',
  league_id: null,
  format: '7-a-side',
  matches: 9,
  ...over,
});
const all = team({});
const limassol = team({ id: 'lim', area: 'city', area_key: 'limassol', area_name: 'Limassol' });
const venue = team({ id: 'kam', area: 'venue', area_key: 'v1', area_name: 'Kamares' });
const league = team({ id: 'lg', kind: 'league', area: 'league', area_key: 'l1', area_name: 'Limassol League', league_id: 'l1' });

const shape: TeamShape = { format: '7-a-side', keepers: 1, defenders: 2, midfielders: 3, strikers: 1 };
const potw: TeamOfTheWeekPlayer = {
  profile_id: 'pa',
  name: 'Panos',
  slot: 'fwd',
  sort: 1,
  games: 2,
  goals: 4,
  assists: 1,
  clean_sheets: 0,
  average_rating: 8.9,
  player_of_the_week: true,
};

const ready = () => {
  mockWeeks = { status: 'ready', weeks: ['2026-11-16', '2026-11-09'], reload: jest.fn() };
  mockTeams = { status: 'ready', teams: [venue, league, all, limassol], reload: jest.fn() };
  mockPlayers = { status: 'ready', players: [potw], shape, reload: jest.fn() };
};

const lastPlayersTeam = () => mockPlayersArgs[mockPlayersArgs.length - 1] as TeamOfTheWeek;

beforeEach(() => {
  mockPush.mockClear();
  mockTeamsArgs.length = 0;
  mockPlayersArgs.length = 0;
  mockProfile = { status: 'ready', profile: { city: 'Limassol', is_premium: true } };
});

const view = (props: Partial<Parameters<typeof TeamOfTheWeekView>[0]> = {}) =>
  render(<TeamOfTheWeekView format="7-a-side" onSeePowerRanking={jest.fn()} {...props} />);

describe('TeamOfTheWeekView', () => {
  it('loading: skeletons', async () => {
    mockWeeks = { status: 'loading', reload: jest.fn() };
    await view();
    expect(screen.getByTestId('totw-skeleton')).toBeTruthy();
  });

  it('error: one line and Try again', async () => {
    const reload = jest.fn();
    mockWeeks = { status: 'error', message: 'boom', reload };
    await view();
    expect(screen.getByText('Couldn’t load the Team of the Week.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(reload).toHaveBeenCalled();
  });

  it('no team yet in this format: one line and one button', async () => {
    const onSee = jest.fn();
    mockWeeks = { status: 'ready', weeks: [], reload: jest.fn() };
    await view({ onSeePowerRanking: onSee });
    expect(screen.getByText('No team yet')).toBeTruthy();
    await fireEvent.press(screen.getByText('See Power ranking'));
    expect(onSee).toHaveBeenCalled();
  });

  it('opens on the latest week, General · my city; the pitch and the Player of the week', async () => {
    ready();
    await view();
    expect(screen.getByText('16–22 Nov')).toBeTruthy();
    expect(screen.getByText('7-a-side · non-league games')).toBeTruthy();
    expect(mockTeamsArgs).toContainEqual(['2026-11-16', '7-a-side']);
    expect(screen.getByTestId('totw-kind')).toHaveTextContent('General');
    expect(screen.getByTestId('totw-area')).toHaveTextContent('Limassol');
    expect(lastPlayersTeam().id).toBe('lim');
    expect(screen.getByTestId('totw-pitch')).toBeTruthy();
    expect(screen.getByTestId('potw-card')).toBeTruthy();
    expect(screen.getAllByText('No eligible player')).toHaveLength(6);
  });

  it('no team for my city: All Cyprus', async () => {
    ready();
    mockProfile = { status: 'ready', profile: { city: 'Paphos', is_premium: true } };
    await view();
    expect(screen.getByTestId('totw-area')).toHaveTextContent('All Cyprus');
  });

  it('the area picker: All Cyprus, cities, then busy venues; choosing one shows it', async () => {
    ready();
    await view();
    await fireEvent.press(screen.getByTestId('totw-area'));
    expect(screen.getByTestId('totw-area-option-all')).toBeTruthy();
    expect(screen.getByTestId('totw-area-option-lim')).toBeTruthy();
    expect(screen.getByTestId('totw-area-option-kam')).toBeTruthy();
    expect(screen.queryByTestId('totw-area-option-lg')).toBeNull();
    await fireEvent.press(screen.getByTestId('totw-area-option-kam'));
    expect(screen.getByTestId('totw-area')).toHaveTextContent('Kamares');
    expect(lastPlayersTeam().id).toBe('kam');
  });

  it('the kind picker: League shows the league team and "league games"', async () => {
    ready();
    await view();
    await fireEvent.press(screen.getByTestId('totw-kind'));
    await fireEvent.press(screen.getByTestId('totw-kind-option-league'));
    expect(screen.getByTestId('totw-kind')).toHaveTextContent('League');
    expect(screen.getByTestId('totw-area')).toHaveTextContent('Limassol League');
    expect(screen.getByText('7-a-side · league games')).toBeTruthy();
    expect(lastPlayersTeam().id).toBe('lg');
  });

  it('the week picker: previous goes back a week; next is off on the latest', async () => {
    ready();
    await view();
    expect(screen.getByTestId('totw-week-next')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('totw-week-prev'));
    expect(screen.getByText('9–15 Nov')).toBeTruthy();
    expect(mockTeamsArgs).toContainEqual(['2026-11-09', '7-a-side']);
    expect(screen.getByTestId('totw-week-prev')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('totw-week-next'));
    expect(screen.getByText('16–22 Nov')).toBeTruthy();
  });

  it('opened on a team (a notification): its week and area', async () => {
    ready();
    mockTeams = { status: 'ready', teams: [team({ id: 'old', week_start: '2026-11-09' })], reload: jest.fn() };
    await view({ initialTeam: team({ id: 'old', week_start: '2026-11-09' }) });
    expect(screen.getByText('9–15 Nov')).toBeTruthy();
    expect(lastPlayersTeam().id).toBe('old');
  });

  it('the team’s players can fail on their own, with Try again', async () => {
    ready();
    const reload = jest.fn();
    mockPlayers = { status: 'error', message: 'boom', reload };
    await view();
    expect(screen.getByText('Couldn’t load this team.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(reload).toHaveBeenCalled();
  });

  it('a viewer who isn’t Premium: "Get Premium to be eligible", opening the plans', async () => {
    ready();
    mockProfile = { status: 'ready', profile: { city: 'Limassol', is_premium: false } };
    await view();
    expect(screen.getByText('Get Premium to be eligible')).toBeTruthy();
    await fireEvent.press(screen.getByText('See plans'));
    expect(mockPush).toHaveBeenCalledWith('/account/premium');
  });

  it('a Premium viewer sees no banner', async () => {
    ready();
    await view();
    expect(screen.queryByTestId('totw-premium-banner')).toBeNull();
  });

  it('G4a: a banner ad at the end, under the Player of the week and the Premium line (image 15)', async () => {
    ready();
    mockProfile = { status: 'ready', profile: { city: 'Limassol', is_premium: false } };
    await view();
    const ids = testIdsInOrder();
    expect(ids).toEqual(expect.arrayContaining(['rankings-totw-ad', 'potw-card', 'totw-premium-banner']));
    expect(ids.indexOf('rankings-totw-ad')).toBeGreaterThan(ids.indexOf('potw-card'));
    expect(ids.indexOf('rankings-totw-ad')).toBeGreaterThan(ids.indexOf('totw-premium-banner'));
  });

  it('G4a: no banner ad while loading, on an error or with no team (hidden empty section)', async () => {
    mockWeeks = { status: 'loading', reload: jest.fn() };
    await view();
    expect(screen.queryByTestId('rankings-totw-ad')).toBeNull();
    mockWeeks = { status: 'error', message: 'boom', reload: jest.fn() };
    await view();
    expect(screen.queryByTestId('rankings-totw-ad')).toBeNull();
    mockWeeks = { status: 'ready', weeks: [], reload: jest.fn() };
    await view();
    expect(screen.queryByTestId('rankings-totw-ad')).toBeNull();
  });
});
