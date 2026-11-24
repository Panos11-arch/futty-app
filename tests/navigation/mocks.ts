// Module mocks shared by the navigation tests: no Supabase client, no
// native icon view, and the server data the tab bar and header read (a
// Basic player with nothing unread).
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ status: 'ready', profile: { is_premium: false, role: 'player' }, reload: jest.fn() }),
}));
jest.mock('@/lib/use-notifications', () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
