// Where the booking screens go (P5b): a booking's detail is
// app/booking/[id].tsx. Checkout and Pay my share land there once paid, My
// Bookings rows open it, and so does "Open in Futty" from a calendar event
// (lib/calendar links to /my-bookings?booking=<id>).
import type { Href } from 'expo-router';

export type BookingNavigator = { push: (href: Href) => void; replace: (href: Href) => void };

export function bookingDetailHref(bookingId: string) {
  return { pathname: '/booking/[id]', params: { id: bookingId } } as const;
}

export function openBookingDetail(bookingId: string, nav: BookingNavigator) {
  nav.push(bookingDetailHref(bookingId));
}

/** Paid: on to that booking's detail, in place of checkout. Without a
 *  booking id (shouldn't happen once paid), My Bookings. */
export function afterPayment(bookingId: string | null, nav: BookingNavigator) {
  nav.replace(bookingId ? bookingDetailHref(bookingId) : '/my-bookings');
}

/** The ?booking= search param, as one id or none. */
export function linkedBookingId(param: string | string[] | undefined): string | null {
  const id = Array.isArray(param) ? param[0] : param;
  return id ? id : null;
}
