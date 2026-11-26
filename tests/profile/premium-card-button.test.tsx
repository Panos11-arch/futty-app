// U9, since S2 on the tab bar's Card button: it turns Premium right after a
// Premium purchase, when the player comes back to the tab, not on the next
// mount (S8 moved Profile's Premium row to the Account menu). Uses the real
// useProfile against a fake profiles table: the purchase is the server
// setting profiles.is_premium (the app never sets it).
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import ProfileScreen from '@/app/(tabs)/profile';
import { CardButton } from '@/components/navigation/card-button';
import { loadWithFile } from '@/components/ui/test-utils';
import { lightPalette } from '@/constants/futty-theme';

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
    useNavigation: () => ({ setOptions: jest.fn() }),
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
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/components/match/player-level', () => ({ PlayerLevelSummary: () => null }));
jest.mock('@/components/navigation/my-card-sheet', () => ({ MyCardSheet: () => null }));
jest.mock('@/lib/match/use-profile-summary', () => {
  const loading = () => ({ status: 'loading', reload: jest.fn() });
  return { useMyProfileSummary: loading, useMyProfileSeason: loading, useMyProfileRecent: loading, useMyVenues: loading };
});
jest.mock('@/lib/match/use-profile-matches', () => ({ useMyTeammates: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/lib/match/use-levels', () => ({
  STARTING_LEVEL_ROUTE: '/starting-level',
  usePlayerLevel: () => ({ status: 'loading', reload: jest.fn() }),
}));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/lib/player-card', () => ({
  cardLink: (u: string) => `https://futty.app/p/${u}`,
  fetchMyPlayerCard: () => Promise.resolve({ status: 'error' }),
}));

loadWithFile(Image);

const circle = () => StyleSheet.flatten(screen.getByTestId('tab-card-circle').props.style).backgroundColor;

it('a Premium purchase, then focusing the tab, turns the Card button Premium', async () => {
  await render(
    <>
      <ProfileScreen />
      <CardButton onPress={jest.fn()} />
    </>,
  );
  expect(await screen.findByText('Ann Lee')).toBeTruthy();
  expect(circle()).toBe(lightPalette.cardBasicBg);

  // The purchase: the server sets is_premium (verified store receipt).
  mockRow.is_premium = true;

  // Back on the Profile tab.
  await act(async () => mockFocusEffects.forEach((effect) => effect()));

  await waitFor(() => expect(circle()).toBe(lightPalette.cardPremiumBg));
});
