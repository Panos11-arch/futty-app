// A player's recent matches (05 section 3), from player_recent_matches, in
// the order the server gives them. A row opens the match page only for a
// confirmed match (match-record.md section 7, "Match page link").
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { MatchRow } from '@/components/match/match-row';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { space } from '@/constants/futty-theme';
import { recentRowToListItem } from '@/lib/match/profile-api';
import type { PlayerRecentMatchRow } from '@/lib/match/types';

export type RecentMatchesState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; rows: PlayerRecentMatchRow[] };

export function RecentMatches({ state, onRetry }: { state: RecentMatchesState; onRetry: () => void }) {
  if (state.status === 'loading') {
    return (
      <View style={styles.list}>
        <MatchRow loading />
        <MatchRow loading />
      </View>
    );
  }
  if (state.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load recent matches." action={{ label: 'Try again', onPress: onRetry }} />;
  }
  if (state.rows.length === 0) {
    return <EmptyState icon="sportscourt.fill" message="No confirmed matches yet" />;
  }
  return (
    <View style={styles.list}>
      {state.rows.map((row) => {
        const item = recentRowToListItem(row);
        const open =
          item.match.status === 'confirmed'
            ? () => router.push({ pathname: '/match/[id]', params: { id: row.match_id } })
            : undefined;
        return <MatchRow key={row.match_id} item={item} viewerResult={row.result} onPress={open} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
});
