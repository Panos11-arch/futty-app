// Where Supabase sends the browser back after Google sign-in (P13):
// futtyapp://auth/callback?code=… On iOS the auth session catches that
// redirect itself, but on Android the app also receives it as a deep link and
// expo-router opens this path. lib/auth-providers.ts does the code exchange,
// so this route only moves on, instead of showing "Unmatched route".
import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

export default function AuthCallback() {
  const { session } = useAuth();
  // Signed out while the code is still being exchanged: the root layout's
  // guards take the user on from sign-in once the session lands.
  return <Redirect href={session ? '/' : '/sign-in'} />;
}
