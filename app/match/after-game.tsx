// The post-match flow (A10; docs/specs/match-record.md decision 1j), opened
// from the match_after_game, match_result_confirmed and motm_vote_open pushes
// (lib/push-tap.tsx) and from Home's Previous game card. It loads what the
// match page loads, waits until all of it is here (the flow works out its
// steps once), then hands over to PostMatchFlow. Done and Skip go to the
// match page.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostMatchFlow } from '@/components/match/post-match-flow';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { playedMatch } from '@/lib/match/page';
import { useMatchRatings } from '@/lib/match/use-levels';
import { useMatchPage, useMatchRoster } from '@/lib/match/use-match-page';
import { useResultMatch } from '@/lib/match/use-match-result';
import { useMyCaptainTeamIds } from '@/lib/use-fixtures';

export default function AfterGameScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const result = useResultMatch(matchId);
  const page = useMatchPage(matchId);
  const captainTeamIds = useMyCaptainTeamIds();
  const member = result.status === 'ready' && result.match !== null;
  const roster = useMatchRoster(matchId, member);
  const pageData = page.status === 'ready' ? page.page : null;
  const rated = pageData !== null && playedMatch(pageData);
  const ratings = useMatchRatings(matchId, rated);

  const { reload } = result;
  const { reload: reloadPage } = page;
  const { reload: reloadRoster } = roster;
  const { reload: reloadRatings } = ratings;
  const reloadAll = useCallback(() => {
    reload();
    reloadPage();
    reloadRoster();
    reloadRatings();
  }, [reload, reloadPage, reloadRoster, reloadRatings]);

  const openMatch = useCallback(() => {
    if (matchId) router.replace({ pathname: '/match/[id]', params: { id: matchId } });
  }, [matchId]);

  const loading =
    result.status === 'loading' ||
    (member && (page.status === 'loading' || roster.status === 'loading' || (rated && ratings.status === 'loading')));
  const failed =
    result.status === 'error' ||
    (member && (page.status === 'error' || roster.status === 'error' || (rated && ratings.status === 'error')));

  let content: React.ReactNode;
  if (loading) {
    content = (
      <View testID="after-game-skeleton" style={styles.stack}>
        <SkeletonBlock width="100%" height={120} />
        <SkeletonText lines={2} />
      </View>
    );
  } else if (failed) {
    content = <Banner tone="danger" message="Could not load this match." action={{ label: 'Try again', onPress: reloadAll }} />;
  } else if (result.status !== 'ready' || !result.match) {
    content = (
      <Card>
        <EmptyState icon="sportscourt.fill" message="Match not found" />
      </Card>
    );
  } else {
    content = (
      <PostMatchFlow
        match={result.match}
        page={pageData}
        roster={roster}
        ratings={rated && ratings.status === 'ready' ? { ratings: ratings.ratings, names: ratings.names } : null}
        viewerId={result.viewerId}
        captainTeamIds={captainTeamIds}
        onChanged={reloadAll}
        onRetryRoster={reloadRoster}
        onDone={openMatch}
      />
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <Stack.Screen options={{ title: 'After the game' }} />
      <ScrollView contentContainerStyle={styles.content}>{content}</ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg },
  stack: { gap: space.md },
}));
