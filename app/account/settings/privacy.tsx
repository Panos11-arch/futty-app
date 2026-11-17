import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { updateProfile, useProfile } from '@/lib/use-profile';

export default function PrivacySettingsScreen() {
  const profile = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profile.status !== 'ready') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <Card testID="privacy-skeleton">
            <SkeletonText lines={2} />
          </Card>
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
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card padded={false}>
          <ListRow
            title="Show my phone number"
            subtitle="Other players can see it on your Community profile. Off by default."
            trailing={
              <Switch
                accessibilityLabel="Show my phone number"
                value={profile.profile.show_phone_publicly}
                onValueChange={toggle}
                disabled={busy}
              />
            }
          />
        </Card>
        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg },
});
