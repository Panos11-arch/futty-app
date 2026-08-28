import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

export type BiometricSupport = {
  available: boolean;
  /** What the OS calls it, for use in prompts — "Face ID", "fingerprint", … */
  label: string;
};

function describe(types: LocalAuthentication.AuthenticationType[]) {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return Platform.OS === 'ios' ? 'Face ID' : 'face unlock';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return Platform.OS === 'ios' ? 'Touch ID' : 'fingerprint';
  }
  return 'biometrics';
}

/**
 * expo-local-authentication has no web implementation, so this reports
 * "unavailable" there rather than throwing.
 */
export async function getBiometricSupport(): Promise<BiometricSupport> {
  if (Platform.OS === 'web') {
    return { available: false, label: 'biometrics' };
  }

  const [hasHardware, isEnrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  return {
    // Hardware alone is not enough — with nothing enrolled there is no face or
    // finger to match against, and authenticateAsync would always fail.
    available: hasHardware && isEnrolled,
    label: describe(types),
  };
}

export async function authenticate(promptMessage: string) {
  if (Platform.OS === 'web') return false;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancel',
    // Leave the device passcode available. Disabling it means a scanner that
    // cannot read your face locks you out of your own session entirely.
    disableDeviceFallback: false,
  });

  return result.success;
}
