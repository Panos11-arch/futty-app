import { render, screen } from '@testing-library/react-native';

import { TeamOfTheWeekHome } from '@/components/match/team-of-the-week-home';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

let mockLatest: unknown = { status: 'loading', reload: jest.fn() };
jest.mock('@/lib/match/use-stats', () => ({
  useLatestTeamOfTheWeek: () => mockLatest,
  useTeamOfTheWeekPlayers: () => ({ status: 'ready', players: [], shape: null, reload: jest.fn() }),
}));

const team = {
  id: 't',
  week_start: '2026-11-09',
  kind: 'general',
  area: 'all',
  area_key: '',
  area_name: 'All Cyprus',
  league_id: null,
  format: '5-a-side',
  matches: 3,
};

describe('TeamOfTheWeekHome', () => {
  it('shows Futty’s latest team', async () => {
    mockLatest = { status: 'ready', team, reload: jest.fn() };
    await render(<TeamOfTheWeekHome />);
    expect(screen.getByTestId('home-team-of-the-week')).toBeTruthy();
    expect(screen.getByText('See team')).toBeTruthy();
  });

  it('nothing while loading, on an error, or before the first team', async () => {
    mockLatest = { status: 'loading', reload: jest.fn() };
    const { rerender } = await render(<TeamOfTheWeekHome />);
    expect(screen.queryByTestId('home-team-of-the-week')).toBeNull();
    mockLatest = { status: 'error', reload: jest.fn() };
    await rerender(<TeamOfTheWeekHome />);
    expect(screen.queryByTestId('home-team-of-the-week')).toBeNull();
    mockLatest = { status: 'ready', team: null, reload: jest.fn() };
    await rerender(<TeamOfTheWeekHome />);
    expect(screen.queryByTestId('home-team-of-the-week')).toBeNull();
  });
});
