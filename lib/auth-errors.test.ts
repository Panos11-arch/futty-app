import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { describeAuthError } from '@/lib/auth-errors';

// Messages a player reads: no Supabase, SMTP or project talk.
describe('describeAuthError', () => {
  it('the email rate limit says to try again later', () => {
    const cause = new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit');
    expect(describeAuthError(cause)).toBe("We couldn't send the email right now. Try again in a few minutes.");
  });

  it('no connection (status 0) says to check the connection', () => {
    const cause = new AuthRetryableFetchError('Failed to fetch', 0);
    expect(describeAuthError(cause)).toBe("Can't reach Futty. Check your connection and try again.");
  });

  it('a server error (5xx) says something went wrong on our side', () => {
    const cause = new AuthRetryableFetchError('{}', 500);
    expect(describeAuthError(cause)).toBe('Something went wrong on our side. Try again soon.');
  });
});
