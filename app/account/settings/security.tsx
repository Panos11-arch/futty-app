import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppLock } from '@/lib/app-lock';

export default function SecuritySettingsScreen() {
  const { supported, enabled, label, setEnabled } = useAppLock();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setEnabled(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView style={[styles.card, { borderColor: border }]}>
          {supported ? (
            <View style={styles.row}>
              <IconSymbol name="lock.fill" size={18} color={FuttyColors.stone700} />
              <ThemedText style={styles.rowLabel}>Lock with {label}</ThemedText>
              <Switch value={enabled} onValueChange={toggle} disabled={busy} />
            </View>
          ) : (
            <IconLabel icon="lock.fill" iconColor={FuttyColors.stone700} style={styles.hint}>
              {Platform.OS === 'web'
                ? 'App lock needs iOS or Android — biometrics are unavailable on web.'
                : 'No biometrics enrolled on this device, so app lock is unavailable.'}
            </IconLabel>
          )}
        </ThemedView>
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
  hint: {
    fontSize: 12,
    opacity: 0.7,
  },
});
