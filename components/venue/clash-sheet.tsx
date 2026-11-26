// The clash sheet (doc 28 prompt 1; docs/specs/13-payments-bookings.md
// "Blocking pitches", decided 18 November). Before a block is saved, every
// booking it clashes with, from venue_block_clashes:
// - app bookings: booker, players joined of needed, unpaid, payment mode,
//   and "Move pitch" to one of the server's free pitches of the same size;
// - walk-ins and phone bookings: contact, phone and what they paid;
// - a game already started stays on and is shown as such; an older booking
//   (no payment mode) must be moved or cancelled first;
// - the total, "Stripe's fees on these payments: €X.XX".
// Confirming saves with the list's quote (venue_add_block): what still
// clashes is cancelled. If the list changed meanwhile, the new one shows.
// Then staff see who to phone and what to refund at the counter.
// Every list and amount is the server's; the app adds nothing up.
import { useState } from 'react';
import { Linking, ScrollView, useWindowDimensions, View } from 'react-native';

import { Button, Chip, IconButton, SectionHeader, Sheet, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles } from '@/lib/theme';
import {
  appClashSummary,
  blockFeeLine,
  blocksOnLegacy,
  clashesToCancel,
  clashTime,
  clashTitle,
  counterClashSummary,
  counterRefundLine,
  moveLabel,
  type AppClash,
  type BlockClashes,
  type BlockConfirm,
  type BlockSaved,
  type CounterClash,
} from '@/lib/venue-today';

export type ClashSheetProps = {
  visible: boolean;
  /** The block's pitch and time, e.g. 'Pitch 1 · 18:00–20:00'. */
  label: string;
  /** The list venue_block_clashes returned when staff tapped Block. */
  clashes: BlockClashes;
  /** The list again, after a move. */
  onReload: () => Promise<{ clashes: BlockClashes } | { error: string }>;
  /** Null when moved, or the server's refusal in words. */
  onMove: (bookingId: string, pitchIds: string[]) => Promise<string | null>;
  onConfirm: (quote: string) => Promise<BlockConfirm>;
  /** A booking moved or the block saved: the day board reloads. */
  onChanged: () => void;
  onClose: () => void;
};

export function ClashSheet({ visible, label, clashes, onReload, onMove, onConfirm, onChanged, onClose }: ClashSheetProps) {
  const styles = useStyles();
  const { height } = useWindowDimensions();
  const [list, setList] = useState(clashes);
  const [moving, setMoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BlockSaved | null>(null);

  const apps = list.clashes.filter((c): c is AppClash => c.kind === 'app');
  const counters = list.clashes.filter((c): c is CounterClash => c.kind === 'counter');
  const fee = blockFeeLine(list);
  const toCancel = clashesToCancel(list);
  const legacy = blocksOnLegacy(list);

  async function move(bookingId: string, pitchIds: string[], key: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    const refusal = await onMove(bookingId, pitchIds);
    if (refusal) {
      setBusy(null);
      haptic.error();
      setError(refusal);
      return;
    }
    haptic.success();
    onChanged();
    const again = await onReload();
    setBusy(null);
    setMoving(null);
    if ('error' in again) setError(again.error);
    else setList(again.clashes);
  }

  async function confirm() {
    if (busy || legacy) return;
    setBusy('confirm');
    setError(null);
    const result = await onConfirm(list.quote);
    setBusy(null);
    if (result.status === 'saved') {
      haptic.success();
      onChanged();
      if (result.saved.call_them.length > 0) setSaved(result.saved);
      else onClose();
      return;
    }
    haptic.error();
    if (result.status === 'changed') {
      setList(result.clashes);
      setMoving(null);
    }
    setError(result.message);
  }

  if (saved) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Call them">
        <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={styles.content} testID="clash-sheet-call">
          {saved.call_them.map((contact) => {
            const refund = counterRefundLine(contact.refund_cents);
            const name = contact.contact_name ?? (contact.source === 'phone' ? 'Phone' : 'Walk-in');
            return (
              <View key={contact.booking_id} style={styles.item}>
                <View style={styles.itemText}>
                  <Text variant="headline">{name}</Text>
                  {contact.phone ? (
                    <Text tone="inkMuted" tabular>
                      {contact.phone}
                    </Text>
                  ) : null}
                  {refund ? (
                    <Text tone="warning" tabular>
                      {refund}
                    </Text>
                  ) : null}
                </View>
                {contact.phone ? (
                  <IconButton
                    icon="phone.fill"
                    accessibilityLabel={`Call ${name}`}
                    testID={`clash-sheet-call-${contact.booking_id}`}
                    onPress={() => Linking.openURL(`tel:${contact.phone}`)}
                  />
                ) : null}
              </View>
            );
          })}
          <Button label="Done" testID="clash-sheet-done" onPress={onClose} />
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Clashing games">
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={styles.content} testID="clash-sheet">
        <Text tone="inkMuted" tabular>
          {label}
        </Text>

        {apps.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="App bookings" />
            {apps.map((clash) => (
              <View key={clash.id} style={styles.item} testID={`clash-sheet-row-${clash.id}`}>
                <View style={styles.itemText}>
                  <Text variant="headline" tabular>{`${clashTime(clash)} · ${clashTitle(clash)}`}</Text>
                  <Text tone="inkMuted" tabular>
                    {appClashSummary(clash)}
                  </Text>
                  {clash.started ? <Text tone="inkMuted">Started · stays on</Text> : null}
                  {!clash.started && clash.legacy ? <Text tone="danger">Move or cancel it first.</Text> : null}
                  {!clash.started && clash.moves.length === 0 ? <Text tone="inkMuted">No free pitch</Text> : null}
                  {moving === clash.id ? (
                    <View style={styles.chips}>
                      {clash.moves.map((m, i) => (
                        <Chip
                          key={m.pitch_ids.join('+')}
                          testID={`clash-sheet-move-${clash.id}-${i}`}
                          label={moveLabel(m)}
                          onPress={() => move(clash.id, m.pitch_ids, `${clash.id}-${i}`)}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
                {!clash.started && clash.moves.length > 0 ? (
                  <Button
                    label="Move pitch"
                    size="compact"
                    variant="secondary"
                    accessibilityHint="Move to another pitch"
                    testID={`clash-sheet-move-${clash.id}`}
                    loading={busy?.startsWith(`${clash.id}-`) ?? false}
                    onPress={() => setMoving((open) => (open === clash.id ? null : clash.id))}
                  />
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {counters.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Walk-ins and phone" />
            {counters.map((clash) => (
              <View key={clash.id} style={styles.item} testID={`clash-sheet-row-${clash.id}`}>
                <View style={styles.itemText}>
                  <Text variant="headline" tabular>{`${clashTime(clash)} · ${clashTitle(clash)}`}</Text>
                  <Text tone="inkMuted" tabular>
                    {counterClashSummary(clash)}
                  </Text>
                  {clash.started ? <Text tone="inkMuted">Started · stays on</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {fee ? (
          <Text tabular testID="clash-sheet-fee">
            {fee}
          </Text>
        ) : null}
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          label={toCancel > 0 ? 'Block and cancel' : 'Block'}
          variant={toCancel > 0 ? 'destructive' : 'primary'}
          testID="clash-sheet-confirm"
          loading={busy === 'confirm'}
          disabled={legacy || (busy !== null && busy !== 'confirm')}
          onPress={confirm}
        />
        <Button label="Go back" variant="plain" testID="clash-sheet-back" disabled={busy !== null} onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  content: { gap: space.md, paddingBottom: space.sm },
  section: { gap: space.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemText: { flex: 1, gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
}));
