import { supabase } from '@/lib/supabase';

export type PlayerListing = {
  id: string;
  username: string | null;
  full_name: string | null;
  /** Only present when the player has opted in via show_phone_publicly. */
  phone: string | null;
};

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
