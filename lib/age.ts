// Age and safety (S12, docs/specs/05-product.md section 16). The server
// decides everything: the app only asks for the caller's status and shows
// what it says. Never the date of birth of anyone else, never an age.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** 'needs_dob': asked before anything else (A1). 'too_young': locked (A2). */
export type AgeStatus = 'needs_dob' | 'too_young' | 'ok';

export const TOO_YOUNG_MESSAGE = 'You must be 14 or older to use Futty.';
export const DOB_INVALID_MESSAGE = 'Check your date of birth and try again.';
export const DOB_LOCKED_MESSAGE = 'Date of birth already set. Contact support to change it.';
export const AGE_ERROR_FALLBACK = 'Something went wrong. Try again.';

export function describeAgeError(code: string | undefined): string {
  switch (code) {
    case 'too_young':
      return TOO_YOUNG_MESSAGE;
    case 'invalid_date':
      return DOB_INVALID_MESSAGE;
    case 'date_of_birth_locked':
      return DOB_LOCKED_MESSAGE;
    default:
      return AGE_ERROR_FALLBACK;
  }
}

/** Sign-up, before the account exists: 14 or older on today's Cyprus date. */
export async function isDateOfBirthAllowed(dateKey: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('date_of_birth_allowed', { p_dob: dateKey });
  if (error) throw error;
  return data === true;
}

const statusListeners = new Set<(status: AgeStatus) => void>();

/** Tells the root layout's gate the new status, without another read. */
export function markAgeStatus(status: AgeStatus) {
  statusListeners.forEach((listener) => listener(status));
}

/** An existing player gives their date of birth, once (A1). */
export async function saveDateOfBirth(dateKey: string): Promise<{ status: AgeStatus } | { error: string }> {
  try {
    const { data, error } = await supabase.rpc('set_date_of_birth', { p_dob: dateKey });
    if (error) return { error: describeAgeError(error.message) };
    return { status: data as AgeStatus };
  } catch {
    return { error: AGE_ERROR_FALLBACK };
  }
}

// "This player is ok", remembered on this device, so an existing player
// isn't held on the loading screen offline. Safe to keep: the date of birth
// can't change once set. The server's answer still wins.
const okKey = (userId: string) => `futty.age_ok.${userId}`;

async function storedOk(userId: string) {
  try {
    return (await AsyncStorage.getItem(okKey(userId))) === 'true';
  } catch {
    return false;
  }
}

function storeOk(userId: string, ok: boolean) {
  (ok ? AsyncStorage.setItem(okKey(userId), 'true') : AsyncStorage.removeItem(okKey(userId))).catch(() => {});
}

const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * The signed-in player's age status, for the root layout's gate. 'loading'
 * until the server answers (retrying while it fails), null when signed out.
 */
export function useAgeStatus(userId: string | null): AgeStatus | 'loading' | null {
  const [known, setKnown] = useState<{ userId: string; status: AgeStatus } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const id = userId;
    let active = true;
    let answered = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = RETRY_FIRST_MS;

    const answer = (status: AgeStatus) => {
      answered = true;
      setKnown({ userId: id, status });
      storeOk(id, status === 'ok');
    };

    const retry = () => {
      if (!active) return;
      retryTimer = setTimeout(read, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };

    function read() {
      Promise.resolve(supabase.rpc('my_age_status')).then(({ data, error }) => {
        if (!active) return;
        if (error || !data) return retry();
        answer(data as AgeStatus);
      }, retry);
    }

    storedOk(id).then((ok) => {
      if (active && ok && !answered) setKnown({ userId: id, status: 'ok' });
    });
    read();

    const onMark = (status: AgeStatus) => {
      if (active) answer(status);
    };
    statusListeners.add(onMark);

    return () => {
      active = false;
      clearTimeout(retryTimer);
      statusListeners.delete(onMark);
    };
  }, [userId]);

  if (!userId) return null;
  if (known?.userId !== userId) return 'loading';
  return known.status;
}
