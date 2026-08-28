import { supabase } from '@/lib/supabase';

export const SKILL_LEVELS = ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Elite'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

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
};

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
}) {
  return supabase.rpc('create_squad_post', {
    p_venue_id: params.venueId,
    p_scheduled_at: params.scheduledAt,
    p_format: params.format,
    p_post_type: params.postType,
    p_level: params.level ?? null,
    p_team_id: params.teamId ?? null,
    p_players_needed: params.playersNeeded ?? null,
    p_venue_booking_id: params.venueBookingId ?? null,
  });
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
