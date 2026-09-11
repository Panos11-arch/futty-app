import { AuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

/**
 * Supabase's raw messages are terse and sometimes misleading — "email rate limit
 * exceeded" reads like a broken app rather than something that clears on its
 * own. Map the codes we actually hit onto messages that say what to do next.
 */
export function describeAuthError(cause: unknown) {
  if (cause instanceof AuthError) {
    // Thrown for 500-range responses before the body is even parsed, so
    // `.message` is just `JSON.stringify()` of the raw fetch Response (no
    // `.code`) — surfacing it as-is looks like `{"type":"default",...}`.
    // A 500 here means the Supabase project's auth service itself errored
    // (commonly a paused free-tier project, or broken SMTP settings), not
    // something the client can retry its way out of.
    if (isAuthRetryableFetchError(cause)) {
      return cause.status === 0
        ? 'Could not reach Supabase. Check your internet connection and try again.'
        : "Supabase's servers had a problem handling that request. Check that the project isn't paused and that SMTP/email settings are configured correctly, then try again.";
    }

    switch (cause.code) {
      case 'over_email_send_rate_limit':
        return "Too many emails sent from this project. Supabase's built-in mail service allows only a couple per hour — wait, or set up custom SMTP to lift the cap.";
      case 'over_request_rate_limit':
        return 'Too many attempts. Wait a moment and try again.';
      case 'email_not_confirmed':
        return 'Confirm your email first — check your inbox for the link.';
      case 'invalid_credentials':
        return 'That email and password combination does not match an account.';
      case 'user_already_exists':
      case 'email_exists':
        return 'An account already exists for that email. Try signing in instead.';
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
