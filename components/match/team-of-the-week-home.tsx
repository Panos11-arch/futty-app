// Home's team of the week (A7, match-record.md decision 1g.4): Futty's one
// team, the latest week. Shows nothing while loading, on an error, or before
// the first team, so Home never waits on it.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TeamOfTheWeekCard } from '@/components/match/team-of-the-week-card';
import { SectionHeader } from '@/components/ui/section-header';
import { space } from '@/constants/futty-theme';
import type { TeamOfTheWeek } from '@/lib/match/stats-api';
import { useLatestTeamOfTheWeek, useTeamOfTheWeekPlayers } from '@/lib/match/use-stats';

export function TeamOfTheWeekHome() {
  const latest = useLatestTeamOfTheWeek();
  const team = latest.status === 'ready' ? latest.team : null;
  if (!team) return null;
  return <LatestTeam team={team} />;
}

function LatestTeam({ team }: { team: TeamOfTheWeek }) {
  const players = useTeamOfTheWeekPlayers(team.id);
  return (
    <View style={styles.section} testID="home-team-of-the-week">
      <SectionHeader title="Team of the week" action={{ label: 'See how', onPress: () => router.push('/match/team-of-the-week') }} />
      <TeamOfTheWeekCard
        team={team}
        state={players.status === 'ready' ? { status: 'ready', players: players.players } : players}
        onRetry={players.reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
});
