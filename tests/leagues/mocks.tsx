// Module mocks shared by the Leagues screen tests (S9): no native icon view,
// a router whose calls the tests read, no safe-area provider and no native
// date picker. Each test mocks @/lib/supabase or the hooks itself.
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) },
    Redirect: () => null,
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
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Picker = (props: Record<string, unknown>) => <View {...props} />;
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});
