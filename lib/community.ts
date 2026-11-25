import { supabase } from '@/lib/supabase';
import type { AvatarFields } from '@/lib/avatar';

export type PlayerListing = {
  id: string;
  username: string | null;
  full_name: string | null;
  /** Only present when the player has opted in via show_phone_publicly. */
  phone: string | null;
} & Partial<AvatarFields>;

export type TeamListing = {
  id: string;
  name: string;
  city: string | null;
};

export async function listPlayers() {
  return supabase.rpc('list_players');
}

export async function listTeams() {
  return supabase.from('teams').select('id, name, city').order('name');
}

export type FollowTarget = 'player' | 'team';

export async function follow(followerId: string, targetType: FollowTarget, targetId: string) {
  return supabase
    .from('user_follows')
    .insert({ follower_id: followerId, target_type: targetType, target_id: targetId });
}

export async function unfollow(followerId: string, targetType: FollowTarget, targetId: string) {
  return supabase
    .from('user_follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('target_type', targetType)
    .eq('target_id', targetId);
}

// ---- S7: feed, suggestions, search (supabase/migrations/*_match_community.sql) ----

type RpcError = { message: string; code?: string } | null;

/** A player as the server shows them to the caller: a minor's first name
 *  only and no username (A5). */
export type CommunityPlayer = {
  id: string;
  username: string | null;
  full_name: string;
} & Partial<AvatarFields>;

export type FollowSuggestion = CommunityPlayer & { matches_in_common: number };

export type FeedScope = 'for_you' | 'following' | 'mine';

type FeedRowBase = {
  item_id: string;
  sort_at: string;
  actor_kind: 'player' | 'team';
  actor_id: string | null;
  actor_name: string;
  scheduled_at: string;
  format: string | null;
  venue_name: string | null;
} & Partial<AvatarFields>;

export type SquadPostItem = FeedRowBase & {
  kind: 'squad_post';
  post_type: 'players' | 'opposition';
  post_status: string;
  /** Places left on an open "Need players" post; null otherwise. */
  spots: number | null;
  level_min: number | null;
  level_max: number | null;
  v2: boolean;
  mine: boolean;
  can_message: boolean;
};

export type MatchResultItem = FeedRowBase & {
  kind: 'match_result';
  league: boolean;
  side_a_label: string;
  side_a_team_id: string | null;
  side_b_label: string;
  side_b_team_id: string | null;
  side_a_score: number | null;
  side_b_score: number | null;
  forfeit_side: 'a' | 'b' | null;
};

export type FeedItem = SquadPostItem | MatchResultItem;

export type FeedCursor = { at: string; id: string };

export const FEED_PAGE_SIZE = 20;

/** One page of the feed, newest first. */
export async function fetchFeed(
  scope: FeedScope,
  before: FeedCursor | null = null,
  limit: number = FEED_PAGE_SIZE,
): Promise<{ data: FeedItem[] | null; error: RpcError }> {
  const { data, error } = await supabase.rpc('community_feed', {
    p_scope: scope,
    p_before_at: before?.at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: limit,
  });
  return { data: (data as FeedItem[] | null) ?? null, error: error as RpcError };
}

export async function fetchFollowSuggestions(
  limit = 20,
): Promise<{ data: FollowSuggestion[] | null; error: RpcError }> {
  const { data, error } = await supabase.rpc('follow_suggestions', { p_limit: limit });
  return { data: (data as FollowSuggestion[] | null) ?? null, error: error as RpcError };
}

export async function dismissFollowSuggestion(profileId: string): Promise<{ error: RpcError }> {
  const { error } = await supabase.rpc('dismiss_follow_suggestion', { p_profile_id: profileId });
  return { error: error as RpcError };
}

/** The shortest query the server searches for. */
export const SEARCH_MIN_LENGTH = 2;

export async function searchPlayers(query: string): Promise<{ data: CommunityPlayer[] | null; error: RpcError }> {
  if (query.trim().length < SEARCH_MIN_LENGTH) return { data: [], error: null };
  const { data, error } = await supabase.rpc('search_players', { p_query: query.trim() });
  return { data: (data as CommunityPlayer[] | null) ?? null, error: error as RpcError };
}
