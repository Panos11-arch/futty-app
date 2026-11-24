// The tab bar's buttons carry testIDs for the Maestro tests (.maestro,
// docs/testing/maestro.md). S2: Home, Community, the Card button, Rankings
// and Profile. tab-book moved to Home's Book a pitch button and tab-play to
// Account's Play row (tests/navigation/tabs.test.tsx). The layout is a route
// file, so its test lives here, outside app/.
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import TabLayout from '@/app/(tabs)/_layout';

jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/lib/use-notifications', () => ({ useNotifications: () => ({ unreadCount: 0 }) }));

const Empty = () => <View />;

it('gives each item on the bar, and the header buttons, a stable testID', async () => {
  await renderRouter(
    {
      '(tabs)/_layout': TabLayout,
      '(tabs)/index': Empty,
      '(tabs)/community': Empty,
      '(tabs)/rankings': Empty,
      '(tabs)/profile': Empty,
      '(tabs)/play': Empty,
      '(tabs)/team': Empty,
      '(tabs)/leagues': Empty,
    },
    { initialUrl: '/' },
  );
  for (const id of ['tab-home', 'tab-community', 'tab-card', 'tab-rankings', 'tab-profile', 'header-bell', 'header-menu']) {
    expect(screen.getByTestId(id)).toBeTruthy();
  }
});
