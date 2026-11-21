// What the end-to-end seed creates on STAGING (docs/testing/maestro.md).
// Everything here is test data: fixed ids, an e2e-only email domain and a
// venue named so nobody mistakes it for a real one.

export type Platform = 'ios' | 'android';

/** Every e2e login is on this domain; nothing else is ever selected. */
export const E2E_EMAIL_DOMAIN = 'e2e.futty.app';

export type E2eUser = { email: string; username: string; fullName: string; platform: Platform };

/** Two per platform, so iOS and Android never share a login. The flows
 *  sign in as the first of each; the second is there for journeys that
 *  need another player (invites, joining). */
export const E2E_USERS: readonly E2eUser[] = [
  { email: `e2e-ios-1@${E2E_EMAIL_DOMAIN}`, username: 'e2e_ios_1', fullName: 'E2E iOS One', platform: 'ios' },
  { email: `e2e-ios-2@${E2E_EMAIL_DOMAIN}`, username: 'e2e_ios_2', fullName: 'E2E iOS Two', platform: 'ios' },
  { email: `e2e-android-1@${E2E_EMAIL_DOMAIN}`, username: 'e2e_android_1', fullName: 'E2E Android One', platform: 'android' },
  { email: `e2e-android-2@${E2E_EMAIL_DOMAIN}`, username: 'e2e_android_2', fullName: 'E2E Android Two', platform: 'android' },
];

/** Fixed ids, so the flows can name the venue's card (free-venue-<id>) and
 *  a re-run updates the same rows. */
export const E2E_VENUE = {
  id: 'e2e00000-0000-4000-8000-000000000001',
  name: 'E2E Arena',
  city: 'Nicosia',
  address: 'Automated test venue (not a real place)',
} as const;

/** One pitch per platform. book_slot picks the pitch, so the platforms are
 *  also kept apart by start time (E2E_START in slot.ts); two pitches mean
 *  each slot still has room if a run left a booking behind. */
export const E2E_PITCHES = [
  { id: 'e2e00000-0000-4000-8000-000000000011', name: 'E2E Pitch iOS', sortOrder: 1 },
  { id: 'e2e00000-0000-4000-8000-000000000012', name: 'E2E Pitch Android', sortOrder: 2 },
] as const;

/** Spec 13, "What this is": every worked example is a €60 5-a-side (5 v 5,
 *  10 players). One price per format, the same on every day and at every
 *  hour ("Pitch prices"). The app then shows €65.50 for the
 *  booker paying for everyone and €6.80 each when each pays (the table in
 *  "Prices and fees"). */
export const E2E_FORMAT = '5-a-side';
export const E2E_PRICE_CENTS = 6000;

/** Open every day, 07:00 to midnight, so every start time the Book flow
 *  offers (07:00 to 23:30, spec 13 "Booking screens") is inside the hours.
 *  Test data only: no venue rule depends on it. */
export const E2E_OPENING_HOURS = { opens: '07:00', closes: '24:00' } as const;
