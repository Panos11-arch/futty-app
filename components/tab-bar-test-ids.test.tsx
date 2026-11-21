// The tab bar's buttons carry testIDs for the Maestro tests (.maestro,
// docs/testing/maestro.md). The layout is a route file, so its test lives
// here, outside app/.
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import TabLayout from '@/app/(tabs)/_layout';

jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const Empty = () => <View />;

it('gives each visible tab button a stable testID', async () => {
  await renderRouter(
    {
      '(tabs)/_layout': TabLayout,
      '(tabs)/index': Empty,
      '(tabs)/book': Empty,
      '(tabs)/play': Empty,
      '(tabs)/profile': Empty,
      '(tabs)/team': Empty,
      '(tabs)/leagues': Empty,
      '(tabs)/community': Empty,
    },
    { initialUrl: '/' },
  );
  for (const id of ['tab-home', 'tab-book', 'tab-play', 'tab-profile']) {
    expect(screen.getByTestId(id)).toBeTruthy();
  }
});
