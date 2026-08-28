import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthError } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { preferences } from '@/lib/preferences';
import { registerForPushNotifications, unregisterPushNotifications } from '@/lib/push-notifications';
import { useProfile } from '@/lib/use-profile';

function describePushFailure(reason: string) {
  switch (reason) {
    case 'not_supported_on_web':
      return 'Push notifications need iOS or Android.';
    case 'not_a_physical_device':
      return 'Push notifications need a real device, not a simulator.';
    case 'permission_denied':
      return 'Notification permission was denied — enable it in system settings.';
    case 'no_project_id':
      return 'Not set up yet — this app has no EAS project configured.';
    default:
      return reason;
  }
}

/** Real push, not an in-app list — requires the external setup described in
 *  supabase/push-notifications.sql and supabase/functions/notify-squad-post.
 *  Fails cleanly with a plain-English reason rather than a crash when that
 *  setup isn't done yet (e.g. 'no_project_id' before EAS is configured). */
export default function NotificationSettingsScreen() {
  const profile = useProfile();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const [enabled, setEnabled] = useState(preferences.isPushNotificationsEnabled());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (profile.status !== 'ready') return;

    setBusy(true);
    setError(null);

    if (next) {
      const result = await registerForPushNotifications(profile.profile.id);
      if (result.ok) {
        preferences.setPushNotificationsEnabled(true);
        setEnabled(true);
      } else {
        setError(describePushFailure(result.reason));
      }
    } else {
      await unregisterPushNotifications(profile.profile.id);
      preferences.setPushNotificationsEnabled(false);
      setEnabled(false);
    }

    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView style={[styles.card, { borderColor: border }]}>
          <View style={styles.row}>
            <IconSymbol name="bell.fill" size={18} color={FuttyColors.stone700} />
            <ThemedText style={styles.rowLabel}>Push notifications for squad posts</ThemedText>
            <Switch value={enabled} onValueChange={toggle} disabled={busy || profile.status !== 'ready'} />
          </View>
        </ThemedView>
        {error ? <AuthError>{error}</AuthError> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
  },
});
