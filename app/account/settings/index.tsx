import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';

export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MenuSection>
          <MenuRow icon="lock.shield.fill" label="Privacy" onPress={() => router.push('/account/settings/privacy')} />
          <MenuRow icon="bell.fill" label="Notifications" onPress={() => router.push('/account/settings/notifications')} />
          <MenuRow icon="key.fill" label="Security" onPress={() => router.push('/account/settings/security')} />
        </MenuSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 16,
  },
});
