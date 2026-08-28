import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthError } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { updateProfile, useProfile } from '@/lib/use-profile';

export default function PrivacySettingsScreen() {
  const profile = useProfile();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profile.status !== 'ready') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const profileId = profile.profile.id;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const { error: updateError } = await updateProfile(profileId, { show_phone_publicly: next });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else profile.reload();
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView style={[styles.card, { borderColor: border }]}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText type="defaultSemiBold" style={styles.rowTitle}>
                Show my phone number
              </ThemedText>
              <ThemedText style={styles.rowNote}>
                Other players can see it on your Community profile. Off by default.
              </ThemedText>
            </View>
            <Switch value={profile.profile.show_phone_publicly} onValueChange={toggle} disabled={busy} />
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
  },
  rowNote: {
    fontSize: 12,
    color: FuttyColors.stone500,
  },
});
