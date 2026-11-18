// Team of the week (A7, docs/specs/match-record.md decision 1g.4): every team
// picked for the latest week (venues, leagues, cities), as the server picked
// them. Opened from Home and the team_of_the_week notification.
import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TeamOfTheWeekCard } from '@/components/match/team-of-the-week-card';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import type { TeamOfTheWeek } from '@/lib/match/stats-api';
import { useLatestTeamsOfTheWeek, useTeamOfTheWeekPlayers } from '@/lib/match/use-stats';

function Team({ team }: { team: TeamOfTheWeek }) {
  const players = useTeamOfTheWeekPlayers(team.id);
  return (
    <TeamOfTheWeekCard
      team={team}
      state={players.status === 'ready' ? { status: 'ready', players: players.players } : players}
      onRetry={players.reload}
    />
  );
}

export default function TeamOfTheWeekScreen() {
  const teams = useLatestTeamsOfTheWeek();
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Team of the week' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="callout" tone="inkMuted">
          The best average match rating at each position, from last week’s confirmed games. Picked every Monday morning.
        </Text>
        {teams.status === 'loading' ? (
          <View testID="team-of-the-week-screen-skeleton">
            <SkeletonText lines={5} />
          </View>
        ) : null}
        {teams.status === 'error' ? (
          <Banner tone="danger" message="Couldn’t load the teams of the week." action={{ label: 'Try again', onPress: teams.reload }} />
        ) : null}
        {teams.status === 'ready' && teams.teams.length === 0 ? (
          <EmptyState icon="trophy.fill" message="No team of the week yet. Rate your teammates after each game." />
        ) : null}
        {teams.status === 'ready' ? teams.teams.map((t) => <Team key={t.id} team={t} />) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
});
