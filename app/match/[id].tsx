// The match screen: one match's result, entered and answered with A2's
// functions (docs/specs/match-record.md section 5.2), and the match page
// from A4a's get_match_page (section 5.3): score, scorers and assists, man of
// the match, lineups, venue and date. Opened from Home, the notifications
// list, recent matches and a tapped push (lib/push-tap.tsx).
//
// Members of the match see it at any time; everyone signed in once it is
// confirmed (the server decides; "Match not found" otherwise). The result
// panel and the post-match offers are for members only, as before.
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchLineup } from '@/components/match/match-lineup';
import { MatchMotm } from '@/components/match/match-motm';
import { MatchScorers } from '@/components/match/match-scorers';
import { MatchPageSection } from '@/components/match/page-section';
import { MatchResultPanel } from '@/components/match/result-panel';
import { PostMatchOffers } from '@/components/offers/post-match-offers';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import { lineupEditable, playedMatch, sideOf, writerSides, type MatchPage } from '@/lib/match/page';
import { useFormationPresets, useMatchPage, useMatchRoster } from '@/lib/match/use-match-page';
import { useResultMatch } from '@/lib/match/use-match-result';
import { scoreEntered } from '@/lib/post-match-offers';
import { useMyCaptainTeamIds } from '@/lib/use-fixtures';

/** The score line for someone outside the match, who has no result panel. */
function pageScore(page: MatchPage): string | null {
  const a = sideOf(page, 'a');
  const b = sideOf(page, 'b');
  if (page.forfeit) {
    const team = page.forfeit.side === 'a' ? a.label : b.label;
    return `Forfeit · ${team} ${page.forfeit.reason === 'no_show' ? "didn't show" : 'pulled out'}`;
  }
  if (a.score === null || b.score === null) return null;
  return `${a.label} ${a.score}–${b.score} ${b.label}`;
}

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const result = useResultMatch(matchId);
  const page = useMatchPage(matchId);
  const captainTeamIds = useMyCaptainTeamIds();
  const member = result.status === 'ready' && result.match !== null;
  const roster = useMatchRoster(matchId, member);
  const pageData = page.status === 'ready' ? page.page : null;
  const now = Date.now();
  const presets = useFormationPresets(member && pageData && lineupEditable(pageData, now) ? pageData.playersPerSide : null);

  const { reload } = result;
  const { reload: reloadPage } = page;
  const { reload: reloadRoster } = roster;
  const reloadAll = useCallback(() => {
    reload();
    reloadPage();
    reloadRoster();
  }, [reload, reloadPage, reloadRoster]);

  useFocusEffect(
    useCallback(() => {
      reloadAll();
    }, [reloadAll])
  );

  const skeleton = (
    <View testID="match-skeleton" style={styles.stack}>
      <SkeletonBlock width="100%" height={120} />
      <SkeletonText lines={2} />
    </View>
  );
  const loadError = (
    <Banner tone="danger" message="Could not load this match." action={{ label: 'Try again', onPress: reloadAll }} />
  );

  let content: React.ReactNode;
  if (result.status === 'loading') {
    content = skeleton;
  } else if (result.status === 'error') {
    content = loadError;
  } else if (!result.match && page.status === 'loading') {
    content = skeleton;
  } else if (!result.match && page.status === 'error') {
    content = loadError;
  } else if (!result.match && !pageData) {
    content = (
      <Card>
        <EmptyState icon="sportscourt.fill" message="Match not found" />
      </Card>
    );
  } else {
    const match = result.match;
    const when = match ? match.match.kickoff_at : pageData!.kickoffAt;
    const venueName = match ? match.venueName : (pageData?.venue?.name ?? null);
    const writable = match ? writerSides(match, result.viewerId, captainTeamIds) : [];
    const rosterState = member ? roster : null;
    const sectionStatus = page.status;
    // Sections wait for the page; once it is here, scorers and the vote exist only for a played match.
    const showPlayed = sectionStatus !== 'ready' || (pageData !== null && playedMatch(pageData));
    const score = !match && pageData ? pageScore(pageData) : null;

    content = (
      <View style={styles.stack}>
        <Text variant="callout" tone="inkMuted" tabular>
          {[formatMatchWhen(when), venueName].filter(Boolean).join(' · ')}
        </Text>
        {match ? (
          <Card>
            <MatchResultPanel
              match={match}
              viewerId={result.viewerId}
              captainTeamIds={captainTeamIds}
              onChanged={reload}
            />
          </Card>
        ) : score ? (
          <Card testID="match-page-score">
            <Text variant="title" tabular>
              {score}
            </Text>
          </Card>
        ) : null}
        {sectionStatus === 'ready' && !pageData ? null : (
          <>
            {showPlayed ? (
              <MatchPageSection title="Scorers" status={sectionStatus} onRetry={reloadPage} testID="section-scorers">
                {pageData ? (
                  <MatchScorers
                    page={pageData}
                    roster={rosterState}
                    onRetryRoster={reloadRoster}
                    writable={writable}
                    onSaved={reloadPage}
                    now={now}
                  />
                ) : null}
              </MatchPageSection>
            ) : null}
            {showPlayed ? (
              <MatchPageSection title="Man of the match" status={sectionStatus} onRetry={reloadPage} testID="section-motm">
                {pageData ? (
                  <MatchMotm
                    page={pageData}
                    roster={rosterState}
                    onRetryRoster={reloadRoster}
                    viewerId={result.viewerId}
                    onVoted={reloadPage}
                    now={now}
                  />
                ) : null}
              </MatchPageSection>
            ) : null}
            <MatchPageSection title="Lineups" status={sectionStatus} onRetry={reloadPage} testID="section-lineups">
              {pageData ? (
                <MatchLineup
                  page={pageData}
                  roster={rosterState}
                  onRetryRoster={reloadRoster}
                  writable={writable}
                  presets={presets}
                  onRetryPresets={presets.reload}
                  onSaved={reloadPage}
                  now={now}
                />
              ) : null}
            </MatchPageSection>
          </>
        )}
        {match && scoreEntered(match) ? <PostMatchOffers matchId={match.match.id} /> : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Match' }} />
      <ScrollView contentContainerStyle={styles.content}>{content}</ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg },
  stack: { gap: space.md },
});
