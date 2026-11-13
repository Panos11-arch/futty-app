import { Platform } from 'react-native';

import { getAppleDeletionCode } from '@/lib/auth-providers';
import { describeFunctionError } from '@/lib/edge-functions';
import { supabase } from '@/lib/supabase';

/** Permanently deletes the signed-in user's account
 *  (supabase/functions/delete-account). Resolves to an error message, or
 *  null on success.
 *
 *  An account that uses Sign in with Apple confirms with Apple once more
 *  first: the server needs that fresh code to revoke the user's Apple token,
 *  as App Review requires (P13). */
export async function deleteMyAccount(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const usesApple = data.user?.identities?.some((identity) => identity.provider === 'apple') ?? false;

  let body: { appleAuthorizationCode: string } | undefined;
  if (usesApple) {
    if (Platform.OS !== 'ios') {
      return 'This account uses Sign in with Apple. Delete it from Futty on your iPhone.';
    }
    try {
      const code = await getAppleDeletionCode();
      if (!code) return 'Confirm with Apple to delete your account.';
      body = { appleAuthorizationCode: code };
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Could not confirm with Apple. Try again.';
    }
  }

  const { error } = await supabase.functions.invoke<{ deleted: boolean }>(
    'delete-account',
    body ? { body } : undefined
  );
  if (error) return describeFunctionError(error);
  return null;
}
