// Module mocks shared by the U7 tests: no native icon view, no Stripe, a
// router whose calls the tests can read. Each test mocks @/lib/supabase.
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams ?? {},
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@stripe/stripe-react-native', () => ({
  usePaymentSheet: () => ({
    initPaymentSheet: (globalThis as { mockInitPaymentSheet?: jest.Mock }).mockInitPaymentSheet,
    presentPaymentSheet: (globalThis as { mockPresentPaymentSheet?: jest.Mock }).mockPresentPaymentSheet,
  }),
}));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));

// Posts format times with the phone's locale and time zone; pin them so
// snapshots read the same on every machine and in CI.
jest.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('Fri 20 Nov');
jest.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('20:00');
