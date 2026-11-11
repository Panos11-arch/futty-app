// Sends the queued pushes (docs/specs/match-record.md sections 4.11 and 6.3).
//
// send_notification writes one notification_deliveries row per push token
// (held during the player's quiet hours). This job claims the ones due now
// with push_deliveries_due (each delivery is handed out once, so it is
// pushed once), sends them to Expo's push API in batches of 100, and records
// each outcome with push_delivery_result. A failure is recorded, never
// thrown: one bad token or one failed request doesn't stop the others.
import { type Db, rpc } from '../_shared/db.ts';

export type DueDelivery = {
  delivery_id: string;
  notification_id: string;
  type: string;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: Record<string, unknown>;
};

/** Expo's answer for one message, in the order the messages were sent. */
export type ExpoTicket =
  | { status: 'ok'; id?: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type SendExpo = (messages: ExpoMessage[]) => Promise<ExpoTicket[]>;

export type Deps = { db: Db; sendExpo: SendExpo };

/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH = 100;
/** How many deliveries one run claims at most. */
export const CLAIM_LIMIT = 500;

export function toExpoMessage(delivery: DueDelivery): ExpoMessage {
  return {
    to: delivery.token,
    title: delivery.title,
    body: delivery.body,
    sound: 'default',
    // The app opens the right screen from the type and the ids in data.
    data: { ...(delivery.data ?? {}), type: delivery.type, notificationId: delivery.notification_id },
  };
}

function ticketError(ticket: ExpoTicket | undefined): string | null {
  if (!ticket) return 'no_ticket';
  if (ticket.status === 'ok') return null;
  return ticket.details?.error ?? ticket.message ?? 'expo_error';
}

async function record(db: Db, deliveryId: string, error: string | null) {
  try {
    await rpc(db, 'push_delivery_result', {
      p_delivery_id: deliveryId,
      p_status: error === null ? 'sent' : 'failed',
      p_error: error,
    });
  } catch (err) {
    console.error('push_delivery_result failed:', deliveryId, err);
  }
}

export async function sendPushes(deps: Deps) {
  const summary = { claimed: 0, sent: 0, failed: 0 };
  const due = await rpc<DueDelivery[] | null>(deps.db, 'push_deliveries_due', { p_limit: CLAIM_LIMIT }) ?? [];
  summary.claimed = due.length;

  for (let i = 0; i < due.length; i += EXPO_BATCH) {
    const batch = due.slice(i, i + EXPO_BATCH);
    let tickets: ExpoTicket[] | null = null;
    let requestError: string | null = null;
    try {
      tickets = await deps.sendExpo(batch.map(toExpoMessage));
    } catch (err) {
      requestError = `request_failed: ${(err as Error).message}`;
    }
    for (let j = 0; j < batch.length; j++) {
      const error = requestError ?? ticketError(tickets?.[j]);
      await record(deps.db, batch[j].delivery_id, error);
      if (error === null) summary.sent++;
      else summary.failed++;
    }
  }
  return summary;
}

/** The real Expo push API. */
export function expoSender(fetcher: typeof fetch = fetch, accessToken?: string): SendExpo {
  return async (messages) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetcher('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });
    if (!response.ok) throw new Error(`Expo answered ${response.status}`);
    const json = await response.json() as { data?: ExpoTicket[] };
    return json.data ?? [];
  };
}
