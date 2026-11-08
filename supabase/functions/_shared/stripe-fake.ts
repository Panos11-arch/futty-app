// A fake Stripe client for tests: records every call and returns scripted
// results, so payment code can be tested without the network.
//
//   const fake = createStripeFake();
//   fake.respond('refunds.create', { id: 're_1', status: 'succeeded' });
//   fake.fail('paymentIntents.capture', stripeError({ code: 'charge_expired_for_capture' }));
//   await handler(fake.stripe);              // typed as the real Stripe client
//   fake.calls[0].idempotencyKey             // 'refund-share-…'
//
// Calling a method with nothing scripted throws, so a test can't pass by
// accident on a call it didn't expect.
import type Stripe from 'npm:stripe@^22';

export type StripeCall = {
  /** Dotted SDK path, e.g. 'refunds.create' or 'paymentIntents.capture'. */
  method: string;
  /** The object id, for id-first methods like retrieve, cancel, capture, del. */
  id?: string;
  params?: Record<string, unknown>;
  idempotencyKey?: string;
  /** All request options passed (idempotencyKey, stripeAccount, ...). */
  options?: Record<string, unknown>;
};

type Handler = (call: StripeCall) => unknown;

// Keys that mark the last argument as Stripe request options, not params.
const REQUEST_OPTION_KEYS = new Set([
  'idempotencyKey',
  'stripeAccount',
  'apiVersion',
  'maxNetworkRetries',
  'timeout',
  'host',
]);

function isRequestOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => REQUEST_OPTION_KEYS.has(key));
}

function toCall(method: string, args: unknown[]): StripeCall {
  const rest = [...args];
  const call: StripeCall = { method };
  if (typeof rest[0] === 'string') call.id = rest.shift() as string;
  if (rest.length > 0 && isRequestOptions(rest[rest.length - 1])) {
    call.options = rest.pop() as Record<string, unknown>;
    if (typeof call.options.idempotencyKey === 'string') call.idempotencyKey = call.options.idempotencyKey;
  }
  if (rest[0] !== undefined) call.params = rest[0] as Record<string, unknown>;
  return call;
}

/** An error shaped like the ones the Stripe SDK throws (type, code, statusCode). */
export function stripeError(
  { type = 'StripeInvalidRequestError', code, message = 'Fake Stripe error', statusCode = 400 }: {
    type?: string;
    code?: string;
    message?: string;
    statusCode?: number;
  } = {},
): Error {
  return Object.assign(new Error(message), { type, code, statusCode, raw: { type, code, message } });
}

export function createStripeFake() {
  const calls: StripeCall[] = [];
  const handlers = new Map<string, Handler>();

  // Any property path (stripe.refunds.create, stripe.checkout.sessions.create)
  // resolves to a recording function. `then` stays undefined so the client
  // and its resources are never mistaken for promises.
  const node = (path: string[]): unknown =>
    new Proxy(function () {}, {
      get: (_target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : node([...path, key])),
      apply: (_target, _this, args: unknown[]) => {
        const call = toCall(path.join('.'), args);
        calls.push(call);
        const handler = handlers.get(call.method);
        if (!handler) {
          return Promise.reject(new Error(`stripe-fake: no response scripted for ${call.method}`));
        }
        try {
          return Promise.resolve(handler(call));
        } catch (error) {
          return Promise.reject(error);
        }
      },
    });

  return {
    stripe: node([]) as unknown as Stripe,
    calls,
    /** Every call to one method, in order. */
    callsTo: (method: string) => calls.filter((call) => call.method === method),
    /** Script a result for every call to `method`: a value, or a function of the call. */
    respond(method: string, result: unknown) {
      handlers.set(method, typeof result === 'function' ? (result as Handler) : () => structuredClone(result));
    },
    /** Make every call to `method` throw `error` (see stripeError). */
    fail(method: string, error: unknown) {
      handlers.set(method, () => {
        throw error;
      });
    },
  };
}
