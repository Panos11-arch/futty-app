// S20: friends. Every rule is on the server (20261126200000_match_friends.sql):
// who may ask whom (blocks, A4), what an adult sees of a minor (A5), who
// accepts. The app calls the functions and words their answers.
import type { Href } from 'expo-router';

import { formatLevel } from '@/lib/match/levels';
import type { PlayerCard } from '@/lib/player-card';
import { supabase } from '@/lib/supabase';
import { USERNAME_PATTERN } from '@/lib/username';

type RpcError = { message: string } | null;

/** Where the caller stands with a player (player_profile_card). */
export type FriendStatus = 'self' | 'friends' | 'requested' | 'incoming' | 'unavailable' | 'none';

/** Another player's card: the S19 card fields, never a QR, plus the friendship. */
export type ProfileCard = PlayerCard & {
  profile_id: string;
  /** For "Message <first name>". */
  first_name: string;
  friend_status: FriendStatus;
  /** The pending request, when requested or incoming. */
  request_id: string | null;
};

export type FriendRow = {
  kind: 'request' | 'friend';
  request_id: string | null;
  profile_id: string;
  name: string;
  first_name: string;
  avatar_style: string | null;
  avatar_kit_colour: string | null;
  avatar_number: number | null;
  avatar_illustration: string | null;
  level: number | null;
};

export type CardLookup = { username: string } | { profileId: string };

// ---- Server calls ----------------------------------------------------------

export async function fetchProfileCard(
  who: CardLookup,
): Promise<{ card: ProfileCard | null; error: RpcError }> {
  const { data, error } = await supabase
    .rpc('player_profile_card', 'username' in who ? { p_username: who.username } : { p_profile_id: who.profileId })
    .maybeSingle();
  if (error) return { card: null, error: error as RpcError };
  if (!data) return { card: null, error: { message: 'player_not_found' } };
  const card = data as ProfileCard;
  return {
    card: {
      ...card,
      show_qr: false,
      level: card.level === null || card.level === undefined ? null : Number(card.level),
      teams: card.teams ?? [],
      team_count: card.team_count ?? 0,
      request_id: card.request_id ?? null,
    },
    error: null,
  };
}

/** Requests to me first, then my friends (the server's order). Throws on failure. */
export async function fetchFriends(): Promise<FriendRow[]> {
  const { data, error } = await supabase.rpc('my_friends');
  if (error) throw new Error(error.message);
  return ((data ?? []) as (FriendRow & { ord?: number })[]).map(({ ord: _ord, ...row }) => ({
    ...row,
    level: row.level === null || row.level === undefined ? null : Number(row.level),
  }));
}

/** Requests waiting for me (the Friends badge); 0 when it can't be read. */
export async function fetchFriendRequestCount(): Promise<number> {
  const { data, error } = await supabase.rpc('my_friend_request_count');
  return error || typeof data !== 'number' ? 0 : data;
}

export async function sendFriendRequest(profileId: string) {
  const { data, error } = await supabase.rpc('send_friend_request', { p_profile_id: profileId });
  return { requestId: typeof data === 'string' ? data : null, error: error as RpcError };
}

/** Accepting opens the friend chat: its id comes back. */
export async function acceptFriendRequest(requestId: string) {
  const { data, error } = await supabase.rpc('accept_friend_request', { p_request_id: requestId });
  return { conversationId: typeof data === 'string' ? data : null, error: error as RpcError };
}

export async function declineFriendRequest(requestId: string) {
  const { error } = await supabase.rpc('decline_friend_request', { p_request_id: requestId });
  return { error: error as RpcError };
}

export async function cancelFriendRequest(requestId: string) {
  const { error } = await supabase.rpc('cancel_friend_request', { p_request_id: requestId });
  return { error: error as RpcError };
}

export async function unfriend(profileId: string) {
  const { error } = await supabase.rpc('unfriend', { p_profile_id: profileId });
  return { error: error as RpcError };
}

// ---- Words ------------------------------------------------------------------

/** One line: what happened and what to do (UX rules: max 10 words). */
export function describeFriendError(error: { message?: string } | null | undefined): string {
  switch (error?.message) {
    case 'player_not_found':
      return 'Player not found.';
    case 'blocked':
    case 'age_pair_refused':
      return "You can't add this player.";
    case 'already_friends':
      return "You're already friends.";
    case 'already_requested':
      return 'Request already sent.';
    case 'request_incoming':
      return 'They already asked you. Accept their request.';
    case 'request_not_found':
      return 'This request is gone. Pull to refresh.';
    case 'not_friends':
      return "You're no longer friends.";
    case 'too_young':
      return "Your account can't do this yet.";
    default:
      return 'Something went wrong. Try again.';
  }
}

/** The main button on a player's sheet; null when there is none (yourself,
 *  or an adult and a minor: no Add friend, A5). */
export type FriendAction = { label: string; kind: 'add' | 'cancel' | 'accept' | 'unfriend' };

export function friendAction(status: FriendStatus): FriendAction | null {
  switch (status) {
    case 'none':
      return { label: 'Add friend', kind: 'add' };
    case 'requested':
      return { label: 'Requested', kind: 'cancel' };
    case 'incoming':
      return { label: 'Accept', kind: 'accept' };
    case 'friends':
      return { label: 'Friends', kind: 'unfriend' };
    default:
      return null;
  }
}

/** "Message Ben"; "Message" when there's no first name. */
export function messageLabel(firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name ? `Message ${name}` : 'Message';
}

/** A friend row's line under the name: "Level 6.4", or nothing yet. */
export function friendSubtitle(row: Pick<FriendRow, 'level'>): string | null {
  return row.level === null ? null : `Level ${formatLevel(row.level)}`;
}

// ---- QR and links ---------------------------------------------------------------

/**
 * The username in a scanned Futty QR or link: https://futty.app/p/<username>
 * (the S19 card's QR, lib/player-card.ts cardLink), with or without www,
 * http or a trailing slash. Null for anything else.
 */
export function parseFuttyQr(text: string | null | undefined): string | null {
  const found = /^https?:\/\/(?:www\.)?futty\.app\/p\/([^/?#]+)\/?(?:[?#].*)?$/i.exec((text ?? '').trim());
  if (!found) return null;
  let username: string;
  try {
    username = decodeURIComponent(found[1]);
  } catch {
    return null;
  }
  return USERNAME_PATTERN.test(username) ? username : null;
}

export function playerCardHref(username: string): Href {
  return { pathname: '/p/[username]', params: { username } };
}

export const SCAN_HREF: Href = '/scan';
export const FRIENDS_HREF: Href = '/friends';
