import { supabase } from '@/lib/supabase';

export const SKILL_LEVELS = ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Elite'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const POSITIONS_NEEDED = ['Goalkeeper', 'Defender', 'Midfielder', 'Striker'] as const;
export type PositionNeeded = (typeof POSITIONS_NEEDED)[number];

export type SquadPost = {
  id: string;
  venue_id: string;
  scheduled_at: string;
  format: string;
  type: 'players' | 'opposition';
  level: string | null;
  posted_by: string | null;
  team_id: string | null;
  players_needed: number | null;
  status: 'open' | 'matched';
  matched_team_id: string | null;
  venue_booking_id: string | null;
  created_at: string;
  /** 'opposition' posts only — 'players' posts are always 'split'. See
   *  supabase/gipedo-pano-payments.sql. */
  payment_mode: 'split' | 'gipedo_pano';
  /** "Need players" posts only — position/level wanted, both optional
   *  ("Any" in the UI maps to null here). */
  position_needed: string | null;
  level_needed: string | null;
};

/** "Looking for goalkeeper, Gold level or above" — the quote-style callout
 *  shown on a "need players" post, shared by app/join-squad-post.tsx and
 *  app/squads.tsx's PlayersPostCard so the wording can't drift between the
 *  two places it's shown. Null when neither is set — nothing to say. */
export function describePlayerPostNeed(post: { position_needed: string | null; level_needed: string | null }) {
  if (!post.position_needed && !post.level_needed) return null;
  return `Looking for ${post.position_needed ? post.position_needed.toLowerCase() : 'any position'}${
    post.level_needed ? `, ${post.level_needed} level or above` : ''
  }`;
}

/** "Looking for a Gold-level opponent" — the "need opposition" equivalent of
 *  describePlayerPostNeed above. Informational only (item 3 of the payment-
 *  auth batch) — a team below or above this level can still see and offer to
 *  play the post, this just states what the posting team had in mind. */
export function describeOppositionPostNeed(post: { level_needed: string | null }) {
  if (!post.level_needed) return null;
  return `Looking for a ${post.level_needed}-level opponent`;
}

/** "Gipedo Pano: loser pays the full pitch" — shown wherever an opposition
 *  post's payment terms need to be clear before a captain offers/pays,
 *  same reasoning as describeOppositionPostNeed above. Null for 'split',
 *  since that's just the normal, unremarked-on default. */
export function describePaymentMode(post: { payment_mode: 'split' | 'gipedo_pano' }) {
  if (post.payment_mode !== 'gipedo_pano') return null;
  return 'Gipedo Pano: loser pays the full pitch';
}

export async function createSquadPost(params: {
  venueId: string;
  scheduledAt: string;
  format: string;
  postType: 'players' | 'opposition';
  level?: string;
  teamId?: string;
  playersNeeded?: number;
  /** The venue_bookings row this post was created from, if any — lets the
   *  home screen tell "this booking already has a matched friendly game"
   *  apart from an unrelated booking, instead of guessing from venue+time. */
  venueBookingId?: string;
  /** "Need players" posts only — "Any" is represented as undefined/omitted. */
  positionNeeded?: string;
  levelNeeded?: string;
  /** "Need opposition" posts only — defaults to 'split' server-side too, so
   *  omitting this is always safe for a "Need players" post. */
  paymentMode?: 'split' | 'gipedo_pano';
}) {
  const result = await supabase.rpc('create_squad_post', {
    p_venue_id: params.venueId,
    p_scheduled_at: params.scheduledAt,
    p_format: params.format,
    p_post_type: params.postType,
    p_level: params.level ?? null,
    p_team_id: params.teamId ?? null,
    p_players_needed: params.playersNeeded ?? null,
    p_venue_booking_id: params.venueBookingId ?? null,
    p_position_needed: params.positionNeeded ?? null,
    p_level_needed: params.levelNeeded ?? null,
    p_payment_mode: params.paymentMode ?? 'split',
  });

  // The in-app bell row for this is written server-side by the
  // on_squad_post_created_notify trigger (supabase/squad-post-notifications.sql)
  // regardless of whether this call succeeds — this only adds the actual push
  // send (item 5), which needs an Edge Function since this project has no
  // pg_net/Database Webhook support for the trigger to call Expo's push API
  // itself. Fire-and-forget: a push failing here must never block the post
  // that already exists from returning success to the caller.
  if (!result.error && result.data) {
    supabase.functions.invoke('notify-squad-post-created', { body: { postId: result.data.id } }).catch(() => {});
  }

  return result;
}

export async function joinSquadPost(postId: string) {
  return supabase.rpc('join_squad_post', { p_post_id: postId });
}

export async function offerOpposition(postId: string, teamId: string) {
  return supabase.rpc('offer_opposition', { p_post_id: postId, p_team_id: teamId });
}

export async function cancelSquadPost(postId: string) {
  return supabase.rpc('cancel_squad_post', { p_post_id: postId });
}

export async function leaveSquadPost(postId: string) {
  return supabase.rpc('leave_squad_post', { p_post_id: postId });
}

/** Venue-owner only (supabase/house-players.sql) — fills an open spot on a
 *  "Need players" post with a free-text name, no account, no payment. */
export async function addHousePlayer(postId: string, name: string) {
  return supabase.rpc('add_house_player', { p_post_id: postId, p_name: name });
}

/** Deletes the caller's own still-'pending' (never authorized) payment
 *  share for a booking — see supabase/cancel-pending-share.sql. Used to
 *  clean up after leaveSquadPost() when a join's follow-up payment step
 *  fails or is cancelled; leaveSquadPost only ever removes the
 *  squad_post_joiners row, never the share the join trigger created
 *  alongside it. */
export async function cancelPendingShare(bookingId: string) {
  return supabase.rpc('cancel_pending_share', { p_booking_id: bookingId });
}

export async function cancelOppositionOffer(postId: string) {
  return supabase.rpc('cancel_opposition_offer', { p_post_id: postId });
}

/** The caller's own still-open squad posts tied to a specific booking — lets
 *  the "Need players / Need opposition" form on a booking show what's
 *  already posted instead of coming back blank every time the screen
 *  remounts (e.g. switching tabs away and back). */
export async function listMyOpenPostsForBooking(bookingId: string, posterId: string) {
  return supabase
    .from('squad_posts')
    .select('id, type')
    .eq('venue_booking_id', bookingId)
    .eq('posted_by', posterId)
    .eq('status', 'open');
}
