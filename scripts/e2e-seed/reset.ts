// What the seed's reset may touch. Pure functions, tested in reset.test.ts:
// the reset only ever selects the e2e logins (by their exact email domain)
// and their own bookings at the E2E venue. The database queries filter the
// same way first; these run on the rows that come back as a second check.
import { E2E_EMAIL_DOMAIN, E2E_LEAGUE, E2E_STAFF, E2E_TEAMS, E2E_USERS, E2E_VENUE } from './config';
import { cyprusWallTime } from './slot';

/** Only <something>@e2e.futty.app, nothing that merely contains it. */
export function isE2eEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.indexOf('@');
  return at > 0 && at === e.lastIndexOf('@') && e.slice(at + 1) === E2E_EMAIL_DOMAIN;
}

/** The configured e2e logins among `users`. An e2e-domain login that
 *  isn't configured is left alone too: the seed only manages its own. */
export function selectE2eUsers<T extends { id: string; email?: string | null }>(users: readonly T[]): T[] {
  const wanted = new Set([...E2E_USERS, ...E2E_STAFF].map((u) => u.email));
  return users.filter((u) => isE2eEmail(u.email) && wanted.has(u.email!.trim().toLowerCase()));
}

export type BookingRow = {
  id: string;
  venue_id: string | null;
  created_by: string | null;
  status: string | null;
  booking_day: string;
  start_time: string;
};

/** Bookings a run left behind that still hold a pitch: an e2e login's own
 *  booking at the E2E venue, not cancelled, not started (nothing can be
 *  cancelled once a game has started, spec 13). The seed cancels them the
 *  way the app does, as their booker. */
export function selectBookingsToCancel(
  bookings: readonly BookingRow[],
  { e2eUserIds, now }: { e2eUserIds: ReadonlySet<string>; now: Date },
): BookingRow[] {
  return bookings.filter(
    (b) =>
      b.venue_id === E2E_VENUE.id &&
      b.created_by !== null &&
      e2eUserIds.has(b.created_by) &&
      b.status !== 'cancelled' &&
      cyprusWallTime(b.booking_day, b.start_time.slice(0, 5)).getTime() > now.getTime(),
  );
}

/** The venue row at E2E_VENUE.id must be ours: a different name means the
 *  id is somebody else's venue, and the seed stops before changing it. */
export function assertE2eVenue(existing: { name: string } | null): void {
  if (existing && existing.name !== E2E_VENUE.name) {
    throw new Error(`e2e seed: venue ${E2E_VENUE.id} is "${existing.name}", not "${E2E_VENUE.name}". Stopping.`);
  }
}

/** The league row at E2E_LEAGUE.id must be our top-level e2e league: a
 *  different name, scope or a parent means it is somebody else's row, and
 *  the seed stops before changing it. */
export function assertE2eLeague(existing: { name: string; scope: string; parent_league_id: string | null } | null): void {
  if (!existing) return;
  if (existing.name !== E2E_LEAGUE.name || existing.scope !== E2E_LEAGUE.scope || existing.parent_league_id !== null) {
    throw new Error(
      `e2e seed: league ${E2E_LEAGUE.id} is "${existing.name}" (${existing.scope}), not the e2e league "${E2E_LEAGUE.name}". Stopping.`,
    );
  }
}

/** Each e2e team id must hold that e2e team (by name), or nothing yet. */
export function assertE2eTeams(existing: readonly { id: string; name: string }[]): void {
  for (const row of existing) {
    const team = E2E_TEAMS.find((t) => t.id === row.id);
    if (!team || team.name !== row.name) {
      throw new Error(`e2e seed: team ${row.id} is "${row.name}", not an e2e team. Stopping.`);
    }
  }
}
