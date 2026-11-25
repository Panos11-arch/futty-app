// A12 and S18: Edit avatar, opened from the Profile header. A player shows
// initials (the default), an illustration (S18: tap the initials to pick one
// from a sheet), or a Futty kit: one of the 8 kit colours and a shirt number
// from 1 to 99. Saves to the player's own profiles row; the database checks
// every value again (pay_profile_avatar, pay_avatar_illustration) and only
// lets the owner change it.
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IllustrationSheet } from '@/components/avatar/illustration-sheet';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { KIT_COLOUR_NAMES, kitColours, radius, space, type KitColourName } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles, useTheme } from '@/lib/theme';
import {
  avatarKit,
  avatarLook,
  clampShirtNumber,
  isAvatarIllustration,
  isShirtNumber,
  SHIRT_NUMBER_MAX,
  SHIRT_NUMBER_MIN,
  type AvatarFields,
} from '@/lib/avatar';
import type { AvatarIllustrationId } from '@/lib/avatar-illustrations';
import { type Profile, updateProfile, useProfile } from '@/lib/use-profile';

const PREVIEW_SIZE = space.xxl * 3;
/** The pencil badge on the tappable initials. */
const BADGE_SIZE = space.xl + space.xs;
const BADGE_ICON = space.lg;

/** The two tabs; an illustration lives on Initials. */
type Tab = 'initials' | 'kit';
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
  const styles = useStyles();
  const { colors } = useTheme();
  const saved = avatarKit(profile);
  const savedLook = avatarLook(profile);
  const name = profile.full_name || profile.username || 'Player';
  const [style, setStyle] = useState<Tab>(saved ? 'kit' : 'initials');
  const [illustration, setIllustration] = useState<AvatarIllustrationId | null>(
    isAvatarIllustration(savedLook) ? savedLook.illustration : null
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [colour, setColour] = useState<KitColourName>(saved?.colour ?? KIT_COLOUR_NAMES[0]);
  const [numberText, setNumberText] = useState(String(saved?.number ?? DEFAULT_NUMBER));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = numberText === '' ? NaN : Number(numberText);
  const numberValid = isShirtNumber(number);
  const kit = style === 'kit' && numberValid ? { colour, number } : null;
  const look = style === 'kit' ? kit : illustration ? { illustration } : null;
  const canSave = style === 'initials' || numberValid;

  const pick = (id: AvatarIllustrationId | null) => {
    if (id) haptic.tap();
    setIllustration(id);
    setSheetOpen(false);
  };

  const step = (by: number) => {
    const from = numberValid ? number : DEFAULT_NUMBER;
    setNumberText(String(clampShirtNumber(from + by)));
  };

  const save = async () => {
    if (!canSave || saving) return;
    const fields: AvatarFields =
      style === 'kit'
        ? { avatar_style: 'kit', avatar_kit_colour: colour, avatar_number: number, avatar_illustration: null }
        : illustration
          ? { avatar_style: 'illustration', avatar_kit_colour: null, avatar_number: null, avatar_illustration: illustration }
          : { avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null, avatar_illustration: null };
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
        {style === 'initials' ? (
          <Pressable
            testID="edit-avatar-initials"
            accessibilityRole="button"
            accessibilityLabel="Change avatar"
            onPress={() => setSheetOpen(true)}>
            <Avatar name={name} kit={look} size={PREVIEW_SIZE} />
            <View style={styles.badge}>
              <IconSymbol name="pencil" size={BADGE_ICON} color={colors.ink} />
            </View>
          </Pressable>
        ) : (
          <Avatar name={name} kit={look} size={PREVIEW_SIZE} />
        )}
      </View>

      <SegmentedControl<Tab>
        accessibilityLabel="Avatar style"
        options={[
          { value: 'initials', label: 'Initials', testID: 'edit-avatar-style-initials' },
          { value: 'kit', label: 'Kit', testID: 'edit-avatar-style-kit' },
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

      <Button testID="edit-avatar-save" label="Save avatar" onPress={save} loading={saving} disabled={!canSave} fullWidth />

      <IllustrationSheet visible={sheetOpen} selected={illustration} onPick={pick} onClose={() => setSheetOpen(false)} />
    </ScrollView>
  );
}

export default function EditAvatarScreen() {
  const styles = useStyles();
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

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  preview: { alignItems: 'center', gap: space.md },
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  swatchRingSelected: { borderColor: colors.positive },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  numberField: { flex: 1 },
}));
