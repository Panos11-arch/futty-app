import { fireEvent, render, screen } from '@testing-library/react-native';

import { MatchRatingsList } from '@/components/match/match-ratings';
import { mockMatchPage, mockPagePlayer } from '@/lib/match/mock';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

beforeEach(() => mockPush.mockReset());

describe('MatchRatingsList (S13B)', () => {
  it('no ratings: one line', async () => {
    await render(<MatchRatingsList page={mockMatchPage()} />);
    expect(screen.getByText('No ratings')).toBeTruthy();
  });

  it('each rated player with their side and a badge, in the order the server gives (best first)', async () => {
    await render(
      <MatchRatingsList
        page={mockMatchPage({
          ratings: [
            { ...mockPagePlayer('p-booker'), side: 'a', rating: 9 },
            { ...mockPagePlayer('p-nikos'), side: 'b', rating: 5.4 },
          ],
        })}
      />
    );
    expect(screen.getByTestId('rating-p-booker')).toHaveTextContent('Andreas BookerBibs9.0');
    expect(screen.getByTestId('rating-p-nikos')).toHaveTextContent('Nikos AwayNon-bibs5.4');
    expect(screen.getByLabelText('Andreas Booker, Bibs, rating 9.0')).toBeTruthy();
    // No 1-10 voting any more.
    expect(screen.queryByTestId('rating-picker')).toBeNull();
    expect(screen.queryByTestId('save-rating')).toBeNull();
  });

  it('a name opens the player profile', async () => {
    await render(
      <MatchRatingsList page={mockMatchPage({ ratings: [{ ...mockPagePlayer('p-nikos'), side: 'b', rating: 7 }] })} />
    );
    await fireEvent.press(screen.getByTestId('rating-p-nikos'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'nikos' } });
  });
});
