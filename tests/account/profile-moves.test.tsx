// S8: the streak and "Players you play with most" left the Profile tab
// (image 19) for their own Account screens.
import { render, screen } from '@testing-library/react-native';

import StreakScreen from '@/app/account/activity/streak';
import TeammatesScreen from '@/app/account/activity/teammates';

const mockTeammatesReload = jest.fn();
let mockLimit: number | undefined;

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    Stack: { Screen: () => null },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/components/stats/streak-card', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { StreakCard: () => <View testID="streak-card-stub" /> };
});
jest.mock('@/lib/match/use-profile-matches', () => ({
  useMyTeammates: (limit: number) => {
    mockLimit = limit;
    return {
      status: 'ready',
      teammates: [{ teammate_profile_id: 'p2', matches_together: 2, last_played_at: '2026-11-20', name: 'Daphne', kit: null }],
      reload: mockTeammatesReload,
    };
  },
}));

it('Streak shows the streak card', async () => {
  await render(<StreakScreen />);
  expect(screen.getByTestId('streak-screen')).toBeTruthy();
  expect(screen.getByTestId('streak-card-stub')).toBeTruthy();
});

it('Teammates lists the players you play with most and reloads on focus', async () => {
  await render(<TeammatesScreen />);
  expect(screen.getByTestId('teammates-screen')).toBeTruthy();
  expect(screen.getByText('Daphne')).toBeTruthy();
  expect(mockLimit).toBe(20);
  expect(mockTeammatesReload).toHaveBeenCalled();
});
