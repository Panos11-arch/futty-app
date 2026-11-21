// One format's price an hour (P6e; spec 13 "Venue setup", "Pitch prices"):
// one price, the same on every day and at every hour. Staff type it; it is
// read as whole cents by parseEurosInput, never through a floating-point
// number, and the server decides whether it is allowed (a €0 price is
// refused there). New prices apply to new bookings only.
import { useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { Button, Sheet, Text, TextField } from '@/components/ui';
import { setupStyles } from '@/components/venue/setup-parts';
import { formatEurosPlain, parseEurosInput } from '@/lib/money/format';
import { NEW_PRICES_NOTE, type PriceInput, type PriceRule } from '@/lib/venue-setup';

const NOT_AN_AMOUNT = 'Enter a price like 50 or 50.50.';

export function PriceSheet({
  format,
  rule,
  onClose,
  onSave,
  onRemove,
}: {
  format: string;
  /** The saved price, or undefined when the format has none. */
  rule: PriceRule | undefined;
  onClose: () => void;
  /** Null when saved, or the server's refusal in words. */
  onSave: (input: PriceInput) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}) {
  const { height } = useWindowDimensions();
  const [priceText, setPriceText] = useState(rule ? formatEurosPlain(rule.price_cents) : '');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    const priceCents = parseEurosInput(priceText);
    if (priceCents === null) {
      setError(NOT_AN_AMOUNT);
      return;
    }
    setBusy('save');
    setError(null);
    const refusal = await onSave({ format, priceCents });
    setBusy(null);
    if (refusal) setError(refusal);
    else onClose();
  }

  async function remove() {
    if (busy) return;
    setBusy('remove');
    setError(null);
    const refusal = await onRemove();
    setBusy(null);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <Sheet visible onClose={onClose} title={`${format} price`}>
      <ScrollView
        style={{ maxHeight: height * 0.75 }}
        contentContainerStyle={setupStyles.sheet}
        keyboardShouldPersistTaps="handled">
        <Text variant="callout" tone="inkMuted">
          {NEW_PRICES_NOTE}
        </Text>
        <TextField
          label="Price an hour"
          helper="In euros, like 50 or 50.50."
          value={priceText}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
        />

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label="Save price" loading={busy === 'save'} disabled={busy === 'remove'} onPress={save} />
        {rule ? (
          <>
            <Button
              label="Remove price"
              variant="destructive"
              loading={busy === 'remove'}
              disabled={busy === 'save'}
              onPress={remove}
            />
            <Text variant="caption" tone="inkMuted">
              Without a price, nobody can book {format} here. Games already booked keep theirs.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
