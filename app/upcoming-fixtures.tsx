import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError } from '@/components/auth-form';
import { FixtureScoreForm } from '@/components/fixture-score-form';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { FuttyColors } from '@/constants/futty-theme';
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
    <View>
      <AuthButton
        label="Resolve outcome — no agreed date this week"
        variant="secondary"
        onPress={resolve}
        busy={busy}
      />
      {error ? <AuthError>{error}</AuthError> : null}
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
    <View style={styles.fixtureRow}>
      <ThemedText type="defaultSemiBold">
        {fixture.home_team?.name ?? 'Unknown team'} vs {fixture.away_team?.name ?? 'Unknown team'}
      </ThemedText>
      <ThemedText style={styles.note}>{statusLabel}</ThemedText>
      {fixture.score_locked ? (
        <IconLabel icon="lock.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
          Captains couldn&apos;t agree a score after 3 tries — locked.
        </IconLabel>
      ) : null}
      {canLogScore ? <FixtureScoreForm fixture={fixture} onSubmitted={onChanged} /> : null}
      {needsAction ? (
        <AuthButton
          label="Go to matchmaking"
          variant="secondary"
          onPress={() => router.push('/matchmaking')}
          compact
        />
      ) : null}
      {canResolve ? <ResolveOutcomeButton fixtureId={fixture.id} onChanged={onChanged} /> : null}
      {isCaptain ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/fixture-chat', params: { fixtureId: fixture.id } })}>
          <IconLabel icon="bubble.left.fill" type="link" iconColor={FuttyColors.emerald700}>
            Message the other captain
          </IconLabel>
        </Pressable>
      ) : null}
    </View>
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
      {fixtures.status === 'loading' ? <ActivityIndicator /> : null}
      {fixtures.status === 'error' ? (
        <ThemedText style={styles.note}>Could not load fixtures: {fixtures.message}</ThemedText>
      ) : null}
      {fixtures.status === 'ready' && upcoming.length === 0 ? (
        <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
          No upcoming fixtures — these fill in once your team is registered in a league with
          opponents.
        </IconLabel>
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
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <UpcomingFixturesList />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  list: {
    gap: 10,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  fixtureRow: {
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
});
