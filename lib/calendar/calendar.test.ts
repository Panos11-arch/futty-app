import {
  addBookingToCalendar,
  buildCalendarEvent,
  isBookingInCalendar,
  removeBookingFromCalendar,
  syncBookingInCalendar,
  type CalendarBooking,
} from '@/lib/calendar';

// expo-calendar arrives in its own PR (with a new development build), so it is
// mocked here; `virtual` lets this run before the package is installed.
const mockCalendar = {
  getCalendarPermissionsAsync: jest.fn(),
  requestCalendarPermissionsAsync: jest.fn(),
  getDefaultCalendarAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  createEventAsync: jest.fn(),
  updateEventAsync: jest.fn(),
  deleteEventAsync: jest.fn(),
  EntityTypes: { EVENT: 'event' },
};
jest.mock('expo-calendar', () => mockCalendar, { virtual: true });

jest.mock('expo-linking', () => ({
  createURL: (path: string, options?: { queryParams?: Record<string, string> }) =>
    `futtyapp://${path}?${new URLSearchParams(options?.queryParams ?? {}).toString()}`,
}));

const mockStorage = new Map<string, string>();
jest.mock('@/lib/auth-storage', () => ({
  authStorage: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => void mockStorage.set(key, value),
    removeItem: (key: string) => void mockStorage.delete(key),
  },
}));

const booking: CalendarBooking = {
  id: 'b-1',
  status: 'confirmed',
  venueName: 'English School',
  venueAddress: 'Kyriakou Matsi 1, Nicosia',
  pitch: 'Pitch 2',
  format: '5-a-side',
  bookingDay: '2026-12-05',
  startTime: '19:00:00',
  endTime: '20:00:00',
  players: ['Anghelo', 'Panos', 'Dimitris'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockCalendar.getCalendarPermissionsAsync.mockResolvedValue({ granted: true });
  mockCalendar.requestCalendarPermissionsAsync.mockResolvedValue({ granted: true });
  mockCalendar.getDefaultCalendarAsync.mockResolvedValue({ id: 'cal-default', allowsModifications: true });
  mockCalendar.getCalendarsAsync.mockResolvedValue([]);
  mockCalendar.createEventAsync.mockResolvedValue('event-1');
  mockCalendar.updateEventAsync.mockResolvedValue('event-1');
  mockCalendar.deleteEventAsync.mockResolvedValue(undefined);
});

describe('buildCalendarEvent', () => {
  it('has the venue name and address, pitch, players and a link back to the booking', () => {
    const event = buildCalendarEvent(booking);

    expect(event.title).toBe('Futty 5-a-side at English School');
    expect(event.location).toBe('English School, Kyriakou Matsi 1, Nicosia');
    expect(event.notes).toBe(
      [
        'English School, Kyriakou Matsi 1, Nicosia',
        'Pitch: Pitch 2',
        "Who's playing: Anghelo, Panos, Dimitris",
        'Open in Futty: futtyapp://my-bookings?booking=b-1',
      ].join('\n'),
    );
    expect(event.url).toBe('futtyapp://my-bookings?booking=b-1');
  });

  it('puts kickoff and end in Cyprus time, whatever the phone zone', () => {
    const event = buildCalendarEvent(booking);

    // 19:00-20:00 in Cyprus in December is 17:00-18:00 UTC.
    expect(event.startDate.toISOString()).toBe('2026-12-05T17:00:00.000Z');
    expect(event.endDate.toISOString()).toBe('2026-12-05T18:00:00.000Z');
    expect(event.timeZone).toBe('Asia/Nicosia');
    expect(event.endTimeZone).toBe('Asia/Nicosia');
  });

  it('ends on the next day for a game that runs past midnight', () => {
    const event = buildCalendarEvent({ ...booking, startTime: '23:30', endTime: '00:30' });

    expect(event.startDate.toISOString()).toBe('2026-12-05T21:30:00.000Z');
    expect(event.endDate.toISOString()).toBe('2026-12-05T22:30:00.000Z');
  });

  it('handles an end time of 24:00', () => {
    const event = buildCalendarEvent({ ...booking, startTime: '23:00', endTime: '24:00:00' });

    expect(event.endDate.toISOString()).toBe('2026-12-05T22:00:00.000Z');
  });

  it('leaves out what it does not know', () => {
    const event = buildCalendarEvent({ ...booking, venueAddress: null, pitch: null, format: null, players: [] });

    expect(event.title).toBe('Futty at English School');
    expect(event.location).toBe('English School');
    expect(event.notes).toBe('English School\nOpen in Futty: futtyapp://my-bookings?booking=b-1');
  });
});

describe('addBookingToCalendar', () => {
  it('asks for permission, then adds the event to the default calendar', async () => {
    await expect(addBookingToCalendar(booking)).resolves.toBe('added');

    expect(mockCalendar.requestCalendarPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockCalendar.createEventAsync).toHaveBeenCalledWith('cal-default', buildCalendarEvent(booking));
    expect(isBookingInCalendar('b-1')).toBe(true);
  });

  it('adds nothing when permission is refused', async () => {
    mockCalendar.requestCalendarPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(addBookingToCalendar(booking)).resolves.toBe('permission_denied');
    expect(mockCalendar.createEventAsync).not.toHaveBeenCalled();
    expect(isBookingInCalendar('b-1')).toBe(false);
  });

  it('uses the primary writable calendar where there is no default (Android)', async () => {
    mockCalendar.getDefaultCalendarAsync.mockRejectedValue(new Error('iOS only'));
    mockCalendar.getCalendarsAsync.mockResolvedValue([
      { id: 'holidays', allowsModifications: false, isPrimary: false },
      { id: 'work', allowsModifications: true, isPrimary: false },
      { id: 'me', allowsModifications: true, isPrimary: true },
    ]);

    await expect(addBookingToCalendar(booking)).resolves.toBe('added');
    expect(mockCalendar.createEventAsync).toHaveBeenCalledWith('me', expect.anything());
  });

  it('reports when there is no calendar it can write to', async () => {
    mockCalendar.getDefaultCalendarAsync.mockResolvedValue({ id: 'ro', allowsModifications: false });
    mockCalendar.getCalendarsAsync.mockResolvedValue([{ id: 'ro', allowsModifications: false }]);

    await expect(addBookingToCalendar(booking)).resolves.toBe('no_calendar');
    expect(mockCalendar.createEventAsync).not.toHaveBeenCalled();
  });

  it('does not add a cancelled booking', async () => {
    await expect(addBookingToCalendar({ ...booking, status: 'cancelled' })).resolves.toBe('booking_cancelled');
    expect(mockCalendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('updates rather than duplicates when tapped again', async () => {
    await addBookingToCalendar(booking);
    await expect(addBookingToCalendar(booking)).resolves.toBe('updated');

    expect(mockCalendar.createEventAsync).toHaveBeenCalledTimes(1);
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('event-1', buildCalendarEvent(booking));
  });

  it('adds one event for a double tap', async () => {
    const results = await Promise.all([addBookingToCalendar(booking), addBookingToCalendar(booking)]);

    expect(results).toEqual(['added', 'updated']);
    expect(mockCalendar.createEventAsync).toHaveBeenCalledTimes(1);
  });

  it('adds it again if the player deleted it in their calendar app', async () => {
    await addBookingToCalendar(booking);
    mockCalendar.updateEventAsync.mockRejectedValue(new Error('event not found'));
    mockCalendar.createEventAsync.mockResolvedValue('event-2');

    await expect(addBookingToCalendar(booking)).resolves.toBe('added');
    // The new event is the one kept up to date from now on.
    mockCalendar.updateEventAsync.mockResolvedValue('event-2');
    await syncBookingInCalendar(booking);
    expect(mockCalendar.updateEventAsync).toHaveBeenLastCalledWith('event-2', expect.anything());
  });
});

describe('syncBookingInCalendar', () => {
  it('updates the event when the booking is rescheduled', async () => {
    await addBookingToCalendar(booking);
    const moved = { ...booking, bookingDay: '2026-12-06', startTime: '20:00', endTime: '21:30' };

    await expect(syncBookingInCalendar(moved)).resolves.toBe('updated');

    const [eventId, details] = mockCalendar.updateEventAsync.mock.calls[0];
    expect(eventId).toBe('event-1');
    expect(details.startDate.toISOString()).toBe('2026-12-06T18:00:00.000Z');
    expect(details.endDate.toISOString()).toBe('2026-12-06T19:30:00.000Z');
  });

  it('updates who is playing when the roster changes', async () => {
    await addBookingToCalendar(booking);

    await syncBookingInCalendar({ ...booking, players: ['Anghelo', 'Panos'] });

    expect(mockCalendar.updateEventAsync.mock.calls[0][1].notes).toContain("Who's playing: Anghelo, Panos\n");
  });

  it('removes the event when the booking is cancelled', async () => {
    await addBookingToCalendar(booking);

    await expect(syncBookingInCalendar({ ...booking, status: 'cancelled' })).resolves.toBe('removed');

    expect(mockCalendar.deleteEventAsync).toHaveBeenCalledWith('event-1');
    expect(isBookingInCalendar('b-1')).toBe(false);
  });

  it('forgets the event even if it was already deleted from the calendar', async () => {
    await addBookingToCalendar(booking);
    mockCalendar.deleteEventAsync.mockRejectedValue(new Error('event not found'));

    await expect(syncBookingInCalendar({ ...booking, status: 'cancelled' })).resolves.toBe('removed');
    expect(isBookingInCalendar('b-1')).toBe(false);
  });

  it('stops tracking an event the player deleted', async () => {
    await addBookingToCalendar(booking);
    mockCalendar.updateEventAsync.mockRejectedValue(new Error('event not found'));

    await expect(syncBookingInCalendar(booking)).resolves.toBe('missing');
    expect(isBookingInCalendar('b-1')).toBe(false);
  });

  it('does nothing, and never asks for permission, for a booking that was not added', async () => {
    await expect(syncBookingInCalendar(booking)).resolves.toBe('not_in_calendar');
    await expect(syncBookingInCalendar({ ...booking, status: 'cancelled' })).resolves.toBe('not_in_calendar');

    expect(mockCalendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(mockCalendar.getCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(mockCalendar.updateEventAsync).not.toHaveBeenCalled();
  });

  it('never asks for permission, even when it was taken away', async () => {
    await addBookingToCalendar(booking);
    mockCalendar.requestCalendarPermissionsAsync.mockClear();
    mockCalendar.getCalendarPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(syncBookingInCalendar({ ...booking, status: 'cancelled' })).resolves.toBe('no_permission');

    expect(mockCalendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(mockCalendar.deleteEventAsync).not.toHaveBeenCalled();
    // Still linked, so it can be removed once permission is back.
    expect(isBookingInCalendar('b-1')).toBe(true);
  });
});

describe('removeBookingFromCalendar', () => {
  it('deletes the event and forgets it', async () => {
    await addBookingToCalendar(booking);

    await expect(removeBookingFromCalendar('b-1')).resolves.toBe('removed');
    expect(mockCalendar.deleteEventAsync).toHaveBeenCalledWith('event-1');
    expect(isBookingInCalendar('b-1')).toBe(false);
  });

  it('does nothing for a booking that was not added', async () => {
    await expect(removeBookingFromCalendar('b-1')).resolves.toBe('not_in_calendar');
    expect(mockCalendar.deleteEventAsync).not.toHaveBeenCalled();
  });
});
