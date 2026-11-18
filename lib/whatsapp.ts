// WhatsApp reminders (A9; docs/specs/match-record.md decision 1h). The app
// reads whether WhatsApp is on, the player's own number and channel choices,
// and writes them only through the server's functions, which check
// everything. Sending happens on the server.
import { supabase } from '@/lib/supabase';

export type Channel = 'push' | 'whatsapp' | 'both';

export type WhatsAppState = {
  /** Whether Futty has switched WhatsApp on (off until it's approved). */
  enabled: boolean;
  /** The player's active number, or null. */
  phone: string | null;
  /** The WhatsApp-capable types, in the order to show them. */
  types: string[];
  /** The player's choice per type; a type with no row is push. */
  channels: Record<string, Channel>;
};

/** The order the reminder types are listed in. */
const ORDER = ['match_reminder_24h', 'match_reminder_2h', 'match_after_game'];

export async function getWhatsAppState(): Promise<{ state: WhatsAppState | null; error: { message: string } | null }> {
  const [enabled, contact, types, channels] = await Promise.all([
    supabase.rpc('whatsapp_enabled'),
    supabase.from('whatsapp_contacts').select('phone_e164, opted_out_at').maybeSingle(),
    supabase.from('whatsapp_notification_types').select('type'),
    supabase.from('notification_channels').select('type, channel'),
  ]);
  const error = enabled.error ?? contact.error ?? types.error ?? channels.error;
  if (error) return { state: null, error };
  const row = contact.data as { phone_e164: string; opted_out_at: string | null } | null;
  const typeList = ((types.data as { type: string }[] | null) ?? []).map((t) => t.type);
  typeList.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const choices: Record<string, Channel> = {};
  for (const c of (channels.data as { type: string; channel: Channel }[] | null) ?? []) choices[c.type] = c.channel;
  return {
    state: {
      enabled: enabled.data === true,
      phone: row && !row.opted_out_at ? row.phone_e164 : null,
      types: typeList,
      channels: choices,
    },
    error: null,
  };
}

/** A Cyprus number typed without a country code gets +357; anything with a + is left as typed. */
export function normalisePhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/[\s().-]/g, '');
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (/^[29]\d{7}$/.test(digits)) return `+357${digits}`;
  return trimmed;
}

const ERRORS: Record<string, string> = {
  invalid_phone: 'Enter your WhatsApp number with its country code, like +357 99 123456.',
  phone_in_use: 'That number is already used for WhatsApp by another Futty account.',
  whatsapp_unavailable: 'WhatsApp reminders aren’t available yet.',
  whatsapp_not_set_up: 'Add your WhatsApp number first.',
};

/** Plain words for a server error. */
export function describeWhatsAppError(message: string | undefined): string {
  const code = Object.keys(ERRORS).find((k) => message?.includes(k));
  return code ? ERRORS[code] : 'Something went wrong. Try again.';
}

export async function setWhatsAppNumber(phone: string) {
  const { data, error } = await supabase.rpc('set_whatsapp_number', { p_phone: normalisePhone(phone) });
  return { phone: (data as { phone?: string } | null)?.phone ?? null, error };
}

export async function stopWhatsApp() {
  const { error } = await supabase.rpc('stop_whatsapp');
  return { error };
}

export async function setNotificationChannel(type: string, channel: Channel) {
  const { error } = await supabase.rpc('set_notification_channel', { p_type: type, p_channel: channel });
  return { error };
}
