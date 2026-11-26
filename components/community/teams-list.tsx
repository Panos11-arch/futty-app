// Find players → Teams (S7; was Community's Teams view): every team with
// Follow, or the teams matching the search.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FollowToggle } from '@/components/community/follow-toggle';
import { PersonRow, RowsSkeleton } from '@/components/community/person-row';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { space } from '@/constants/futty-theme';
import { searchTeams } from '@/lib/booking-opposition';
import { listTeams, type TeamListing } from '@/lib/community';
import { teamHref } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';
import type { useFollows } from '@/lib/use-follows';

type TeamsState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; teams: TeamListing[] };

/** Every team (no query) or the teams matching `query` (2+ characters),
 *  followed teams first. */
export function TeamsList({
  query,
  follows,
  onCreateTeam,
}: {
  query: string;
  follows: ReturnType<typeof useFollows>;
  onCreateTeam: () => void;
}) {
  const styles = useStyles();
  const [state, setState] = useState<TeamsState>({ status: 'loading' });
  // Bumped by "Try again" to run the same request again.
  const [attempt, setAttempt] = useState(0);
  const q = query.trim();
  const searching = q.length >= 2;

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    const load = (): Promise<{ data: TeamListing[] | null; error: { message: string } | null }> =>
      searching
        ? searchTeams(q, new Set()).then(
            (teams) => ({ data: teams as TeamListing[], error: null }),
            (e: Error) => ({ data: null, error: { message: e.message } }),
          )
        : Promise.resolve(listTeams()).then(({ data, error }) => ({ data: data as TeamListing[] | null, error }));
    // A short pause while typing, so each key doesn't query.
    const timer = setTimeout(
      () => {
        load().then(({ data, error }) => {
          if (!active) return;
          if (error || !data) setState({ status: 'error', message: error?.message ?? '' });
          else setState({ status: 'ready', teams: data as TeamListing[] });
        });
      },
      searching ? 300 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, searching, attempt]);

  if (state.status === 'loading') return <RowsSkeleton testID="teams-list-skeleton" />;
  if (state.status === 'error') {
    return (
      <Banner
        tone="danger"
        message={`Could not load: ${state.message}`}
        action={{ label: 'Try again', onPress: () => setAttempt((n) => n + 1) }}
      />
    );
  }
  if (state.teams.length === 0) {
    return searching ? (
      <EmptyState icon="magnifyingglass" message="No teams found." />
    ) : (
      <EmptyState icon="person.2.fill" message="No teams yet." action={{ label: 'Create a team', onPress: onCreateTeam }} />
    );
  }

  // Search results: followed teams first. The full list stays in name order.
  const teams = searching
    ? [...state.teams].sort(
        (a, b) => Number(follows.isFollowing('team', b.id)) - Number(follows.isFollowing('team', a.id)),
      )
    : state.teams;

  return (
    <View style={styles.list}>
      {teams.map((team) => (
        <PersonRow
          key={team.id}
          testID={`team-row-${team.id}`}
          name={team.name}
          subtitle={team.city}
          onPress={() => router.push(teamHref(team.id))}
          actions={
            <FollowToggle
              testID={`team-follow-${team.id}`}
              targetType="team"
              targetId={team.id}
              name={team.name}
              follows={follows}
            />
          }
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: { gap: space.md },
}));
