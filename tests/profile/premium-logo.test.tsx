// U9: the Profile tab's logo turns Premium right after a Premium purchase,
// when the player comes back to the tab, not on the next mount. Uses the real
// useProfile against a fake profiles table: the purchase is the server
// setting profiles.is_premium (the app never sets it).
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';

import ProfileScreen from '@/app/(tabs)/profile';
import { loadWithFile } from '@/components/ui/test-utils';

const mockRow = {
  id: 'me',
  email: 'ann@example.com',
  username: 'ann',
  full_name: 'Ann Lee',
  position: null,
  role: 'player',
  is_premium: false,
  played: 0,
  won: 0,
  goals: 0,
};
const mockFocusEffects: (() => void)[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...mockRow }, error: null }) }),
      }),
    }),
  },
}));
jest.mock('@/lib/auth', () => {
  const user = { id: 'me', email: 'ann@example.com' };
  return { useAuth: () => ({ user, signOut: jest.fn() }) };
});
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    // Runs on mount like the real one, and again whenever the test focuses the tab.
    useFocusEffect: (effect: () => void) =>
      useEffect(() => {
        mockFocusEffects.push(effect);
        effect();
        return () => {
          mockFocusEffects.splice(mockFocusEffects.indexOf(effect), 1);
        };
      }, [effect]),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/components/match/player-match-sections', () => ({ PlayerMatchSections: () => null }));
jest.mock('@/components/match/player-level', () => ({ PlayerLevelSummary: () => null }));

loadWithFile(Image);

it('a Premium purchase, then focusing the Profile tab, shows the Premium logo', async () => {
  await render(<ProfileScreen />);
  expect(await screen.findByText('Ann Lee')).toBeTruthy();
  expect(screen.getByTestId('futty-logo-basic')).toBeTruthy();

  // The purchase: the server sets is_premium (verified store receipt).
  mockRow.is_premium = true;

  // Back on the Profile tab.
  await act(async () => mockFocusEffects.forEach((effect) => effect()));

  await waitFor(() => expect(screen.getByTestId('futty-logo-premium')).toBeTruthy());
  expect(screen.queryByTestId('futty-logo-basic')).toBeNull();
});
