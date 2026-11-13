// Deletes the caller's own account (see index.ts for the steps). The order is
// the point: nothing is deleted until the money check and, for a Sign in with
// Apple account, the Apple revoke have both passed.
import { AppleAccountMismatchError } from '../_shared/apple-sign-in.ts';

/** One of the account's sign-in identities. For Apple, `id` is the identity's
 *  provider_id: the user's Apple ID (the `sub` in Apple's tokens). */
export type Identity = { provider: string; id: string };

export type Body = { appleAuthorizationCode?: string; platform?: string };

export type Deps = {
  /** Today in Cyprus (cyprusToday()). */
  today: string;
  hasMoneyInPlay(userId: string, today: string): Promise<boolean>;
  /** The account's identities from the server's own record, or null if it can't be read. */
  loadIdentities(userId: string): Promise<Identity[] | null>;
  /** Throws if Apple refuses, or AppleAccountMismatchError for another Apple ID. */
  revokeAppleToken(code: string, expectedSub: string): Promise<void>;
  deleteSavedCards(userId: string): Promise<void>;
  deleteLinks(userId: string): Promise<void>;
  /** Resolves to an error message, or null. */
  scrubProfile(userId: string): Promise<string | null>;
  /** Resolves to an error message, or null. */
  deleteLogin(userId: string): Promise<string | null>;
  log(message: string, err?: unknown): void;
};

export type Result = { status: number; body: Record<string, unknown> };

/**
 * Platforms where the app cannot get a fresh Apple code (no Sign in with
 * Apple sheet), so an Apple-linked account is deleted without the revoke.
 * Decided by Dimitris on 13 November, for Panos to confirm.
 */
const NO_APPLE_SHEET_PLATFORMS = new Set(['android', 'web']);

export async function deleteAccount(deps: Deps, userId: string, body: Body): Promise<Result> {
  // 1. Money still in play?
  if (await deps.hasMoneyInPlay(userId, deps.today)) {
    return {
      status: 409,
      body: {
        error:
          'You still have upcoming games. Cancel your bookings (or wait until they have been played) and then try again.',
      },
    };
  }

  // 1b. Sign in with Apple: revoke the user's Apple token before anything is
  // deleted. Whether the account uses Apple comes from the server's own
  // record of the user, never from the request.
  const identities = await deps.loadIdentities(userId);
  if (!identities) return { status: 500, body: { error: 'Could not load your account. Try again.' } };

  const apple = identities.find((identity) => identity.provider === 'apple');
  if (apple) {
    const code = typeof body.appleAuthorizationCode === 'string' ? body.appleAuthorizationCode : '';
    if (code) {
      try {
        await deps.revokeAppleToken(code, apple.id);
      } catch (err) {
        if (err instanceof AppleAccountMismatchError) {
          deps.log(`delete-account: Apple ID mismatch for ${userId}; nothing revoked or deleted`);
          return {
            status: 403,
            body: {
              error:
                'That Apple ID is not the one linked to your Futty account. Confirm with the Apple ID you sign in with.',
            },
          };
        }
        deps.log(`delete-account: Apple token revoke failed for ${userId}`, err);
        return { status: 502, body: { error: 'Apple could not confirm the deletion. Try again.' } };
      }
    } else if (body.platform && NO_APPLE_SHEET_PLATFORMS.has(body.platform)) {
      // Android and web can't show the Apple sheet, so there is no code to
      // revoke with. The account is deleted anyway (decided 13 November,
      // pending Panos) and this is logged. `platform` is the app's own claim:
      // the worst a false one can do is skip the revoke of the caller's own
      // Apple grant, which the user can still remove in their Apple ID settings.
      deps.log(
        `delete-account: Apple-linked account ${userId} deleted from ${body.platform} without revoking its Apple token`
      );
    } else {
      return { status: 400, body: { error: 'Confirm with Apple to delete your account.' } };
    }
  }

  // From here on the Apple token may already be revoked. If a later step
  // fails, the account stays (with its personal data partly removed) and the
  // user sees an error and can retry: signing in with Apple again simply
  // grants a new token, and a retry from iOS asks Apple for a fresh code.

  // 2. Saved cards and device links.
  await deps.deleteSavedCards(userId);
  await deps.deleteLinks(userId);

  // 3. Personal data off the profile. Stats/XP columns are left alone.
  const scrubError = await deps.scrubProfile(userId);
  if (scrubError) return { status: 500, body: { error: `Could not delete your profile details: ${scrubError}` } };

  // 4. The login itself.
  const deleteError = await deps.deleteLogin(userId);
  if (deleteError) return { status: 500, body: { error: `Could not delete your login: ${deleteError}` } };

  return { status: 200, body: { deleted: true } };
}
