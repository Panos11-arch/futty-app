// Leaderboards (A7, docs/specs/match-record.md decision 1g.1): per venue and
// per city, this calendar year in Cyprus time, for top scorers, most men of
// the match and best win rate. Only players with the minimum appearances
// (from the server) are listed; ranks come from the server.
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LeaderboardList } from '@/components/match/leaderboard-list';
import { Banner } from '@/components/ui/banner';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { cyprusYear, defaultScope, type LeaderboardBoard, type LeaderboardScope } from '@/lib/match/stats-api';
import { useLeaderboard, useLeaderboardScopes } from '@/lib/match/use-stats';
import { useProfile } from '@/lib/use-profile';

const BOARDS: { value: LeaderboardBoard; label: string }[] = [
  { value: 'goals', label: 'Top scorers' },
  { value: 'motm', label: 'Man of the match' },
  { value: 'win_rate', label: 'Win rate' },
];

const scopeId = (s: LeaderboardScope) => `${s.scope}|${s.scope_key}`;

export default function LeaderboardsScreen() {
  const year = cyprusYear();
  const profile = useProfile();
  const scopes = useLeaderboardScopes(year);
  const [picked, setPicked] = useState<string | null>(null);
  const [board, setBoard] = useState<LeaderboardBoard>('goals');

  const list = scopes.status === 'ready' ? scopes.scopes : [];
  const city = profile.status === 'ready' ? profile.profile.city : null;
  const scope = list.find((s) => scopeId(s) === picked) ?? defaultScope(list, city);
  const rows = useLeaderboard(scope, year, board);
  const min = scopes.status === 'ready' ? scopes.min : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Leaderboards' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {scopes.status === 'loading' ? (
          <View testID="leaderboards-skeleton">
            <SkeletonText lines={3} />
          </View>
        ) : null}
        {scopes.status === 'error' ? (
          <Banner tone="danger" message="Couldn’t load the leaderboards." action={{ label: 'Try again', onPress: scopes.reload }} />
        ) : null}
        {scopes.status === 'ready' && list.length === 0 ? (
          <EmptyState
            icon="trophy.fill"
            message={min ? `Leaderboards start once players have ${min} confirmed games at a venue this year` : 'No leaderboards yet'}
          />
        ) : null}
        {scope ? (
          <>
            <View style={styles.chips}>
              {list.map((s) => (
                <Chip
                  key={scopeId(s)}
                  label={s.scope_name ?? (s.scope === 'city' ? 'City' : 'Venue')}
                  selected={scopeId(s) === scopeId(scope)}
                  onPress={() => setPicked(scopeId(s))}
                />
              ))}
            </View>
            <SegmentedControl options={BOARDS} value={board} onChange={setBoard} accessibilityLabel="Leaderboard" />
            <Text variant="caption" tone="inkMuted">
              {min && min > 1
                ? `${year} · players with ${min} or more confirmed games here`
                : `${year} · everyone with a confirmed game here`}
            </Text>
            <LeaderboardList
              state={rows.status === 'ready' ? { status: 'ready', rows: rows.rows } : rows}
              board={board}
              minAppearances={min}
              onRetry={rows.reload}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
