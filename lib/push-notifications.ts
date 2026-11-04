import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

function getProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

export type PushRegistrationFailure =
  | 'not_supported_on_web'
  | 'not_a_physical_device'
  | 'permission_denied'
  | 'no_project_id'
  | string;

/** Requests permission, gets an Expo push token, and stores it — safe to call
 *  even before EAS is set up (fails cleanly with 'no_project_id' rather than
 *  throwing). See supabase/push-notifications.sql and
 *  supabase/functions/notify-squad-post/index.ts for the rest of the pipeline. */
export async function registerForPushNotifications(
  profileId: string
): Promise<{ ok: true } | { ok: false; reason: PushRegistrationFailure }> {
  if (Platform.OS === 'web') return { ok: false, reason: 'not_supported_on_web' };
  if (!Device.isDevice) return { ok: false, reason: 'not_a_physical_device' };

  // `status` comes from expo-modules-core's PermissionResponse, which npm
  // nests under expo/ so TypeScript can't see it from here — the field is
  // there at runtime.
  type WithStatus = { status: string };
  const existingStatus = ((await Notifications.getPermissionsAsync()) as unknown as WithStatus).status;
  const finalStatus =
    existingStatus === 'granted'
      ? existingStatus
      : ((await Notifications.requestPermissionsAsync()) as unknown as WithStatus).status;

  if (finalStatus !== 'granted') return { ok: false, reason: 'permission_denied' };

  const projectId = getProjectId();
  if (!projectId) return { ok: false, reason: 'no_project_id' };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { profile_id: profileId, token, platform: Platform.OS },
        { onConflict: 'profile_id,token' }
      );

    return error ? { ok: false, reason: error.message } : { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown_error' };
  }
}

/** Best-effort — if the token can't be resolved there's nothing to remove by,
 *  and that's fine: an unremoved token just means one stale row. */
export async function unregisterPushNotifications(profileId: string) {
  if (Platform.OS === 'web' || !Device.isDevice) return;

  const projectId = getProjectId();
  if (!projectId) return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').delete().eq('profile_id', profileId).eq('token', token);
  } catch {
    // no-op — see doc comment above
  }
}
