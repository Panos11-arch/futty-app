// reconcile-money (P4d): the daily check is the database's reconcile_money.
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { reconcileMoney } from './handler.ts';

const quiet = { checked: 12, unbalanced: 0, missing_transfers: 0, waiting_for_balance_cents: 0, oldest_waiting: null };

Deno.test('runs the database check and returns what it found', async () => {
  const db = createDbFake();
  db.respond('reconcile_money', quiet);
  deepStrictEqual(await reconcileMoney({ db: db.db }), quiet);
  strictEqual(db.callsTo('reconcile_money').length, 1);
});

Deno.test('a problem is logged as well as alerted in the database', async () => {
  const db = createDbFake();
  db.respond('reconcile_money', { ...quiet, unbalanced: 1, missing_transfers: 2 });
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    deepStrictEqual(await reconcileMoney({ db: db.db }), { ...quiet, unbalanced: 1, missing_transfers: 2 });
  } finally {
    console.error = original;
  }
  strictEqual(logged.length, 1);
});

Deno.test('what is waiting for card money to clear is reported: the total and the oldest', async () => {
  const db = createDbFake();
  const oldest = { payout_id: 'po1', amount_cents: 6000, created_at: '2026-11-14T10:00:00Z', waiting_since: '2026-11-14T10:05:00Z' };
  db.respond('reconcile_money', { ...quiet, waiting_for_balance_cents: 11895, oldest_waiting: oldest });
  const logged: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logged.push(args);
  try {
    const summary = await reconcileMoney({ db: db.db });
    strictEqual(summary.waiting_for_balance_cents, 11895);
    deepStrictEqual(summary.oldest_waiting, oldest);
  } finally {
    console.log = original;
  }
  strictEqual(logged.length, 1);
  strictEqual(String(logged[0][1]).includes('"waiting_for_balance_cents":11895'), true);
});

Deno.test('the database failing fails the run (so the schedule shows it)', async () => {
  const db = createDbFake();
  db.fail('reconcile_money', 'boom');
  await rejects(() => reconcileMoney({ db: db.db }), /boom/);
});
