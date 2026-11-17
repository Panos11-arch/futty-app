import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MatchRatingsPanel } from '@/components/match/match-ratings';
import type { MatchRatings } from '@/lib/match/levels';
import { rateMatchPlayer } from '@/lib/match/levels-api';
import { mockRoster } from '@/lib/match/mock';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/levels-api', () => ({ rateMatchPlayer: jest.fn() }));

const rate = rateMatchPlayer as jest.Mock;

const ratings = (over: Partial<MatchRatings> = {}): MatchRatings => ({
  ratingsOpen: true,
  ratingsCloseAt: '2026-11-15T19:00:00.000Z',
  players: [],
  myRatings: [],
  ...over,
});

beforeEach(() => rate.mockReset().mockResolvedValue({ error: null }));

async function show(r: MatchRatings, { viewerId = 'me', member = true, names = {} as Record<string, string> } = {}) {
  const onRated = jest.fn();
  await render(
    <MatchRatingsPanel
      matchId="m1"
      ratings={r}
      names={names}
      roster={member ? { status: 'ready', roster: mockRoster() } : null}
      onRetryRoster={jest.fn()}
      viewerId={viewerId}
      onRated={onRated}
    />
  );
  return { onRated };
}

describe('MatchRatingsPanel', () => {
  it('a checked-in player rates another 1 to 10', async () => {
    const { onRated } = await show(ratings());
    await fireEvent.press(screen.getByTestId('rate-p-nikos'));
    await fireEvent.press(screen.getByTestId('score-8'));
    await fireEvent.press(screen.getByTestId('save-rating'));
    expect(rate).toHaveBeenCalledWith('m1', 'p-nikos', 8);
    await waitFor(() => expect(onRated).toHaveBeenCalled());
  });

  it("can't rate yourself, guests, leavers or players who didn't check in", async () => {
    await show(ratings());
    expect(screen.queryByTestId('rate-p-me')).toBeNull();
    expect(screen.queryByTestId('rate-p-guest')).toBeNull();
    expect(screen.queryByTestId('rate-p-left')).toBeNull();
    expect(screen.queryByTestId('rate-p-maria')).toBeNull();
  });

  it('shows "Rated" after, with no way to rate again', async () => {
    await show(ratings({ myRatings: [{ playerId: 'p-nikos', score: 6 }] }));
    expect(screen.getByTestId('rate-p-nikos')).toHaveTextContent(/Rated/);
    expect(screen.getByTestId('rate-p-booker')).not.toHaveTextContent(/Rated/);
    await fireEvent.press(screen.getByTestId('rate-p-nikos'));
    expect(screen.queryByTestId('rating-picker')).toBeNull();
  });

  it.each([
    ['rating_closed', 'Ratings for this match have closed.'],
    ['already_rated', "You've already rated this player."],
    ['cannot_rate_self', "You can't rate yourself."],
    ['not_checked_in', 'Only players who checked in can rate.'],
    ['player_not_eligible', 'You can only rate players who checked in.'],
  ])('%s is refused in words', async (code, words) => {
    rate.mockResolvedValue({ error: { message: code } });
    await show(ratings());
    await fireEvent.press(screen.getByTestId('rate-p-nikos'));
    await fireEvent.press(screen.getByTestId('score-5'));
    await fireEvent.press(screen.getByTestId('save-rating'));
    await waitFor(() => expect(screen.getByText(words)).toBeTruthy());
  });

  it('not checked in: no rating, just when it closes', async () => {
    await show(ratings(), { viewerId: 'maria' });
    expect(screen.queryByTestId('ratings-rate')).toBeNull();
    expect(screen.getByText(/Players who checked in rate each other/)).toBeTruthy();
  });

  it('while open, no ratings are shown, even your own scores', async () => {
    await show(ratings({ myRatings: [{ playerId: 'p-nikos', score: 9 }] }));
    expect(screen.queryByTestId('ratings-result')).toBeNull();
    expect(screen.queryByText('9')).toBeNull();
  });

  it('closed: only the ratings the server returned, one decimal', async () => {
    await show(
      ratings({ ratingsOpen: false, players: [{ playerId: 'p-nikos', profileId: 'nikos', rating: 7.25, count: 4 }] }),
      { names: { nikos: 'Nikos Away' } }
    );
    expect(screen.getByTestId('rating-p-nikos')).toHaveTextContent(/Nikos Away.*7\.3/);
    expect(screen.queryByTestId('rating-p-booker')).toBeNull();
  });

  it('closed with none returned: empty state', async () => {
    await show(ratings({ ratingsOpen: false }));
    expect(screen.getByText('Not enough ratings to show.')).toBeTruthy();
  });

  it('a forfeit or unconfirmed match: nothing', async () => {
    await show(ratings({ ratingsOpen: false, ratingsCloseAt: null }));
    expect(screen.queryByTestId('ratings-rate')).toBeNull();
    expect(screen.queryByTestId('ratings-result')).toBeNull();
  });

  it('squad loading or failed: skeleton, then an inline error with retry', async () => {
    const onRetryRoster = jest.fn();
    const props = { matchId: 'm1', ratings: ratings(), names: {}, viewerId: 'me', onRated: jest.fn(), onRetryRoster };
    const view = await render(<MatchRatingsPanel {...props} roster={{ status: 'loading' }} />);
    expect(screen.getByTestId('ratings-roster-skeleton')).toBeTruthy();
    await view.rerender(<MatchRatingsPanel {...props} roster={{ status: 'error', message: 'x' }} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetryRoster).toHaveBeenCalled();
  });
});
