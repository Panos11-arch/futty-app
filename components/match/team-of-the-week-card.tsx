// Futty's team of the week (A7, match-record.md decision 1g.4): five players
// from every confirmed game of the week, each with their position, the numbers
// behind the pick and their average points per game, as the server picked
// them. A row opens the player's profile.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import {
  formatPoints,
  formatWeekOf,
  pickLine,
  POSITION_LABELS,
  type TeamOfTheWeek,
  type TeamOfTheWeekPlayer,
} from '@/lib/match/stats-api';

export type TeamOfTheWeekPlayersState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; players: TeamOfTheWeekPlayer[] };

export function TeamOfTheWeekCard({
  team,
  state,
  onRetry,
}: {
  team: TeamOfTheWeek;
  state: TeamOfTheWeekPlayersState;
  onRetry: () => void;
}) {
  return (
    <Card padded={false} testID="team-of-the-week-card">
      <View style={styles.header}>
        <Text variant="headline">Team of the week</Text>
        <Text variant="caption" tone="inkMuted">
          {`${formatWeekOf(team.week_start)} · ${team.matches === 1 ? '1 match' : `${team.matches} matches`}`}
        </Text>
      </View>
      {state.status === 'loading' ? (
        <View style={styles.pad} testID="team-of-the-week-skeleton">
          <SkeletonText lines={5} />
        </View>
      ) : null}
      {state.status === 'error' ? (
        <View style={styles.pad}>
          <Banner tone="danger" message="Couldn’t load the team." action={{ label: 'Try again', onPress: onRetry }} />
        </View>
      ) : null}
      {state.status === 'ready'
        ? state.players.map((p) => (
            <ListRow
              key={p.profile_id}
              testID="team-of-the-week-player"
              title={p.name}
              subtitle={`${POSITION_LABELS[p.position_group]} · ${pickLine(p)}`}
              leading={{ avatar: { name: p.name, kit: p.kit } }}
              accessibilityLabel={`${p.name}, ${POSITION_LABELS[p.position_group]}, ${pickLine(p)}, ${formatPoints(p.average_points)} per game`}
              trailing={
                <Text variant="headline" tabular>
                  {formatPoints(p.average_points)}
                </Text>
              }
              chevron
              onPress={() => router.push({ pathname: '/player-profile', params: { profileId: p.profile_id } })}
            />
          ))
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { padding: space.lg, gap: space.xs },
  pad: { paddingHorizontal: space.lg, paddingBottom: space.lg },
});
