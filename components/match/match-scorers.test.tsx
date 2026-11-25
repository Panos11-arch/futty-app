import { fireEvent, render, screen } from '@testing-library/react-native';

import { MatchScorers } from '@/components/match/match-scorers';
import { mockMatchPage, mockPagePlayer } from '@/lib/match/mock';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

beforeEach(() => mockPush.mockReset());

describe('MatchScorers (read-only, S13B)', () => {
  it('no goals: one line', async () => {
    await render(<MatchScorers page={mockMatchPage()} />);
    expect(screen.getByText('No scorers yet')).toBeTruthy();
  });

  it("each side's scorers with their goals, own goals last, and assisters with their assists", async () => {
    const booker = mockPagePlayer('p-booker');
    const me = mockPagePlayer('p-me');
    const nikos = mockPagePlayer('p-nikos');
    await render(
      <MatchScorers
        page={mockMatchPage({
          goals: [
            { side: 'a', scorer: null, assist: null },
            { side: 'a', scorer: booker, assist: null },
            { side: 'a', scorer: booker, assist: me },
            { side: 'b', scorer: nikos, assist: null },
          ],
          assists: [{ ...me, side: 'a', assists: 1 }],
        })}
      />
    );
    expect(screen.getByTestId('scorer-p-booker')).toHaveTextContent('Andreas Booker2');
    expect(screen.getByTestId('scorer-own')).toHaveTextContent('Own goal1');
    // An older paired assist and a S13B tally add up.
    expect(screen.getByTestId('assister-p-me')).toHaveTextContent('Me Player2');
    expect(screen.getByTestId('scorers-b')).toHaveTextContent('Non-bibsNikos Away1');
  });

  it('a name opens the player profile; an own goal has none', async () => {
    await render(
      <MatchScorers page={mockMatchPage({ goals: [{ side: 'b', scorer: mockPagePlayer('p-nikos'), assist: null }] })} />
    );
    await fireEvent.press(screen.getByTestId('scorer-p-nikos'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'nikos' } });
  });
});
