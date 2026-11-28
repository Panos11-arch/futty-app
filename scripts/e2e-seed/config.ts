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
  // S17: a point in Nicosia, so the map has a pin and Around me a distance
  // (.maestro/flows/around-me.yaml). Staging's e2e seed only, never a migration.
  latitude: 35.165,
  longitude: 33.36,
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

/** Every e2e login's date of birth (S12): an adult, so the date of birth
 *  screen and the under-18 limits never stand in a flow's way. */
export const E2E_DATE_OF_BIRTH = '1995-01-01';

/** S13B: a pickup each platform's first login booked, played 2 hours ago
 *  and waiting for its score, so log-score.yaml can log it. Bibs: the first
 *  login (its captain); Non-bibs: the second. Fixed ids, so the flow can tap
 *  a player (log-score-goal-plus-<player id>). Re-made on every run. */
export const E2E_LOG_MATCHES: Record<Platform, { matchId: string; captainPlayerId: string; otherPlayerId: string }> = {
  ios: {
    matchId: 'e2e00000-0000-4000-8000-000000000021',
    captainPlayerId: 'e2e00000-0000-4000-8000-000000000031',
    otherPlayerId: 'e2e00000-0000-4000-8000-000000000032',
  },
  android: {
    matchId: 'e2e00000-0000-4000-8000-000000000022',
    captainPlayerId: 'e2e00000-0000-4000-8000-000000000033',
    otherPlayerId: 'e2e00000-0000-4000-8000-000000000034',
  },
};

/** Doc 28 prompt 1 (block clashes, block-clashes.yaml): one venue-staff login
 *  per platform (profiles.role venue_owner), each the owner of its own test
 *  venue with one pitch, so the platforms never block each other's games.
 *  Not live: players never see these venues in Book. */
export type E2eStaff = E2eUser & { venue: { id: string; name: string }; pitchId: string };

export const E2E_STAFF: readonly E2eStaff[] = [
  {
    email: `e2e-ios-staff@${E2E_EMAIL_DOMAIN}`,
    username: 'e2e_ios_staff',
    fullName: 'E2E iOS Staff',
    platform: 'ios',
    venue: { id: 'e2e00000-0000-4000-8000-000000000041', name: 'E2E Staff Arena iOS' },
    pitchId: 'e2e00000-0000-4000-8000-000000000051',
  },
  {
    email: `e2e-android-staff@${E2E_EMAIL_DOMAIN}`,
    username: 'e2e_android_staff',
    fullName: 'E2E Android Staff',
    platform: 'android',
    venue: { id: 'e2e00000-0000-4000-8000-000000000042', name: 'E2E Staff Arena Android' },
    pitchId: 'e2e00000-0000-4000-8000-000000000052',
  },
];

/** The phone booking each staff venue holds tomorrow (Cyprus), so blocking
 *  the pitch clashes with it. Not paid: no money row is ever written. */
export const E2E_STAFF_BOOKING = {
  daysAhead: 1,
  start: '21:00',
  end: '22:00',
  contactName: 'E2E Caller',
  phone: '+35799000000',
} as const;

/** S10 (competition.yaml): a live city league in its own e2e-only city, so
 *  every tab of the competition page has data. The hub stays in sign-up
 *  while Season 1 (a child row, made by league_start_season) runs, as in
 *  production. Scope 'E2E': the Leagues list shows a city group "E2E"
 *  (testIDs leagues-group-e2e, leagues-row-child-e2e-5-a-side). */
export const E2E_LEAGUE = {
  id: 'e2e00000-0000-4000-8000-000000000071',
  name: 'E2E City 5s',
  scope: 'E2E',
  format: E2E_FORMAT,
  capacity: 8,
  seasonWeeks: 6,
  /** Season 1 starts this many days before the first seed run. */
  startDaysAgo: 21,
} as const;

export type E2eTeam = { id: string; name: string; captainEmail: string };

/** One team per player login, each its captain (and only player). The ids
 *  sort in this order, so sync_league_fixtures makes home = the earlier
 *  one in every pairing. */
export const E2E_TEAMS: readonly E2eTeam[] = [
  { id: 'e2e00000-0000-4000-8000-000000000061', name: 'E2E iOS 1 FC', captainEmail: `e2e-ios-1@${E2E_EMAIL_DOMAIN}` },
  { id: 'e2e00000-0000-4000-8000-000000000062', name: 'E2E Android 1 FC', captainEmail: `e2e-android-1@${E2E_EMAIL_DOMAIN}` },
  { id: 'e2e00000-0000-4000-8000-000000000063', name: 'E2E iOS 2 FC', captainEmail: `e2e-ios-2@${E2E_EMAIL_DOMAIN}` },
  { id: 'e2e00000-0000-4000-8000-000000000064', name: 'E2E Android 2 FC', captainEmail: `e2e-android-2@${E2E_EMAIL_DOMAIN}` },
];

/** Every pairing's result (home = the first team), played 3 days apart from
 *  Season 1's start, all long final. Indexes into E2E_TEAMS. */
export const E2E_LEAGUE_RESULTS: readonly { home: number; away: number; homeGoals: number; awayGoals: number }[] = [
  { home: 0, away: 1, homeGoals: 2, awayGoals: 1 },
  { home: 0, away: 2, homeGoals: 1, awayGoals: 1 },
  { home: 0, away: 3, homeGoals: 3, awayGoals: 0 },
  { home: 1, away: 2, homeGoals: 2, awayGoals: 0 },
  { home: 1, away: 3, homeGoals: 1, awayGoals: 2 },
  { home: 2, away: 3, homeGoals: 0, awayGoals: 0 },
];

/** The upcoming fixture: Android 1 at home to iOS 1 (the reverse of their
 *  first game), moved to this many days ahead on every run. */
export const E2E_UPCOMING = { home: 1, away: 0, daysAhead: 3, time: '20:00' } as const;

/** League kickoffs (Cyprus time). */
export const E2E_LEAGUE_KICKOFF = '19:00';

/** S10A (tournaments.yaml, tournament-admin.yaml): two tournaments, fixed
 *  ids. One Coming soon (no dates), one with sign-up open. Area "E2E" keeps
 *  them apart from real ones. Nothing is registered: the flows look, never
 *  change (a 5-a-side squad needs 5 players; e2e teams have one). */
export const E2E_TOURNAMENTS = {
  comingSoon: { id: 'e2e00000-0000-4000-8000-000000000081', name: 'E2E Coming Cup', status: 'coming_soon' },
  open: { id: 'e2e00000-0000-4000-8000-000000000082', name: 'E2E Cup', status: 'registration' },
} as const;

/** The tournaments' fields (shown only; the fee is never collected). */
export const E2E_TOURNAMENT_FIELDS = {
  area: 'E2E',
  format: E2E_FORMAT,
  maxTeams: 16,
  squadSubs: 2,
  entryFeeCents: 500,
  matchMinutes: 50,
} as const;

/** STAGING ONLY: the logins the admin flow signs in as are app admins there.
 *  seedMain refuses a production URL or key before it makes any client
 *  (lib/e2e-guard.ts), so this never reaches production; Panos adds the
 *  founders on production himself. */
export const E2E_ADMIN_EMAILS: readonly string[] = [`e2e-ios-1@${E2E_EMAIL_DOMAIN}`, `e2e-android-1@${E2E_EMAIL_DOMAIN}`];
