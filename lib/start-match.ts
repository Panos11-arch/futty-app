// "Start a match" (S6): Find a match opens Book a pitch; once the game is
// paid, the screen after paying (B3) opens with Publish already on, so the
// game shows in Find a match. Only preselected: the player can switch it off.
//
// The Book a pitch screen opened from Start a match arms this while it is
// open (and disarms it when it closes), whichever way the player then goes
// to pay (a time, the venue page). The screen after paying takes it once.
import type { BookingDetailData } from '@/lib/booking-detail';

let armed = false;

/** Book a pitch, opened from Start a match: on while it is open. */
export function armStartMatch(on: boolean): void {
  armed = on;
}

/** True once, right after paying for a game started from Find a match. */
export function takeStartMatch(): boolean {
  const was = armed;
  armed = false;
  return was;
}

export type PublishKind = 'players' | 'opposition';

/** Which Publish switch starts on: a half pitch's side A captain publishes
 *  for an opponent ("Publish", while the invite is open); a whole pitch's
 *  booker publishes the game ("Publish game"). Null when there is nothing
 *  he can publish, or it is already published. */
export function startMatchPublishKind(detail: Pick<BookingDetailData, 'is_booker' | 'v2'>): PublishKind | null {
  const v2 = detail.v2 ?? null;
  if (!v2) return null;
  if (v2.kind === 'half') {
    if (v2.captain_of !== 'a' || !v2.opposition?.open || v2.posts.opposition) return null;
    return 'opposition';
  }
  if (!detail.is_booker || v2.posts.players) return null;
  return 'players';
}

export type WaitOptions = { tries: number; delayMs: number; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** "Publish game" needs the booking confirmed, which the payment webhook does
 *  a moment after paying: asks again until it is, or gives up (false). A
 *  failed check counts as not yet. */
export async function waitUntilConfirmed(
  isConfirmed: () => Promise<boolean>,
  { tries, delayMs, sleep = realSleep }: WaitOptions,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await isConfirmed().catch(() => false)) return true;
    if (i < tries - 1) await sleep(delayMs);
  }
  return false;
}
