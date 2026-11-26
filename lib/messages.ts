// S13: messages. Captain to captain (two teams in a league) and friend to
// friend. Every rule (who may write, blocks, ages, the 1 to 1000 characters,
// the rate limit) is the server's (supabase/migrations/*_match_messages.sql);
// this file calls it and shapes what it returns for the screens.
import type { Href } from 'expo-router';
import * as Crypto from 'expo-crypto';

import { TOO_YOUNG_MESSAGE } from '@/lib/age';
import { avatarLook, type AvatarLook } from '@/lib/avatar';
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { cyprusDateKey } from '@/lib/days';
import { supabase } from '@/lib/supabase';

/** The server's limit (messages.body check). */
export const MESSAGE_MAX_LENGTH = 1000;
/** Messages per page, newest first. */
export const MESSAGE_PAGE_SIZE = 30;
/** The input grows up to this many lines, then scrolls. */
export const INPUT_MAX_LINES = 5;

export type ConversationKind = 'captains' | 'friends';

type AvatarColumns = {
  avatar_style: string | null;
  avatar_kit_colour: string | null;
  avatar_number: number | null;
  avatar_illustration?: string | null;
};

export type InboxRow = AvatarColumns & {
  id: string;
  kind: ConversationKind;
  title: string;
  subtitle: string | null;
  other_profile_id: string | null;
  other_team_id: string | null;
  last_body: string;
  last_at: string;
  last_mine: boolean | null;
  unread: number;
};

/** Why the caller can't write right now, or null. */
export type SendRefusal = 'blocked' | 'age_pair_refused' | 'no_captain' | null;

export type ConversationHeader = AvatarColumns & {
  id: string;
  kind: ConversationKind;
  title: string;
  subtitle: string | null;
  other_profile_id: string | null;
  other_team_id: string | null;
  my_team_id: string | null;
  send_refusal: SendRefusal;
  blocked_by_me: boolean;
  other_read_at: string | null;
  other_delivered_at: string | null;
  /** Friend chats: a team each of them captains ("Team vs team"). */
  friend_team_id: string | null;
  my_captain_team_id: string | null;
};

export type ServerMessage = {
  id: string;
  sender_id: string | null;
  sender_name: string;
  mine: boolean;
  body: string;
  client_id: string | null;
  created_at: string;
};

/** A message on screen: from the server, or mine still on its way. */
export type ChatMessage = ServerMessage & {
  /** Mine only, before the server has it. */
  pending?: 'sending' | 'failed';
};

export type CaptainContact = AvatarColumns & {
  my_team_id: string;
  team_id: string;
  team_name: string;
  captain_id: string;
  captain_name: string;
};

type RpcError = { message: string } | null;

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

// ---- Server calls -------------------------------------------------------------

export async function fetchInbox(): Promise<InboxRow[]> {
  const { data, error } = await supabase.rpc('list_my_conversations');
  if (error) throw error;
  return rows<InboxRow>(data);
}

export async function fetchUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('my_unread_message_count');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function fetchConversationHeader(conversationId: string): Promise<ConversationHeader> {
  const { data, error } = await supabase.rpc('conversation_header', { p_conversation_id: conversationId });
  if (error) throw error;
  const [header] = rows<ConversationHeader>(data);
  if (!header) throw new Error('conversation_not_found');
  return header;
}

/** A page of messages, newest first; `before` is the oldest one already shown. */
export async function fetchMessages(
  conversationId: string,
  before?: Pick<ServerMessage, 'id' | 'created_at'> | null
): Promise<ServerMessage[]> {
  const { data, error } = await supabase.rpc('list_messages', {
    p_conversation_id: conversationId,
    p_before: before?.created_at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: MESSAGE_PAGE_SIZE,
  });
  if (error) throw error;
  return rows<ServerMessage>(data);
}

export async function sendMessage(
  conversationId: string,
  body: string,
  clientId: string
): Promise<{ data: { id: string; created_at: string } | null; error: RpcError }> {
  const { data, error } = await supabase.rpc('send_message', {
    p_conversation_id: conversationId,
    p_body: body,
    p_client_id: clientId,
  });
  if (error) return { data: null, error };
  const [row] = rows<{ id: string; created_at: string }>(data);
  return { data: row ?? null, error: null };
}

export async function markConversationRead(conversationId: string) {
  return supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
}

export async function markMessagesDelivered() {
  return supabase.rpc('mark_messages_delivered');
}

export async function fetchLeagueCaptainContacts(leagueId: string): Promise<CaptainContact[]> {
  const { data, error } = await supabase.rpc('league_captain_contacts', { p_league_id: leagueId });
  if (error) throw error;
  return rows<CaptainContact>(data);
}

export async function openCaptainConversation(myTeamId: string, otherTeamId: string) {
  const { data, error } = await supabase.rpc('open_captain_conversation', {
    p_my_team_id: myTeamId,
    p_other_team_id: otherTeamId,
  });
  return { conversationId: typeof data === 'string' ? data : null, error: error as RpcError };
}

/**
 * The other team's current captain in a match, for "Message <captain>" on
 * the score mismatch screen. Null (no button) when the caller isn't a
 * current captain of one of its two teams, or on any error.
 */
export async function fetchMatchCaptainContact(matchId: string): Promise<CaptainContact | null> {
  const { data, error } = await supabase.rpc('match_captain_contact', { p_match_id: matchId });
  if (error) return null;
  return rows<CaptainContact>(data)[0] ?? null;
}

/** The captain chat between the two teams of a match, even outside a league. */
export async function openMatchCaptainConversation(matchId: string) {
  const { data, error } = await supabase.rpc('open_match_captain_conversation', { p_match_id: matchId });
  return { conversationId: typeof data === 'string' ? data : null, error: error as RpcError };
}

/** Friends only (S20): anyone else gets not_friends from the server. */
export async function openFriendConversation(profileId: string) {
  const { data, error } = await supabase.rpc('open_friend_conversation', { p_profile_id: profileId });
  return { conversationId: typeof data === 'string' ? data : null, error: error as RpcError };
}

export function newClientId(): string {
  return Crypto.randomUUID();
}

// ---- Words --------------------------------------------------------------------

/** One line, what happened and what to do (UX rules: max 10 words). */
export function describeMessageError(error: { message?: string } | null | undefined): string {
  switch (error?.message) {
    case 'blocked':
      return "You can't message this player.";
    case 'age_pair_refused':
      return "You can't message this player.";
    case 'not_friends':
      return 'Add them as a friend to message them.';
    case 'not_in_conversation':
    case 'conversation_not_found':
      return "You're no longer in this chat.";
    case 'not_captain':
      return 'Only the team captain can do that.';
    case 'teams_not_in_league':
      return 'Only captains in the same league can message.';
    case 'no_captain':
      return 'This team has no captain right now.';
    case 'message_required':
      return 'Write a message first.';
    case 'message_too_long':
      return `Keep it to ${MESSAGE_MAX_LENGTH} characters or fewer.`;
    case 'rate_limited':
      return 'Too many messages. Try again in a minute.';
    case 'too_young':
      return TOO_YOUNG_MESSAGE;
    default:
      return 'Something went wrong. Try again.';
  }
}

/** The line under the input when the caller can't write. */
export function refusalLine(refusal: SendRefusal, blockedByMe: boolean): string | null {
  if (!refusal) return null;
  if (refusal === 'blocked' && blockedByMe) return 'You blocked this player. Unblock to message.';
  return describeMessageError({ message: refusal });
}

// ---- The draft ----------------------------------------------------------------

/** Whether the draft can be sent: some text, and not over the limit. */
export function draftState(text: string): { canSend: boolean; tooLong: boolean; body: string } {
  const body = text.trim();
  const tooLong = [...body].length > MESSAGE_MAX_LENGTH;
  return { canSend: body.length > 0 && !tooLong, tooLong, body };
}

// ---- Times (Cyprus) ------------------------------------------------------------

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: CYPRUS_TIME_ZONE, weekday: 'long' });
const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

/** "21:05", Cyprus time. */
export function clockTime(iso: string): string {
  return clock.format(new Date(iso));
}

/** Whole Cyprus days from `iso` to `now` (0 = same day). */
function cyprusDaysAgo(iso: string, now: Date): number {
  const a = Date.parse(`${cyprusDateKey(new Date(iso))}T00:00:00Z`);
  const b = Date.parse(`${cyprusDateKey(now)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** The date pill: "Today", "Yesterday", a weekday this week, else "24 Nov 2026". */
export function datePillLabel(iso: string, now: Date = new Date()): string {
  const ago = cyprusDaysAgo(iso, now);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return weekday.format(new Date(iso));
  return longDate.format(new Date(iso));
}

/** The inbox row's time: "21:05" today, "Yesterday", a weekday, else "24/11/26". */
export function inboxTime(iso: string, now: Date = new Date()): string {
  const ago = cyprusDaysAgo(iso, now);
  if (ago <= 0) return clockTime(iso);
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return weekday.format(new Date(iso));
  return shortDate.format(new Date(iso));
}

// ---- Ticks ---------------------------------------------------------------------

export type Tick = 'sending' | 'failed' | 'sent' | 'delivered' | 'read';

/** My message's ticks: read once the other side's last-read time passes it,
 *  delivered once their app fetched it. */
export function tickFor(
  message: ChatMessage,
  receipts: Pick<ConversationHeader, 'other_read_at' | 'other_delivered_at'> | null
): Tick {
  if (message.pending) return message.pending;
  const at = Date.parse(message.created_at);
  if (receipts?.other_read_at && Date.parse(receipts.other_read_at) >= at) return 'read';
  if (receipts?.other_delivered_at && Date.parse(receipts.other_delivered_at) >= at) return 'delivered';
  return 'sent';
}

export const TICK_LABELS: Record<Tick, string> = {
  sending: 'Sending',
  failed: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

// ---- The list ------------------------------------------------------------------

export type ChatItem =
  | {
      type: 'message';
      key: string;
      message: ChatMessage;
      /** The first of a run from one sender: a little more space above. */
      firstInGroup: boolean;
      /** The last of a run: the bubble gets its tail. */
      lastInGroup: boolean;
    }
  | { type: 'date'; key: string; label: string };

function senderKey(m: ChatMessage) {
  return m.mine ? 'me' : (m.sender_id ?? 'former');
}

/**
 * Items for an inverted list (index 0 at the bottom): messages newest first,
 * consecutive messages from one sender on one Cyprus day grouped, and a date
 * pill above each day's first message.
 */
export function buildChatItems(newestFirst: ChatMessage[], now: Date = new Date()): ChatItem[] {
  const items: ChatItem[] = [];
  for (let i = 0; i < newestFirst.length; i++) {
    const m = newestFirst[i];
    const newer = newestFirst[i - 1];
    const older = newestFirst[i + 1];
    const day = cyprusDateKey(new Date(m.created_at));
    const sameAsNewer = !!newer && senderKey(newer) === senderKey(m) && cyprusDateKey(new Date(newer.created_at)) === day;
    const olderDay = older ? cyprusDateKey(new Date(older.created_at)) : null;
    const sameAsOlder = !!older && senderKey(older) === senderKey(m) && olderDay === day;
    items.push({
      type: 'message',
      key: m.client_id ?? m.id,
      message: m,
      firstInGroup: !sameAsOlder,
      lastInGroup: !sameAsNewer,
    });
    if (olderDay !== day) items.push({ type: 'date', key: `date-${day}`, label: datePillLabel(m.created_at, now) });
  }
  return items;
}

/** Puts a server page and my pending messages together, newest first, one
 *  copy of each (a sent message replaces its pending copy by client id). */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();
  for (const m of current) byKey.set(m.client_id ?? m.id, m);
  for (const m of incoming) {
    const key = m.client_id ?? m.id;
    // A server copy wins over a pending one; also drop any older copy filed by id.
    byKey.delete(m.id);
    byKey.set(key, m);
  }
  return [...byKey.values()].sort((a, b) => {
    // Pending ones stay at the bottom, in the order they were written.
    if (a.pending && !b.pending) return -1;
    if (!a.pending && b.pending) return 1;
    const t = Date.parse(b.created_at) - Date.parse(a.created_at);
    return t !== 0 ? t : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
}

// ---- Contacts -------------------------------------------------------------------

/** The sheet's search: team or captain name, any case. */
export function filterContacts(contacts: CaptainContact[], query: string): CaptainContact[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return contacts;
  return contacts.filter(
    (c) => c.team_name.toLocaleLowerCase().includes(q) || c.captain_name.toLocaleLowerCase().includes(q)
  );
}

export function kitOf(row: AvatarColumns | null | undefined): AvatarLook | null {
  return avatarLook(row);
}

// ---- Routes ---------------------------------------------------------------------

export function chatHref(conversationId: string): Href {
  return { pathname: '/messages/[id]', params: { id: conversationId } };
}

export const INBOX_HREF: Href = '/messages';

export function profileHref(profileId: string): Href {
  return { pathname: '/player-profile', params: { profileId } };
}

export function teamHref(teamId: string): Href {
  return { pathname: '/team-profile', params: { teamId } };
}

/** "Former player" (a deleted account) has no profile to open. */
export const FORMER_PLAYER = 'Former player';

/**
 * Friend chats, "Book together": Book a pitch, and after paying the friend
 * is preselected in Invite friends (S20, lib/booking-preselect.ts).
 */
export function bookTogetherHref(friendProfileId: string): Href {
  return { pathname: '/book', params: { inviteProfileId: friendProfileId } };
}

/**
 * Friend chats where both are captains, "Team vs team": a half-pitch booking
 * (the checkout starts on half) with the friend's team preselected in the
 * opposition invite after paying (S20, lib/booking-preselect.ts).
 */
export function teamVsTeamHref(friendTeamId: string): Href {
  return { pathname: '/book', params: { oppositionTeamId: friendTeamId } };
}
