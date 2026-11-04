import { describeFunctionError } from '@/lib/edge-functions';
import { supabase } from '@/lib/supabase';

/** Permanently deletes the signed-in user's account
 *  (supabase/functions/delete-account). Resolves to an error message, or
 *  null on success. */
export async function deleteMyAccount(): Promise<string | null> {
  const { error } = await supabase.functions.invoke<{ deleted: boolean }>('delete-account');
  if (error) return describeFunctionError(error);
  return null;
}
