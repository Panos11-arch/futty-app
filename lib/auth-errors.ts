import { AuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists. Sign in instead.';
export const LINK_EXPIRED_MESSAGE = 'This link has expired. Request a new one.';
export const LINK_FAILED_MESSAGE = "This link didn't work. Request a new one.";
export const RESEND_NEEDS_EMAIL_MESSAGE = 'Enter your email, then tap resend.';

/**
 * Supabase's signUp for an email that already has a confirmed account returns
 * a user with no identities, sends no email and raises no error (so nobody can
 * probe which addresses are registered). Thrown by lib/auth.tsx in that case.
 */
export class EmailTakenError extends Error {
  readonly code = 'email_taken';

  constructor() {
    super(EMAIL_TAKEN_MESSAGE);
    this.name = 'EmailTakenError';
  }
}

/**
 * Supabase's raw messages are terse and sometimes misleading — "email rate limit
 * exceeded" reads like a broken app rather than something that clears on its
 * own. Map the codes we actually hit onto messages that say what to do next.
 */
export function describeAuthError(cause: unknown) {
  if (cause instanceof EmailTakenError) return EMAIL_TAKEN_MESSAGE;

  if (cause instanceof AuthError) {
    // Thrown for 500-range responses before the body is even parsed, so
    // `.message` is just `JSON.stringify()` of the raw fetch Response (no
    // `.code`) — surfacing it as-is looks like `{"type":"default",...}`.
    // A 500 here means the Supabase project's auth service itself errored
    // (commonly a paused free-tier project, or broken SMTP settings), not
    // something the client can retry its way out of.
    if (isAuthRetryableFetchError(cause)) {
      return cause.status === 0
        ? "Can't reach Futty. Check your connection and try again."
        : 'Something went wrong on our side. Try again soon.';
    }

    switch (cause.code) {
      case 'over_email_send_rate_limit':
        // Forgot password treats this code as sent-with-a-cooldown, so this
        // shows on sign-up and resend only.
        return "We couldn't send the email right now. Try again in a few minutes.";
      case 'over_request_rate_limit':
        return 'Too many attempts. Wait a moment and try again.';
      case 'email_not_confirmed':
        return 'Confirm your email first — check your inbox for the link.';
      case 'invalid_credentials':
        return 'That email and password combination does not match an account.';
      case 'user_already_exists':
      case 'email_exists':
        return EMAIL_TAKEN_MESSAGE;
      case 'otp_expired':
        return LINK_EXPIRED_MESSAGE;
      case 'weak_password':
        return 'That password is too weak. Use at least 6 characters.';
      case 'email_address_invalid':
        return 'Supabase rejected that address as undeliverable. Reserved domains like example.com will not work.';
      case 'same_password':
        return 'That is already your current password. Choose a different one.';
      default:
        break;
    }

    return cause.message;
  }

  if (cause instanceof Error) return cause.message;
  return 'Something went wrong. Try again.';
}
