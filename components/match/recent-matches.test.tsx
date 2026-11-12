import { fireEvent, render, screen } from '@testing-library/react-native';

import { RecentMatches } from '@/components/match/recent-matches';
import type { PlayerRecentMatchRow } from '@/lib/match/types';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const row = (over: Partial<PlayerRecentMatchRow>): PlayerRecentMatchRow => ({
  profile_id: 'me',
  match_id: 'm1',
  kickoff_at: '2026-11-07T17:00:00Z',
  kickoff_local: '2026-11-07T19:00:00',
  venue_id: 'v1',
  venue_name: 'Nuevo Campo',
  kind: 'named',
  side: 'a',
  label: 'Lions',
  opponent_label: 'Tigers',
  team_id: 't1',
  opponent_team_id: 't2',
  goals_for: 3,
  goals_against: 1,
  result: 'W',
  forfeit_side: null,
  forfeit_reason: null,
  ...over,
});

const rows = [
  row({ match_id: 'm3', result: 'L_forfeit', goals_for: null, goals_against: null, forfeit_side: 'a', forfeit_reason: 'pulled_out' }),
  row({ match_id: 'm2', kickoff_at: '2026-11-03T17:00:00Z', result: 'D', goals_for: 2, goals_against: 2 }),
  row({ match_id: 'm1', kickoff_at: '2026-10-31T17:00:00Z' }),
];

beforeEach(() => mockPush.mockReset());

describe('RecentMatches', () => {
  it('keeps the server’s order and result chips, a forfeit as "L (forfeit)"', async () => {
    await render(<RecentMatches state={{ status: 'ready', rows }} onRetry={jest.fn()} />);
    const chips = screen.getAllByTestId('form-chip').map((c) => c.props.accessibilityLabel);
    expect(chips).toEqual(['lost by forfeit', 'drew', 'won']);
    expect(screen.getByText('L (forfeit)')).toBeTruthy();
    expect(screen.getByText('Forfeit')).toBeTruthy();
    expect(screen.getByText('Lions pulled out')).toBeTruthy();
    expect(screen.getByText('2 – 2')).toBeTruthy();
  });

  it('a confirmed match opens its match page', async () => {
    await render(<RecentMatches state={{ status: 'ready', rows: [rows[2]] }} onRetry={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm1' } });
  });

  it('loading: skeleton rows', async () => {
    await render(<RecentMatches state={{ status: 'loading' }} onRetry={jest.fn()} />);
    expect(screen.getAllByTestId('match-row-skeleton')).toHaveLength(2);
  });

  it('empty: says so', async () => {
    await render(<RecentMatches state={{ status: 'ready', rows: [] }} onRetry={jest.fn()} />);
    expect(screen.getByText('No confirmed matches yet')).toBeTruthy();
  });

  it('error: retry', async () => {
    const onRetry = jest.fn();
    await render(<RecentMatches state={{ status: 'error' }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
