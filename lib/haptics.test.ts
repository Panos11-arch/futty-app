jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const mockSettings = { haptics: true };
jest.mock('@/lib/theme/settings', () => ({ getDisplaySettings: () => mockSettings }));

import * as Haptics from 'expo-haptics';

import { haptic } from '@/lib/haptics';

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.haptics = true;
});

describe('haptics (Settings → Accessibility → Haptics)', () => {
  it('taps, succeeds and fails through expo-haptics when on', () => {
    haptic.tap();
    haptic.success();
    haptic.error();
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(1, Haptics.NotificationFeedbackType.Success);
    expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(2, Haptics.NotificationFeedbackType.Error);
  });

  it('does nothing when the player switched haptics off', () => {
    mockSettings.haptics = false;
    haptic.tap();
    haptic.success();
    haptic.error();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('never lets a haptics failure reach the caller', async () => {
    (Haptics.notificationAsync as jest.Mock).mockReturnValueOnce(Promise.reject(new Error('no engine')));
    (Haptics.impactAsync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    expect(() => haptic.success()).not.toThrow();
    expect(() => haptic.tap()).not.toThrow();
    await Promise.resolve();
  });
});
