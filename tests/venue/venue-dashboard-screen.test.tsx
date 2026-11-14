import { render, screen } from '@testing-library/react-native';

import VenueDashboardScreen from '@/app/venue-dashboard';

// The venue dashboard's day list (app/venue-dashboard.tsx): a walk-in or
// phone booking is named by its source and customer
// (venue_counter_bookings, venue_contacts), never as a booking of the staff
// member who added it (its created_by).

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockCalls: { table: string; method: string; args: unknown[] }[] = [];
const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    let ownerBlocksOnly = false;
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'order', 'update']) {
      query[method] = (...args: unknown[]) => {
        mockCalls.push({ table, method, args });
        if (method === 'eq' && args[0] === 'booking_type' && args[1] === 'owner_block') ownerBlocksOnly = true;
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: ownerBlocksOnly ? [] : mockTables[table] ?? [], error: null }).then(resolve, reject);
    return query;
  };
  return { supabase: { from: (table: string) => builder(table), rpc: (...args: unknown[]) => mockRpc(...args) } };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'staff1' } }) }));
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ status: 'ready', profile: { id: 'staff1', role: 'venue_owner' }, reload: jest.fn() }),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const booking = (id: string, start: string, bookingType: string, createdBy: string): Row => ({
  id,
  start_time: start,
  end_time: start.replace(':00:00', ':59:00'),
  pitches: 1,
  format: '5-a-side',
  booking_type: bookingType,
  note: null,
  created_by: createdBy,
});

beforeEach(() => {
  mockCalls.length = 0;
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({
    data: [
      { id: 'player1', username: 'nikos', full_name: 'Nikos Georgiou' },
      { id: 'staff1', username: 'staff', full_name: 'Staff Member' },
    ],
  });
  mockTables.venues = [{ id: 'v1', name: 'Nuevo Campo', base_pitches: 2 }];
  mockTables.venue_bookings = [
    booking('app1', '18:00:00', 'user_booking', 'player1'),
    booking('walk1', '18:00:00', 'counter', 'staff1'),
    booking('phone1', '20:00:00', 'counter', 'staff1'),
    booking('nodetails', '21:00:00', 'counter', 'staff1'),
  ];
  mockTables.squad_posts = [];
  mockTables.venue_counter_bookings = [
    { booking_id: 'walk1', source: 'walk_in', venue_contacts: { name: 'Andreas' } },
    { booking_id: 'phone1', source: 'phone', venue_contacts: [{ name: 'Maria' }] },
  ];
});

describe('VenueDashboardScreen walk-in labels', () => {
  it('names a walk-in and a phone booking by their customer, never as the staff member who added them', async () => {
    await render(<VenueDashboardScreen />);

    expect(await screen.findByText('Walk-in · Andreas')).toBeTruthy();
    expect(screen.getByText('Phone booking · Maria')).toBeTruthy();
    expect(screen.getByText('Nikos Georgiou')).toBeTruthy();
    expect(screen.queryByText('Staff Member')).toBeNull();
  });

  it('still says walk-in or phone when its details could not be read', async () => {
    await render(<VenueDashboardScreen />);
    expect(await screen.findByText('Walk-in or phone booking')).toBeTruthy();
  });

  it('looks up the app booker only, and the counter details only for counter bookings', async () => {
    await render(<VenueDashboardScreen />);
    await screen.findByText('Walk-in · Andreas');

    expect(mockRpc).toHaveBeenCalledWith('get_public_profiles', { p_profile_ids: ['player1'] });
    expect(
      mockCalls.find((c) => c.table === 'venue_counter_bookings' && c.method === 'in')?.args,
    ).toEqual(['booking_id', ['walk1', 'phone1', 'nodetails']]);
  });
});
