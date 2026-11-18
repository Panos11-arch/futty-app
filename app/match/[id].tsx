// The match screen: one match's result, entered and answered with A2's
// functions (docs/specs/match-record.md section 5.2), and the match page
// from A4a's get_match_page (section 5.3): score, scorers and assists, man of
// the match, lineups, venue and date. Opened from Home, the notifications
// list, recent matches and a tapped push (lib/push-tap.tsx).
//
// Members of the match see it at any time; everyone signed in once it is
// confirmed (the server decides; "Match not found" otherwise). The result
// panel and the post-match offers are for members only, as before.
//
// A5b (decision 1f): competitive or casual (members; a captain switches it
// before kickoff), balance teams (a pickup's booker, before sides lock) and
// player ratings (after confirmation; ratings show only as the server
// returns them).
//
// A6: Share, for a confirmed match with a score only (MatchShare hides
// itself otherwise): the result and man-of-the-match cards as PNGs.
//
// A10 (decision 1j): "Add your stats" opens the post-match flow, shown only
// while this player has a step left in it.
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckInSection } from '@/components/booking/check-in-panel';
import { BalanceTeams } from '@/components/match/balance-teams';
import { MatchCompetitive } from '@/components/match/match-competitive';
import { MatchLineup } from '@/components/match/match-lineup';
import { MatchMotm } from '@/components/match/match-motm';
import { MatchRatingsPanel } from '@/components/match/match-ratings';
import { MatchScorers } from '@/components/match/match-scorers';
import { MatchShare } from '@/components/match/match-share';
import { MatchPageSection } from '@/components/match/page-section';
import { MatchResultPanel } from '@/components/match/result-panel';
import { PostMatchOffers } from '@/components/offers/post-match-offers';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import { canBalanceTeams } from '@/lib/match/levels';
import { lineupEditable, playedMatch, sideOf, writerSides, type MatchPage } from '@/lib/match/page';
import { postMatchSteps } from '@/lib/match/post-match';
import { useFormationPresets, useMatchPage, useMatchRoster } from '@/lib/match/use-match-page';
import { captainSideOf } from '@/lib/match/result';
import { useMatchRatings } from '@/lib/match/use-levels';
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
  const ratings = useMatchRatings(matchId, pageData !== null && playedMatch(pageData));
  const presets = useFormationPresets(member && pageData && lineupEditable(pageData, now) ? pageData.playersPerSide : null);

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
  /** After balancing: the sides changed in the match, the page and the squad. */
  const reloadSides = useCallback(() => {
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
    const rated = pageData !== null && playedMatch(pageData);
    const hasSteps =
      match !== null &&
      postMatchSteps(
        {
          match,
          page: pageData,
          roster: roster.status === 'ready' ? roster.roster : null,
          ratings: ratings.status === 'ready' ? ratings.ratings : null,
          viewerId: result.viewerId,
          captainTeamIds,
        },
        now
      ).length > 0;

    content = (
      <View style={styles.stack}>
        <Text variant="callout" tone="inkMuted" tabular>
          {[formatMatchWhen(when), venueName].filter(Boolean).join(' · ')}
        </Text>
        {/* P6 check-in QR: members only; it hides itself outside the window. */}
        {match ? <CheckInSection matchId={match.match.id} /> : null}
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
        {match && hasSteps ? (
          <Button
            label="Add your stats"
            variant="secondary"
            onPress={() => router.push({ pathname: '/match/after-game', params: { id: match.match.id } })}
            fullWidth
            testID="match-add-stats"
          />
        ) : null}
        {pageData ? <MatchShare page={pageData} /> : null}
        {match ? (
          <MatchPageSection title="Competitive or casual" status="ready" onRetry={reload} testID="section-competitive">
            <MatchCompetitive
              match={match}
              captainSide={captainSideOf(match, result.viewerId, captainTeamIds)}
              onChanged={reload}
              now={now}
            />
          </MatchPageSection>
        ) : null}
        {match && canBalanceTeams(match, result.viewerId) ? (
          <MatchPageSection title="Balance teams" status="ready" onRetry={reload} testID="section-balance">
            <BalanceTeams
              matchId={match.match.id}
              labels={{ a: match.sides.a.label, b: match.sides.b.label }}
              onBalanced={reloadSides}
            />
          </MatchPageSection>
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
            {rated ? (
              <MatchPageSection
                title="Player ratings"
                status={ratings.status}
                onRetry={reloadRatings}
                errorMessage="Could not load the ratings."
                testID="section-ratings">
                {ratings.status === 'ready' ? (
                  <MatchRatingsPanel
                    matchId={pageData!.matchId}
                    ratings={ratings.ratings}
                    names={ratings.names}
                    kits={ratings.kits}
                    roster={rosterState}
                    onRetryRoster={reloadRoster}
                    viewerId={result.viewerId}
                    onRated={reloadRatings}
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
