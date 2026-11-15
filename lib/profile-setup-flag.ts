// "This user has a username", remembered on this device per user id (P13), so
// an existing user isn't held on the loading screen when the profile can't be
// read (offline). The root layout still re-checks in the background. Not a
// secret and not trusted for anything else: it only skips a wait.
import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (userId: string) => `futty.has_username.${userId}`;

export async function hasStoredUsername(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(userId))) === 'true';
  } catch {
    return false;
  }
}

export async function storeHasUsername(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), 'true');
  } catch {
    // Losing it only means waiting for the profile next time.
  }
}

/** On sign-out and account deletion, and when the server says there's no username. */
export async function clearHasUsername(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(userId));
  } catch {
    // Nothing to do: the next profile read corrects it.
  }
}
