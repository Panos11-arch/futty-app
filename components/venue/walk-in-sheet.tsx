// Adding a walk-in or phone booking at the counter (spec 13 "Venue
// dashboard"; spec 05 section 12, item 5). It holds a real pitch, so the app
// can never double-book it. The server fills in the venue's price for the
// slot (slot_price_cents) and staff may change it, for example a discount
// for regulars: only then is the typed price sent (that money never goes
// through Futty). It can be marked paid by cash or card at once, or later.
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Chip, SegmentedControl, Sheet, Text, TextField } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { formatEuros, formatEurosPlain, parseEurosInput } from '@/lib/money/format';
import { GAME_LENGTHS, gameEnd, type BoardPitch, type CounterBookingInput, type Slot } from '@/lib/venue-today';

export type WalkInSheetProps = {
  visible: boolean;
  onClose: () => void;
  venueId: string;
  day: string;
  pitch: BoardPitch | null;
  start: string | null;
  loadPrice: (slot: Slot) => Promise<{ cents: number | null } | { error: string }>;
  /** Null when added, or the server's refusal in words. */
  onAdd: (input: CounterBookingInput) => Promise<string | null>;
};

export function WalkInSheet({ visible, onClose, venueId, day, pitch, start, loadPrice, onAdd }: WalkInSheetProps) {
  const { height } = useWindowDimensions();
  const [source, setSource] = useState<'walk_in' | 'phone'>('walk_in');
  // The shortest game that still ends by midnight (the calendar never offers
  // a start time with none).
  const [length, setLength] = useState(
    () => GAME_LENGTHS.find((minutes) => start && gameEnd(start, minutes)) ?? GAME_LENGTHS[0],
  );
  const [format, setFormat] = useState(pitch?.formats[0] ?? '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [priceText, setPriceText] = useState('');
  /** The venue's price from the server: undefined while loading, null when none. */
  const [venuePrice, setVenuePrice] = useState<number | null | undefined>(undefined);
  /** Why the venue's price couldn't be read, in the server's words. */
  const [priceError, setPriceError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'cash' | 'card' | 'later' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const end = start ? gameEnd(start, length) : null;
  /** Why nothing can be added here at all, or null. */
  const unbookable = !pitch || !start
    ? 'Pick a free slot on the calendar.'
    : !end
      ? `A game starting at ${start} can’t end by midnight. Pick an earlier time.`
      : !format
        ? 'This pitch has no formats set up, so it can’t take a booking yet.'
        : null;

  useEffect(() => {
    if (!visible || !start || !end || !format) return;
    const id = ++request.current;
    setVenuePrice(undefined);
    setPriceError(null);
    setPriceText('');
    loadPrice({ venueId, day, start, end, format }).then((result) => {
      if (id !== request.current) return;
      if ('error' in result) {
        setPriceError(result.error);
        setVenuePrice(null);
        return;
      }
      setVenuePrice(result.cents);
      setPriceText(result.cents === null ? '' : formatEurosPlain(result.cents));
    });
  }, [visible, venueId, day, start, end, format, loadPrice]);

  async function add(paidMethod: 'cash' | 'card' | null) {
    if (!pitch || !start || !end || !format || !name.trim() || busy) return;
    const typed = parseEurosInput(priceText);
    // Unchanged from the venue's price (compared in cents): the server fills it in.
    let chargedCents: number | null = null;
    if (venuePrice === null || venuePrice === undefined || typed !== venuePrice) {
      if (typed === null) {
        setError('Enter a price, like 45.00.');
        return;
      }
      chargedCents = typed;
    }
    setBusy(paidMethod ?? 'later');
    setError(null);
    const refusal = await onAdd({
      venueId,
      day,
      start,
      end,
      format,
      source,
      contactName: name.trim(),
      contactPhone: phone,
      pitchId: pitch.id,
      chargedCents,
      paidMethod,
    });
    setBusy(null);
    if (refusal) setError(refusal);
    else onClose();
  }

  const ready = !unbookable && !!name.trim() && venuePrice !== undefined;
  const title = pitch && start ? `${pitch.name} · ${start}${end ? `–${end}` : ''}` : 'Add a booking';
  const priceHelper = unbookable
    ? undefined
    : priceError
      ? `Couldn't get your price for this slot. ${priceError}`
      : venuePrice === undefined
        ? 'Getting your price…'
        : venuePrice === null
          ? 'No price is set for this slot. Enter what you charge.'
          : `Your price is ${formatEuros(venuePrice)}. Change it for a discount.`;

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView
        style={{ maxHeight: height * 0.7 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <SegmentedControl
          accessibilityLabel="How they booked"
          options={[
            { value: 'walk_in', label: 'Walk-in' },
            { value: 'phone', label: 'Phone' },
          ]}
          value={source}
          onChange={setSource}
        />
        <View style={styles.chips}>
          {GAME_LENGTHS.map((minutes) => (
            <Chip
              key={minutes}
              label={`${minutes} min`}
              selected={minutes === length}
              disabled={!start || gameEnd(start, minutes) === null}
              onPress={() => setLength(minutes)}
            />
          ))}
        </View>
        {pitch && pitch.formats.length > 1 ? (
          <View style={styles.chips}>
            {pitch.formats.map((f) => (
              <Chip key={f} label={f} selected={f === format} onPress={() => setFormat(f)} />
            ))}
          </View>
        ) : null}
        <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <TextField
          label="Phone number"
          helper="Optional. The same number is the same customer."
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <TextField
          label="Price"
          value={priceText}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
          editable={!unbookable && venuePrice !== undefined}
          helper={priceHelper}
        />
        {unbookable ? (
          <Text tone="warning" accessibilityRole="alert">
            {unbookable}
          </Text>
        ) : null}
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label="Add, paid cash" loading={busy === 'cash'} disabled={!ready} onPress={() => add('cash')} />
        <Button
          label="Add, paid card"
          variant="secondary"
          loading={busy === 'card'}
          disabled={!ready}
          onPress={() => add('card')}
        />
        <Button
          label="Add, not paid yet"
          variant="plain"
          loading={busy === 'later'}
          disabled={!ready}
          onPress={() => add(null)}
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
