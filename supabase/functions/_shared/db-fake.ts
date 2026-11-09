// A fake database for tests, the counterpart of stripe-fake.ts: records every
// database function call and returns scripted results.
//
//   const fake = createDbFake();
//   fake.respond('shares_due_for_capture', [{ share_id: 's1', ... }]);
//   fake.respond('share_captured', (args) => ({ result: 'captured' }));
//   fake.fail('prepare_share_payment', 'not_your_share');
//
// Calling a function with nothing scripted fails, so a test can't pass on a
// call it didn't expect.
import type { Db, RpcResult } from './db.ts';

export type DbCall = { fn: string; args: Record<string, unknown> };

type Handler = (args: Record<string, unknown>) => unknown;

export function createDbFake() {
  const calls: DbCall[] = [];
  const handlers = new Map<string, Handler>();

  const db: Db = {
    rpc(fn, args = {}) {
      calls.push({ fn, args });
      const handler = handlers.get(fn);
      if (!handler) {
        return Promise.resolve<RpcResult>({ data: null, error: { message: `db-fake: no response scripted for ${fn}` } });
      }
      try {
        return Promise.resolve<RpcResult>({ data: handler(args), error: null });
      } catch (error) {
        return Promise.resolve<RpcResult>({ data: null, error: { message: (error as Error).message } });
      }
    },
  };

  return {
    db,
    calls,
    /** Every call to one function, in order. */
    callsTo: (fn: string) => calls.filter((call) => call.fn === fn),
    /** Script a result for every call to `fn`: a value, or a function of the arguments. */
    respond(fn: string, result: unknown) {
      handlers.set(fn, typeof result === 'function' ? (result as Handler) : () => structuredClone(result));
    },
    /** Make every call to `fn` raise `message`, as a database exception would. */
    fail(fn: string, message: string) {
      handlers.set(fn, () => {
        throw new Error(message);
      });
    },
  };
}
