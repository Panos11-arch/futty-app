import { render, screen } from '@testing-library/react-native';

import { TeamOfTheWeekHome } from '@/components/match/team-of-the-week-home';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

let mockCity: string | null = 'Nicosia';
let mockTeams: unknown = { status: 'loading', reload: jest.fn() };
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ status: 'ready', profile: { city: mockCity } }),
}));
jest.mock('@/lib/match/use-stats', () => ({
  useLatestTeamsOfTheWeek: () => mockTeams,
  useTeamOfTheWeekPlayers: () => ({ status: 'ready', players: [], reload: jest.fn() }),
}));

const nicosia = {
  id: 'c',
  week_start: '2026-11-09',
  scope: 'city',
  venue_id: null,
  city_key: 'nicosia',
  league_id: null,
  name: 'Nicosia',
  matches: 3,
};

describe('TeamOfTheWeekHome', () => {
  it('shows the viewer’s city’s team', async () => {
    mockTeams = { status: 'ready', teams: [nicosia], reload: jest.fn() };
    await render(<TeamOfTheWeekHome />);
    expect(screen.getByTestId('home-team-of-the-week')).toBeTruthy();
    expect(screen.getByText('See all')).toBeTruthy();
  });

  it('nothing while loading, or with no team for the city, or no city', async () => {
    mockTeams = { status: 'loading', reload: jest.fn() };
    const { rerender } = await render(<TeamOfTheWeekHome />);
    expect(screen.queryByTestId('home-team-of-the-week')).toBeNull();
    mockTeams = { status: 'ready', teams: [{ ...nicosia, city_key: 'limassol' }], reload: jest.fn() };
    await rerender(<TeamOfTheWeekHome />);
    expect(screen.queryByTestId('home-team-of-the-week')).toBeNull();
    mockCity = null;
    mockTeams = { status: 'ready', teams: [nicosia], reload: jest.fn() };
    await rerender(<TeamOfTheWeekHome />);
    expect(screen.queryByTestId('home-team-of-the-week')).toBeNull();
  });
});
