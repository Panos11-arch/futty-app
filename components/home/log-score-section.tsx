// Home's "Log the score" (image 01): shown only while a game still needs
// something from the player. Each card carries its own title, so the section
// has no heading:
// - "Check the score" (levels like Playtomic, Panos 25 November): a pickup's
//   score the player can accept or reject (get_my_scores_to_check);
// - "Log the score" (S13B): a game with a match whose captain hasn't logged
//   it (get_my_matches_to_log); Log opens the after-game screens;
// - games recorded before A2 keep their old forms (a friendly, a league
//   fixture you captain, a plain booking you made), so none becomes
//   unscorable.
// Moved from app/(tabs)/index.tsx in S3; the rules are unchanged.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { BookingResultForm } from '@/components/booking-result-form';
import { FixtureScoreForm } from '@/components/fixture-score-form';
import { InlineError } from '@/components/home/inline-error';
import { useReloadOn } from '@/components/home/refresh';
import { CheckScoreCard } from '@/components/match/check-score-card';
import { LogScoreCard } from '@/components/match/log-score-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { dateKeyAndTimeToDate } from '@/lib/days';
import { canLogFixtureScore } from '@/lib/fixtures';
import { type FriendlyMatch, submitFriendlyScore } from '@/lib/friendly-matches';
import { describeLeagueError } from '@/lib/league-errors';
import { useMyMatchesToLog, useMyScoresToCheck } from '@/lib/match/use-match-log';
import { useMatchLinks } from '@/lib/match/use-match-result';
import { makeStyles } from '@/lib/theme';
import { useMyUnscoredBookings } from '@/lib/use-my-bookings';
import { useMyCaptainTeamIds, useMyFixtures } from '@/lib/use-fixtures';
import { useMyFriendlyMatches } from '@/lib/use-friendly-matches';
import { useVenues } from '@/lib/use-venues';

// No match duration is tracked anywhere (friendly_matches or league_fixtures)
// — assumed as a flat 2 hours so scoring can't happen before or during the
// game, matching supabase/scores.sql's server-side "too_early" check.
const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

// However many unscored plain bookings pile up, only this many show inline
// on Home — the rest sit behind "View all" (app/previous-games.tsx) so a run
// of forgotten games doesn't turn Home into a wall of forms.
const INLINE_UNSCORED_CAP = 2;

/** A friendly match only needs logging once its (assumed) end time has
 *  passed and no final score has been agreed yet. */
function isReadyToScore(match: FriendlyMatch) {
  if (match.status !== 'pending_score' || !match.post?.scheduled_at) return false;
  return new Date(match.post.scheduled_at).getTime() + MATCH_DURATION_MS < Date.now();
}

function FriendlyScoreForm({ match, onSubmitted }: { match: FriendlyMatch; onSubmitted: () => void }) {
  const styles = useStyles();
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const home = match.home_team?.name ?? 'Home team';
  const away = match.away_team?.name ?? 'Away team';

  async function submit() {
    if (homeScore.trim() === '' || awayScore.trim() === '' || busy) return;

    setBusy(true);
    setError(null);
    const { error: submitError } = await submitFriendlyScore(match.id, Number(homeScore), Number(awayScore));
    setBusy(false);

    if (submitError) {
      setError(describeLeagueError(submitError));
    } else {
      setHomeScore('');
      setAwayScore('');
      onSubmitted();
    }
  }

  return (
    <View style={styles.scoreForm}>
      <Text variant="headline">
        {home} vs {away}
      </Text>
      <View style={styles.scoreInputsRow}>
        <View style={styles.scoreInput}>
          <TextField label={home} value={homeScore} onChangeText={setHomeScore} placeholder="0" keyboardType="number-pad" />
        </View>
        <View style={styles.scoreInput}>
          <TextField label={away} value={awayScore} onChangeText={setAwayScore} placeholder="0" keyboardType="number-pad" />
        </View>
      </View>
      {error ? (
        <Text variant="callout" tone="danger">
          {error}
        </Text>
      ) : null}
      <Button
        label="Log score"
        onPress={submit}
        disabled={!homeScore.trim() || !awayScore.trim()}
        loading={busy}
        fullWidth
      />
    </View>
  );
}

/** Renders nothing when no game needs the player's score. */
export function LogScoreSection({ refreshSignal }: { refreshSignal: number }) {
  const styles = useStyles();
  const toCheck = useMyScoresToCheck();
  const venuesState = useVenues();
  const friendlyMatches = useMyFriendlyMatches();
  const fixtures = useMyFixtures();
  const myCaptainTeamIds = useMyCaptainTeamIds();
  const unscoredBookings = useMyUnscoredBookings();
  const toLog = useMyMatchesToLog();

  const reloadAll = () => {
    toCheck.reload();
    friendlyMatches.reload();
    fixtures.reload();
    unscoredBookings.reload();
    toLog.reload();
  };
  useFocusEffect(
    useCallback(() => {
      reloadAll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );
  useReloadOn(refreshSignal, reloadAll);

  function venueName(venueId: string) {
    return (venuesState.status === 'ready' ? venuesState.venues.find((v) => v.id === venueId)?.name : null) ?? 'Booked venue';
  }

  const oldFriendlies = friendlyMatches.status === 'ready' ? friendlyMatches.matches.filter(isReadyToScore) : [];
  const oldFixtures =
    fixtures.status === 'ready' ? fixtures.fixtures.filter((f) => canLogFixtureScore(f, myCaptainTeamIds)) : [];
  // Every refocus reloads the past bookings, which go back to loading for a
  // moment; asking with the last ids meanwhile keeps the match links (and
  // Home) from flipping to [] and back on each return to Home.
  const lastBookingIds = useRef<string[]>([]);
  if (unscoredBookings.status === 'ready') lastBookingIds.current = unscoredBookings.bookings.map((b) => b.id);
  else if (unscoredBookings.status === 'error') lastBookingIds.current = [];
  const matchLinks = useMatchLinks({
    bookingIds: lastBookingIds.current,
    friendlyMatchIds: oldFriendlies.map((m) => m.id),
    leagueFixtureIds: oldFixtures.map((f) => f.id),
  });
  // Until we know which games have a match, show no old form: a game with a
  // match must never be scored the old way.
  const linksReady = matchLinks.status === 'ready';
  const readyToScore = linksReady ? oldFriendlies.filter((m) => !matchLinks.links.byFriendlyMatchId.has(m.id)) : [];
  const readyToScoreFixtures = linksReady
    ? oldFixtures.filter((f) => !matchLinks.links.byLeagueFixtureId.has(f.id))
    : [];
  const resultMatches = toLog.status === 'ready' ? toLog.matches : [];

  // A booking later turned into a "Need opposition" post that got matched
  // already has a friendly_matches row for the same game — show only that
  // (it has the two-sided scoring), not also this booking's own plain log.
  // Matched by the post's venue_booking_id; venue+time is a fallback for
  // posts created before that column existed.
  const linkedBookingIds = new Set(
    friendlyMatches.status === 'ready'
      ? friendlyMatches.matches.map((m) => m.post?.venue_booking_id).filter((id): id is string => !!id)
      : []
  );
  const friendlyMatchSlots = new Set(
    friendlyMatches.status === 'ready'
      ? friendlyMatches.matches
          .filter((m) => !m.post?.venue_booking_id && m.post?.venue?.id && m.post?.scheduled_at)
          .map((m) => `${m.post!.venue!.id}|${new Date(m.post!.scheduled_at).getTime()}`)
      : []
  );
  const unscored = (
    unscoredBookings.status === 'ready' && linksReady
      ? unscoredBookings.bookings.filter(
          (booking) =>
            !matchLinks.links.byBookingId.has(booking.id) &&
            !linkedBookingIds.has(booking.id) &&
            !friendlyMatchSlots.has(
              `${booking.venue_id}|${dateKeyAndTimeToDate(booking.booking_day, booking.start_time).getTime()}`
            )
        )
      : []
  ).sort(
    (a, b) =>
      dateKeyAndTimeToDate(b.booking_day, b.start_time).getTime() -
      dateKeyAndTimeToDate(a.booking_day, a.start_time).getTime()
  );
  const visibleUnscored = unscored.slice(0, INLINE_UNSCORED_CAP);
  const hiddenUnscoredCount = unscored.length - visibleUnscored.length;

  const toCheckScores = toCheck.status === 'ready' ? toCheck.scores : [];
  const errors = [
    toCheck.status === 'error'
      ? { key: 'check', message: 'Could not load the scores to check.', retry: toCheck.reload }
      : null,
    friendlyMatches.status === 'error' ? { key: 'friendly', message: 'Could not load friendly matches.', retry: friendlyMatches.reload } : null,
    fixtures.status === 'error' ? { key: 'fixtures', message: 'Could not load fixtures.', retry: fixtures.reload } : null,
    unscoredBookings.status === 'error'
      ? { key: 'unscored', message: 'Could not load past bookings.', retry: unscoredBookings.reload }
      : null,
    toLog.status === 'error'
      ? { key: 'results', message: 'Could not load your games waiting for a score.', retry: toLog.reload }
      : null,
    matchLinks.status === 'error'
      ? { key: 'links', message: 'Could not check which games have a match record.', retry: matchLinks.reload }
      : null,
  ].filter((e) => e !== null);

  const hasOldForms = readyToScore.length > 0 || readyToScoreFixtures.length > 0 || unscored.length > 0;
  if (errors.length === 0 && toCheckScores.length === 0 && resultMatches.length === 0 && !hasOldForms) return null;

  return (
    <View testID="home-log-score-section" style={styles.section}>
      {errors.map((e) => (
        <InlineError key={e.key} message={e.message} onRetry={e.retry} />
      ))}
      {toCheckScores.map((score) => (
        <CheckScoreCard key={score.matchId} score={score} onAnswered={toCheck.reload} />
      ))}
      {resultMatches.map((match) => (
        <LogScoreCard key={match.matchId} match={match} />
      ))}
      {hasOldForms ? (
        <Card style={styles.cardStack}>
          <Text variant="headline" accessibilityRole="header">
            Log the score
          </Text>
          {readyToScore.map((match) => (
            <FriendlyScoreForm key={match.id} match={match} onSubmitted={friendlyMatches.reload} />
          ))}
          {readyToScoreFixtures.map((fixture) => (
            <FixtureScoreForm key={fixture.id} fixture={fixture} onSubmitted={fixtures.reload} />
          ))}
          {visibleUnscored.map((booking) => (
            <BookingResultForm
              key={booking.id}
              booking={booking}
              venueName={venueName(booking.venue_id)}
              // Also covers a cancel, not just a logged score
              // (BookingResultForm uses this callback for both).
              onSubmitted={unscoredBookings.reload}
            />
          ))}
          {hiddenUnscoredCount > 0 ? (
            <Button
              label={`View all ${unscored.length} pending`}
              variant="plain"
              onPress={() => router.push('/previous-games')}
            />
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  section: { gap: space.md },
  cardStack: { gap: space.lg },
  scoreForm: { gap: space.sm },
  scoreInputsRow: { flexDirection: 'row', gap: space.md },
  scoreInput: { flex: 1 },
}));
