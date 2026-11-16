// reconcile-money (P4d): the daily check is the database's reconcile_money.
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { reconcileMoney } from './handler.ts';

Deno.test('runs the database check and returns what it found', async () => {
  const db = createDbFake();
  db.respond('reconcile_money', { checked: 12, unbalanced: 0, missing_transfers: 0 });
  deepStrictEqual(await reconcileMoney({ db: db.db }), { checked: 12, unbalanced: 0, missing_transfers: 0 });
  strictEqual(db.callsTo('reconcile_money').length, 1);
});

Deno.test('a problem is logged as well as alerted in the database', async () => {
  const db = createDbFake();
  db.respond('reconcile_money', { checked: 12, unbalanced: 1, missing_transfers: 2 });
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    deepStrictEqual(await reconcileMoney({ db: db.db }), { checked: 12, unbalanced: 1, missing_transfers: 2 });
  } finally {
    console.error = original;
  }
  strictEqual(logged.length, 1);
});

Deno.test('the database failing fails the run (so the schedule shows it)', async () => {
  const db = createDbFake();
  db.fail('reconcile_money', 'boom');
  await rejects(() => reconcileMoney({ db: db.db }), /boom/);
});
