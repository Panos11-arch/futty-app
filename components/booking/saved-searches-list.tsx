// The player's saved searches (decided 18 November): each one with what it
// looks for, and Delete. A player can delete a search at any time.
import { ScrollView, View } from 'react-native';

import { Banner, Button, Card, EmptyState, SkeletonBlock, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { LoadState } from '@/lib/booking-search';
import { type SavedSearch, savedSearchDetail, savedSearchTitle } from '@/lib/saved-searches';

export type SavedSearchesListProps = {
  searches: LoadState<SavedSearch[]>;
  /** The search being deleted, if any. */
  deletingId: string | null;
  /** A failed delete, in plain words. */
  error: string | null;
  onDelete: (id: string) => void;
  onRetry: () => void;
  onNewSearch: () => void;
};

export function SavedSearchesList({ searches, deletingId, error, onDelete, onRetry, onNewSearch }: SavedSearchesListProps) {
  const styles = useStyles();
  if (searches.status === 'loading') {
    return (
      <View style={[styles.screen, styles.content]}>
        <SkeletonBlock width="100%" height={72} />
        <SkeletonBlock width="100%" height={72} />
      </View>
    );
  }
  if (searches.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="exclamationmark.circle.fill"
          message={searches.message}
          action={{ label: 'Try again', onPress: onRetry }}
        />
      </View>
    );
  }
  if (searches.data.length === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="magnifyingglass"
          message="No saved searches yet. Save one from Book a pitch and we’ll tell you when a slot frees up."
          action={{ label: 'Book a pitch', onPress: onNewSearch }}
        />
      </View>
    );
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? <Banner tone="danger" message={error} /> : null}
      {searches.data.map((s) => (
        <Card key={s.id} testID={`saved-search-${s.id}`}>
          <View style={styles.row}>
            <View style={styles.text}>
              <Text variant="body">{savedSearchTitle(s)}</Text>
              <Text variant="callout" tone="inkMuted">
                {savedSearchDetail(s)}
              </Text>
            </View>
            <Button
              label="Delete"
              variant="destructive"
              loading={deletingId === s.id}
              disabled={deletingId !== null && deletingId !== s.id}
              onPress={() => onDelete(s.id)}
              testID={`delete-${s.id}`}
            />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, gap: space.xs },
}));
