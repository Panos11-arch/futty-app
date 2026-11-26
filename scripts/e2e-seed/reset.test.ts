import { E2E_STAFF, E2E_USERS, E2E_VENUE } from './config';
import { assertE2eVenue, isE2eEmail, selectBookingsToCancel, selectE2eUsers, type BookingRow } from './reset';

describe('isE2eEmail: only the exact e2e domain', () => {
  it.each(['e2e-ios-1@e2e.futty.app', 'E2E-Android-1@E2E.Futty.App', ' e2e-ios-2@e2e.futty.app '])('%s is e2e', (email) => {
    expect(isE2eEmail(email)).toBe(true);
  });

  it.each([
    'panos@futty.app',
    'support@futty.app',
    'someone@e2e.futty.app.evil.com',
    'e2e.futty.app@gmail.com',
    'someone@sub.e2e.futty.app',
    'someone@xe2e.futty.app',
    'a@b@e2e.futty.app',
    '@e2e.futty.app',
    '',
    null,
    undefined,
  ])('%s is not', (email) => {
    expect(isE2eEmail(email)).toBe(false);
  });
});

describe('selectE2eUsers: never a real login', () => {
  const users = [
    { id: 'real-1', email: 'panos@futty.app' },
    { id: 'real-2', email: 'e2e-ios-1@e2e.futty.app.example.com' },
    { id: 'real-3', email: null },
    { id: 'stray', email: 'someone-else@e2e.futty.app' },
    ...E2E_USERS.map((u, i) => ({ id: `e2e-${i}`, email: u.email })),
    ...E2E_STAFF.map((u, i) => ({ id: `staff-${i}`, email: u.email })),
  ];

  it('picks exactly the configured e2e logins: four players and the two venue staff', () => {
    expect(selectE2eUsers(users).map((u) => u.id)).toEqual(['e2e-0', 'e2e-1', 'e2e-2', 'e2e-3', 'staff-0', 'staff-1']);
  });

  it('picks nothing from a list of real logins', () => {
    expect(selectE2eUsers(users.slice(0, 4))).toEqual([]);
  });
});

describe('selectBookingsToCancel: only e2e bookings at the E2E venue that still hold a pitch', () => {
  // 10:00 in Cyprus on 21 November 2026.
  const now = new Date('2026-11-21T08:00:00Z');
  const e2eUserIds = new Set(['e2e-0', 'e2e-2']);
  const base: BookingRow = {
    id: 'mine',
    venue_id: E2E_VENUE.id,
    created_by: 'e2e-0',
    status: 'confirmed',
    booking_day: '2026-11-23',
    start_time: '19:00:00',
  };
  const rows: BookingRow[] = [
    base,
    { ...base, id: 'pending', status: 'pending_payment', created_by: 'e2e-2' },
    { ...base, id: 'other-venue', venue_id: '5f0c3c5e-8d5b-4b8e-9a43-2a4d7c1f0b11' },
    { ...base, id: 'no-venue', venue_id: null },
    { ...base, id: 'real-player', created_by: 'real-1' },
    { ...base, id: 'walk-in', created_by: null },
    { ...base, id: 'cancelled', status: 'cancelled' },
    { ...base, id: 'started', booking_day: '2026-11-21', start_time: '09:30:00' },
  ];

  it('selects the e2e logins’ own open bookings there, and nothing else', () => {
    expect(selectBookingsToCancel(rows, { e2eUserIds, now }).map((b) => b.id)).toEqual(['mine', 'pending']);
  });

  it('selects nothing with no e2e logins', () => {
    expect(selectBookingsToCancel(rows, { e2eUserIds: new Set(), now })).toEqual([]);
  });

  it('a game that kicks off later today in Cyprus still counts as to come', () => {
    const tonight = { ...base, id: 'tonight', booking_day: '2026-11-21', start_time: '10:30:00' };
    expect(selectBookingsToCancel([tonight], { e2eUserIds, now }).map((b) => b.id)).toEqual(['tonight']);
  });
});

describe('assertE2eVenue', () => {
  it('passes a new venue or our own', () => {
    expect(() => assertE2eVenue(null)).not.toThrow();
    expect(() => assertE2eVenue({ name: 'E2E Arena' })).not.toThrow();
  });

  it('stops on anybody else’s venue at that id', () => {
    expect(() => assertE2eVenue({ name: 'Nuevo Campo' })).toThrow(/Stopping/);
  });
});
