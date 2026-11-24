// The no-opponent choice (B3; spec 13 "No side B by 24 hours before
// kickoff"): "Pay the whole pitch and play" or "Cancel free", on Home and in
// the booking. The amount and the deadline are the server's.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Card, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { noOpponentLines, payWholeLabel, type NoOpponentInfo } from '@/lib/booking-opposition';

export type NoOpponentPanelProps = {
  info: Pick<NoOpponentInfo, 'amount_cents' | 'choose_by'>;
  /** Home: which game ("Kamares · Pitch 2 · Thu 26 Nov · 20:00"). */
  game?: string;
  /** Each resolves to an error message, or null once done. */
  onPayWhole: () => Promise<string | null>;
  onCancelFree: () => Promise<string | null>;
  testID: string;
};

export function NoOpponentPanel({ info, game, onPayWhole, onCancelFree, testID }: NoOpponentPanelProps) {
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = noOpponentLines(info);

  async function run(kind: 'pay' | 'cancel', work: () => Promise<string | null>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const message = await work();
    setBusy(null);
    if (message) setError(message);
    else setConfirming(false);
  }

  return (
    <Card testID={testID} style={styles.card}>
      <Text variant="headline">{lines.title}</Text>
      {game ? (
        <Text variant="body" tabular>
          {game}
        </Text>
      ) : null}
      <Text variant="callout" tone="inkMuted">
        {lines.body}
      </Text>
      {confirming ? (
        <View style={styles.actions}>
          <Text variant="body">The game is cancelled and everyone gets their money back.</Text>
          <Button
            testID={`${testID}-cancel-free-confirm`}
            label="Confirm: cancel free"
            variant="destructive"
            loading={busy === 'cancel'}
            disabled={busy !== null}
            onPress={() => run('cancel', onCancelFree)}
            fullWidth
          />
          <Button label="Keep it" variant="secondary" disabled={busy !== null} onPress={() => setConfirming(false)} fullWidth />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            testID={`${testID}-pay-whole`}
            label={payWholeLabel(info.amount_cents)}
            loading={busy === 'pay'}
            disabled={busy !== null}
            onPress={() => run('pay', onPayWhole)}
            fullWidth
          />
          <Button
            testID={`${testID}-cancel-free`}
            label="Cancel free"
            variant="secondary"
            disabled={busy !== null}
            onPress={() => setConfirming(true)}
            fullWidth
          />
        </View>
      )}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  actions: { gap: space.sm, marginTop: space.xs },
});
