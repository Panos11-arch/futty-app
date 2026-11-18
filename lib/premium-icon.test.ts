// The Premium app icon (decided 18 November): Premium players' home-screen
// icon switches to the Premium logo once the server confirms a purchase,
// and back to the standard icon on the next launch after Premium ends. The
// app only follows profiles.is_premium as the server returns it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAlternateAppIcon } from 'expo-alternate-app-icons';

import { iconChange, LAUNCH_SWITCH_KEY, PREMIUM_ICON, syncPremiumIcon, syncPremiumIconAfterPurchase } from '@/lib/premium-icon';

const mockDevice = { supported: true, current: null as string | null, failSet: false };
jest.mock('expo-alternate-app-icons', () => ({
  get supportsAlternateIcons() {
    return mockDevice.supported;
  },
  getAppIconName: jest.fn(async () => mockDevice.current),
  setAlternateAppIcon: jest.fn(async (name: string | null) => {
    if (mockDevice.failSet) throw new Error('native failure');
    mockDevice.current = name;
    return name;
  }),
}));

let mockServer: { user: { id: string } | null; isPremium: boolean | null; error: unknown } = {
  user: { id: 'u1' },
  isPremium: true,
  error: null,
};
const mockCalls: unknown[][] = [];
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: mockServer.user }, error: null }) },
    from: (table: string) => {
      mockCalls.push(['from', table]);
      const query = {
        select: (cols: string) => (mockCalls.push(['select', cols]), query),
        eq: (col: string, value: string) => (mockCalls.push(['eq', col, value]), query),
        maybeSingle: async () => ({
          data: mockServer.isPremium === null ? null : { is_premium: mockServer.isPremium },
          error: mockServer.error,
        }),
      };
      return query;
    },
  },
}));

const set = setAlternateAppIcon as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockDevice.supported = true;
  mockDevice.current = null;
  mockDevice.failSet = false;
  mockServer = { user: { id: 'u1' }, isPremium: true, error: null };
  await AsyncStorage.clear();
});

describe('iconChange (the decision)', () => {
  it('a confirmed purchase by a Premium player: the Premium icon', () => {
    expect(iconChange('purchase', true, null, false)).toEqual({ to: PREMIUM_ICON });
  });
  it('a basic player: never', () => {
    expect(iconChange('purchase', false, null, false)).toBeNull();
    expect(iconChange('launch', false, null, false)).toBeNull();
  });
  it('Premium ended: back to the standard icon at launch', () => {
    expect(iconChange('launch', false, PREMIUM_ICON, false)).toEqual({ to: null });
  });
  it('already right: nothing', () => {
    expect(iconChange('purchase', true, PREMIUM_ICON, false)).toBeNull();
    expect(iconChange('launch', true, PREMIUM_ICON, false)).toBeNull();
  });
  it('Premium at launch with the standard icon: once per install', () => {
    expect(iconChange('launch', true, null, false)).toEqual({ to: PREMIUM_ICON });
    expect(iconChange('launch', true, null, true)).toBeNull();
  });
});

describe('syncPremiumIconAfterPurchase', () => {
  it('switches to the Premium icon once the server says is_premium', async () => {
    expect(await syncPremiumIconAfterPurchase()).toBe('premium');
    expect(set).toHaveBeenCalledWith(PREMIUM_ICON);
    expect(mockCalls).toEqual([['from', 'profiles'], ['select', 'is_premium'], ['eq', 'id', 'u1']]);
  });

  it('not when the server doesn’t say is_premium', async () => {
    mockServer.isPremium = false;
    expect(await syncPremiumIconAfterPurchase()).toBe('unchanged');
    expect(set).not.toHaveBeenCalled();
  });

  it('not when the profile can’t be read, or nobody is signed in', async () => {
    mockServer.error = { message: 'offline' };
    expect(await syncPremiumIconAfterPurchase()).toBe('failed');
    mockServer = { user: null, isPremium: true, error: null };
    expect(await syncPremiumIconAfterPurchase()).toBe('failed');
    expect(set).not.toHaveBeenCalled();
  });

  it('no repeat switch when the Premium icon already shows', async () => {
    mockDevice.current = PREMIUM_ICON;
    expect(await syncPremiumIconAfterPurchase()).toBe('unchanged');
    expect(set).not.toHaveBeenCalled();
  });

  it('a device without alternate icons: no call at all', async () => {
    mockDevice.supported = false;
    expect(await syncPremiumIconAfterPurchase()).toBe('unsupported');
    expect(set).not.toHaveBeenCalled();
  });

  it('a failed switch never throws', async () => {
    mockDevice.failSet = true;
    expect(await syncPremiumIconAfterPurchase()).toBe('failed');
  });
});

describe('syncPremiumIcon at launch', () => {
  it('Premium ended: back to the standard icon', async () => {
    mockDevice.current = PREMIUM_ICON;
    expect(await syncPremiumIcon('launch', false)).toBe('standard');
    expect(set).toHaveBeenCalledWith(null);
  });

  it('a basic player with the standard icon: nothing', async () => {
    expect(await syncPremiumIcon('launch', false)).toBe('unchanged');
    expect(set).not.toHaveBeenCalled();
  });

  it('Premium with the standard icon (a new phone, a reinstall): switches once per install', async () => {
    expect(await syncPremiumIcon('launch', true)).toBe('premium');
    expect(await AsyncStorage.getItem(LAUNCH_SWITCH_KEY)).toBe('1');

    // The icon went back to standard by other means: the next launch leaves it, so iOS's alert can't repeat.
    mockDevice.current = null;
    set.mockClear();
    expect(await syncPremiumIcon('launch', true)).toBe('unchanged');
    expect(set).not.toHaveBeenCalled();
  });

  it('remembers the launch switch before switching, so a killed app can’t switch again', async () => {
    set.mockImplementationOnce(async () => {
      expect(await AsyncStorage.getItem(LAUNCH_SWITCH_KEY)).toBe('1');
      return PREMIUM_ICON;
    });
    expect(await syncPremiumIcon('launch', true)).toBe('premium');
  });

  it('storage that can’t be read: no launch switch to Premium (never risk a repeated alert)', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage'));
    expect(await syncPremiumIcon('launch', true)).toBe('unchanged');
    expect(set).not.toHaveBeenCalled();
  });

  it('storage that can’t be written: the switch still happens, nothing throws', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage'));
    expect(await syncPremiumIcon('launch', true)).toBe('premium');
  });

  it('a confirmed purchase isn’t limited by the launch rule', async () => {
    await AsyncStorage.setItem(LAUNCH_SWITCH_KEY, '1');
    expect(await syncPremiumIcon('purchase', true)).toBe('premium');
  });

  it('a device without alternate icons: no call at all', async () => {
    mockDevice.supported = false;
    mockDevice.current = PREMIUM_ICON;
    expect(await syncPremiumIcon('launch', false)).toBe('unsupported');
    expect(set).not.toHaveBeenCalled();
  });
});
