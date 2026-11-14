import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Modal } from 'react-native';

import VenueDashboardScreen from '@/app/venue-dashboard';
import { loadWithFile } from '@/components/ui/test-utils';
import { cyprusToday } from '@/lib/venue-today';
import { appRoster, dayBoard, venueQuote, walkIn } from '@/lib/venue-today.fixtures';

// The venue dashboard's Today screen (app/venue-dashboard.tsx, P6c): the day
// calendar per pitch from venue_day_board, the blocks and flags on it, and
// every write going to its server function with ids only. Detailed sheet
// behaviour is tested in components/venue/*.test.tsx.

loadWithFile(Modal, VenueDashboardScreen);

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockCalls: { table: string; method: string; args: unknown[] }[] = [];
const mockRpcData: Record<string, unknown> = {};
const mockRpc = jest.fn();
let mockRole = 'venue_owner';

jest.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'order', 'update', 'insert', 'delete']) {
      query[method] = (...args: unknown[]) => {
        mockCalls.push({ table, method, args });
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: mockTables[table] ?? [], error: null }).then(resolve, reject);
    return query;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string, args: unknown) => {
        mockRpc(name, args);
        return Promise.resolve({ data: mockRpcData[name] ?? null, error: null });
      },
      functions: { invoke: jest.fn(async () => ({ data: { cancelled: true }, error: null })) },
    },
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'staff1' } }) }));
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ status: 'ready', profile: { id: 'staff1', role: mockRole }, reload: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const block = { id: 'blk1', pitch_id: 'p2', starts_at: '09:00:00', ends_at: '10:00:00', reason: 'Resurfacing' };
const flag = { id: 'f1', pitch_id: null, starts_at: '18:00:00', ends_at: '20:00:00', note: 'Waterlogged' };

beforeEach(() => {
  mockCalls.length = 0;
  mockRpc.mockReset();
  mockRole = 'venue_owner';
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  mockTables.venues = [{ id: 'v1', name: 'Nuevo Campo', base_pitches: 2, allows_6v6_on_5s: false }];
  mockRpcData.venue_day_board = dayBoard({ day: cyprusToday(), blocks: [block], flags: [flag] });
  mockRpcData.venue_booking_roster = appRoster();
  mockRpcData.slot_price_cents = 5000;
  mockRpcData.cancellation_quote = venueQuote();
});

const rpcCalls = (name: string) => mockRpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

async function open() {
  await render(<VenueDashboardScreen />);
  await screen.findByTestId('booking-b-walk');
}

describe('Venue dashboard: Today', () => {
  it("shows today's calendar per pitch, in Cyprus time", async () => {
    await open();
    expect(rpcCalls('venue_day_board')).toEqual([{ p_venue_id: 'v1', p_day: cyprusToday() }]);
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('labels a walk-in by its source and contact, never as a booking of the staff member who added it', async () => {
    await open();
    const walk = screen.getByTestId('booking-b-walk');
    expect(walk).toHaveTextContent(/Walk-in/);
    expect(walk).toHaveTextContent(/Andreas/);
    expect(walk).not.toHaveTextContent(/staff/i);
  });

  it('shows blocks and flags, on the calendar and in the list', async () => {
    await open();
    expect(screen.getByTestId('cell-p2-09:00')).toHaveTextContent('Blocked');
    expect(screen.getByTestId('cell-p2-18:00')).toHaveTextContent('Flagged');
    expect(screen.getByTestId('block-blk1')).toHaveTextContent(/Pitch 2 · 09:00–10:00.*Resurfacing/);
    expect(screen.getByTestId('flag-f1')).toHaveTextContent(/All pitches · 18:00–20:00.*Waterlogged/);
  });

  it('removes a block by its id and reloads the day', async () => {
    await open();
    await act(() => fireEvent.press(within(screen.getByTestId('block-blk1')).getByText('Remove')));
    expect(mockCalls.filter((c) => c.table === 'venue_blocks').map((c) => [c.method, c.args])).toEqual([
      ['delete', []],
      ['eq', ['id', 'blk1']],
    ]);
    expect(rpcCalls('venue_day_board')).toHaveLength(2);
  });

  it('clears a flag by its id', async () => {
    await open();
    await act(() => fireEvent.press(within(screen.getByTestId('flag-f1')).getByText('Remove')));
    expect(rpcCalls('clear_conditions')).toEqual([{ p_flag_id: 'f1' }]);
  });

  it('opens a booking and ticks cash on the second tap, with the share id only', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByTestId('booking-b-app')));
    expect(rpcCalls('venue_booking_roster')).toEqual([{ p_booking_id: 'b-app' }]);
    const tick = await screen.findByText('Mark €6.00 cash paid');
    await act(() => fireEvent.press(tick));
    expect(rpcCalls('mark_cash_received')).toEqual([]);
    await act(() => fireEvent.press(screen.getByText('Confirm €6.00 cash received')));
    expect(rpcCalls('mark_cash_received')).toEqual([{ p_share_id: 's2' }]);
  });

  it('adds a walk-in at a free slot with no price unless staff change it', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByTestId('cell-p1-10:00')));
    expect(rpcCalls('slot_price_cents')).toEqual([
      { p_venue_id: 'v1', p_day: cyprusToday(), p_start: '10:00', p_end: '11:00', p_format: '5-a-side' },
    ]);
    await act(() => fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas'));
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(rpcCalls('add_counter_booking')).toEqual([
      expect.objectContaining({ p_venue_id: 'v1', p_pitch_id: 'p1', p_charged_cents: null, p_paid_method: 'cash' }),
    ]);
  });

  it('blocks every pitch for the day in two taps', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByText('Block')));
    await act(() => fireEvent.press(screen.getByText('Close to new bookings')));
    const inserts = mockCalls.filter((c) => c.table === 'venue_blocks' && c.method === 'insert');
    expect(inserts.map((c) => c.args[0])).toEqual([
      {
        venue_id: 'v1',
        pitch_id: null,
        block_day: cyprusToday(),
        starts_at: null,
        ends_at: null,
        reason: null,
        created_by: 'staff1',
      },
    ]);
  });

  it('blocks one pitch for a time range, with that pitch and those times', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByText('Block')));
    await act(() => fireEvent.press(screen.getAllByText('Pitch 1').at(-1)!));
    await act(() => fireEvent.press(screen.getByText('Time range')));
    await act(() => fireEvent.press(screen.getByTestId('from-19:30')));
    await act(() => fireEvent.press(screen.getByTestId('to-21:00')));
    await act(() => fireEvent.press(screen.getByText('Close to new bookings')));
    const inserts = mockCalls.filter((c) => c.table === 'venue_blocks' && c.method === 'insert');
    expect(inserts.map((c) => c.args[0])).toEqual([
      expect.objectContaining({ pitch_id: 'p1', block_day: cyprusToday(), starts_at: '19:30', ends_at: '21:00' }),
    ]);
  });

  it('tapping a flagged slot opens Flag with that pitch and half hour filled in', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByTestId('cell-p2-18:00')));
    await act(() => fireEvent.press(screen.getByText('Flag and tell players')));
    expect(rpcCalls('flag_conditions')).toEqual([
      { p_venue_id: 'v1', p_day: cyprusToday(), p_start: '18:00', p_end: '18:30', p_pitch_id: 'p2', p_note: null },
    ]);
    expect(rpcCalls('slot_price_cents')).toEqual([]);
  });

  it('flags conditions for the day in two taps', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByText('Flag conditions')));
    await act(() => fireEvent.press(screen.getByText('Flag and tell players')));
    expect(rpcCalls('flag_conditions')).toEqual([
      { p_venue_id: 'v1', p_day: cyprusToday(), p_start: null, p_end: null, p_pitch_id: null, p_note: null },
    ]);
  });

  it('switches 6 v 6 on 5-a-side pitches on', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByText('Allowed')));
    expect(rpcCalls('set_venue_allows_6v6')).toEqual([{ p_venue_id: 'v1', p_allowed: true }]);
  });

  it('moves to the next day', async () => {
    await open();
    await act(() => fireEvent.press(screen.getByLabelText('Next day')));
    expect(rpcCalls('venue_day_board').at(-1)).toMatchObject({ p_day: expect.not.stringMatching(cyprusToday()) });
    expect(screen.getByText('Tomorrow')).toBeTruthy();
  });

  it('is only for venue owners', async () => {
    mockRole = 'player';
    await render(<VenueDashboardScreen />);
    expect(screen.getByText('This screen is only available to venue owner accounts.')).toBeTruthy();
  });

  it('still names a walk-in by its contact when there is only that booking', async () => {
    mockRpcData.venue_day_board = dayBoard({ day: cyprusToday(), bookings: [walkIn({ contact_name: 'Maria' })] });
    await render(<VenueDashboardScreen />);
    expect(await screen.findByTestId('booking-b-walk')).toHaveTextContent(/Maria/);
  });
});
