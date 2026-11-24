import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthField } from '@/components/auth-form';
import { PhoneField } from '@/components/phone-field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { SERVER_ERROR_FALLBACK } from '@/lib/booking-errors';
import { getPhoneNumberError, joinPhone, splitPhone, type Country } from '@/lib/countries';
import { toDateKey } from '@/lib/days';
import {
  PREFERRED_DAYS,
  PREFERRED_TIMES,
  updateProfile,
  useProfile,
  type PreferredDay,
  type PreferredTime,
} from '@/lib/use-profile';
import { USERNAME_PATTERN, USERNAME_RULES_MESSAGE } from '@/lib/username';

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const CITIES = ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'];
const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Striker'];
const FEET = ['Left', 'Right', 'Both'];
const DAY_LABELS: Record<PreferredDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};
const TIME_LABELS: Record<PreferredTime, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

type FormState = {
  username: string;
  fullName: string;
  phoneCountry: Country;
  phoneNational: string;
  gender: string;
  dateOfBirth: string;
  bio: string;
  city: string;
  position: string;
  preferredFoot: string;
  preferredDays: PreferredDay[];
  preferredTimes: PreferredTime[];
  showPhonePublicly: boolean;
};

function Field({ label, children, testID }: { label: string; children: React.ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.field} testID={testID}>
      <Text variant="callout" tone="inkMuted">
        {label}
      </Text>
      {children}
    </View>
  );
}

function PickerRow({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.pickerRow}>
      {options.map((option) => (
        <Chip key={option} label={option} selected={value === option} onPress={() => onChange(option)} />
      ))}
    </View>
  );
}

/** Several at once (preferred days and times); saved in the fixed order of `options`. */
function MultiPickerRow<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (next: T[]) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.pickerRow}>
      {options.map((option) => {
        const selected = value.includes(option);
        return (
          <Chip
            key={option}
            label={labels[option]}
            selected={selected}
            onPress={() => onChange(options.filter((o) => (o === option ? !selected : value.includes(o))))}
          />
        );
      })}
    </View>
  );
}

const DEFAULT_DOB = new Date(2000, 0, 1);

/** Android shows its date picker as an imperative native dialog
 *  (DateTimePickerAndroid.open) rather than a rendered component — rendering
 *  <DateTimePicker> continuously there would pop the dialog immediately and
 *  repeatedly. iOS renders it inline as a spinner sheet instead, toggled by
 *  the same tap. */
function DateOfBirthField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const styles = useStyles();
  const [showIOSPicker, setShowIOSPicker] = useState(false);
  const dateValue = value ? new Date(value) : DEFAULT_DOB;
  const maximumDate = new Date(); // can't be born in the future

  function open() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dateValue,
        mode: 'date',
        maximumDate,
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) onChange(toDateKey(selected));
        },
      });
    } else {
      setShowIOSPicker((v) => !v);
    }
  }

  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={value ? `Date of birth ${value}` : 'Select date of birth'} onPress={open}>
        <View style={styles.dateInput} pointerEvents="none">
          <Text variant="body" tone={value ? 'ink' : 'inkMuted'} tabular>
            {value || 'Select date of birth'}
          </Text>
        </View>
      </Pressable>
      {Platform.OS === 'ios' && showIOSPicker ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="spinner"
          maximumDate={maximumDate}
          onChange={(event, selected) => {
            if (event.type === 'set' && selected) onChange(toDateKey(selected));
          }}
        />
      ) : null}
    </View>
  );
}

export default function EditProfileScreen() {
  const styles = useStyles();
  const { isUsernameAvailable } = useAuth();
  const profile = useProfile();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // QA 24 November: the username's own error, shown under its field.
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // What was loaded, to tell whether anything changed; and whether the
  // screen is leaving because it saved (then nothing is asked).
  const initial = useRef<FormState | null>(null);
  const saved = useRef(false);
  const navigation = useNavigation();
  const dirty = !!form && !!initial.current && JSON.stringify(form) !== JSON.stringify(initial.current);

  // QA 24 November, bug 5: leaving (back button or gesture) with unsaved
  // changes asks first.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (!dirty || saved.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', undefined, [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [navigation, dirty]);

  useEffect(() => {
    if (profile.status !== 'ready') return;
    const p = profile.profile;
    const { country, national } = splitPhone(p.phone);
    const loaded: FormState = {
      username: p.username ?? '',
      fullName: p.full_name ?? '',
      phoneCountry: country,
      phoneNational: national,
      gender: p.gender ?? '',
      dateOfBirth: p.date_of_birth ?? '',
      bio: p.bio ?? '',
      city: p.city ?? '',
      position: p.position ?? '',
      preferredFoot: p.preferred_foot ?? '',
      preferredDays: p.preferred_days ?? [],
      preferredTimes: p.preferred_times ?? [],
      showPhonePublicly: p.show_phone_publicly,
    };
    initial.current = loaded;
    setForm(loaded);
    // Seeded once when the row first loads — re-running on every `profile`
    // change would stomp on in-progress edits each time `reload()` refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.status === 'ready']);

  if (profile.status !== 'ready' || !form) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <Card testID="edit-profile-skeleton">
            <SkeletonText lines={6} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const activeProfile = profile.profile;
  const phoneError = getPhoneNumberError(form.phoneCountry, form.phoneNational);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!form || busy) return;

    const trimmedUsername = form.username.trim();
    setUsernameError(null);
    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      showUsernameError(USERNAME_RULES_MESSAGE);
      return;
    }

    if (phoneError) {
      setError(phoneError);
      return;
    }

    setBusy(true);
    setError(null);

    const usernameChanged = trimmedUsername.toLowerCase() !== (activeProfile.username ?? '').toLowerCase();

    if (usernameChanged && !(await isUsernameAvailable(trimmedUsername))) {
      showUsernameError(`"${trimmedUsername}" is already taken.`);
      setBusy(false);
      return;
    }

    const { error: updateError } = await updateProfile(activeProfile.id, {
      username: trimmedUsername,
      full_name: form.fullName.trim() || null,
      phone: joinPhone(form.phoneCountry, form.phoneNational) || null,
      gender: form.gender || null,
      date_of_birth: form.dateOfBirth.trim() || null,
      bio: form.bio.trim() || null,
      city: form.city || null,
      position: form.position || null,
      preferred_foot: form.preferredFoot || null,
      preferred_days: form.preferredDays,
      preferred_times: form.preferredTimes,
      show_phone_publicly: form.showPhonePublicly,
    });

    setBusy(false);

    if (updateError) {
      // Never the server's own text.
      setError(SERVER_ERROR_FALLBACK);
    } else {
      saved.current = true;
      router.back();
    }
  }

  /** The username's error goes under its field, scrolled into view. */
  function showUsernameError(message: string) {
    setError(null);
    setUsernameError(message);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Field label="Username" testID="edit-profile-username-field">
            <AuthField
              value={form.username}
              onChangeText={(v) => set('username', v)}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Username"
            />
            {usernameError ? (
              <Text
                variant="callout"
                tone="danger"
                accessibilityLiveRegion="polite"
                testID="edit-profile-username-error"
              >
                {usernameError}
              </Text>
            ) : null}
          </Field>
          <Field label="Full name">
            <AuthField value={form.fullName} onChangeText={(v) => set('fullName', v)} autoCapitalize="words" />
          </Field>
        </View>

        <Field label="Phone number">
          <PhoneField
            country={form.phoneCountry}
            national={form.phoneNational}
            onChangeCountry={(c) => set('phoneCountry', c)}
            onChangeNational={(v) => set('phoneNational', v)}
          />
          {phoneError ? (
            <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
              {phoneError}
            </Text>
          ) : null}
        </Field>

        <View style={styles.toggleRow}>
          <Text variant="body" style={styles.flex}>
            Show my number to other players
          </Text>
          <Switch
            accessibilityLabel="Show my number to other players"
            value={form.showPhonePublicly}
            onValueChange={(v) => set('showPhonePublicly', v)}
          />
        </View>

        <Field label="Gender">
          <PickerRow options={GENDERS} value={form.gender} onChange={(v) => set('gender', v)} />
        </Field>

        <Field label="Date of birth">
          <DateOfBirthField value={form.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} />
        </Field>

        <Field label="Description">
          <AuthField
            value={form.bio}
            onChangeText={(v) => set('bio', v)}
            placeholder="Tell other players a bit about you"
            multiline
            numberOfLines={3}
            style={styles.textarea}
          />
        </Field>

        <Field label="Where do you play">
          <PickerRow options={CITIES} value={form.city} onChange={(v) => set('city', v)} />
        </Field>

        <Field label="Position">
          <PickerRow options={POSITIONS} value={form.position} onChange={(v) => set('position', v)} />
        </Field>

        <Field label="Preferred foot">
          <PickerRow options={FEET} value={form.preferredFoot} onChange={(v) => set('preferredFoot', v)} />
        </Field>

        <Field label="Days you like to play">
          <MultiPickerRow
            options={PREFERRED_DAYS}
            labels={DAY_LABELS}
            value={form.preferredDays}
            onChange={(v) => set('preferredDays', v)}
          />
        </Field>

        <Field label="Times you like to play">
          <MultiPickerRow
            options={PREFERRED_TIMES}
            labels={TIME_LABELS}
            value={form.preferredTimes}
            onChange={(v) => set('preferredTimes', v)}
          />
        </Field>

        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Button label="Save changes" fullWidth onPress={save} loading={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  row: { flexDirection: 'row', gap: space.md },
  field: { flex: 1, gap: space.sm },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dateInput: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  textarea: { minHeight: space.xxl * 2 + space.sm, textAlignVertical: 'top' },
}));
