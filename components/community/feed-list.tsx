// S7: one feed (For you, Your posts or Following) as a virtualised list:
// skeletons while loading, pull to refresh, one-line error with "Try again",
// and the next page when the end comes into view.
import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { MatchResultCard } from '@/components/community/match-result-card';
import { SquadPostCard } from '@/components/community/squad-post-card';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import type { FeedItem, FeedScope } from '@/lib/community';
import { feedKey } from '@/lib/community-feed';
import { useCommunityFeed } from '@/lib/use-community-feed';
import { makeStyles, useTheme } from '@/lib/theme';

/** G4a: one banner ad every 8 posts. */
export const POSTS_PER_AD = 8;

export function FeedSkeleton({ testID }: { testID: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.list}>
      {[0, 1, 2].map((i) => (
        <Card key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonRow}>
            <SkeletonBlock width={MIN_TOUCH} height={MIN_TOUCH} rounded="pill" />
            <View style={styles.flex}>
              <SkeletonText lines={2} />
            </View>
          </View>
          <SkeletonBlock width="100%" height={MIN_TOUCH} rounded="control" />
        </Card>
      ))}
    </View>
  );
}

export function FeedList({
  scope,
  testID,
  header,
  empty,
}: {
  scope: FeedScope;
  testID: string;
  /** Above the cards, e.g. the All | Your posts chips. */
  header?: ReactElement | null;
  empty: { message: string; action: { label: string; onPress: () => void } };
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const feed = useCommunityFeed(scope);

  function renderItem({ item, index }: { item: FeedItem; index: number }) {
    const card = item.kind === 'squad_post' ? <SquadPostCard item={item} /> : <MatchResultCard item={item} />;
    const count = index + 1;
    if (count % POSTS_PER_AD !== 0) return card;
    // G4a (image 18): a banner ad after every 8 posts (none on Premium Plus).
    return (
      <View style={styles.withAd}>
        {card}
        <AdBanner testID={`community-feed-ad-${count}`} />
      </View>
    );
  }

  let emptyView: ReactElement | null = null;
  if (feed.status === 'loading') emptyView = <FeedSkeleton testID={`${testID}-skeleton`} />;
  else if (feed.status === 'error')
    emptyView = (
      <Banner tone="danger" message="Couldn't load posts." action={{ label: 'Try again', onPress: feed.reload }} />
    );
  else emptyView = <EmptyState icon="person.2.fill" message={empty.message} action={empty.action} />;

  return (
    <FlatList
      testID={testID}
      data={feed.items}
      keyExtractor={feedKey}
      renderItem={renderItem}
      ListHeaderComponent={header ?? null}
      ListEmptyComponent={emptyView}
      ListFooterComponent={
        feed.loadingMore ? <ActivityIndicator color={colors.inkMuted} accessibilityLabel="Loading more" /> : null
      }
      contentContainerStyle={styles.content}
      onEndReached={feed.loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} tintColor={colors.inkMuted} />
      }
    />
  );
}

const useStyles = makeStyles(() => ({
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl * 3 },
  list: { gap: space.md },
  withAd: { gap: space.md },
  flex: { flex: 1 },
  skeletonCard: { gap: space.md },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
}));
