// Sets the phone's time zone for a test. Every date and time the app shows is
// Cyprus time (Asia/Nicosia), whatever zone the phone is in.
//
// Jest gives each test file a copy of process.env, so setting TZ on it doesn't
// change Date's local zone. Node only re-reads TZ when it is set on the real
// process, which lives outside Jest's sandbox.
import { runInThisContext } from 'node:vm';

const realProcess = runInThisContext('process') as NodeJS.Process;
const realTz = realProcess.env.TZ;

export function onPhoneIn(timeZone: string) {
  realProcess.env.TZ = timeZone;
}

export function restorePhoneZone() {
  if (realTz === undefined) delete realProcess.env.TZ;
  else realProcess.env.TZ = realTz;
}

/** Zones well behind and well ahead of Cyprus, so a wrong zone changes the day. */
export const PHONE_ZONES = ['America/New_York', 'Asia/Tokyo'] as const;

/**
 * 23:30 on a Friday in Cyprus, in winter (UTC+2) and in summer (UTC+3). In New
 * York it is still afternoon; in Tokyo it is already Saturday morning.
 */
export const CYPRUS_LATE_KICKOFF = {
  winter: { iso: '2026-11-20T21:30:00.000Z', day: '2026-11-20', time: '23:30:00', date: 'Fri 20 Nov', clock: '23:30' },
  summer: { iso: '2027-07-16T20:30:00.000Z', day: '2027-07-16', time: '23:30:00', date: 'Fri 16 Jul', clock: '23:30' },
} as const;

/** Every phone zone in both seasons, for describe.each / it.each. */
export const ZONES_AND_SEASONS = PHONE_ZONES.flatMap((zone) =>
  (['winter', 'summer'] as const).map((season) => [zone, season] as const),
);
