/**
 * The only place the app calls expo-haptics (a guard checks). Every call
 * respects Settings → Accessibility → Haptics, and a haptics failure never
 * reaches the caller: the action it decorates still runs.
 */
import * as Haptics from 'expo-haptics';

import { getDisplaySettings } from '@/lib/theme/settings';

function run(fire: () => unknown) {
  if (!getDisplaySettings().haptics) return;
  try {
    void Promise.resolve(fire()).catch(() => {});
  } catch {
    // Haptics unavailable.
  }
}

export const haptic = {
  /** A light tap: primary buttons, tabs. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** After something worked: paid, booked, sent. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** After something failed. */
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
