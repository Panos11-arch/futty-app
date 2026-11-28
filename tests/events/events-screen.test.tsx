// S10B: Events ("Join an event" on Home; Playtomic 06). Search, then the chips
// Format, Day and Type; cards with date | time, name, Tournament, format,
// teams "9/16", venue and "€12 per player", all from the server. A card opens
// the tournament page. Loading, empty, error and pull to refresh.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import EventsScreen from '@/app/events';
import type { TournamentHeader } from '@/lib/match/tournament-api';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
const mockList = jest.fn();
jest.mock('@/lib/match/tournament-api', () => ({
  ...jest.requireActual('@/lib/match/tournament-api'),
  listTournaments: () => mockList(),
}));

const header = (over: Partial<TournamentHeader & { firstKickoffAt: string | null }> = {}) => ({
  id: 't1',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  country: 'CY',
  format: '5-a-side',
  status: 'registration',
  comingSoon: false,
  startDate: '2026-12-06',
  endDate: '2026-12-14',
  venueId: 'v1',
  venueName: 'Nuevo Campo',
  maxTeams: 16,
  teamsCount: 9,
  entryFeeCents: 1200,
  championTeamId: null,
  firstKickoffAt: '2026-12-06T08:00:00Z',
  ...over,
});
const paphos = header({ id: 't2', name: 'Paphos Sevens', format: '7-a-side', venueName: 'Paphos Arena', area: 'Paphos',
  startDate: '2026-12-20', endDate: '2026-12-20', firstKickoffAt: null, teamsCount: 4 });

beforeEach(() => {
  jest.mocked(router.push).mockClear();
  mockList.mockReset();
  mockList.mockResolvedValue({ tournaments: [header(), paphos], error: null });
});

async function openScreen() {
  await render(<EventsScreen />);
}

describe('Events', () => {
  it('skeletons while loading', async () => {
    mockList.mockReturnValue(new Promise(() => undefined));
    await openScreen();
    expect(screen.getByTestId('events-loading')).toBeTruthy();
  });

  it('each card: date | time, name, Tournament, format, teams, venue and price', async () => {
    await openScreen();
    const card = await screen.findByTestId('events-card-t1');
    expect(within(card).getByText('Sun 6 Dec | 10:00')).toBeTruthy();
    expect(within(card).getByText('Nuevo Campo Cup')).toBeTruthy();
    expect(within(card).getByText('Tournament')).toBeTruthy();
    expect(within(card).getByText('5-a-side')).toBeTruthy();
    expect(within(card).getByText('9/16')).toBeTruthy();
    expect(within(card).getByText('Nuevo Campo')).toBeTruthy();
    expect(within(card).getByText('€12 per player')).toBeTruthy();
  });

  it('a card opens the tournament page', async () => {
    await openScreen();
    await fireEvent.press(await screen.findByTestId('events-card-t2'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/tournament/[id]', params: { id: 't2' } });
  });

  it('search narrows the list', async () => {
    await openScreen();
    await screen.findByTestId('events-card-t1');
    await fireEvent.changeText(screen.getByTestId('events-search'), 'paphos');
    expect(screen.queryByTestId('events-card-t1')).toBeNull();
    expect(screen.getByTestId('events-card-t2')).toBeTruthy();
  });

  it('the Format chip narrows it too, and clears', async () => {
    await openScreen();
    await screen.findByTestId('events-card-t1');
    await fireEvent.press(screen.getByTestId('events-chip-format'));
    await fireEvent.press(screen.getByTestId('events-format-7-a-side'));
    expect(screen.queryByTestId('events-card-t1')).toBeNull();
    expect(screen.getByTestId('events-chip-format')).toHaveTextContent('7-a-side');
    await fireEvent.press(screen.getByTestId('events-chip-format'));
    await fireEvent.press(screen.getByTestId('events-format-any'));
    expect(screen.getByTestId('events-card-t1')).toBeTruthy();
  });

  it('the Day and Type chips are there', async () => {
    await openScreen();
    await screen.findByTestId('events-card-t1');
    expect(screen.getByTestId('events-chip-day')).toBeTruthy();
    expect(screen.getByTestId('events-chip-type')).toBeTruthy();
  });

  it('nothing matches: one line and one button that clears the filters', async () => {
    await openScreen();
    await screen.findByTestId('events-card-t1');
    await fireEvent.changeText(screen.getByTestId('events-search'), 'zzz');
    expect(screen.getByText('No events found')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('events-clear'));
    expect(screen.getByTestId('events-card-t1')).toBeTruthy();
  });

  it('no events at all: one line', async () => {
    mockList.mockResolvedValue({ tournaments: [], error: null });
    await openScreen();
    expect(await screen.findByText('No events yet')).toBeTruthy();
  });

  it('an error: one line and Try again', async () => {
    mockList.mockResolvedValueOnce({ tournaments: [], error: { message: 'offline' } });
    await openScreen();
    expect(await screen.findByText('Couldn’t load events.')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByTestId('events-card-t1')).toBeTruthy();
  });

  it('pull to refresh loads it again', async () => {
    await openScreen();
    await screen.findByTestId('events-card-t1');
    const list = screen.getByTestId('events-list');
    await act(async () => {
      await list.props.onRefresh();
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
