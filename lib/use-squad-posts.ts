import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useRealtimeChannelName } from '@/lib/realtime';
import type { SquadPost } from '@/lib/squads';
import { supabase } from '@/lib/supabase';
import { xpTier, type XpTier } from '@/lib/xp-tier';

export type SquadPostRosterEntry = {
  profileId: string | null;
  name: string;
  tier: XpTier | null;
  /** Venue staff added via supabase/legacy/house-players.sql's add_house_player —
   *  no account, no payment share, tier is meaningless for them. */
  isHousePlayer: boolean;
};

export type SquadPostWithDetails = SquadPost & {
  venue_name: string;
  venue_city: string | null;
  team_name: string | null;
  matched_team_name: string | null;
  joined_count: number;
  joined_by_me: boolean;
  /** 'players' posts only — each already-joined player, with their XP tier. */
  roster: SquadPostRosterEntry[];
  /** 'opposition' posts only — the requesting (post.team_id) team's XP tier. */
  team_level: XpTier | null;
};

type PostsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; posts: SquadPostWithDetails[] };

/** Open (and, for opposition, recently-matched) posts of one type, with venue
 *  and team names resolved and — for 'players' posts — how many have joined
 *  and whether the current user is one of them.
 *
 *  Team names are fetched separately rather than embedded: squad_posts has
 *  two FKs into teams (team_id, matched_team_id), and disambiguating that in
 *  a single PostgREST embed is more fragile than just doing a second query.
 *  venue_id has only one FK target, so venues embeds directly. */
export function useSquadPosts(postType: 'players' | 'opposition') {
  const { user } = useAuth();
  const [state, setState] = useState<PostsState>({ status: 'loading' });
  // Bumped on every reload() call — including ones triggered by postType
  // changing while a previous request for the old type is still in flight —
  // and on unmount, so a stale response can't land after a newer one and show
  // the wrong tab's posts.
  const requestIdRef = useRef(0);
  const channelName = useRealtimeChannelName(`squad-posts-${postType}`);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const { data: posts, error } = await supabase
      .from('squad_posts')
      .select(
        'id, venue_id, scheduled_at, format, type, level, posted_by, team_id, players_needed, status, matched_team_id, venue_booking_id, created_at, position_needed, level_needed, payment_mode, venues(name, city)'
      )
      .eq('type', postType)
      .neq('status', 'cancelled')
      // A post for a game that's already started/passed is nothing anyone
      // can join or offer against any more — drop it rather than let stale
      // dates pile up in the browse list.
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true });

    if (requestIdRef.current !== requestId) return;

    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    const rows = posts ?? [];
    const teamIds = [
      ...new Set(
        rows.flatMap((row) => [row.team_id, row.matched_team_id]).filter((id): id is string => !!id)
      ),
    ];

    const [{ data: teams, error: teamsError }, { data: joiners, error: joinersError }] =
      await Promise.all([
        teamIds.length > 0
          ? supabase.from('teams').select('id, name, xp').in('id', teamIds)
          : Promise.resolve({ data: [] as { id: string; name: string; xp: number }[], error: null }),
        postType === 'players' && rows.length > 0
          ? supabase
              .from('squad_post_joiners')
              .select('post_id, profile_id, display_name, is_house_player')
              .in(
                'post_id',
                rows.map((row) => row.id)
              )
          : Promise.resolve({
              data: [] as { post_id: string; profile_id: string | null; display_name: string | null; is_house_player: boolean }[],
              error: null,
            }),
      ]);

    if (requestIdRef.current !== requestId) return;

    if (teamsError) {
      setState({ status: 'error', message: teamsError.message });
      return;
    }
    if (joinersError) {
      setState({ status: 'error', message: joinersError.message });
      return;
    }

    const joinerProfileIds = [
      ...new Set((joiners ?? []).map((j) => j.profile_id).filter((id): id is string => !!id)),
    ];
    // profiles' RLS only allows reading your own row — a plain
    // .from('profiles') select here would silently come back empty for
    // every joiner except the signed-in user. get_public_profiles is the
    // security-definer RPC (supabase/legacy/public-profiles.sql) that exists
    // specifically to read other users' public fields.
    const { data: joinerProfiles } =
      joinerProfileIds.length > 0
        ? ((await supabase.rpc('get_public_profiles', { p_profile_ids: joinerProfileIds })) as unknown as {
            data: { id: string; username: string | null; full_name: string | null; xp: number }[] | null;
          })
        : { data: [] as { id: string; username: string | null; full_name: string | null; xp: number }[] };

    if (requestIdRef.current !== requestId) return;

    const teamById = new Map((teams ?? []).map((team) => [team.id, team]));
    const joinerProfileById = new Map((joinerProfiles ?? []).map((p) => [p.id, p]));

    const result: SquadPostWithDetails[] = rows.map((row) => {
      const venue = row.venues as unknown as { name: string; city: string | null } | null;
      const postJoiners = (joiners ?? []).filter((j) => j.post_id === row.id);
      const team = row.team_id ? teamById.get(row.team_id) : null;

      return {
        ...row,
        venue_name: venue?.name ?? 'Unknown venue',
        venue_city: venue?.city ?? null,
        team_name: team?.name ?? (row.team_id ? 'Unknown team' : null),
        matched_team_name: row.matched_team_id
          ? (teamById.get(row.matched_team_id)?.name ?? 'Unknown team')
          : null,
        joined_count: postJoiners.length,
        joined_by_me: !!user && postJoiners.some((j) => j.profile_id === user.id),
        roster: postJoiners.map((j) => {
          if (j.is_house_player) {
            return {
              profileId: null,
              name: j.display_name ?? 'Venue staff',
              tier: null,
              isHousePlayer: true,
            };
          }
          const profile = j.profile_id ? joinerProfileById.get(j.profile_id) : null;
          return {
            profileId: j.profile_id,
            name: profile?.full_name || profile?.username || 'Player',
            tier: xpTier(profile?.xp ?? 0),
            isHousePlayer: false,
          };
        }),
        team_level: team ? xpTier(team.xp) : null,
      };
    });

    setState({ status: 'ready', posts: result });
  }, [postType, user]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  // Live updates: a new post (squad_posts insert), someone else's post
  // getting matched/cancelled (squad_posts update), or a "need players" post
  // filling up (squad_post_joiners insert/delete) all just trigger the same
  // reload() — simpler and less error-prone than patching this screen's
  // joined-count/team-name-resolved shape in place from a raw payload row.
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'squad_posts', filter: `type=eq.${postType}` },
        () => reload()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'squad_post_joiners' }, () => reload())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, postType, reload]);

  return { ...state, reload };
}
