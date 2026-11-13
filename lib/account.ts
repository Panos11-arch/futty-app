import { Platform } from 'react-native';

import { getAppleDeletionCode } from '@/lib/auth-providers';
import { describeFunctionError } from '@/lib/edge-functions';
import { supabase } from '@/lib/supabase';

const NETWORK_ERROR = 'Could not reach Futty. Check your internet connection and try again.';

/** Permanently deletes the signed-in user's account
 *  (supabase/functions/delete-account). Resolves to an error message, or
 *  null on success.
 *
 *  An account that uses Sign in with Apple confirms with Apple once more
 *  first on iOS: the server needs that fresh code to revoke the user's Apple
 *  token, as App Review requires (P13). Android and web can't show the Apple
 *  sheet, so there the account is deleted without the revoke, which the
 *  server logs (decided 13 November, for Panos to confirm). */
export async function deleteMyAccount(): Promise<string | null> {
  let usesApple: boolean;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return NETWORK_ERROR;
    usesApple = data.user.identities?.some((identity) => identity.provider === 'apple') ?? false;
  } catch {
    return NETWORK_ERROR;
  }

  const body: { platform: string; appleAuthorizationCode?: string } = { platform: Platform.OS };
  if (usesApple && Platform.OS === 'ios') {
    try {
      const code = await getAppleDeletionCode();
      if (!code) return 'Confirm with Apple to delete your account.';
      body.appleAuthorizationCode = code;
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Could not confirm with Apple. Try again.';
    }
  }

  const { error } = await supabase.functions.invoke<{ deleted: boolean }>('delete-account', { body });
  if (error) return describeFunctionError(error);
  return null;
}
