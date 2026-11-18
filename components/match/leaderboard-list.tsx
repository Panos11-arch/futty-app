// One leaderboard (A7, match-record.md decision 1g.1): the rows and ranks as
// stats_leaderboards gives them; tied players share a rank. A row opens the
// player's profile.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { LeaderboardBoard, LeaderboardRow } from '@/lib/match/stats-api';

export type LeaderboardState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; rows: LeaderboardRow[] };

const games = (n: number) => (n === 1 ? '1 game' : `${n} games`);

/** What a row shows for its board. */
export function boardValue(row: LeaderboardRow, board: LeaderboardBoard): string {
  if (board === 'goals') return row.goals === 1 ? '1 goal' : `${row.goals} goals`;
  if (board === 'motm') return row.motm === 1 ? '1 award' : `${row.motm} awards`;
  return `${row.win_pct}%`;
}

export function LeaderboardList({
  state,
  board,
  minAppearances,
  onRetry,
}: {
  state: LeaderboardState;
  board: LeaderboardBoard;
  minAppearances: number | null;
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <Card>
        <View testID="leaderboard-skeleton">
          <SkeletonText lines={5} />
        </View>
      </Card>
    );
  }
  if (state.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load the leaderboard." action={{ label: 'Try again', onPress: onRetry }} />;
  }
  if (state.rows.length === 0) {
    return (
      <EmptyState
        icon="trophy.fill"
        message={
          minAppearances && minAppearances > 1
            ? `Nobody has played ${minAppearances} confirmed games here this year yet`
            : 'No confirmed games here this year yet'
        }
      />
    );
  }
  return (
    <Card padded={false}>
      <View style={styles.list}>
        {state.rows.map((row) => (
          <ListRow
            key={row.profile_id}
            testID="leaderboard-row"
            title={row.name}
            subtitle={games(row.appearances)}
            leading={{ avatar: { name: row.name, kit: row.kit } }}
            accessibilityLabel={`${row.rank}. ${row.name}, ${boardValue(row, board)}`}
            trailing={
              <View style={styles.trailing}>
                <Text variant="headline" tabular>
                  {boardValue(row, board)}
                </Text>
                <Text variant="caption" tone="inkMuted" tabular>
                  {`#${row.rank}`}
                </Text>
              </View>
            }
            chevron
            onPress={() => router.push({ pathname: '/player-profile', params: { profileId: row.profile_id } })}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  trailing: { alignItems: 'flex-end' },
});
