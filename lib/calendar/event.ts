import * as Linking from 'expo-linking';

import { CYPRUS_TIME_ZONE, cyprusWallTime } from './cyprus-time';

/**
 * What the booking screens (P5) pass in. Every field comes from the server's
 * booking, venue and roster data; nothing here is computed by the app.
 */
export type CalendarBooking = {
  id: string;
  /** venue_bookings.status; 'cancelled' removes the event. */
  status: string;
  venueName: string;
  venueAddress: string | null;
  /** Pitch name(s) for this booking, e.g. "Pitch 2" or "Pitch 1 + Pitch 2". */
  pitch: string | null;
  /** e.g. "5-a-side". */
  format: string | null;
  /** Cyprus day, YYYY-MM-DD (venue_bookings.booking_day). */
  bookingDay: string;
  /** Cyprus wall-clock times, HH:MM or HH:MM:SS. */
  startTime: string;
  endTime: string;
  /** Display names of who's playing. */
  players: string[];
};

/** The fields we write to the device calendar (a subset of expo-calendar's Event). */
export type CalendarEventDetails = {
  title: string;
  startDate: Date;
  endDate: Date;
  timeZone: string;
  endTimeZone: string;
  location: string;
  notes: string;
  url: string;
};

/** Where the event links back to. P5 owns the booking screens; change the path here if the route moves. */
export const BOOKING_LINK_PATH = 'my-bookings';

export function bookingLink(bookingId: string): string {
  return Linking.createURL(BOOKING_LINK_PATH, { queryParams: { booking: bookingId } });
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

/** Kickoff and end as instants. A game that ends at or before its start time finishes the next day. */
export function bookingTimes(booking: Pick<CalendarBooking, 'bookingDay' | 'startTime' | 'endTime'>) {
  const startDate = cyprusWallTime(booking.bookingDay, booking.startTime);
  let endDate = cyprusWallTime(booking.bookingDay, booking.endTime);
  if (minutesOf(booking.endTime) <= minutesOf(booking.startTime)) {
    const [y, m, d] = booking.bookingDay.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    endDate = cyprusWallTime(next, booking.endTime);
  }
  return { startDate, endDate };
}

export function buildCalendarEvent(booking: CalendarBooking): CalendarEventDetails {
  const { startDate, endDate } = bookingTimes(booking);
  const url = bookingLink(booking.id);
  const location = [booking.venueName, booking.venueAddress].filter(Boolean).join(', ');

  const notes = [
    booking.venueAddress ? `${booking.venueName}, ${booking.venueAddress}` : booking.venueName,
    booking.pitch ? `Pitch: ${booking.pitch}` : null,
    booking.players.length > 0 ? `Who's playing: ${booking.players.join(', ')}` : null,
    // The url field shows only on iOS, so the link also goes in the notes.
    `Open in Futty: ${url}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title: booking.format ? `Futty ${booking.format} at ${booking.venueName}` : `Futty at ${booking.venueName}`,
    startDate,
    endDate,
    timeZone: CYPRUS_TIME_ZONE,
    endTimeZone: CYPRUS_TIME_ZONE,
    location,
    notes,
    url,
  };
}
