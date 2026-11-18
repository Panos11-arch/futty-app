import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import {
  cleanParam,
  cloudApiSender,
  type DueWhatsApp,
  type SendResult,
  sendWhatsApp,
  type TemplateMessage,
  toTemplateMessage,
} from './handler.ts';

function due(n: number, extra: Partial<DueWhatsApp> = {}): DueWhatsApp {
  return {
    delivery_id: `d${n}`,
    notification_id: `n${n}`,
    type: 'match_reminder_2h',
    phone: `+3579900000${n}`,
    template_name: 'futty_game_reminder',
    template_language: 'en',
    params: ['Kick-off in 2 hours', 'North Arena at 20:00. 6 in, 2 haven\'t paid.'],
    ...extra,
  };
}

/** A queue with the real rule: whatsapp_deliveries_due hands each message out once. */
function setup(queue: DueWhatsApp[]) {
  const fake = createDbFake();
  let waiting = [...queue];
  fake.respond('whatsapp_deliveries_due', (args: Record<string, unknown>) => {
    const claimed = waiting.slice(0, args.p_limit as number);
    waiting = waiting.slice(claimed.length);
    return claimed;
  });
  fake.respond('whatsapp_delivery_result', () => null);
  return fake;
}

Deno.test('a template message: number without +, template, language and the params in order', () => {
  deepStrictEqual(toTemplateMessage(due(1)), {
    messaging_product: 'whatsapp',
    to: '35799000001',
    type: 'template',
    template: {
      name: 'futty_game_reminder',
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: 'Kick-off in 2 hours' },
          { type: 'text', text: 'North Arena at 20:00. 6 in, 2 haven\'t paid.' },
        ],
      }],
    },
  });
});

Deno.test('a template with no params has no components', () => {
  const message = toTemplateMessage(due(1, { template_name: 'futty_after_game', params: [] }));
  strictEqual(message.template.components, undefined);
  strictEqual(toTemplateMessage(due(1, { params: null })).template.components, undefined);
});

Deno.test('params are cleaned the way Meta requires', () => {
  strictEqual(cleanParam('Line one\nLine two\t  end     here '), 'Line one Line two end here');
  strictEqual(cleanParam('x'.repeat(2000)).length, 1024);
});

Deno.test('each queued message is sent once, even when the job runs again', async () => {
  const fake = setup([due(1), due(2)]);
  const sent: TemplateMessage[] = [];
  const send = (m: TemplateMessage): Promise<SendResult> => {
    sent.push(m);
    return Promise.resolve({ id: `wamid.${sent.length}` });
  };
  deepStrictEqual(await sendWhatsApp({ db: fake.db, send }), { claimed: 2, sent: 2, failed: 0 });
  deepStrictEqual(await sendWhatsApp({ db: fake.db, send }), { claimed: 0, sent: 0, failed: 0 });
  strictEqual(sent.length, 2);
  deepStrictEqual(fake.callsTo('whatsapp_delivery_result').map((c) => c.args), [
    { p_delivery_id: 'd1', p_status: 'sent', p_error: null, p_provider_message_id: 'wamid.1' },
    { p_delivery_id: 'd2', p_status: 'sent', p_error: null, p_provider_message_id: 'wamid.2' },
  ]);
});

Deno.test('a refused or failed message is recorded and doesn\'t stop the others', async () => {
  const fake = setup([due(1), due(2), due(3)]);
  let n = 0;
  const send = (): Promise<SendResult> => {
    n++;
    if (n === 1) return Promise.resolve({ error: '131026: Message undeliverable' });
    if (n === 2) return Promise.reject(new Error('network down'));
    return Promise.resolve({ id: 'wamid.3' });
  };
  deepStrictEqual(await sendWhatsApp({ db: fake.db, send }), { claimed: 3, sent: 1, failed: 2 });
  deepStrictEqual(fake.callsTo('whatsapp_delivery_result').map((c) => [c.args.p_status, c.args.p_error]), [
    ['failed', '131026: Message undeliverable'],
    ['failed', 'request_failed: network down'],
    ['sent', null],
  ]);
});

Deno.test('a failure to record one result doesn\'t stop the run', async () => {
  const fake = setup([due(1), due(2)]);
  fake.fail('whatsapp_delivery_result', 'boom');
  const summary = await sendWhatsApp({ db: fake.db, send: () => Promise.resolve({ id: 'wamid' }) });
  deepStrictEqual(summary, { claimed: 2, sent: 2, failed: 0 });
});

Deno.test('cloudApiSender posts to the phone number\'s messages endpoint with the token', async () => {
  let url = '';
  let init: RequestInit | undefined;
  const fetcher = ((u: string, i?: RequestInit) => {
    url = u;
    init = i;
    return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }));
  }) as typeof fetch;
  const send = cloudApiSender({ token: 'tok', phoneNumberId: '123', graphVersion: 'v21.0' }, fetcher);
  deepStrictEqual(await send(toTemplateMessage(due(1))), { id: 'wamid.X' });
  strictEqual(url, 'https://graph.facebook.com/v21.0/123/messages');
  strictEqual((init?.headers as Record<string, string>).Authorization, 'Bearer tok');
  strictEqual(JSON.parse(init?.body as string).to, '35799000001');
});

Deno.test('cloudApiSender returns Meta\'s error, or the HTTP status', async () => {
  const error = cloudApiSender({ token: 't', phoneNumberId: '1', graphVersion: 'v21.0' }, (() =>
    Promise.resolve(new Response(JSON.stringify({ error: { message: 'Template name does not exist', code: 132001 } }), {
      status: 400,
    }))) as typeof fetch);
  deepStrictEqual(await error(toTemplateMessage(due(1))), { error: '132001: Template name does not exist' });
  const plain = cloudApiSender({ token: 't', phoneNumberId: '1', graphVersion: 'v21.0' }, (() =>
    Promise.resolve(new Response('Bad gateway', { status: 502 }))) as typeof fetch);
  deepStrictEqual(await plain(toTemplateMessage(due(1))), { error: 'HTTP 502' });
});
