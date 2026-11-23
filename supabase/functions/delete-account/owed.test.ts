import { strictEqual } from 'node:assert/strict';

import { type Db, owedCents, type Query } from './owed.ts';

// An in-memory venue_debts table that applies each filter like PostgREST.
function fakeDb(rows: Record<string, unknown>[], failWith?: string): Db {
  return {
    from(table: string): Query {
      let selected = table === 'venue_debts' ? [...rows] : [];
      const query: Query = {
        select: () => query,
        eq: (c, v) => ((selected = selected.filter((r) => r[c] === v)), query),
        is: (c, v) => ((selected = selected.filter((r) => r[c] === v)), query),
        then: (resolve, reject) =>
          Promise.resolve(
            failWith
              ? { data: null, error: { message: failWith } }
              : { data: selected as { amount_cents: number }[], error: null }
          ).then(
            resolve,
            reject
          ),
      };
      return query;
    },
  };
}

const debt = (overrides: Record<string, unknown>) => ({
  profile_id: 'u1',
  amount_cents: 680,
  settled_at: null,
  ...overrides,
});

Deno.test('no debts: owes nothing', async () => {
  strictEqual(await owedCents(fakeDb([]), 'u1'), 0);
});

Deno.test('adds up every unsettled debt of the player, to a venue or to Futty, in cents', async () => {
  const db = fakeDb([debt({}), debt({ amount_cents: 455 }), debt({ amount_cents: 1 })]);
  strictEqual(await owedCents(db, 'u1'), 1136);
});

Deno.test('settled debts and other players\' debts do not count', async () => {
  const db = fakeDb([
    debt({ settled_at: '2026-11-20T10:00:00Z' }),
    debt({ profile_id: 'someone-else' }),
    debt({ amount_cents: 300 }),
  ]);
  strictEqual(await owedCents(db, 'u1'), 300);
});

Deno.test('a read error gives null, so nothing is deleted', async () => {
  strictEqual(await owedCents(fakeDb([debt({})], 'boom'), 'u1'), null);
});
