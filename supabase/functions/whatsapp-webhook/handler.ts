// What the WhatsApp Business Platform tells Futty after a message is sent
// (A9; match-record.md decision 1h):
//   - GET: Meta's one-time check when the webhook is set up (hub.challenge).
//   - POST: delivery reports (sent, delivered, read, failed, with the
//     pricing category) and replies. Every POST is checked against Meta's
//     X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret)
//     before anything is read.
// A delivery report updates the message with whatsapp_status_update, which
// logs the pricing category and fills in the cost when a price is set. A
// reply of STOP (or ΣΤΟΠ) opts the number out with whatsapp_inbound_opt_out.
// Other replies are ignored: Futty doesn't hold conversations on WhatsApp.
import { type Db, rpc } from '../_shared/db.ts';

export type StatusReport = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string;
  pricing?: { billable?: boolean; category?: string };
  errors?: { code?: number; title?: string; message?: string }[];
};

export type InboundMessage = { from: string; type: string; text?: { body?: string } };

type Payload = {
  object?: string;
  entry?: { changes?: { field?: string; value?: { statuses?: StatusReport[]; messages?: InboundMessage[] } }[] }[];
};

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'στοπ', 'stop.']);

/** Whether a reply asks to stop: the whole message is a stop word, any case. */
export function isStop(text: string | undefined): boolean {
  return STOP_WORDS.has((text ?? '').trim().toLocaleLowerCase('el'));
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks X-Hub-Signature-256 ("sha256=<hex>") against the raw body. */
export async function validSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return sameText(header.slice('sha256='.length).toLowerCase(), hex(signature));
}

/** Meta's set-up check: echo hub.challenge when the verify token matches. */
export function verifySubscription(url: URL, verifyToken: string): Response {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token !== null && sameText(token, verifyToken) && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

const toIso = (unixSeconds: string | undefined) =>
  unixSeconds && /^\d+$/.test(unixSeconds) ? new Date(Number(unixSeconds) * 1000).toISOString() : new Date().toISOString();

/** Records every delivery report and STOP reply in a webhook payload. */
export async function handlePayload(db: Db, payload: Payload) {
  const summary = { statuses: 0, unknown: 0, optedOut: 0, ignored: 0 };
  if (payload.object !== 'whatsapp_business_account') return summary;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      for (const status of change.value?.statuses ?? []) {
        if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) {
          summary.ignored++;
          continue;
        }
        const error = status.errors?.[0];
        const known = await rpc<boolean>(db, 'whatsapp_status_update', {
          p_provider_message_id: status.id,
          p_status: status.status,
          p_at: toIso(status.timestamp),
          p_error: error ? `${error.code ?? ''}${error.code ? ': ' : ''}${error.title ?? error.message ?? 'failed'}` : null,
          p_pricing_category: status.pricing?.category ?? null,
          p_billable: status.pricing?.billable ?? null,
        });
        if (known) summary.statuses++;
        else summary.unknown++;
      }
      for (const message of change.value?.messages ?? []) {
        if (message.type === 'text' && isStop(message.text?.body)) {
          if (await rpc<boolean>(db, 'whatsapp_inbound_opt_out', { p_phone: message.from })) summary.optedOut++;
        } else {
          summary.ignored++;
        }
      }
    }
  }
  return summary;
}

export type Config = { appSecret: string; verifyToken: string };

/** The whole request: GET for Meta's check, POST for reports and replies. */
export async function handleRequest(req: Request, db: Db, config: Config): Promise<Response> {
  if (req.method === 'GET') return verifySubscription(new URL(req.url), config.verifyToken);
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256'), config.appSecret))) {
    return new Response('Invalid signature', { status: 401 });
  }
  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  try {
    const summary = await handlePayload(db, payload);
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // Meta retries a non-200 answer, which is what we want for a database error.
    console.error('whatsapp-webhook failed:', err);
    return new Response('failed', { status: 500 });
  }
}
