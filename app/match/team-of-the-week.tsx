// Team of the week (A7, docs/specs/match-record.md decision 1g.4): Futty's one
// team for the latest week, as the server picked it, and how it's picked.
// Opened from Home and the team_of_the_week notification.
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
import { useLatestTeamOfTheWeek, useTeamOfTheWeekPlayers } from '@/lib/match/use-stats';

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
  const latest = useLatestTeamOfTheWeek();
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Team of the week' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="callout" tone="inkMuted">
          The best keeper, defender, midfielder and forward from every confirmed game last week, plus the next best
          outfield player. Picked every Monday morning on average points per game.
        </Text>
        <Text variant="caption" tone="inkMuted">
          Forwards score most for goals and assists, midfielders for assists, goals and big wins, defenders and keepers for
          clean sheets. Everyone scores for a win and for man of the match.
        </Text>
        {latest.status === 'loading' ? (
          <View testID="team-of-the-week-screen-skeleton">
            <SkeletonText lines={5} />
          </View>
        ) : null}
        {latest.status === 'error' ? (
          <Banner tone="danger" message="Couldn’t load the team of the week." action={{ label: 'Try again', onPress: latest.reload }} />
        ) : null}
        {latest.status === 'ready' && !latest.team ? (
          <EmptyState icon="trophy.fill" message="No team of the week yet. Play a confirmed game to be in with a chance." />
        ) : null}
        {latest.status === 'ready' && latest.team ? <Team team={latest.team} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
});
