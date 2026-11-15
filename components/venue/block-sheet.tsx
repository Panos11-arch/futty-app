// A blocked slot tapped on the calendar (spec 13 "Blocking pitches";
// removing a block, decided 14 November): which block covers it, and
// Remove block. Removing only reopens the slots to new bookings; it changes
// no booking, no player and no money.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Sheet, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import type { BoardBlock } from '@/lib/venue-today';

export type BlockSheetProps = {
  visible: boolean;
  block: BoardBlock;
  /** The block's pitch and time, e.g. 'Pitch 2 · 09:00–10:00'. */
  label: string;
  onClose: () => void;
  /** Null when removed, or the server's refusal in words. */
  onRemove: (block: BoardBlock) => Promise<string | null>;
};

export function BlockSheet({ visible, block, label, onClose, onRemove }: BlockSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const refusal = await onRemove(block);
    setBusy(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Closed to new bookings">
      <View style={styles.content}>
        <Text tabular>{[label, block.reason].filter(Boolean).join(' · ')}</Text>
        <Text tone="inkMuted">
          Removing it reopens these slots to new bookings. Games already booked and their money are not changed.
        </Text>
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label="Remove block" variant="secondary" loading={busy} onPress={remove} />
        <Button label="Keep it" variant="plain" disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingBottom: space.sm },
});
