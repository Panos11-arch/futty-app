import { bookingRowKind, bookingRowWho, counterDetailsByBookingId } from './venue-dashboard-rows';

describe('bookingRowKind', () => {
  it.each([
    ['owner_block', 'owner_block'],
    ['counter', 'counter'],
    ['user_booking', 'app'],
  ])('%s -> %s', (bookingType, kind) => {
    expect(bookingRowKind(bookingType)).toBe(kind);
  });
});

describe('bookingRowWho', () => {
  const base = { teamLabel: null, playerLabel: 'Dimitris (staff)', counter: null };

  it('shows a walk-in as a walk-in with its customer, never as the staff member who added it', () => {
    expect(
      bookingRowWho({ ...base, booking_type: 'counter', counter: { source: 'walk_in', contactName: 'Andreas' } }),
    ).toBe('Walk-in · Andreas');
  });

  it('shows a phone booking as a phone booking with its customer', () => {
    expect(
      bookingRowWho({ ...base, booking_type: 'counter', counter: { source: 'phone', contactName: 'Maria' } }),
    ).toBe('Phone booking · Maria');
  });

  it('still says walk-in or phone when its details could not be read', () => {
    expect(bookingRowWho({ ...base, booking_type: 'counter' })).toBe('Walk-in or phone booking');
  });

  it('keeps the owner block and app booking labels', () => {
    expect(bookingRowWho({ ...base, booking_type: 'owner_block' })).toBe('Your training block');
    expect(bookingRowWho({ ...base, booking_type: 'user_booking', teamLabel: 'Lions' })).toBe('Lions');
    expect(bookingRowWho({ ...base, booking_type: 'user_booking' })).toBe('Dimitris (staff)');
    expect(bookingRowWho({ ...base, booking_type: 'user_booking', playerLabel: null })).toBe('A player');
  });
});

describe('counterDetailsByBookingId', () => {
  it('maps venue_counter_bookings rows with their contact (object or array form)', () => {
    const map = counterDetailsByBookingId([
      { booking_id: 'b1', source: 'walk_in', venue_contacts: { name: 'Andreas' } },
      { booking_id: 'b2', source: 'phone', venue_contacts: [{ name: 'Maria' }] },
      { booking_id: 'b3', source: 'phone', venue_contacts: null },
    ]);
    expect(map.get('b1')).toEqual({ source: 'walk_in', contactName: 'Andreas' });
    expect(map.get('b2')).toEqual({ source: 'phone', contactName: 'Maria' });
    expect(map.get('b3')).toEqual({ source: 'phone', contactName: null });
  });

  it('ignores an unknown source', () => {
    expect(counterDetailsByBookingId([{ booking_id: 'b1', source: 'email', venue_contacts: null }]).size).toBe(0);
  });
});
