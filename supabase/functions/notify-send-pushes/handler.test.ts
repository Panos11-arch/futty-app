import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { type DueDelivery, type ExpoMessage, type ExpoTicket, expoSender, sendPushes, toExpoMessage } from './handler.ts';

function delivery(n: number, extra: Partial<DueDelivery> = {}): DueDelivery {
  return {
    delivery_id: `d${n}`,
    notification_id: `n${n}`,
    type: 'match_result_submitted',
    token: `ExponentPushToken[${n}]`,
    title: 'Check the score',
    body: 'Bibs 5–3 Non-bibs. Accept or reject it in the match.',
    data: { matchId: 'm1' },
    ...extra,
  };
}

/**
 * A fake queue with the real rule: push_deliveries_due hands each delivery
 * out once (the database marks it sending), so a second run gets nothing.
 */
function setup(queue: DueDelivery[]) {
  const fake = createDbFake();
  let waiting = [...queue];
  fake.respond('push_deliveries_due', (args: Record<string, unknown>) => {
    const claimed = waiting.slice(0, args.p_limit as number);
    waiting = waiting.slice(claimed.length);
    return claimed;
  });
  fake.respond('push_delivery_result', () => null);
  const sent: ExpoMessage[][] = [];
  return { fake, sent };
}

function okSender(sent: ExpoMessage[][]) {
  return (messages: ExpoMessage[]) => {
    sent.push(messages);
    return Promise.resolve(messages.map((): ExpoTicket => ({ status: 'ok', id: 'ticket' })));
  };
}

Deno.test('one send_notification call is exactly one push, even when the job runs again', async () => {
  const { fake, sent } = setup([delivery(1)]);
  const first = await sendPushes({ db: fake.db, sendExpo: okSender(sent) });
  const second = await sendPushes({ db: fake.db, sendExpo: okSender(sent) });

  deepStrictEqual(first, { claimed: 1, sent: 1, failed: 0 });
  deepStrictEqual(second, { claimed: 0, sent: 0, failed: 0 });
  strictEqual(sent.flat().length, 1);
  deepStrictEqual(fake.callsTo('push_delivery_result').map((c) => c.args), [
    { p_delivery_id: 'd1', p_status: 'sent', p_error: null },
  ]);
});

Deno.test('one push per delivery, with the type and ids the app opens', async () => {
  const { fake, sent } = setup([delivery(1), delivery(2, { type: 'booking_cancelled', data: { bookingId: 'b1' } })]);
  await sendPushes({ db: fake.db, sendExpo: okSender(sent) });

  deepStrictEqual(sent, [[
    {
      to: 'ExponentPushToken[1]',
      title: 'Check the score',
      body: 'Bibs 5–3 Non-bibs. Accept or reject it in the match.',
      sound: 'default',
      data: { matchId: 'm1', type: 'match_result_submitted', notificationId: 'n1' },
    },
    {
      to: 'ExponentPushToken[2]',
      title: 'Check the score',
      body: 'Bibs 5–3 Non-bibs. Accept or reject it in the match.',
      sound: 'default',
      data: { bookingId: 'b1', type: 'booking_cancelled', notificationId: 'n2' },
    },
  ]]);
  deepStrictEqual(fake.callsTo('push_deliveries_due')[0].args, { p_limit: 500 });
});

Deno.test('a ticket error is recorded as failed and the rest are still sent', async () => {
  const { fake } = setup([delivery(1), delivery(2), delivery(3)]);
  const summary = await sendPushes({
    db: fake.db,
    sendExpo: () =>
      Promise.resolve([
        { status: 'ok' },
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'too big' },
      ]),
  });

  deepStrictEqual(summary, { claimed: 3, sent: 1, failed: 2 });
  deepStrictEqual(fake.callsTo('push_delivery_result').map((c) => c.args), [
    { p_delivery_id: 'd1', p_status: 'sent', p_error: null },
    { p_delivery_id: 'd2', p_status: 'failed', p_error: 'DeviceNotRegistered' },
    { p_delivery_id: 'd3', p_status: 'failed', p_error: 'too big' },
  ]);
});

Deno.test('a failed request fails its batch only; a missing ticket is a failure', async () => {
  const queue = Array.from({ length: 205 }, (_, i) => delivery(i));
  const { fake } = setup(queue);
  let call = 0;
  const summary = await sendPushes({
    db: fake.db,
    sendExpo: (messages) => {
      call++;
      if (call === 2) return Promise.reject(new Error('timeout'));
      // The third batch (5 messages) gets one ticket short.
      return Promise.resolve(messages.slice(0, call === 3 ? 4 : messages.length).map((): ExpoTicket => ({ status: 'ok' })));
    },
  });

  strictEqual(call, 3, 'batches of 100: 100, 100, 5');
  deepStrictEqual(summary, { claimed: 205, sent: 104, failed: 101 });
  const results = fake.callsTo('push_delivery_result').map((c) => c.args);
  strictEqual(results.length, 205, 'every claimed delivery gets a result');
  deepStrictEqual(results[100], { p_delivery_id: 'd100', p_status: 'failed', p_error: 'request_failed: timeout' });
  deepStrictEqual(results[204], { p_delivery_id: 'd204', p_status: 'failed', p_error: 'no_ticket' });
});

Deno.test('nothing due: no request to Expo', async () => {
  const { fake, sent } = setup([]);
  deepStrictEqual(await sendPushes({ db: fake.db, sendExpo: okSender(sent) }), { claimed: 0, sent: 0, failed: 0 });
  strictEqual(sent.length, 0);
});

Deno.test('recording a result that fails doesn\'t stop the others', async () => {
  const { fake, sent } = setup([delivery(1), delivery(2)]);
  let n = 0;
  fake.respond('push_delivery_result', () => {
    n++;
    if (n === 1) throw new Error('db down');
    return null;
  });
  const summary = await sendPushes({ db: fake.db, sendExpo: okSender(sent) });
  deepStrictEqual(summary, { claimed: 2, sent: 2, failed: 0 });
  strictEqual(fake.callsTo('push_delivery_result').length, 2);
});

Deno.test('toExpoMessage copes with no data', () => {
  deepStrictEqual(toExpoMessage(delivery(1, { data: null })).data, { type: 'match_result_submitted', notificationId: 'n1' });
});

Deno.test('expoSender posts the batch to Expo and returns its tickets', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = ((url: string, init: RequestInit) => {
    requests.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify({ data: [{ status: 'ok', id: 't1' }] }), { status: 200 }));
  }) as unknown as typeof fetch;
  const messages = [toExpoMessage(delivery(1))];
  deepStrictEqual(await expoSender(fetcher, 'secret')(messages), [{ status: 'ok', id: 't1' }]);
  strictEqual(requests[0].url, 'https://exp.host/--/api/v2/push/send');
  strictEqual(requests[0].init.method, 'POST');
  strictEqual((requests[0].init.headers as Record<string, string>).Authorization, 'Bearer secret');
  deepStrictEqual(JSON.parse(requests[0].init.body as string), messages);
});

Deno.test('expoSender throws on an HTTP error, so the batch is recorded as failed', async () => {
  const fetcher = (() => Promise.resolve(new Response('busy', { status: 503 }))) as unknown as typeof fetch;
  let error = '';
  try {
    await expoSender(fetcher)([]);
  } catch (err) {
    error = (err as Error).message;
  }
  strictEqual(error, 'Expo answered 503');
  const noData = (() => Promise.resolve(new Response('{}', { status: 200 }))) as unknown as typeof fetch;
  deepStrictEqual(await expoSender(noData)([]), []);
});
