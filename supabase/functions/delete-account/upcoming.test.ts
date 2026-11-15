import { strictEqual } from 'node:assert/strict';

import { type Db, hasUpcomingGames, type Query } from './upcoming.ts';

// An in-memory stand-in for the two tables: applies each filter to its rows
// (a dotted column reads the embedded booking), like PostgREST would.
function fakeDb(tables: Record<string, Record<string, unknown>[]>): Db {
  const read = (row: Record<string, unknown>, column: string): unknown =>
    column.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], row);
  return {
    from(table: string): Query {
      let rows = [...(tables[table] ?? [])];
      const query: Query = {
        select: () => query,
        eq: (c, v) => ((rows = rows.filter((r) => read(r, c) === v)), query),
        neq: (c, v) => ((rows = rows.filter((r) => read(r, c) !== v)), query),
        gte: (c, v) => ((rows = rows.filter((r) => String(read(r, c)) >= String(v))), query),
        in: (c, vs) => ((rows = rows.filter((r) => vs.includes(read(r, c)))), query),
        limit: (n) => ((rows = rows.slice(0, n)), query),
        then: (resolve, reject) => Promise.resolve({ data: rows }).then(resolve, reject),
      };
      return query;
    },
  };
}

const today = '2026-11-14';
const booking = (overrides: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  created_by: 'u1',
  booking_type: 'user_booking',
  booking_day: '2026-11-20',
  status: 'confirmed',
  ...overrides,
});

Deno.test('walk-ins a staff member added and their training blocks never block deleting the account', async () => {
  const db = fakeDb({
    booking_payment_shares: [],
    venue_bookings: [booking({ booking_type: 'counter' }), booking({ booking_type: 'owner_block' })],
  });
  strictEqual(await hasUpcomingGames(db, 'u1', today), false);
});

Deno.test('an upcoming app booking they made still blocks it', async () => {
  const db = fakeDb({ booking_payment_shares: [], venue_bookings: [booking({})] });
  strictEqual(await hasUpcomingGames(db, 'u1', today), true);
});

Deno.test('a past, cancelled or someone else\'s booking does not', async () => {
  const db = fakeDb({
    booking_payment_shares: [],
    venue_bookings: [
      booking({ booking_day: '2026-11-13' }),
      booking({ status: 'cancelled' }),
      booking({ created_by: 'u2' }),
    ],
  });
  strictEqual(await hasUpcomingGames(db, 'u1', today), false);
});

Deno.test('money on an upcoming game they joined blocks it; a pending share does not', async () => {
  const share = (status: string) => ({
    id: crypto.randomUUID(),
    profile_id: 'u1',
    status,
    venue_bookings: { booking_day: '2026-11-20', status: 'confirmed' },
  });
  strictEqual(await hasUpcomingGames(fakeDb({ booking_payment_shares: [share('paid')], venue_bookings: [] }), 'u1', today), true);
  strictEqual(
    await hasUpcomingGames(fakeDb({ booking_payment_shares: [share('pending')], venue_bookings: [] }), 'u1', today),
    false,
  );
});
