import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { listFixturesForTeams } from '@/lib/fixtures';
import { listFriendlyMatchesForTeams } from '@/lib/friendly-matches';
import { supabase } from '@/lib/supabase';
import { useMyTeams } from '@/lib/use-my-teams';

export type RecentResult = {
  key: string;
  kind: 'friendly' | 'league' | 'booking';
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  playedAt: string;
};

type RecentResultsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; results: RecentResult[] };

const DEFAULT_MAX_RESULTS = 5;

/** Most recent confirmed/completed results across every team the signed-in
 *  user belongs to — friendly matches (submit_friendly_score) and league
 *  fixtures (submit_fixture_score) both persist their final score once both
 *  sides agree (supabase/match-results.sql).
 *
 *  `limit` defaults to 5 for the Home card; app/account/activity/matches.tsx
 *  passes a much higher number for the full history page. */
export function useRecentResults(limit: number = DEFAULT_MAX_RESULTS) {
  const { user } = useAuth();
  const myTeams = useMyTeams();
  const [state, setState] = useState<RecentResultsState>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const teamIds = myTeams.status === 'ready' ? myTeams.teams.map(({ team }) => team.id) : [];
  const teamIdsKey = teamIds.join(',');

  const reload = useCallback(async () => {
    if (myTeams.status !== 'ready' || !user) return;

    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });

    const [
      { data: friendlies, error: friendliesError },
      { data: fixtures, error: fixturesError },
      { data: bookings, error: bookingsError },
    ] = await Promise.all([
      listFriendlyMatchesForTeams(teamIds),
      listFixturesForTeams(teamIds),
      supabase
        .from('venue_bookings')
        .select('id, booking_day, start_time, format, result_goals_for, result_goals_against')
        .eq('created_by', user.id)
        .not('result', 'is', null)
        .order('booking_day', { ascending: false })
        .order('start_time', { ascending: false })
        .limit(limit),
    ]);

    if (requestIdRef.current !== requestId) return;

    if (friendliesError) {
      setState({ status: 'error', message: friendliesError.message });
      return;
    }
    if (fixturesError) {
      setState({ status: 'error', message: fixturesError.message });
      return;
    }
    if (bookingsError) {
      setState({ status: 'error', message: bookingsError.message });
      return;
    }

    const friendlyResults: RecentResult[] = friendlies
      .filter(
        (m) =>
          m.status === 'confirmed' && m.home_score !== null && m.away_score !== null && m.post?.scheduled_at
      )
      .map((m) => ({
        key: `friendly:${m.id}`,
        kind: 'friendly' as const,
        homeTeamName: m.home_team?.name ?? 'Unknown team',
        awayTeamName: m.away_team?.name ?? 'Unknown team',
        homeScore: m.home_score as number,
        awayScore: m.away_score as number,
        playedAt: m.post!.scheduled_at,
      }));

    const fixtureResults: RecentResult[] = fixtures
      .filter(
        (f) => f.status === 'completed' && f.home_score !== null && f.away_score !== null && f.scheduled_day
      )
      .map((f) => ({
        key: `league:${f.id}`,
        kind: 'league' as const,
        homeTeamName: f.home_team?.name ?? 'Unknown team',
        awayTeamName: f.away_team?.name ?? 'Unknown team',
        homeScore: f.home_score as number,
        awayScore: f.away_score as number,
        playedAt: `${f.scheduled_day}T${f.scheduled_time ?? '00:00:00'}`,
      }));

    const bookingResults: RecentResult[] = (bookings ?? []).map((b) => ({
      key: `booking:${b.id}`,
      kind: 'booking' as const,
      homeTeamName: 'You',
      awayTeamName: '',
      homeScore: b.result_goals_for as number,
      awayScore: b.result_goals_against as number,
      playedAt: `${b.booking_day}T${b.start_time}`,
    }));

    const results = [...friendlyResults, ...fixtureResults, ...bookingResults]
      .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
      .slice(0, limit);

    setState({ status: 'ready', results });
    // teamIdsKey (not teamIds) is the real dependency — a new array with the
    // same ids shouldn't trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeams.status, teamIdsKey, user, limit]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { ...state, reload };
}
