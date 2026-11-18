import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { handlePayload, handleRequest, isStop, validSignature, verifySubscription } from './handler.ts';

const SECRET = 'app-secret';
const config = { appSecret: SECRET, verifyToken: 'verify-me' };

async function sign(body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function payload(value: Record<string, unknown>) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value }] }] };
}

function setup() {
  const fake = createDbFake();
  fake.respond('whatsapp_status_update', (args: Record<string, unknown>) => args.p_provider_message_id !== 'wamid.UNKNOWN');
  fake.respond('whatsapp_inbound_opt_out', () => true);
  return fake;
}

Deno.test('Meta\'s set-up check echoes the challenge only with the right token', async () => {
  const ok = verifySubscription(new URL('https://x/fn?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42'), 'verify-me');
  strictEqual(ok.status, 200);
  strictEqual(await ok.text(), '42');
  strictEqual(verifySubscription(new URL('https://x/fn?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'), 'verify-me').status, 403);
  strictEqual(verifySubscription(new URL('https://x/fn?hub.mode=other&hub.verify_token=verify-me&hub.challenge=42'), 'verify-me').status, 403);
});

Deno.test('the signature must match the raw body and the app secret', async () => {
  const body = '{"a":1}';
  strictEqual(await validSignature(body, await sign(body), SECRET), true);
  strictEqual(await validSignature(body + ' ', await sign(body), SECRET), false);
  strictEqual(await validSignature(body, await sign(body, 'other'), SECRET), false);
  strictEqual(await validSignature(body, null, SECRET), false);
  strictEqual(await validSignature(body, 'md5=abc', SECRET), false);
});

Deno.test('an unsigned or wrongly signed POST is refused before anything is read', async () => {
  const fake = setup();
  const body = JSON.stringify(payload({ statuses: [{ id: 'wamid.1', status: 'read' }] }));
  const res = await handleRequest(new Request('https://x/fn', { method: 'POST', body, headers: { 'x-hub-signature-256': await sign('{}') } }),
    fake.db, config);
  strictEqual(res.status, 401);
  strictEqual(fake.calls.length, 0);
  strictEqual((await handleRequest(new Request('https://x/fn', { method: 'PUT' }), fake.db, config)).status, 405);
});

Deno.test('delivery reports: status, time, pricing and the first error', async () => {
  const fake = setup();
  const summary = await handlePayload(fake.db, payload({
    statuses: [
      { id: 'wamid.1', status: 'delivered', timestamp: '1763460000', pricing: { billable: true, category: 'utility' } },
      { id: 'wamid.2', status: 'failed', timestamp: '1763460060', errors: [{ code: 131026, title: 'Message undeliverable' }] },
      { id: 'wamid.UNKNOWN', status: 'read', timestamp: '1763460120' },
      { id: 'wamid.3', status: 'deleted' },
    ],
  }));
  deepStrictEqual(summary, { statuses: 2, unknown: 1, optedOut: 0, ignored: 1 });
  deepStrictEqual(fake.callsTo('whatsapp_status_update').map((c) => c.args), [
    { p_provider_message_id: 'wamid.1', p_status: 'delivered', p_at: '2025-11-18T10:00:00.000Z', p_error: null,
      p_pricing_category: 'utility', p_billable: true },
    { p_provider_message_id: 'wamid.2', p_status: 'failed', p_at: '2025-11-18T10:01:00.000Z',
      p_error: '131026: Message undeliverable', p_pricing_category: null, p_billable: null },
    { p_provider_message_id: 'wamid.UNKNOWN', p_status: 'read', p_at: '2025-11-18T10:02:00.000Z', p_error: null,
      p_pricing_category: null, p_billable: null },
  ]);
});

Deno.test('STOP or ΣΤΟΠ opts the number out; anything else is ignored', async () => {
  strictEqual(isStop(' Stop '), true);
  strictEqual(isStop('ΣΤΟΠ'), true);
  strictEqual(isStop('στοπ'), true);
  strictEqual(isStop('please stop sending'), false);
  const fake = setup();
  const summary = await handlePayload(fake.db, payload({
    messages: [
      { from: '35799000001', type: 'text', text: { body: 'STOP' } },
      { from: '35799000002', type: 'text', text: { body: 'See you at 8' } },
      { from: '35799000003', type: 'image' },
    ],
  }));
  deepStrictEqual(summary, { statuses: 0, unknown: 0, optedOut: 1, ignored: 2 });
  deepStrictEqual(fake.callsTo('whatsapp_inbound_opt_out').map((c) => c.args), [{ p_phone: '35799000001' }]);
});

Deno.test('a signed POST is handled end to end; other objects are ignored', async () => {
  const fake = setup();
  const body = JSON.stringify(payload({ statuses: [{ id: 'wamid.1', status: 'read', timestamp: '1763460000' }] }));
  const res = await handleRequest(new Request('https://x/fn', { method: 'POST', body, headers: { 'x-hub-signature-256': await sign(body) } }),
    fake.db, config);
  strictEqual(res.status, 200);
  deepStrictEqual(await res.json(), { statuses: 1, unknown: 0, optedOut: 0, ignored: 0 });
  deepStrictEqual(await handlePayload(fake.db, { object: 'page' }), { statuses: 0, unknown: 0, optedOut: 0, ignored: 0 });
});

Deno.test('a database error answers 500 so Meta sends the report again', async () => {
  const fake = createDbFake();
  fake.fail('whatsapp_status_update', 'boom');
  const body = JSON.stringify(payload({ statuses: [{ id: 'wamid.1', status: 'read' }] }));
  const res = await handleRequest(new Request('https://x/fn', { method: 'POST', body, headers: { 'x-hub-signature-256': await sign(body) } }),
    fake.db, config);
  strictEqual(res.status, 500);
});
