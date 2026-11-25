// Module mocks shared by the Play tests (U4): no native
// icon view, and a router whose calls the tests can read. Each test mocks
// @/lib/supabase itself (a mock here would override the test's own).
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
    Redirect: () => null,
    // S13: chat screens set their own header options.
    Stack: { Screen: () => null },
    useLocalSearchParams: () => (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams ?? {},
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
