import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { LogScoreCard } from '@/components/match/log-score-card';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const match = {
  matchId: 'm1',
  kickoffAt: '2026-11-26T18:00:00.000Z',
  labelA: 'Bibs',
  labelB: 'Non-bibs',
  state: 'log' as const,
};

describe('LogScoreCard (Home, image 01)', () => {
  it('"Log the score", the sides and when; Log opens the logging screens', async () => {
    await render(<LogScoreCard match={match} />);
    expect(screen.getByText('Log the score')).toBeTruthy();
    expect(screen.getByText('Bibs v Non-bibs · Thu 26 Nov · 20:00')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-log-score-m1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm1' } });
  });

  it('when the captains disagree: "Scores differ"', async () => {
    await render(<LogScoreCard match={{ ...match, state: 'mismatch' }} />);
    expect(screen.getByText('Scores differ')).toBeTruthy();
  });
});
