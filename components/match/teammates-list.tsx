// "Players you play with most" (match-record.md decision 1c.6): the
// signed-in player's own list, from player_teammates, in the server's order.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import type { NamedTeammate } from '@/lib/match/use-profile-matches';

export type TeammatesState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; teammates: NamedTeammate[] };

const together = (n: number) => (n === 1 ? '1 game together' : `${n} games together`);

export function TeammatesList({ state, onRetry }: { state: TeammatesState; onRetry: () => void }) {
  if (state.status === 'loading') {
    return (
      <Card>
        <View testID="teammates-skeleton">
          <SkeletonText lines={3} />
        </View>
      </Card>
    );
  }
  if (state.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load your teammates." action={{ label: 'Try again', onPress: onRetry }} />;
  }
  if (state.teammates.length === 0) {
    return <EmptyState icon="person.2.fill" message="Play a confirmed match to see who you play with most" />;
  }
  return (
    <Card padded={false}>
      <View style={styles.list}>
        {state.teammates.map((t) => (
          <ListRow
            key={t.teammate_profile_id}
            testID="teammate-row"
            title={t.name}
            subtitle={together(t.matches_together)}
            leading={{ avatar: { name: t.name } }}
            chevron
            onPress={() => router.push({ pathname: '/player-profile', params: { profileId: t.teammate_profile_id } })}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
});
