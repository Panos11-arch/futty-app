// A team of the week (A7, match-record.md decision 1g.4): its five players in
// their slots, each with their position, average match rating that week and
// rated matches, as the server picked them. A row opens the player's profile.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import {
  formatRating,
  formatWeekOf,
  POSITION_LABELS,
  type TeamOfTheWeek,
  type TeamOfTheWeekPlayer,
} from '@/lib/match/stats-api';

export type TeamOfTheWeekPlayersState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; players: TeamOfTheWeekPlayer[] };

const matches = (n: number) => (n === 1 ? '1 rated game' : `${n} rated games`);

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
        <Text variant="headline">{team.name}</Text>
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
              subtitle={`${POSITION_LABELS[p.position_group]} · ${matches(p.rated_matches)}`}
              leading={{ avatar: { name: p.name } }}
              accessibilityLabel={`${p.name}, ${POSITION_LABELS[p.position_group]}, rated ${formatRating(p.average_rating)}`}
              trailing={
                <Text variant="headline" tabular>
                  {formatRating(p.average_rating)}
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
