// Sends the queued WhatsApp reminders (A9; docs/specs/match-record.md
// section 6.3 step 5, decision 1h) through the WhatsApp Business Platform
// (Meta Cloud API), with Meta-approved templates.
//
// send_notification queues one WhatsApp delivery when the player chose
// WhatsApp (or both) for a WhatsApp-capable type and has an active number.
// This job claims the due ones with whatsapp_deliveries_due (each is handed
// out once, so it is sent once), sends each as a template message, and
// records Meta's answer with whatsapp_delivery_result: sent with Meta's
// message id, or failed with the error. A failure is recorded, never thrown:
// one bad number doesn't stop the others. Delivery reports and the pricing
// category arrive later through whatsapp-webhook.
import { type Db, rpc } from '../_shared/db.ts';

export type DueWhatsApp = {
  delivery_id: string;
  notification_id: string;
  type: string;
  phone: string;
  template_name: string;
  template_language: string;
  params: string[] | null;
};

export type TemplateMessage = {
  messaging_product: 'whatsapp';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components?: { type: 'body'; parameters: { type: 'text'; text: string }[] }[];
  };
};

/** Meta's answer for one message: its id, or an error. */
export type SendResult = { id: string } | { error: string };

export type SendWhatsApp = (message: TemplateMessage) => Promise<SendResult>;

export type Deps = { db: Db; send: SendWhatsApp };

/** How many messages one run claims at most. */
export const CLAIM_LIMIT = 200;

/**
 * A template parameter as Meta accepts it: no new lines or tabs, no more
 * than 4 spaces in a row, and at most 1024 characters.
 */
export function cleanParam(text: string): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return flat.length > 1024 ? `${flat.slice(0, 1023)}…` : flat;
}

export function toTemplateMessage(due: DueWhatsApp): TemplateMessage {
  const params = (due.params ?? []).map(cleanParam);
  return {
    messaging_product: 'whatsapp',
    // Meta takes the number without the +.
    to: due.phone.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: due.template_name,
      language: { code: due.template_language },
      ...(params.length > 0
        ? { components: [{ type: 'body' as const, parameters: params.map((text) => ({ type: 'text' as const, text })) }] }
        : {}),
    },
  };
}

async function record(db: Db, deliveryId: string, result: SendResult) {
  try {
    await rpc(db, 'whatsapp_delivery_result', {
      p_delivery_id: deliveryId,
      p_status: 'id' in result ? 'sent' : 'failed',
      p_error: 'error' in result ? result.error : null,
      p_provider_message_id: 'id' in result ? result.id : null,
    });
  } catch (err) {
    console.error('whatsapp_delivery_result failed:', deliveryId, err);
  }
}

export async function sendWhatsApp(deps: Deps) {
  const summary = { claimed: 0, sent: 0, failed: 0 };
  const due = await rpc<DueWhatsApp[] | null>(deps.db, 'whatsapp_deliveries_due', { p_limit: CLAIM_LIMIT }) ?? [];
  summary.claimed = due.length;
  for (const delivery of due) {
    let result: SendResult;
    try {
      result = await deps.send(toTemplateMessage(delivery));
    } catch (err) {
      result = { error: `request_failed: ${(err as Error).message}` };
    }
    await record(deps.db, delivery.delivery_id, result);
    if ('id' in result) summary.sent++;
    else summary.failed++;
  }
  return summary;
}

type GraphAnswer = {
  messages?: { id?: string }[];
  error?: { message?: string; code?: number };
};

/** The real Cloud API: POST /{version}/{phone-number-id}/messages. */
export function cloudApiSender(
  config: { token: string; phoneNumberId: string; graphVersion: string },
  fetcher: typeof fetch = fetch,
): SendWhatsApp {
  return async (message) => {
    const response = await fetcher(
      `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
    );
    let json: GraphAnswer = {};
    try {
      json = await response.json() as GraphAnswer;
    } catch {
      // A non-JSON answer is reported by status below.
    }
    const id = json.messages?.[0]?.id;
    if (response.ok && id) return { id };
    const code = json.error?.code ? `${json.error.code}: ` : '';
    return { error: `${code}${json.error?.message ?? `HTTP ${response.status}`}` };
  };
}
