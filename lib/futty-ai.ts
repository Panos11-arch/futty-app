// S13A: Futty AI chats. The chats and their messages are the server's
// (public.ai_chats, public.ai_chat_messages; the owner reads them). A message
// goes to the futty-ai-chat function, which answers from app_rules and spec
// 13, and saves the question and the answer together. Chats and their
// photos are deleted 7 days after the last message.
import type { Href } from 'expo-router';

import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { CONTACT_EMAIL } from '@/lib/contact';
import { supabase } from '@/lib/supabase';

export const AI_PHOTO_BUCKET = 'ai-chat-photos';
export const MAX_AI_PHOTOS = 3;
/** The chat route's id for a chat not started yet. */
export const NEW_CHAT = 'new';

/** Account → Help → "Ask Futty AI": my chats. */
export const FUTTY_AI_HREF: Href = '/futty-ai';

/** One chat, or a new one. */
export function futtyAiHref(chatId: string): Href {
  return { pathname: '/futty-ai/[id]', params: { id: chatId } };
}

export type AiChat = { id: string; title: string; created_at: string; last_message_at: string };

export type AiMessage = {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  actions: string[];
  /** Storage paths, for photoUrls. */
  photo_paths: string[];
  created_at: string;
  /** Mine only, before the server has it. */
  pending?: 'sending' | 'failed';
  /** Mine only, before the server has it: the photos on the phone. */
  local_photos?: string[];
};

export const QUICK_REPLIES = ['Book a pitch', 'Cancel a booking', 'How do payments work?', 'Premium'] as const;

// ---- Action buttons -------------------------------------------------------------

/** The screen each action tag opens (the server's whitelist, futty-ai-chat/answer.ts); support is an email. */
const ACTIONS = {
  book: { label: 'Book a pitch', href: '/book' },
  my_bookings: { label: 'View bookings', href: '/my-bookings' },
  payments: { label: 'View payments', href: '/account/payments' },
  premium: { label: 'Get Premium', href: '/account/premium' },
  find_game: { label: 'Find a match', href: '/squads' },
  leagues: { label: 'View leagues', href: '/leagues' },
  settings: { label: 'Open settings', href: '/account/settings' },
  contact_support: { label: 'Email support', href: null },
} as const satisfies Record<string, { label: string; href: Href | null }>;

export type AiAction = keyof typeof ACTIONS;
export type AiActionButton = { tag: AiAction; label: string; href: Href | null };

/** The buttons under an answer: known tags only, at most two. */
export function actionButtons(tags: readonly string[]): AiActionButton[] {
  return tags
    .filter((t): t is AiAction => Object.prototype.hasOwnProperty.call(ACTIONS, t))
    .slice(0, 2)
    .map((tag) => ({ tag, label: ACTIONS[tag].label, href: ACTIONS[tag].href }));
}

// ---- Server calls -----------------------------------------------------------------

const CHAT_COLUMNS = 'id, title, created_at, last_message_at';
const MESSAGE_COLUMNS = 'id, role, body, actions, photo_paths, created_at';

/** My chats, newest first. */
export async function fetchAiChats(): Promise<AiChat[]> {
  const { data, error } = await supabase.from('ai_chats').select(CHAT_COLUMNS).order('last_message_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AiChat[];
}

/** One of my chats and its messages, oldest first. */
export async function fetchAiChat(chatId: string): Promise<{ chat: AiChat; messages: AiMessage[] }> {
  const [chat, messages] = await Promise.all([
    supabase.from('ai_chats').select(CHAT_COLUMNS).eq('id', chatId).maybeSingle(),
    supabase.from('ai_chat_messages').select(MESSAGE_COLUMNS).eq('chat_id', chatId).order('created_at', { ascending: true }),
  ]);
  if (chat.error) throw new Error(chat.error.message);
  if (messages.error) throw new Error(messages.error.message);
  if (!chat.data) throw new Error('chat_not_found');
  return { chat: chat.data as AiChat, messages: (messages.data ?? []) as AiMessage[] };
}

/** One line for a failed send: what happened, and what to do. */
export function aiErrorLine(status: number | null, code: string | null): string {
  if (status === 429) return 'Too many messages. Try again later.';
  if (code === 'message_too_long') return 'Too long. Send a shorter message.';
  if (code === 'too_many_photos') return `Up to ${MAX_AI_PHOTOS} photos per message.`;
  if (code === 'bad_photo') return "That photo didn't work. Try another.";
  if (code === 'chat_not_found') return 'Chat not found. Start a new chat.';
  return "Couldn't reach Futty AI. Try again.";
}

type InvokeError = { context?: { status?: number; json?: () => Promise<{ error?: unknown }> } } | null;

async function errorLine(error: InvokeError): Promise<string> {
  const status = typeof error?.context?.status === 'number' ? error.context.status : null;
  let code: string | null = null;
  try {
    const body = await error?.context?.json?.();
    code = typeof body?.error === 'string' ? body.error : null;
  } catch {
    // Not JSON: the generic line.
  }
  return aiErrorLine(status, code);
}

export type SendResult = { chat_id: string; messages: AiMessage[] };

/** Sends one message (and up to 3 base64 JPEGs); the server reads the history itself. Throws one line. */
export async function sendAiMessage(input: { chatId: string | null; text: string; photos: string[] }): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke<SendResult>('futty-ai-chat', {
    body: { chat_id: input.chatId, text: input.text, photos: input.photos },
  });
  if (error || !data?.chat_id) throw new Error(await errorLine(error as InvokeError));
  return data;
}

/** Signed links to my chat's photos (private bucket), by path. */
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(AI_PHOTO_BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) throw new Error(error.message);
  const urls: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  return urls;
}

// ---- Cyprus dates and times -----------------------------------------------------------

const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: CYPRUS_TIME_ZONE, day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { timeZone: CYPRUS_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const year = new Intl.DateTimeFormat('en-GB', { timeZone: CYPRUS_TIME_ZONE, year: 'numeric' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: CYPRUS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The chat header: "Started 20 Nov at 17:53". */
export function startedLabel(iso: string): string {
  const at = new Date(iso);
  return `Started ${dayMonth.format(at)} at ${clock.format(at)}`;
}

/** A chat in the list: "20 Nov", or "30 Dec 2025" from another year. */
export function chatDateLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  return year.format(at) === year.format(now) ? dayMonth.format(at) : dayMonthYear.format(at);
}

/** Under my latest message: "Sent · Just now", "Sent · 5 min ago", then "Sent · 17:54". */
export function sentLabel(iso: string, now: Date = new Date()): string {
  const seconds = (now.getTime() - Date.parse(iso)) / 1000;
  if (seconds < 60) return 'Sent · Just now';
  if (seconds < 60 * 60) return `Sent · ${Math.floor(seconds / 60)} min ago`;
  return `Sent · ${clock.format(new Date(iso))}`;
}

// ---- Contact support -------------------------------------------------------------------

/** How much of the chat goes in the email (mail apps cut long links). */
const MAIL_BODY_MAX = 1800;

function transcriptLine(m: AiMessage): string {
  const who = m.role === 'user' ? 'Me' : 'Futty AI';
  const photos = m.photo_paths.length || m.local_photos?.length || 0;
  const note = photos ? `\n[${photos} photo${photos === 1 ? '' : 's'}]` : '';
  return `${who}: ${m.body}${note}`;
}

/** An email to support with the chat's text, its latest messages when long. */
export function supportMailto(title: string, messages: AiMessage[]): string {
  const lines: string[] = [];
  let length = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = transcriptLine(messages[i]);
    const added = line.length + (lines.length > 0 ? 2 : 0);
    if (length + added > MAIL_BODY_MAX) break;
    lines.unshift(line);
    length += added;
  }
  const subject = encodeURIComponent(`Futty AI: ${title}`);
  return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${encodeURIComponent(lines.join('\n\n'))}`;
}
