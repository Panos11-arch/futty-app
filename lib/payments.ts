import { supabase } from '@/lib/supabase';

export type SetupIntentPayload = {
  customerId: string;
  ephemeralKey: string;
  setupIntentClientSecret: string;
};

/** Ensures the caller has a Stripe Customer and returns what
 *  usePaymentSheet's initPaymentSheet needs to run in saved-cards mode —
 *  see supabase/functions/create-setup-intent. */
export async function createSetupIntent() {
  return supabase.functions.invoke<SetupIntentPayload>('create-setup-intent');
}
