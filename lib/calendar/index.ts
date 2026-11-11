// "Add to calendar" for bookings (A3a). P5 uses it on the booking screens:
//
//   - The Add to calendar button calls addBookingToCalendar(booking). This is
//     the only place the app asks for calendar permission.
//   - Whenever a booking screen loads or changes a booking (moved, cancelled,
//     roster changed), call syncBookingInCalendar(booking). It updates the
//     event, or removes it when the booking is cancelled. It never asks for
//     permission and does nothing for a booking the player didn't add.
//   - isBookingInCalendar(id) tells the button whether to say "Added".

import { buildCalendarEvent, type CalendarBooking } from './event';
import { loadCalendarModule, type CalendarModule } from './native';
import { calendarEventStore } from './store';

export { bookingLink, bookingTimes, buildCalendarEvent, BOOKING_LINK_PATH } from './event';
export type { CalendarBooking, CalendarEventDetails } from './event';
export { CYPRUS_TIME_ZONE, cyprusWallTime } from './cyprus-time';

export type AddToCalendarResult =
  | 'added'
  | 'updated'
  | 'permission_denied'
  | 'no_calendar'
  | 'booking_cancelled'
  | 'unavailable';

export type SyncCalendarResult =
  | 'updated'
  | 'removed'
  | 'not_in_calendar'
  /** The player deleted the event in their calendar app; we stop tracking it. */
  | 'missing'
  | 'no_permission'
  | 'unavailable';

const CANCELLED = 'cancelled';

// One calendar operation per booking at a time, so a double tap or a sync
// racing an add can't create two events.
const queues = new Map<string, Promise<unknown>>();

function oneAtATime<T>(bookingId: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(bookingId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  queues.set(bookingId, next);
  const clear = () => {
    if (queues.get(bookingId) === next) queues.delete(bookingId);
  };
  next.then(clear, clear);
  return next;
}

/** A calendar the player can write to: iOS's default, else the primary or first writable one. */
async function writableCalendarId(calendar: CalendarModule): Promise<string | null> {
  try {
    const defaultCalendar = await calendar.getDefaultCalendarAsync();
    if (defaultCalendar?.allowsModifications) return defaultCalendar.id;
  } catch {
    // Android has no default calendar; look through the list below.
  }
  const calendars = await calendar.getCalendarsAsync(calendar.EntityTypes?.EVENT);
  const writable = calendars.filter((c) => c.allowsModifications);
  return (writable.find((c) => c.isPrimary) ?? writable[0])?.id ?? null;
}

export function isBookingInCalendar(bookingId: string): boolean {
  return calendarEventStore.get(bookingId) !== null;
}

/** Call from the Add to calendar button only: it may show the permission prompt. */
export function addBookingToCalendar(booking: CalendarBooking): Promise<AddToCalendarResult> {
  return oneAtATime(booking.id, async () => {
    if (booking.status === CANCELLED) return 'booking_cancelled';

    const calendar = loadCalendarModule();
    if (!calendar) return 'unavailable';

    const permission = await calendar.requestCalendarPermissionsAsync();
    if (!permission.granted) return 'permission_denied';

    const details = buildCalendarEvent(booking);

    // Already added on this phone: refresh it rather than adding a second one.
    const existing = calendarEventStore.get(booking.id);
    if (existing) {
      try {
        await calendar.updateEventAsync(existing, details);
        return 'updated';
      } catch {
        // Deleted in the calendar app; add it again below.
        calendarEventStore.forget(booking.id);
      }
    }

    const calendarId = await writableCalendarId(calendar);
    if (!calendarId) return 'no_calendar';

    const eventId = await calendar.createEventAsync(calendarId, details);
    calendarEventStore.set(booking.id, eventId);
    return 'added';
  });
}

/** Bring the event in line with the booking: update it, or remove it if the booking is cancelled. */
export function syncBookingInCalendar(booking: CalendarBooking): Promise<SyncCalendarResult> {
  return oneAtATime(booking.id, async () => {
    const eventId = calendarEventStore.get(booking.id);
    if (!eventId) return 'not_in_calendar';

    const calendar = loadCalendarModule();
    if (!calendar) return 'unavailable';

    const permission = await calendar.getCalendarPermissionsAsync();
    if (!permission.granted) return 'no_permission';

    if (booking.status === CANCELLED) {
      await deleteQuietly(calendar, eventId);
      calendarEventStore.forget(booking.id);
      return 'removed';
    }

    try {
      await calendar.updateEventAsync(eventId, buildCalendarEvent(booking));
      return 'updated';
    } catch {
      calendarEventStore.forget(booking.id);
      return 'missing';
    }
  });
}

/** Remove the event for a booking, e.g. when the player leaves it. */
export function removeBookingFromCalendar(bookingId: string): Promise<SyncCalendarResult> {
  return oneAtATime(bookingId, async () => {
    const eventId = calendarEventStore.get(bookingId);
    if (!eventId) return 'not_in_calendar';

    const calendar = loadCalendarModule();
    if (!calendar) return 'unavailable';

    const permission = await calendar.getCalendarPermissionsAsync();
    if (!permission.granted) return 'no_permission';

    await deleteQuietly(calendar, eventId);
    calendarEventStore.forget(bookingId);
    return 'removed';
  });
}

async function deleteQuietly(calendar: CalendarModule, eventId: string) {
  try {
    await calendar.deleteEventAsync(eventId);
  } catch {
    // Already gone from the calendar: that's the outcome we wanted.
  }
}
