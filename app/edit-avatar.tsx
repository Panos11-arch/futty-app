// A12: Edit avatar, opened from the Profile header. A player shows initials
// (the default) or a Futty kit: one of the 8 kit colours and a shirt number
// from 1 to 99. Saves to the player's own profiles row; the database checks
// every value again (pay_profile_avatar) and only lets the owner change it.
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { colors, KIT_COLOUR_NAMES, kitColours, radius, space, type KitColourName } from '@/constants/futty-theme';
import {
  avatarKit,
  clampShirtNumber,
  isShirtNumber,
  SHIRT_NUMBER_MAX,
  SHIRT_NUMBER_MIN,
  type AvatarFields,
  type AvatarStyle,
} from '@/lib/avatar';
import { type Profile, updateProfile, useProfile } from '@/lib/use-profile';

const PREVIEW_SIZE = space.xxl * 3;
const SWATCH_SIZE = MIN_TOUCH;
/** A new kit starts here until the player picks. */
const DEFAULT_NUMBER = 10;
const NUMBER_ERROR = `Pick a number from ${SHIRT_NUMBER_MIN} to ${SHIRT_NUMBER_MAX}.`;

const COLOUR_LABELS: Record<KitColourName, string> = {
  kitRed: 'Red',
  kitBlue: 'Blue',
  kitSky: 'Sky blue',
  kitGreen: 'Green',
  kitYellow: 'Yellow',
  kitOrange: 'Orange',
  kitBlack: 'Black',
  kitWhite: 'White',
};

function Editor({ profile }: { profile: Profile }) {
  const saved = avatarKit(profile);
  const name = profile.full_name || profile.username || 'Player';
  const [style, setStyle] = useState<AvatarStyle>(saved ? 'kit' : 'initials');
  const [colour, setColour] = useState<KitColourName>(saved?.colour ?? KIT_COLOUR_NAMES[0]);
  const [numberText, setNumberText] = useState(String(saved?.number ?? DEFAULT_NUMBER));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = numberText === '' ? NaN : Number(numberText);
  const numberValid = isShirtNumber(number);
  const kit = style === 'kit' && numberValid ? { colour, number } : null;
  const canSave = style === 'initials' || numberValid;

  const step = (by: number) => {
    const from = numberValid ? number : DEFAULT_NUMBER;
    setNumberText(String(clampShirtNumber(from + by)));
  };

  const save = async () => {
    if (!canSave || saving) return;
    const fields: AvatarFields =
      style === 'kit'
        ? { avatar_style: 'kit', avatar_kit_colour: colour, avatar_number: number }
        : { avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null };
    setSaving(true);
    setError(null);
    const { error: saveError } = await updateProfile(profile.id, fields);
    setSaving(false);
    if (saveError) {
      setError(`Couldn’t save your avatar: ${saveError.message}`);
      return;
    }
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.preview} testID="avatar-preview">
        <Avatar name={name} kit={kit} size={PREVIEW_SIZE} />
        <Text variant="callout" tone="inkMuted">
          Other players see this next to your name.
        </Text>
      </View>

      <SegmentedControl<AvatarStyle>
        accessibilityLabel="Avatar style"
        options={[
          { value: 'initials', label: 'Initials' },
          { value: 'kit', label: 'Kit' },
        ]}
        value={style}
        onChange={setStyle}
      />

      {style === 'kit' ? (
        <Card style={styles.card}>
          <Text variant="headline">Kit colour</Text>
          <View style={styles.swatches}>
            {KIT_COLOUR_NAMES.map((c) => {
              const selected = c === colour;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  accessibilityLabel={`${COLOUR_LABELS[c]} kit`}
                  accessibilityState={{ selected }}
                  onPress={() => setColour(c)}
                  style={[styles.swatchRing, selected && styles.swatchRingSelected]}>
                  <View style={[styles.swatch, { backgroundColor: kitColours[c].shirt }]} />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.numberRow}>
            <IconButton icon="minus" accessibilityLabel="Lower number" onPress={() => step(-1)} />
            <View style={styles.numberField}>
              <TextField
                label="Shirt number"
                value={numberText}
                onChangeText={(t) => setNumberText(t.replace(/\D/g, '').slice(0, 3))}
                keyboardType="number-pad"
                maxLength={3}
                error={numberValid ? undefined : NUMBER_ERROR}
              />
            </View>
            <IconButton icon="plus" accessibilityLabel="Higher number" onPress={() => step(1)} />
          </View>
        </Card>
      ) : null}

      {error ? <Banner tone="danger" message={error} action={{ label: 'Try again', onPress: save }} /> : null}

      <Button label="Save avatar" onPress={save} loading={saving} disabled={!canSave} fullWidth />
    </ScrollView>
  );
}

export default function EditAvatarScreen() {
  const profile = useProfile();

  let body;
  switch (profile.status) {
    case 'loading':
      body = (
        <View style={styles.content} testID="edit-avatar-skeleton">
          <View style={styles.preview}>
            <SkeletonBlock width={PREVIEW_SIZE} height={PREVIEW_SIZE} rounded="pill" />
          </View>
          <SkeletonText lines={3} />
        </View>
      );
      break;
    case 'ready':
      body = <Editor profile={profile.profile} />;
      break;
    case 'missing':
      body = (
        <View style={styles.content}>
          <Banner tone="warning" message="We couldn’t find your profile — try signing up again." />
        </View>
      );
      break;
    case 'error':
      body = (
        <View style={styles.content}>
          <Banner
            tone="danger"
            message={`Couldn’t load your profile: ${profile.message}`}
            action={{ label: 'Try again', onPress: profile.reload }}
          />
        </View>
      );
      break;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Edit avatar' }} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  preview: { alignItems: 'center', gap: space.md },
  card: { gap: space.lg },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatchRing: {
    width: SWATCH_SIZE + space.sm,
    height: SWATCH_SIZE + space.sm,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchRingSelected: { borderColor: colors.brand },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  numberField: { flex: 1 },
});
