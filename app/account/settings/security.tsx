import { useState } from 'react';
import { Platform, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useAppLock } from '@/lib/app-lock';

export default function SecuritySettingsScreen() {
  const styles = useStyles();
  const { supported, enabled, label, setEnabled } = useAppLock();
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
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card padded={false}>
          {supported ? (
            <ListRow
              title={`Lock with ${label}`}
              leading={{ icon: 'lock.fill' }}
              trailing={
                <Switch
                  accessibilityLabel={`Lock with ${label}`}
                  value={enabled}
                  onValueChange={toggle}
                  disabled={busy}
                />
              }
            />
          ) : (
            <ListRow
              title={
                Platform.OS === 'web'
                  ? 'App lock needs iOS or Android — biometrics are unavailable on web.'
                  : 'No biometrics enrolled on this device, so app lock is unavailable.'
              }
              leading={{ icon: 'lock.fill' }}
            />
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg },
}));
