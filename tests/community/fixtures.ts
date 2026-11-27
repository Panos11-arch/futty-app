import type { FollowSuggestion, MatchResultItem, SquadPostItem } from '@/lib/community';

export function post(over: Partial<SquadPostItem> = {}): SquadPostItem {
  return {
    kind: 'squad_post',
    item_id: 'p1',
    sort_at: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    actor_kind: 'player',
    actor_id: 'u-anna',
    actor_name: 'Anna',
    scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    format: '5-a-side',
    venue_name: 'Nuevo Campo',
    post_type: 'players',
    post_status: 'open',
    spots: 2,
    level_min: null,
    level_max: null,
    v2: false,
    mine: false,
    can_message: false,
    booking_id: null,
    ...over,
  };
}

export function result(over: Partial<MatchResultItem> = {}): MatchResultItem {
  return {
    kind: 'match_result',
    item_id: 'm1',
    sort_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    actor_kind: 'team',
    actor_id: 't-kato',
    actor_name: 'Kato United',
    scheduled_at: new Date(Date.now() - 86_400_000).toISOString(),
    format: '5-a-side',
    venue_name: null,
    league: true,
    side_a_label: 'Kato United',
    side_a_team_id: 't-kato',
    side_b_label: 'Limassol Lions',
    side_b_team_id: 't-lions',
    side_a_score: 3,
    side_b_score: 2,
    forfeit_side: null,
    ...over,
  };
}

export function suggestion(over: Partial<FollowSuggestion> = {}): FollowSuggestion {
  return { id: 'u-nikos', username: 'nikos', full_name: 'Nikos', matches_in_common: 3, ...over };
}

export function follows(followed: string[] = [], toggle = jest.fn().mockResolvedValue({ error: null })) {
  return {
    status: 'ready' as const,
    isFollowing: (_type: string, id: string) => followed.includes(id),
    toggle,
    reload: jest.fn(),
  };
}
