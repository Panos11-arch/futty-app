// The Gipedo Pano part of a booking (P8; spec 13 "Gipedo Pano", spec 15
// section 5): where the game stands, the booking captain's choice when
// nobody took it on, pulling out with its cost shown before a second tap,
// and what the hold paid after the match. Every amount is booking_detail's.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, SectionHeader, Sheet, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { choiceWords, gipedoStatusLine, pullOutWords, settlementLine } from '@/lib/booking-gipedo';
import type { GipedoDetail } from '@/lib/booking-search';

export type GipedoPanelProps = {
  gipedo: GipedoDetail;
  /** Not cancelled and not started. */
  live: boolean;
  /** Resolve to an error message, or null when it went through. */
  onPullOut: () => Promise<string | null>;
  onChoose: (choice: 'play_normal' | 'cancel') => Promise<string | null>;
};

export function GipedoPanel({ gipedo, live, onPullOut, onChoose }: GipedoPanelProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settled = settlementLine(gipedo);
  const choice = live ? choiceWords(gipedo) : null;
  const canPullOut = live && gipedo.pull_out !== null;

  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await action();
    setBusy(false);
    if (message) setError(message);
    else setAsking(false);
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Gipedo Pano" />
      {settled ? <Text variant="body">{settled}</Text> : <Text variant="body">{gipedoStatusLine(gipedo)}</Text>}

      {choice ? (
        <>
          <Banner tone="warning" message={choice.message} />
          <Button label={choice.playLabel} onPress={() => run(() => onChoose('play_normal'))} loading={busy} fullWidth />
          <Button label={choice.cancelLabel} variant="secondary" onPress={() => run(() => onChoose('cancel'))} disabled={busy} fullWidth />
        </>
      ) : null}

      {canPullOut ? (
        <Button
          label="Pull out"
          variant="destructive"
          onPress={() => {
            setError(null);
            setAsking(true);
          }}
          fullWidth
        />
      ) : null}

      {error && !asking ? <Banner tone="danger" message={error} /> : null}

      <Sheet
        visible={asking}
        onClose={() => {
          if (!busy) setAsking(false);
        }}
        title="Pull out?"
        primaryAction={{ label: 'Confirm: pull out', onPress: () => run(onPullOut), loading: busy }}
        secondaryAction={{ label: 'Stay in', disabled: busy }}>
        {pullOutWords(gipedo).map((line) => (
          <Text key={line} variant="body">
            {line}
          </Text>
        ))}
        {error ? <Banner tone="danger" message={error} /> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
});
