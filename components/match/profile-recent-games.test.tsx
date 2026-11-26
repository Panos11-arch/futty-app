import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ProfileRecentGames } from '@/components/match/profile-recent-games';
import type { ProfileRecentGame } from '@/lib/match/profile-summary-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const game = (over: Partial<ProfileRecentGame> = {}): ProfileRecentGame => ({
  match_id: 'm1',
  kickoff_at: '2026-11-22T17:00:00Z',
  venue_id: 'v1',
  venue_name: 'Nuevo Campo',
  format: '5-a-side',
  label: 'Bibs',
  opponent_label: 'Non-bibs',
  team_id: null,
  opponent_team_id: null,
  goals_for: 4,
  goals_against: 1,
  result: 'W',
  goals: 2,
  assists: 1,
  rating: 8.9,
  ...over,
});

beforeEach(() => (router.push as jest.Mock).mockReset());

describe('ProfileRecentGames', () => {
  it('shows each game: result, score, venue and day, goals and assists, rating', async () => {
    await render(<ProfileRecentGames state={{ status: 'ready', games: [game()] }} onRetry={jest.fn()} />);
    expect(screen.getByText('Recent games')).toBeTruthy();
    expect(screen.getByText('4 : 1')).toBeTruthy();
    expect(screen.getByText('Nuevo Campo · Sun')).toBeTruthy();
    expect(screen.getByText('2 G · 1 A')).toBeTruthy();
    expect(screen.getByTestId('profile-recent-rating')).toHaveTextContent('8.9');
    expect(screen.getByTestId('form-chip')).toBeTruthy();
  });

  it('no rating and no goals: neither shows', async () => {
    await render(
      <ProfileRecentGames state={{ status: 'ready', games: [game({ rating: null, goals: 0, assists: 0 })] }} onRetry={jest.fn()} />,
    );
    expect(screen.queryByTestId('profile-recent-rating')).toBeNull();
    expect(screen.queryByText(/ G/)).toBeNull();
  });

  it('a row opens the match; a named team opens its page; All games opens Previous games', async () => {
    await render(
      <ProfileRecentGames
        state={{ status: 'ready', games: [game({ team_id: 't1', label: 'Kato United', opponent_label: 'Paphos 5' })] }}
        onRetry={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByTestId('profile-recent-row'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/match/[id]', params: { id: 'm1' } });
    expect(screen.getAllByTestId('profile-recent-team')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('profile-recent-team'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/team-profile', params: { teamId: 't1' } });
    await fireEvent.press(screen.getByTestId('profile-all-games'));
    expect(router.push).toHaveBeenLastCalledWith('/previous-games');
  });

  it('is hidden with no games', async () => {
    await render(<ProfileRecentGames state={{ status: 'ready', games: [] }} onRetry={jest.fn()} />);
    expect(screen.queryByTestId('profile-recent')).toBeNull();
  });

  it('loading shows a skeleton; an error offers Try again', async () => {
    const onRetry = jest.fn();
    await render(<ProfileRecentGames state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByTestId('profile-recent-skeleton')).toBeTruthy();
    await render(<ProfileRecentGames state={{ status: 'error', message: 'x' }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
