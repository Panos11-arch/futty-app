import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useRealtimeChannelName } from '@/lib/realtime';
import type { SquadPost } from '@/lib/squads';
import { supabase } from '@/lib/supabase';

export type SquadPostWithDetails = SquadPost & {
  venue_name: string;
  venue_city: string | null;
  team_name: string | null;
  matched_team_name: string | null;
  joined_count: number;
  joined_by_me: boolean;
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
        'id, venue_id, scheduled_at, format, type, level, posted_by, team_id, players_needed, status, matched_team_id, created_at, venues(name, city)'
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
          ? supabase.from('teams').select('id, name').in('id', teamIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
        postType === 'players' && rows.length > 0
          ? supabase
              .from('squad_post_joiners')
              .select('post_id, profile_id')
              .in(
                'post_id',
                rows.map((row) => row.id)
              )
          : Promise.resolve({ data: [] as { post_id: string; profile_id: string }[], error: null }),
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

    const teamNameById = new Map((teams ?? []).map((team) => [team.id, team.name]));

    const result: SquadPostWithDetails[] = rows.map((row) => {
      const venue = row.venues as unknown as { name: string; city: string | null } | null;
      const postJoiners = (joiners ?? []).filter((j) => j.post_id === row.id);

      return {
        ...row,
        venue_name: venue?.name ?? 'Unknown venue',
        venue_city: venue?.city ?? null,
        team_name: row.team_id ? (teamNameById.get(row.team_id) ?? 'Unknown team') : null,
        matched_team_name: row.matched_team_id
          ? (teamNameById.get(row.matched_team_id) ?? 'Unknown team')
          : null,
        joined_count: postJoiners.length,
        joined_by_me: !!user && postJoiners.some((j) => j.profile_id === user.id),
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
