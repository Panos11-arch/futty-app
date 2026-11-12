// Inline errors for the sign-in and onboarding forms (U6). Display only:
// they are shown when a field loses focus and never decide whether a form
// can be sent; each screen keeps its own submit rules.
import { useCallback, useState } from 'react';

import { getPasswordLengthError } from '@/lib/password';
import { USERNAME_PATTERN, USERNAME_RULES_MESSAGE } from '@/lib/username';

// Something@something.something, no spaces. Supabase is the real check.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(email: string): string | null {
  const value = email.trim();
  if (value.length === 0) return 'Enter your email.';
  if (!EMAIL_SHAPE.test(value)) return 'Enter a valid email address.';
  return null;
}

export function usernameError(username: string): string | null {
  const value = username.trim();
  if (value.length === 0) return 'Enter a username.';
  if (!USERNAME_PATTERN.test(value)) return USERNAME_RULES_MESSAGE;
  return null;
}

/** Sign-in only needs a password; new passwords also have a length rule. */
export function passwordError(password: string, { isNew }: { isNew: boolean }): string | null {
  if (password.length === 0) return isNew ? 'Choose a password.' : 'Enter your password.';
  return isNew ? getPasswordLengthError(password) : null;
}

/** Which fields have lost focus at least once, so errors don't show before the player has typed. */
export function useTouched<Field extends string>() {
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set());
  const touch = useCallback(
    (field: Field) => () => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field))),
    []
  );
  const reset = useCallback(() => setTouched(new Set()), []);
  /** The error to show for a field: only once it has been touched. */
  const shown = useCallback(
    (field: Field, error: string | null) => (touched.has(field) && error ? error : undefined),
    [touched]
  );
  return { touch, shown, reset };
}
