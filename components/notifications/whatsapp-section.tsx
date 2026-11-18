// WhatsApp reminders in Notification settings (A9; 05 section 13): the
// player adds their WhatsApp number, then picks push, WhatsApp or both for
// each reminder that can go by WhatsApp. Hidden while Futty has WhatsApp
// switched off. The server checks every write.
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { notificationLabel } from '@/lib/notifications';
import {
  type Channel,
  describeWhatsAppError,
  getWhatsAppState,
  setNotificationChannel,
  setWhatsAppNumber,
  stopWhatsApp,
  type WhatsAppState,
} from '@/lib/whatsapp';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'both', label: 'Both' },
];

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; state: WhatsAppState };

export function WhatsAppSection() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { state, error: loadError } = await getWhatsAppState();
    setLoad(loadError || !state ? { status: 'error' } : { status: 'ready', state });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (load.status === 'loading') {
    return (
      <View testID="whatsapp-skeleton">
        <SkeletonText lines={2} />
      </View>
    );
  }
  if (load.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load your WhatsApp settings." action={{ label: 'Try again', onPress: reload }} />;
  }
  const { state } = load;
  if (!state.enabled) return null;

  async function run(action: () => Promise<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action();
    if (actionError) setError(describeWhatsAppError(actionError.message));
    await reload();
    setBusy(false);
  }

  return (
    <View style={styles.section} testID="whatsapp-section">
      <SectionHeader title="WhatsApp reminders" />
      <Text variant="callout" tone="inkMuted">
        Get game reminders on WhatsApp as well as, or instead of, push. Reply STOP on WhatsApp at any time to stop them.
      </Text>
      {error ? <Banner tone="danger" message={error} /> : null}
      {state.phone ? (
        <>
          <Card padded={false}>
            <ListRow
              title={state.phone}
              subtitle="Your WhatsApp number"
              leading={{ icon: 'bubble.left.fill' }}
              trailing={<Button label="Stop" variant="plain" onPress={() => run(stopWhatsApp)} disabled={busy} />}
            />
          </Card>
          {state.types.map((type) => (
            <View key={type} style={styles.choice} testID={`whatsapp-channel-${type}`}>
              <Text variant="body">{notificationLabel(type)}</Text>
              <SegmentedControl
                accessibilityLabel={`${notificationLabel(type)} by`}
                options={CHANNELS}
                value={state.channels[type] ?? 'push'}
                onChange={(channel) => run(() => setNotificationChannel(type, channel))}
              />
            </View>
          ))}
        </>
      ) : (
        <Card>
          <View style={styles.form}>
            <TextField
              label="WhatsApp number"
              helper="With the country code, like +357 99 123456."
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <Button
              label="Turn on WhatsApp reminders"
              onPress={() => run(() => setWhatsAppNumber(phone))}
              disabled={busy || phone.trim() === ''}
            />
          </View>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  choice: { gap: space.xs },
  form: { gap: space.md },
});
