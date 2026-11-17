import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FixtureScoreEntry } from '@/components/match/fixture-score-entry';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import {
  canLogFixtureScore,
  FIXTURE_SCHEDULING_WINDOW_DAYS,
  formatFixtureWhen,
  resolveUnscheduledFixture,
  type Fixture,
} from '@/lib/fixtures';
import { describeLeagueError } from '@/lib/league-errors';
import { useMyCaptainTeamIds, useMyFixtures } from '@/lib/use-fixtures';

const RESOLVE_WINDOW_MS = FIXTURE_SCHEDULING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function ResolveOutcomeButton({ fixtureId, onChanged }: { fixtureId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setError(null);
    const { error: resolveError } = await resolveUnscheduledFixture(fixtureId);
    setBusy(false);
    if (resolveError) setError(describeLeagueError(resolveError));
    else onChanged();
  }

  return (
    <View style={styles.stack}>
      <Button
        label="Resolve outcome — no agreed date this week"
        variant="secondary"
        onPress={resolve}
        loading={busy}
      />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function FixtureRow({
  fixture,
  myCaptainTeamIds,
  onChanged,
}: {
  fixture: Fixture;
  myCaptainTeamIds: Set<string>;
  onChanged: () => void;
}) {
  const isCaptain = myCaptainTeamIds.has(fixture.home_team_id) || myCaptainTeamIds.has(fixture.away_team_id);
  const when = formatFixtureWhen(fixture);

  const statusLabel =
    fixture.status === 'agreed' || fixture.status === 'completed'
      ? `${when ?? 'Date tbc'} · ${fixture.venue?.name ?? 'pitch tbc'}`
      : fixture.status === 'proposed'
        ? 'Proposed — awaiting agreement between captains'
        : 'Not yet scheduled';

  const canLogScore = canLogFixtureScore(fixture, myCaptainTeamIds);

  const canResolve =
    isCaptain &&
    (fixture.status === 'unscheduled' || fixture.status === 'proposed') &&
    Date.now() > new Date(fixture.created_at).getTime() + RESOLVE_WINDOW_MS;

  // A captain can't do anything with an unscheduled/proposed fixture from
  // this read-only list — actually proposing or agreeing a date only happens
  // in Matchmaking (app/matchmaking.tsx), which already lists every fixture
  // of theirs that needsScheduling(). Without this link, "Not yet scheduled"
  // reads as a dead end even though the real next step is one tab away.
  const needsAction = isCaptain && (fixture.status === 'unscheduled' || fixture.status === 'proposed');

  return (
    <Card testID="fixture-card" style={styles.stack}>
      <Text variant="headline">
        {fixture.home_team?.name ?? 'Unknown team'} vs {fixture.away_team?.name ?? 'Unknown team'}
      </Text>
      <Text variant="callout" tone="inkMuted" tabular>
        {statusLabel}
      </Text>
      {fixture.score_locked ? (
        <View style={styles.iconRow}>
          <IconSymbol name="lock.fill" size={ICON.small} color={colors.inkMuted} />
          <Text variant="callout" tone="inkMuted" style={styles.flex}>
            Captains couldn&apos;t agree a score after 3 tries — locked.
          </Text>
        </View>
      ) : null}
      {canLogScore ? <FixtureScoreEntry fixture={fixture} onSubmitted={onChanged} /> : null}
      {needsAction ? (
        <Button label="Go to matchmaking" variant="secondary" onPress={() => router.push('/matchmaking')} />
      ) : null}
      {canResolve ? <ResolveOutcomeButton fixtureId={fixture.id} onChanged={onChanged} /> : null}
      {isCaptain ? (
        <Button
          label="Message the other captain"
          variant="plain"
          onPress={() => router.push({ pathname: '/fixture-chat', params: { fixtureId: fixture.id } })}
        />
      ) : null}
    </Card>
  );
}

/** Your league fixtures still to play. No scrolling of its own: the screen
 *  below and Play's Matches segment (app/(tabs)/play.tsx) each wrap it. */
export function UpcomingFixturesList() {
  const fixtures = useMyFixtures();
  const myCaptainTeamIds = useMyCaptainTeamIds();

  // See app/(tabs)/leagues.tsx's FixturesSection for why this is needed —
  // this screen can be pushed on top of Matchmaking's stack too, so it can
  // stay mounted underneath and miss a date agreed there.
  useFocusEffect(
    useCallback(() => {
      fixtures.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // Completed fixtures aren't "upcoming" — a fixture still needing its score
  // logged stays status 'agreed' until both sides confirm, so it's unaffected.
  const upcoming = fixtures.status === 'ready' ? fixtures.fixtures.filter((f) => f.status !== 'completed') : [];

  return (
    <View style={styles.list}>
      {fixtures.status === 'loading' ? (
        <Card testID="upcoming-fixtures-skeleton">
          <SkeletonText lines={3} />
        </Card>
      ) : null}
      {fixtures.status === 'error' ? (
        <Banner
          tone="danger"
          message={`Could not load fixtures: ${fixtures.message}`}
          action={{ label: 'Try again', onPress: fixtures.reload }}
        />
      ) : null}
      {fixtures.status === 'ready' && upcoming.length === 0 ? (
        <EmptyState
          icon="calendar"
          message="No upcoming fixtures — these fill in once your team is registered in a league with opponents."
        />
      ) : null}
      {upcoming.map((fixture) => (
        <FixtureRow
          key={fixture.id}
          fixture={fixture}
          myCaptainTeamIds={myCaptainTeamIds}
          onChanged={fixtures.reload}
        />
      ))}
    </View>
  );
}

export default function UpcomingFixturesScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <UpcomingFixturesList />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl },
  list: { gap: space.md },
  stack: { gap: space.sm },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
