// Locked (S12, A2): a player whose date of birth is under 14 on today's
// Cyprus date sees only this screen. They can write to support or sign out
// (decided 24 November).
import { Linking, View } from 'react-native';

import { AuthError, AuthLink, AuthScreen, AuthWordmark } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { TOO_YOUNG_MESSAGE } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { CONTACT_EMAIL } from '@/lib/contact';

const SUPPORT_MAIL_URL = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Futty account')}`;

export default function AgeLockedScreen() {
  const { signOut } = useAuth();
  return (
    <AuthScreen>
      <View testID="age-locked-screen" />
      <AuthWordmark />
      <AuthError>{TOO_YOUNG_MESSAGE}</AuthError>
      <Button
        testID="age-locked-support"
        label="Contact support"
        onPress={() => Linking.openURL(SUPPORT_MAIL_URL).catch(() => {})}
        fullWidth
      />
      <AuthLink label="Sign out" onPress={() => signOut().catch(() => {})} />
    </AuthScreen>
  );
}
