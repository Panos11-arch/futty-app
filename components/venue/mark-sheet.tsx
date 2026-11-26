// Blocking pitches and flagging conditions for the chosen day (spec 13
// "Weather, condition warnings and blocking pitches"; spec 05 section 12,
// items 4 and 6): a day or a time range, on one pitch or every pitch.
// - Block: closes the pitches. Before it's saved, the clash sheet lists the
//   games booked then (doc 28 prompt 1); the dashboard opens it.
// - Flag: "conditions may be unsuitable". Every player booked then is told,
//   and normal cancellation rules apply.
// The default, every pitch for the whole day, is one tap once open. Opened
// from a flagged slot on the calendar, it starts on that pitch and half hour
// (a blocked slot opens BlockSheet instead, to remove that block).
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Chip, SegmentedControl, Sheet, Text, TextField } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { SLOT_STARTS, type BoardPitch } from '@/lib/venue-today';

export type MarkMode = 'block' | 'flag';

type Range = { pitchId: string | null; start: string | null; end: string | null };

export type MarkSheetProps = {
  visible: boolean;
  mode: MarkMode;
  pitches: BoardPitch[];
  /** Opened from a slot on the calendar: that pitch and time. */
  initial?: Range;
  /** Opened from a flagged slot: add a walk-in there instead. */
  onAddWalkIn?: () => void;
  onClose: () => void;
  /** Null when done, or the server's refusal in words. */
  onBlock: (input: Range & { reason: string }) => Promise<string | null>;
  onFlag: (input: Range & { note: string }) => Promise<string | null>;
};

/** Every half hour a range can end at, 07:30 to midnight. */
const ENDS = [...SLOT_STARTS.slice(1), '24:00'];

export function MarkSheet({
  visible,
  mode: initialMode,
  pitches,
  initial,
  onAddWalkIn,
  onClose,
  onBlock,
  onFlag,
}: MarkSheetProps) {
  const { height } = useWindowDimensions();
  const [mode, setMode] = useState<MarkMode>(initialMode);
  const [pitchId, setPitchId] = useState<string | null>(initial?.pitchId ?? null);
  const [span, setSpan] = useState<'day' | 'range'>(initial?.start ? 'range' : 'day');
  const [start, setStart] = useState(initial?.start ?? '18:00');
  const [end, setEnd] = useState(initial?.end ?? '20:00');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (span === 'range' && end <= start) {
      setError('Pick an end time after the start time.');
      return;
    }
    const range = { pitchId, start: span === 'range' ? start : null, end: span === 'range' ? end : null };
    setBusy(true);
    setError(null);
    const refusal = mode === 'block' ? await onBlock({ ...range, reason: text }) : await onFlag({ ...range, note: text });
    setBusy(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={mode === 'block' ? 'Block pitches' : 'Flag conditions'}>
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={styles.content}>
        <SegmentedControl
          accessibilityLabel="Block or flag"
          options={[
            { value: 'block', label: 'Block pitches' },
            { value: 'flag', label: 'Flag conditions' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'flag' ? (
          <Text tone="inkMuted">Every player booked then is told. Normal cancellation rules apply.</Text>
        ) : null}
        <View style={styles.chips}>
          <Chip
            label="All pitches"
            testID="mark-sheet-pitch-all"
            selected={pitchId === null}
            onPress={() => setPitchId(null)}
          />
          {pitches.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              testID={`mark-sheet-pitch-${p.id}`}
              selected={pitchId === p.id}
              onPress={() => setPitchId(p.id)}
            />
          ))}
        </View>
        <SegmentedControl
          accessibilityLabel="Whole day or a time range"
          options={[
            { value: 'day', label: 'Whole day', testID: 'mark-sheet-whole-day' },
            { value: 'range', label: 'Time range', testID: 'mark-sheet-time-range' },
          ]}
          value={span}
          onChange={setSpan}
        />
        {span === 'range' ? (
          <>
            <Text variant="callout">From</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {SLOT_STARTS.map((t) => (
                <Chip key={t} testID={`from-${t}`} label={t} tabular selected={t === start} onPress={() => setStart(t)} />
              ))}
            </ScrollView>
            <Text variant="callout">To</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {ENDS.map((t) => (
                <Chip key={t} testID={`to-${t}`} label={t} tabular selected={t === end} onPress={() => setEnd(t)} />
              ))}
            </ScrollView>
          </>
        ) : null}
        <TextField
          label={mode === 'block' ? 'Reason (optional)' : 'Note (optional)'}
          value={text}
          onChangeText={setText}
          placeholder={mode === 'block' ? 'For example, resurfacing' : 'For example, waterlogged'}
        />
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          label={mode === 'block' ? 'Block pitches' : 'Flag and tell players'}
          testID="mark-sheet-submit"
          loading={busy}
          onPress={submit}
        />
        {onAddWalkIn ? (
          <Button label="Add a walk-in or phone booking here" variant="plain" onPress={onAddWalkIn} />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { gap: space.sm },
});
