import { authStorage } from '@/lib/auth-storage';

// Which device-calendar event belongs to which booking, kept on this phone only
// (an event id means nothing on another device). Not a secret.
const KEY_PREFIX = 'futty.calendar_event.';

export const calendarEventStore = {
  get(bookingId: string): string | null {
    try {
      return authStorage?.getItem(KEY_PREFIX + bookingId) ?? null;
    } catch {
      return null;
    }
  },
  set(bookingId: string, eventId: string) {
    try {
      authStorage?.setItem(KEY_PREFIX + bookingId, eventId);
    } catch {
      // Losing the link only means a later move or cancel can't update the event.
    }
  },
  forget(bookingId: string) {
    try {
      authStorage?.removeItem(KEY_PREFIX + bookingId);
    } catch {
      // As above.
    }
  },
};
