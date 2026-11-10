import { addBookingToCalendar, syncBookingInCalendar, type CalendarBooking } from '@/lib/calendar';

// A development build made before expo-calendar was added has no native module,
// so importing it throws. Add to calendar must fail softly, not crash.
jest.mock(
  'expo-calendar',
  () => {
    throw new Error("Cannot find native module 'ExpoCalendar'");
  },
  { virtual: true },
);

jest.mock('expo-linking', () => ({ createURL: () => 'futtyapp://my-bookings' }));

jest.mock('@/lib/auth-storage', () => ({
  authStorage: {
    getItem: (key: string) => (key === 'futty.calendar_event.b-1' ? 'event-1' : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  },
}));

const booking: CalendarBooking = {
  id: 'b-1',
  status: 'confirmed',
  venueName: 'English School',
  venueAddress: null,
  pitch: null,
  format: null,
  bookingDay: '2026-12-05',
  startTime: '19:00',
  endTime: '20:00',
  players: [],
};

it('reports the calendar as unavailable when the native module is missing', async () => {
  await expect(addBookingToCalendar(booking)).resolves.toBe('unavailable');
  await expect(syncBookingInCalendar(booking)).resolves.toBe('unavailable');
});
