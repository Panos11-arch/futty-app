// Module mocks shared by the U5 tests: no native icon view, a router whose
// calls the tests can read, plain safe-area views. Each test mocks
// @/lib/supabase itself.
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useLocalSearchParams: () => (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams ?? {},
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
    useSegments: () => ['(tabs)'],
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
