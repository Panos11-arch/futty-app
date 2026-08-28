import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { PhoneField } from '@/components/phone-field';
import { ThemedText } from '@/components/themed-text';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuth } from '@/lib/auth';
import { joinPhone, splitPhone, type Country } from '@/lib/countries';
import { toDateKey } from '@/lib/days';
import { updateProfile, useProfile } from '@/lib/use-profile';
import { USERNAME_PATTERN, USERNAME_RULES_MESSAGE } from '@/lib/username';

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const CITIES = ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'];
const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Striker'];
const FEET = ['Left', 'Right', 'Both'];

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
  showPhonePublicly: boolean;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>{label}</ThemedText>
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
  return (
    <View style={styles.pickerRow}>
      {options.map((option) => (
        <Chip key={option} label={option} selected={value === option} onPress={() => onChange(option)} />
      ))}
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
  const [showIOSPicker, setShowIOSPicker] = useState(false);
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
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
      <Pressable accessibilityRole="button" onPress={open}>
        <View style={[styles.input, styles.dateInput, { borderColor: border }]} pointerEvents="none">
          <ThemedText style={value ? undefined : styles.datePlaceholder}>
            {value || 'Select date of birth'}
          </ThemedText>
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
  const { isUsernameAvailable } = useAuth();
  const profile = useProfile();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.status !== 'ready') return;
    const p = profile.profile;
    const { country, national } = splitPhone(p.phone);
    setForm({
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
      showPhonePublicly: p.show_phone_publicly,
    });
    // Seeded once when the row first loads — re-running on every `profile`
    // change would stomp on in-progress edits each time `reload()` refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.status === 'ready']);

  if (profile.status !== 'ready' || !form) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const activeProfile = profile.profile;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!form || busy) return;

    const trimmedUsername = form.username.trim();
    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setError(USERNAME_RULES_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);

    const usernameChanged = trimmedUsername.toLowerCase() !== (activeProfile.username ?? '').toLowerCase();

    if (usernameChanged && !(await isUsernameAvailable(trimmedUsername))) {
      setError(`"${trimmedUsername}" is already taken.`);
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
      show_phone_publicly: form.showPhonePublicly,
    });

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      router.back();
    }
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Field label="Username">
            <AuthField
              value={form.username}
              onChangeText={(v) => set('username', v)}
              autoCapitalize="none"
              autoCorrect={false}
            />
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
        </Field>

        <View style={styles.toggleRow}>
          <ThemedText style={styles.toggleLabel}>Show my number to other players</ThemedText>
          <Switch
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

        {error ? <AuthError>{error}</AuthError> : null}

        <AuthButton label="Save changes" onPress={save} busy={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: 16,
    padding: 16,
    paddingBottom: 48,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  field: {
    flex: 1,
    gap: 6,
  },
  label: {
    fontSize: 12,
    opacity: 0.7,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  dateInput: {
    justifyContent: 'center',
    minHeight: 48,
  },
  datePlaceholder: {
    opacity: 0.5,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleLabel: {
    flex: 1,
    fontSize: 13,
  },
  textarea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
