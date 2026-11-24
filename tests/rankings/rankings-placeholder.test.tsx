// S2: the Rankings tab is a placeholder until S15 (images 14, 15): one line
// and one button, and Team of the Week stays one tap away.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import RankingsScreen from '@/app/(tabs)/rankings';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));

describe('Rankings (placeholder)', () => {
  it('shows one line and one button', async () => {
    await render(<RankingsScreen />);
    expect(screen.getByTestId('rankings-screen')).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('See Team of the Week opens Team of the Week', async () => {
    await render(<RankingsScreen />);
    await fireEvent.press(screen.getByTestId('rankings-totw'));
    expect(router.push).toHaveBeenCalledWith('/match/team-of-the-week');
  });
});
