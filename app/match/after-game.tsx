// After the game (S13B; docs/specs/match-record.md decision 1l, images
// 07–11; spec 15 section 0.6). Opened from Home's "Log the score", the match
// page, and the match_after_game, match_score_mismatch,
// match_result_confirmed and motm_vote_open pushes (lib/push-tap.tsx).
//
// A captain who can log the score gets Score → Goals → Assists → Review
// (with ?correct=1, a correction of the goals and assists for 24 hours after
// the result). Everyone else, and the captain once it is confirmed, gets the
// Man of the Match vote while it is open; with nothing left, one line and a
// button to the match. The server decides who may do what (get_match_log).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogScoreFlow } from '@/components/match/log-score/log-score-flow';
import { MatchMotm } from '@/components/match/match-motm';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { motmView } from '@/lib/match/page';
import { useMatchLog } from '@/lib/match/use-match-log';
import { useMatchPage, useMatchRoster } from '@/lib/match/use-match-page';
import { useAuth } from '@/lib/auth';
import { makeStyles } from '@/lib/theme';

export default function AfterGameScreen() {
  const styles = useStyles();
  const { id, correct } = useLocalSearchParams<{ id: string; correct?: string }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const log = useMatchLog(matchId);
  const logData = log.status === 'ready' ? log.log : null;
  const logging = logData !== null && (logData.canLog || (logData.canCorrect && correct === '1'));
  const page = useMatchPage(matchId);
  const roster = useMatchRoster(matchId, logData !== null && !logging);

  const { reload } = log;
  const { reload: reloadPage } = page;
  const { reload: reloadRoster } = roster;
  const reloadAll = useCallback(() => {
    reload();
    reloadPage();
    reloadRoster();
  }, [reload, reloadPage, reloadRoster]);

  const openMatch = useCallback(() => {
    if (matchId) router.replace({ pathname: '/match/[id]', params: { id: matchId } });
  }, [matchId]);

  let content: React.ReactNode;
  if (log.status === 'loading') {
    content = (
      <View testID="after-game-skeleton" style={styles.padded}>
        <SkeletonBlock width="100%" height={space.xxl * 4} />
        <SkeletonText lines={2} />
      </View>
    );
  } else if (log.status === 'error') {
    content = (
      <View style={styles.padded}>
        <Banner tone="danger" message="Could not load this match." action={{ label: 'Try again', onPress: reloadAll }} />
      </View>
    );
  } else if (!logData) {
    content = (
      <View style={styles.padded}>
        <Card>
          <EmptyState icon="sportscourt.fill" message="Match not found" />
        </Card>
      </View>
    );
  } else if (logging) {
    return (
      <SafeAreaView style={styles.flex} edges={[]}>
        <Stack.Screen options={{ title: 'After the game' }} />
        <LogScoreFlow
          key={`${logData.tries}|${logData.myEntry?.a}|${logData.myEntry?.b}|${logData.status}`}
          log={logData}
          onLogged={(status) => (status === 'confirmed' || status === 'corrected' ? openMatch() : reload())}
          onExit={() => (router.canGoBack() ? router.back() : openMatch())}
          onOpenMatch={openMatch}
          onStale={reload}
        />
      </SafeAreaView>
    );
  } else {
    const pageData = page.status === 'ready' ? page.page : null;
    const rosterReady = roster.status === 'ready' ? roster.roster : null;
    const vote = pageData && rosterReady ? motmView(pageData, rosterReady, viewerId, Date.now()) : null;
    if (page.status === 'loading' || roster.status === 'loading') {
      content = (
        <View testID="after-game-skeleton" style={styles.padded}>
          <SkeletonText lines={3} />
        </View>
      );
    } else if (pageData && vote?.kind === 'vote') {
      content = (
        <View style={styles.padded} testID="post-match-step-motm">
          <Text variant="display" accessibilityRole="header">
            Man of the Match
          </Text>
          <Card>
            <MatchMotm
              page={pageData}
              roster={roster}
              onRetryRoster={reloadRoster}
              viewerId={viewerId}
              onVoted={openMatch}
            />
          </Card>
        </View>
      );
    } else {
      content = (
        <View style={styles.padded}>
          <Card>
            <View style={styles.stack} testID="post-match-nothing">
              <EmptyState icon="sportscourt.fill" message="Nothing to add for this match." />
              <Button label="Open match" onPress={openMatch} fullWidth testID="post-match-open-match" />
            </View>
          </Card>
        </View>
      );
    }
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <Stack.Screen options={{ title: 'After the game' }} />
      <ScrollView>{content}</ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1, backgroundColor: colors.canvas },
  padded: { padding: space.lg, gap: space.md },
  stack: { gap: space.md },
}));
