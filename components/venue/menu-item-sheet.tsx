// One food or drink item (P6e; spec 13 "Venue photos, amenities and menu"):
// name, category, description, price, and for a post-match offer its offer
// price and text; the days and time window it's on; dietary tags. Prices are
// typed in euros and read as whole cents by parseEurosInput, never through a
// floating-point number; the server decides whether they are allowed (above
// €0, and an offer price below the price). A saved item can also get a
// photo, move up or down in its category, be switched off, or be deleted.
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Chip, SegmentedControl, Sheet, Text, TextField } from '@/components/ui';
import { ChipRow, ConfirmStep, setupStyles, TimeChips } from '@/components/venue/setup-parts';
import { radius, space } from '@/constants/futty-theme';
import { formatEurosPlain, parseEurosInput } from '@/lib/money/format';
import type { MenuItem, MenuItemInput } from '@/lib/venue-media';
import { OPEN_TIMES, WEEKDAYS } from '@/lib/venue-setup';

const NOT_AN_AMOUNT = 'Enter a price like 3 or 3.50.';
const DEFAULT_FROM = '17:00';
const DEFAULT_TO = '23:00';

type Refusal = Promise<string | null>;

function cents(value: number | null): string {
  return value === null ? '' : formatEurosPlain(value);
}

export function MenuItemSheet({
  item,
  photoUrl,
  canAddPhoto,
  canMoveUp,
  canMoveDown,
  onClose,
  onSave,
  onMove,
  onSetActive,
  onAddPhoto,
  onRemovePhoto,
  onDelete,
}: {
  /** The saved item, or null to add one. */
  item: MenuItem | null;
  photoUrl?: string;
  /** Photo permission is confirmed. */
  canAddPhoto: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  /** Each is null when done, or the server's refusal in words. */
  onSave: (input: MenuItemInput) => Refusal;
  onMove: (move: 'up' | 'down') => Refusal;
  onSetActive: (active: boolean) => Refusal;
  onAddPhoto: () => Refusal;
  onRemovePhoto: () => Refusal;
  onDelete: () => Refusal;
}) {
  const { height } = useWindowDimensions();
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [priceText, setPriceText] = useState(cents(item?.price_cents ?? null));
  const [offer, setOffer] = useState(item?.is_post_match_offer ?? false);
  const [offerPriceText, setOfferPriceText] = useState(cents(item?.offer_price_cents ?? null));
  const [offerText, setOfferText] = useState(item?.offer_text ?? '');
  const [days, setDays] = useState<number[]>(item?.available_weekdays ?? []);
  const [timed, setTimed] = useState(item?.available_from != null);
  const [from, setFrom] = useState(item?.available_from ?? DEFAULT_FROM);
  const [to, setTo] = useState(item?.available_to ?? DEFAULT_TO);
  const [tags, setTags] = useState((item?.dietary_tags ?? []).join(', '));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Refusal, closeAfter: boolean) {
    if (busy) return;
    setBusy(key);
    setError(null);
    const refusal = await action();
    setBusy(null);
    if (refusal) setError(refusal);
    else if (closeAfter) onClose();
  }

  function save() {
    const priceCents = parseEurosInput(priceText);
    const offerPriceCents = offer && offerPriceText.trim() ? parseEurosInput(offerPriceText) : null;
    if (priceCents === null || (offer && offerPriceText.trim() !== '' && offerPriceCents === null)) {
      setError(NOT_AN_AMOUNT);
      return;
    }
    return run(
      'save',
      () =>
        onSave({
          name,
          category,
          description,
          priceCents,
          isPostMatchOffer: offer,
          offerPriceCents,
          offerText,
          availableFrom: timed ? from : null,
          availableTo: timed ? to : null,
          availableWeekdays: days.length > 0 ? days : null,
          dietaryTags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          active: item?.active ?? true,
        }),
      true,
    );
  }

  function changeFrom(time: string) {
    setFrom(time);
    if (to <= time) setTo(OPEN_TIMES.find((t) => t > time) ?? to);
  }

  return (
    <Sheet visible onClose={onClose} title={item ? item.name : 'New item'}>
      <ScrollView
        style={{ maxHeight: height * 0.75 }}
        contentContainerStyle={setupStyles.sheet}
        keyboardShouldPersistTaps="handled">
        <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
        <TextField
          label="Category"
          helper="Optional, like Drinks or Food."
          value={category}
          onChangeText={setCategory}
          maxLength={40}
        />
        <TextField
          label="Description"
          helper="Optional."
          value={description}
          onChangeText={setDescription}
          maxLength={200}
          multiline
        />
        <TextField
          label="Price"
          helper="In euros, like 3 or 3.50."
          value={priceText}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
        />

        <SegmentedControl
          accessibilityLabel="Post-match offer or not"
          options={[
            { value: 'off', label: 'Menu item' },
            { value: 'on', label: 'Post-match offer' },
          ]}
          value={offer ? 'on' : 'off'}
          onChange={(value) => setOffer(value === 'on')}
        />
        {offer ? (
          <View style={setupStyles.sheet}>
            <Text variant="callout" tone="inkMuted">
              Players in a game here see it after the score is in, with a code to show at the counter.
            </Text>
            <TextField
              label="Offer price"
              helper="Optional. Less than the price, like 2.50."
              value={offerPriceText}
              onChangeText={setOfferPriceText}
              keyboardType="decimal-pad"
            />
            <TextField
              label="Offer text"
              helper="Optional, like 2 for 1 after your game."
              value={offerText}
              onChangeText={setOfferText}
              maxLength={120}
            />
          </View>
        ) : null}

        <Text variant="callout">Days</Text>
        <ChipRow>
          {WEEKDAYS.map((d) => (
            <Chip
              key={d.weekday}
              testID={`item-day-${d.weekday}`}
              label={d.short}
              selected={days.includes(d.weekday)}
              onPress={() =>
                setDays((current) =>
                  current.includes(d.weekday)
                    ? current.filter((x) => x !== d.weekday)
                    : [...current, d.weekday].sort((a, b) => a - b),
                )
              }
            />
          ))}
        </ChipRow>
        <Text variant="caption" tone="inkMuted">
          With no day picked, it’s on every day.
        </Text>
        <SegmentedControl
          accessibilityLabel="All day or set times"
          options={[
            { value: 'all', label: 'All day' },
            { value: 'set', label: 'Set times' },
          ]}
          value={timed ? 'set' : 'all'}
          onChange={(value) => setTimed(value === 'set')}
        />
        {timed ? (
          <>
            <TimeChips label="From" times={OPEN_TIMES} value={from} onChange={changeFrom} testPrefix="item-from" />
            <TimeChips
              label="Until"
              times={OPEN_TIMES}
              value={to}
              onChange={setTo}
              isDisabled={(t) => t <= from}
              testPrefix="item-to"
            />
          </>
        ) : null}

        <TextField
          label="Dietary tags"
          helper="Optional, separated by commas, like vegan, gluten free."
          value={tags}
          onChangeText={setTags}
        />

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label="Save item" loading={busy === 'save'} disabled={busy !== null && busy !== 'save'} onPress={save} />

        {item ? (
          <View style={setupStyles.sheet}>
            <Text variant="headline">Photo</Text>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} contentFit="cover" accessibilityLabel={item.name} style={styles.photo} />
            ) : null}
            {canAddPhoto ? (
              <Button
                label={item.photo_path ? 'Change photo' : 'Add photo'}
                variant="secondary"
                loading={busy === 'photo'}
                disabled={busy !== null && busy !== 'photo'}
                onPress={() => run('photo', onAddPhoto, false)}
              />
            ) : (
              <Text variant="callout" tone="inkMuted">
                To add photos, confirm they’re yours on the Photos screen first.
              </Text>
            )}
            {item.photo_path ? (
              <Button
                label="Remove photo"
                variant="plain"
                loading={busy === 'unphoto'}
                disabled={busy !== null && busy !== 'unphoto'}
                onPress={() => run('unphoto', onRemovePhoto, false)}
              />
            ) : null}

            <Text variant="headline">Order and visibility</Text>
            <View style={styles.row}>
              {canMoveUp ? (
                <Button
                  label="Move up"
                  variant="secondary"
                  disabled={busy !== null}
                  onPress={() => run('up', () => onMove('up'), false)}
                />
              ) : null}
              {canMoveDown ? (
                <Button
                  label="Move down"
                  variant="secondary"
                  disabled={busy !== null}
                  onPress={() => run('down', () => onMove('down'), false)}
                />
              ) : null}
              <Button
                label={item.active ? 'Switch off' : 'Switch on'}
                variant="secondary"
                loading={busy === 'active'}
                disabled={busy !== null && busy !== 'active'}
                onPress={() => run('active', () => onSetActive(!item.active), false)}
              />
            </View>
            <Text variant="caption" tone="inkMuted">
              {item.active ? 'Players see this item.' : 'Switched off: players don’t see this item.'}
            </Text>

            {confirmDelete ? (
              <ConfirmStep
                message="Players won’t see this item any more. Codes already given out for it are kept."
                confirmLabel="Yes, delete"
                busy={busy === 'delete'}
                onConfirm={() => run('delete', onDelete, true)}
                onBack={() => setConfirmDelete(false)}
              />
            ) : (
              <Button
                label="Delete item"
                variant="destructive"
                disabled={busy !== null}
                onPress={() => setConfirmDelete(true)}
              />
            )}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.card },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
