// Adding a combination (P6e; spec 13 "Venue setup"): which of the venue's
// pitches combine for a format. Two or more different pitches; Add stays
// greyed out until there are.
import { useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { Button, Chip, Sheet, Text } from '@/components/ui';
import { ChipRow, setupStyles } from '@/components/venue/setup-parts';
import { FORMATS, type SetupPitch } from '@/lib/venue-setup';

export function CombinationSheet({
  pitches,
  onClose,
  onAdd,
}: {
  pitches: SetupPitch[];
  onClose: () => void;
  /** Null when added, or the server's refusal in words. */
  onAdd: (format: string, pitchIds: string[]) => Promise<string | null>;
}) {
  const { height } = useWindowDimensions();
  const [format, setFormat] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : pitches.map((p) => p.id).filter((x) => x === id || list.includes(x))));
  }

  async function add() {
    if (busy || !format || picked.length < 2) return;
    setBusy(true);
    setError(null);
    const refusal = await onAdd(format, picked);
    setBusy(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <Sheet visible onClose={onClose} title="Add combination">
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={setupStyles.sheet}>
        <Text variant="callout">Format</Text>
        <ChipRow>
          {FORMATS.map((f) => (
            <Chip key={f} testID={`combo-format-${f}`} label={f} selected={f === format} onPress={() => setFormat(f)} />
          ))}
        </ChipRow>
        <Text variant="callout">Pitches that combine (two or more)</Text>
        <ChipRow>
          {pitches.map((p) => (
            <Chip
              key={p.id}
              testID={`combo-pitch-${p.id}`}
              label={p.name}
              selected={picked.includes(p.id)}
              onPress={() => toggle(p.id)}
            />
          ))}
        </ChipRow>
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          testID="combo-add"
          label="Add combination"
          loading={busy}
          disabled={!format || picked.length < 2}
          onPress={add}
        />
      </ScrollView>
    </Sheet>
  );
}
