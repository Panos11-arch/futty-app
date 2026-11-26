// S8: the streak left the Profile tab (image 19) for its own Account screen.
// "People you play with most" moved back to Profile (Panos, 26 November;
// tests/profile/my-lists.test.tsx).
import { render, screen } from '@testing-library/react-native';

import StreakScreen from '@/app/account/activity/streak';

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
it('Streak shows the streak card', async () => {
  await render(<StreakScreen />);
  expect(screen.getByTestId('streak-screen')).toBeTruthy();
  expect(screen.getByTestId('streak-card-stub')).toBeTruthy();
});
