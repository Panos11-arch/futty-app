// A build without the alternate-icons native module (a development build
// made before it was added, Expo Go, web): the icon is left alone and
// nothing that imports lib/premium-icon breaks.
import { syncPremiumIcon } from '@/lib/premium-icon';

jest.mock('expo-alternate-app-icons', () => {
  throw new Error("Cannot find native module 'ExpoAlternateAppIcons'");
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

it('reports unsupported, and never throws', async () => {
  expect(await syncPremiumIcon('purchase', true)).toBe('unsupported');
  expect(await syncPremiumIcon('launch', false)).toBe('unsupported');
});
