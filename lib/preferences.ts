import { authStorage } from '@/lib/auth-storage';

const REMEMBERED_EMAIL = 'futty.remembered_email';
const BIOMETRIC_LOCK = 'futty.biometric_lock_enabled';
const PUSH_NOTIFICATIONS = 'futty.push_notifications_enabled';

// Neither value is a secret: the email is user-visible anyway, and the flag only
// says whether to prompt. Nothing here would help an attacker who already has
// the device, which is why no credential is stored.
function read(key: string) {
  try {
    return authStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) {
      authStorage?.removeItem(key);
    } else {
      authStorage?.setItem(key, value);
    }
  } catch {
    // Storage is absent while Expo prerenders the static web output, and losing
    // a preference is not worth failing a sign-in over.
  }
}

export const preferences = {
  getRememberedEmail: () => read(REMEMBERED_EMAIL),
  setRememberedEmail: (email: string | null) => write(REMEMBERED_EMAIL, email),
  isBiometricLockEnabled: () => read(BIOMETRIC_LOCK) === 'true',
  setBiometricLockEnabled: (enabled: boolean) =>
    write(BIOMETRIC_LOCK, enabled ? 'true' : null),
  isPushNotificationsEnabled: () => read(PUSH_NOTIFICATIONS) === 'true',
  setPushNotificationsEnabled: (enabled: boolean) =>
    write(PUSH_NOTIFICATIONS, enabled ? 'true' : null),
};
