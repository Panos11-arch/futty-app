// Home's team of the week (A7, match-record.md decision 1g.4): the latest
// team for the viewer's city (profiles.city), the city's own team first,
// else a venue team there. Shows nothing while loading, on an error, or when
// there's no team for that city, so Home never waits on it.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TeamOfTheWeekCard } from '@/components/match/team-of-the-week-card';
import { SectionHeader } from '@/components/ui/section-header';
import { space } from '@/constants/futty-theme';
import { teamForCity, type TeamOfTheWeek } from '@/lib/match/stats-api';
import { useLatestTeamsOfTheWeek, useTeamOfTheWeekPlayers } from '@/lib/match/use-stats';
import { useProfile } from '@/lib/use-profile';

export function TeamOfTheWeekHome() {
  const profile = useProfile();
  const teams = useLatestTeamsOfTheWeek();
  const city = profile.status === 'ready' ? profile.profile.city : null;
  const team = teams.status === 'ready' ? teamForCity(teams.teams, city) : null;
  if (!team) return null;
  return <CityTeam team={team} />;
}

function CityTeam({ team }: { team: TeamOfTheWeek }) {
  const players = useTeamOfTheWeekPlayers(team.id);
  return (
    <View style={styles.section} testID="home-team-of-the-week">
      <SectionHeader title="Team of the week" action={{ label: 'See all', onPress: () => router.push('/match/team-of-the-week') }} />
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
