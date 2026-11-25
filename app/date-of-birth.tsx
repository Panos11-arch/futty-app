// Date of birth (S12, A1): a signed-in player with none yet (an existing
// player, or a new Apple or Google user) sees only this screen, with no way
// past it but saving or signing out. The server checks the age; under 14
// the root layout swaps to app/age-locked.tsx.
import { useState } from 'react';
import { View } from 'react-native';

import { AuthError, AuthLink, AuthScreen, AuthTitle, AuthWordmark } from '@/components/auth-form';
import { DateOfBirthField } from '@/components/date-of-birth-field';
import { Button } from '@/components/ui/button';
import { markAgeStatus, saveDateOfBirth } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';

export default function DateOfBirthScreen() {
  const { signOut } = useAuth();
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!dateOfBirth || busy) return;
    setBusy(true);
    setError(null);
    const result = await saveDateOfBirth(dateOfBirth);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    haptic.success();
    // The root layout's gate lets the player in, or locks them.
    markAgeStatus(result.status);
  }

  return (
    <AuthScreen>
      <View testID="dob-screen" />
      <AuthWordmark />
      <AuthTitle>Date of birth</AuthTitle>
      <DateOfBirthField value={dateOfBirth} onChange={setDateOfBirth} disabled={busy} />
      {error ? (
        <View testID="dob-error">
          <AuthError>{error}</AuthError>
        </View>
      ) : null}
      <Button
        testID="dob-save"
        label="Save"
        onPress={save}
        disabled={!dateOfBirth}
        loading={busy}
        fullWidth
      />
      <AuthLink label="Sign out" onPress={() => signOut().catch(() => {})} disabled={busy} />
    </AuthScreen>
  );
}
