// Team of the week (docs/specs/match-record.md decision 1k): the latest
// week's General · All Cyprus team, as the server picked and placed it, or
// the team a team_of_the_week notification names (teamId). Opened from Home,
// Rankings and that notification. S15
// moves it into Rankings with its format, week and area pickers.
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TeamOfTheWeekCard } from '@/components/match/team-of-the-week-card';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { TeamOfTheWeek } from '@/lib/match/stats-api';
import { useLatestTeamOfTheWeek, useTeamOfTheWeekPlayers } from '@/lib/match/use-stats';

function Team({ team }: { team: TeamOfTheWeek }) {
  const players = useTeamOfTheWeekPlayers(team);
  return (
    <TeamOfTheWeekCard
      team={team}
      state={players.status === 'ready' ? { status: 'ready', players: players.players, shape: players.shape } : players}
      onRetry={players.reload}
    />
  );
}

export default function TeamOfTheWeekScreen() {
  const styles = useStyles();
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const latest = useLatestTeamOfTheWeek(typeof teamId === 'string' && teamId ? teamId : undefined);
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Team of the week' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {latest.status === 'loading' ? (
          <View testID="team-of-the-week-screen-skeleton">
            <SkeletonText lines={5} />
          </View>
        ) : null}
        {latest.status === 'error' ? (
          <Banner tone="danger" message="Couldn’t load the team of the week." action={{ label: 'Try again', onPress: latest.reload }} />
        ) : null}
        {latest.status === 'ready' && !latest.team ? (
          <EmptyState icon="trophy.fill" message="No team of the week yet." />
        ) : null}
        {latest.status === 'ready' && latest.team ? <Team team={latest.team} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
}));
