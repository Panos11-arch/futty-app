import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';
import { Button } from '@/components/ui/button';
import { type DeleteFailure, deleteMyAccount } from '@/lib/account';
import { useAuth } from '@/lib/auth';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<DeleteFailure | null>(null);

  async function runDelete() {
    setDeleting(true);
    setError(null);
    const failure = await deleteMyAccount();
    if (failure) {
      setDeleting(false);
      setError(failure);
      return;
    }
    await signOut().catch(() => {});
    router.replace('/sign-in');
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your login, profile details and saved cards. Your past match results stay in league tables as "Deleted player". This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: runDelete },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MenuSection>
          <MenuRow icon="lock.shield.fill" label="Privacy" onPress={() => router.push('/account/settings/privacy')} />
          <MenuRow icon="bell.fill" label="Notifications" onPress={() => router.push('/account/settings/notifications')} />
          <MenuRow icon="key.fill" label="Security" onPress={() => router.push('/account/settings/security')} />
        </MenuSection>

        <MenuSection>
          <MenuRow
            icon="trash.fill"
            label="Delete account"
            destructive
            onPress={deleting ? () => {} : confirmDelete}
          />
        </MenuSection>
        {deleting ? <ActivityIndicator /> : null}
        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {error.message}
          </Text>
        ) : null}
        {error?.fix ? (
          <Button
            variant="secondary"
            testID="settings-delete-fix"
            label={error.fix === 'payments' ? 'Go to Payments' : 'Go to My bookings'}
            onPress={() => router.push(error.fix === 'payments' ? '/account/payments/owed' : '/my-bookings')}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    gap: space.xl,
    padding: space.lg,
  },
});
