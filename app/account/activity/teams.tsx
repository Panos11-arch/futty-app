import { router } from 'expo-router';
import { Fragment } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useMyTeams } from '@/lib/use-my-teams';

export default function TeamsScreen() {
  const styles = useStyles();
  const myTeams = useMyTeams();

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {myTeams.status === 'loading' ? (
          <Card testID="teams-skeleton">
            <SkeletonText lines={3} />
          </Card>
        ) : null}
        {myTeams.status === 'error' ? (
          <Banner
            tone="danger"
            message={`Could not load your teams: ${myTeams.message}`}
            action={{ label: 'Try again', onPress: myTeams.reload }}
          />
        ) : null}
        {myTeams.status === 'ready' && myTeams.teams.length === 0 ? (
          <EmptyState icon="shield.fill" message="You’re not on a team yet — register one from the League tab." />
        ) : null}
        {myTeams.status === 'ready' && myTeams.teams.length > 0 ? (
          <Card padded={false}>
            {myTeams.teams.map(({ team, role }, i) => (
              <Fragment key={team.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <ListRow
                  title={team.name}
                  accessibilityLabel={`${team.name}, ${role === 'captain' ? 'Captain' : role === 'substitute' ? 'Substitute' : 'Player'}${team.city ? `, ${team.city}` : ''}, ${team.played} played, ${team.won} won, ${team.drawn} drawn, ${team.lost} lost`}
                  subtitle={`${role === 'captain' ? 'Captain' : role === 'substitute' ? 'Substitute' : 'Player'}${team.city ? ` · ${team.city}` : ''}`}
                  leading={{ icon: 'shield.fill' }}
                  trailing={
                    <Text variant="caption" tone="inkMuted" tabular>
                      {team.played}P {team.won}W {team.drawn}D {team.lost}L
                    </Text>
                  }
                  chevron
                  onPress={() => router.push({ pathname: '/(tabs)/team', params: { teamId: team.id } })}
                />
              </Fragment>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
