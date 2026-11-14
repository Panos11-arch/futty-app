import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TrainingSlotsSection } from '@/components/venue/training-slots-section';

// Recurring training slots on the venue dashboard (spec 05 section 12, item
// 4): which slots are still upcoming, and which dates a new series falls on,
// are worked out on the Cyprus date (CLAUDE.md rule 3), never the phone's.

type Row = Record<string, unknown>;
const mockCalls: { table: string; method: string; args: unknown[] }[] = [];
let mockRows: Row[] = [];

jest.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'order', 'update', 'insert']) {
      query[method] = (...args: unknown[]) => {
        mockCalls.push({ table, method, args });
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: mockRows, error: null }).then(resolve, reject);
    return query;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const venue = { id: 'v1', name: 'Nuevo Campo', base_pitches: 2 };

beforeEach(() => {
  mockCalls.length = 0;
  mockRows = [];
});

async function draw(today: string) {
  const onChanged = jest.fn();
  await render(<TrainingSlotsSection venue={venue} userId="staff1" today={today} onChanged={onChanged} />);
  await screen.findAllByText(/No recurring slots|upcoming/);
  return { onChanged };
}

const calls = (method: string) => mockCalls.filter((c) => c.method === method).map((c) => c.args);

describe('TrainingSlotsSection', () => {
  it('lists slots from the Cyprus today', async () => {
    await draw('2026-11-16');
    expect(calls('gte')).toEqual([['booking_day', '2026-11-16']]);
  });

  it('groups a series by its weekday on the Cyprus date', async () => {
    mockRows = [
      { id: 'a', booking_day: '2026-11-16', start_time: '18:00:00', end_time: '19:00:00', note: null },
      { id: 'b', booking_day: '2026-11-23', start_time: '18:00:00', end_time: '19:00:00', note: null },
      { id: 'c', booking_day: '2026-11-22', start_time: '18:00:00', end_time: '19:00:00', note: null },
    ];
    await draw('2026-11-16');
    expect(screen.getByText('Mondays, 18:00–19:00')).toBeTruthy();
    expect(screen.getByText('2 upcoming')).toBeTruthy();
    expect(screen.getByText('Sundays, 18:00–19:00')).toBeTruthy();
  });

  it('a new series starts on the next such weekday from the Cyprus today', async () => {
    // Sunday 15 November in Cyprus: Monday slots start on the 16th.
    await draw('2026-11-15');
    await act(() => fireEvent.press(screen.getByText('4 weeks')));
    await act(() => fireEvent.press(screen.getByText('Create recurring slots')));
    const [rows] = calls('insert')[0] as [Row[]];
    expect(rows.map((r) => r.booking_day)).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07']);
  });

  it('a series on today’s weekday starts today', async () => {
    await draw('2026-11-15');
    await act(() => fireEvent.press(screen.getByText('Sun')));
    await act(() => fireEvent.press(screen.getByText('4 weeks')));
    await act(() => fireEvent.press(screen.getByText('Create recurring slots')));
    const [rows] = calls('insert')[0] as [Row[]];
    expect(rows[0].booking_day).toBe('2026-11-15');
  });
});
