// The release steps Panos runs before each App Store submission (P7,
// docs/release-checklist.md). No file or network access here (run.mjs does
// that), so all of it is tested.
//
//   demo-account      creates App Review's demo account, or resets its
//                     password; the password comes only from
//                     FUTTY_DEMO_PASSWORD, never from the repo
//   unlive-unsigned   switches is_live off for every venue without signed_at
//                     (public.release_unlive_unsigned)
//   check             public.release_check: no unsigned venue live, the demo
//                     account exists and gets checkout's quote at a signed
//                     venue. Exits 1 when anything is wrong.

export const DEMO_EMAIL = 'review@futty.app';
export const DEMO_USERNAME = 'futty_review';
export const DEMO_FULL_NAME = 'App Review';

export const COMMANDS = ['demo-account', 'unlive-unsigned', 'check'] as const;
export type Command = (typeof COMMANDS)[number];

export function parseCommand(value: string | undefined): Command | null {
  return (COMMANDS as readonly string[]).includes(value ?? '') ? (value as Command) : null;
}

/** Supabase Auth's own minimum is 6; App Review's account gets a long one. */
export const DEMO_PASSWORD_MIN_LENGTH = 12;

/** The demo password from the environment, or why it can't be used. */
export function readDemoPassword(env: Record<string, string | undefined>): { password: string } | { error: string } {
  const password = env.FUTTY_DEMO_PASSWORD;
  if (!password) return { error: 'Set FUTTY_DEMO_PASSWORD to the demo account password (it is never stored in the repo).' };
  if (password.length < DEMO_PASSWORD_MIN_LENGTH) {
    return { error: `FUTTY_DEMO_PASSWORD must be at least ${DEMO_PASSWORD_MIN_LENGTH} characters.` };
  }
  return { password };
}

/** The local Supabase stack; anything else is production and needs --allow-remote. */
// (As in scripts/import-venues; Node can't run release.ts with an import of it
// that tsc also accepts, so it is repeated here.)
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** The auth admin call that makes the demo account: confirmed email, a username so it skips choose-username. */
export function demoUserAttributes(password: string) {
  return {
    email: DEMO_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { username: DEMO_USERNAME, full_name: DEMO_FULL_NAME },
  };
}

export type ReleaseProblem =
  | { problem: 'unsigned_venue_live'; venue_id: string; name: string }
  | { problem: 'no_signed_venue' }
  | { problem: 'demo_account_missing'; email: string }
  | { problem: 'demo_cannot_quote'; email: string };

export type ReleaseCheck = { ok: boolean; problems: ReleaseProblem[]; quote: Record<string, unknown> | null };

function describeProblem(p: ReleaseProblem): string {
  switch (p.problem) {
    case 'unsigned_venue_live':
      return `Live but not signed: ${p.name} (${p.venue_id}). Run unlive-unsigned, or set its signed_at.`;
    case 'no_signed_venue':
      return 'No signed venue is live, so nothing can be booked.';
    case 'demo_account_missing':
      return `No demo account ${p.email}. Run demo-account.`;
    case 'demo_cannot_quote':
      return `${p.email} got no checkout quote at any signed venue in the next 7 days (no free slot or no price).`;
  }
}

/** release_check's answer as lines for the terminal. */
export function describeCheck(check: ReleaseCheck): string[] {
  if (check.ok) {
    const q = check.quote ?? {};
    return [`Ready: the demo account gets a quote at venue ${q.venue_id} on ${q.day} at ${q.start_time}.`];
  }
  return check.problems.map(describeProblem);
}
