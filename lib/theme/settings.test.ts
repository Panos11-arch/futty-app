jest.mock('@/lib/auth-storage', () => {
  const map = new Map<string, string>();
  return {
    authStorage: {
      map,
      getItem: jest.fn((k: string) => map.get(k) ?? null),
      setItem: jest.fn((k: string, v: string) => void map.set(k, v)),
      removeItem: jest.fn((k: string) => void map.delete(k)),
    },
  };
});

import { authStorage } from '@/lib/auth-storage';
import { DEFAULT_SETTINGS } from '@/lib/theme/build-theme';
import {
  DISPLAY_SETTINGS_KEY,
  getDisplaySettings,
  loadDisplaySettings,
  resetDisplaySettingsCache,
  saveDisplaySettings,
} from '@/lib/theme/settings';

const mockStorage = authStorage as unknown as {
  map: Map<string, string>;
  getItem: jest.Mock;
  setItem: jest.Mock;
};
const store = mockStorage.map;

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  resetDisplaySettingsCache();
});

describe('display settings on the phone', () => {
  it('starts with the defaults', () => {
    expect(loadDisplaySettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and reads back every setting', () => {
    const next = {
      appearance: 'dark' as const,
      textScale: 1.5,
      dyslexiaFont: true,
      boldText: true,
      highContrast: true,
      reduceMotion: true,
      colourBlind: true,
      haptics: false,
    };
    saveDisplaySettings(next);
    resetDisplaySettingsCache();
    expect(loadDisplaySettings()).toEqual(next);
    expect(JSON.parse(store.get(DISPLAY_SETTINGS_KEY)!)).toEqual(next);
  });

  it('falls back to the default for a corrupt or unknown value, field by field', () => {
    store.set(
      DISPLAY_SETTINGS_KEY,
      JSON.stringify({ appearance: 'purple', textScale: 9, boldText: 'yes', haptics: false }),
    );
    expect(loadDisplaySettings()).toEqual({ ...DEFAULT_SETTINGS, textScale: 2, haptics: false });
  });

  it('falls back to the defaults when the stored text is not JSON', () => {
    store.set(DISPLAY_SETTINGS_KEY, '{nope');
    expect(loadDisplaySettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('never throws when storage throws', () => {
    mockStorage.getItem.mockImplementationOnce(() => {
      throw new Error('locked');
    });
    expect(loadDisplaySettings()).toEqual(DEFAULT_SETTINGS);
    mockStorage.setItem.mockImplementationOnce(() => {
      throw new Error('full');
    });
    expect(() => saveDisplaySettings({ ...DEFAULT_SETTINGS, haptics: false })).not.toThrow();
  });

  it('keeps the latest settings in memory for code outside React (haptics)', () => {
    expect(getDisplaySettings().haptics).toBe(true);
    saveDisplaySettings({ ...DEFAULT_SETTINGS, haptics: false });
    mockStorage.getItem.mockClear();
    expect(getDisplaySettings().haptics).toBe(false);
    expect(mockStorage.getItem).not.toHaveBeenCalled();
  });
});
