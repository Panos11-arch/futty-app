import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { bookingWhen, NextBookingCard } from '@/components/booking/next-game-card';
import { NoOpponentChoices } from '@/components/booking/no-opponent-choices';
import { BookingResultForm } from '@/components/booking-result-form';
import { FixtureScoreForm } from '@/components/fixture-score-form';
import { CheckScoreCard } from '@/components/match/check-score-card';
import { LogScoreCard } from '@/components/match/log-score-card';
import { TeamOfTheWeekHome } from '@/components/match/team-of-the-week-home';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { dateKeyAndTimeToDate } from '@/lib/days';
import { canLogFixtureScore } from '@/lib/fixtures';
import { type FriendlyMatch, submitFriendlyScore } from '@/lib/friendly-matches';
import { describeLeagueError } from '@/lib/league-errors';
import { formatMatchDate, formatMatchWhen } from '@/lib/match/format';
import { isPremiumPlayer, TEAM_PREMIUM_ENABLED } from '@/lib/premium';
import { useStartingLevelOffer } from '@/lib/match/use-levels';
import { useMyMatchesToLog, useMyScoresToCheck } from '@/lib/match/use-match-log';
import { useMatchLinks } from '@/lib/match/use-match-result';
import { useMyBookings, useMyUnscoredBookings } from '@/lib/use-my-bookings';
import { useMyCaptainTeamIds, useMyFixtures } from '@/lib/use-fixtures';
import { useMyFriendlyMatches } from '@/lib/use-friendly-matches';
import { debtBlockMessage, type Owed, owedBannerMessage, owedToName, useOwed, useReloadOnReturn } from '@/lib/use-owed';
import { useProfile } from '@/lib/use-profile';
import { type RecentResult, useRecentResults } from '@/lib/use-recent-results';
import { useSquadPosts } from '@/lib/use-squad-posts';
import { useVenues } from '@/lib/use-venues';

// No match duration is tracked anywhere (friendly_matches or league_fixtures)
// — assumed as a flat 2 hours so scoring can't happen before or during the
// game, matching supabase/scores.sql's server-side "too_early" check.
const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

// However many unscored plain bookings pile up, only this many show inline
// on Home — the rest sit behind "View all" (app/previous-games.tsx) so a run
// of forgotten games doesn't turn Home into a wall of forms.
const INLINE_UNSCORED_CAP = 2;

/** Bookings after the next one shown as rows ("Also booked"). */
const MORE_BOOKINGS = 2;
const VENUES_SHOWN = 5;
const POSTS_SHOWN = 5;

const openBook = () => router.push('/book');
const openFindGame = () => router.push({ pathname: '/squads', params: { view: 'players' } });
const openMyBookings = () => router.push('/my-bookings');

/** A friendly match only needs logging once its (assumed) end time has
 *  passed and no final score has been agreed yet. */
function isReadyToScore(match: FriendlyMatch) {
  if (match.status !== 'pending_score' || !match.post?.scheduled_at) return false;
  return new Date(match.post.scheduled_at).getTime() + MATCH_DURATION_MS < Date.now();
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Banner tone="danger" message={message} action={{ label: 'Try again', onPress: onRetry }} />;
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

function NextGameSection() {
  const styles = useStyles();
  const myBookings = useMyBookings();
  const venuesState = useVenues();

  // Home stays mounted in the background while you cancel a booking on My
  // bookings — without this, its own useMyBookings state never learns the
  // cancellation happened until some other reload.
  useFocusEffect(
    useCallback(() => {
      myBookings.reload();
      // Only re-run when the screen refocuses, not on every state change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  function venueFor(venueId: string) {
    const venue = venuesState.status === 'ready' ? venuesState.venues.find((v) => v.id === venueId) : null;
    return venue ? { name: venue.name, city: venue.city } : null;
  }

  if (myBookings.status === 'loading') {
    return (
      <View testID="next-game-skeleton" style={styles.cards}>
        <SkeletonBlock width="100%" height={180} />
        <SkeletonText lines={2} />
      </View>
    );
  }

  if (myBookings.status === 'error') {
    return <InlineError message="Could not load your bookings." onRetry={myBookings.reload} />;
  }

  const [next, ...rest] = myBookings.bookings;
  if (!next) {
    return (
      <Card>
        <EmptyState icon="calendar" message="No games booked" action={{ label: 'Book a pitch', onPress: openBook }} />
      </Card>
    );
  }

  const more = rest.slice(0, MORE_BOOKINGS);
  return (
    <View style={styles.cards}>
      <NextBookingCard booking={next} venue={venueFor(next.venue_id)} onPress={openMyBookings} />
      {more.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Also booked" />
          <Card padded={false}>
            {more.map((booking) => (
              <ListRow
                key={booking.id}
                title={venueFor(booking.venue_id)?.name ?? 'Booked venue'}
                subtitle={bookingWhen(booking)}
                leading={{ icon: 'calendar' }}
                chevron
                onPress={openMyBookings}
              />
            ))}
          </Card>
        </View>
      ) : null}
    </View>
  );
}

function QuickActions() {
  const styles = useStyles();
  return (
    <View style={styles.quickActions}>
      <View style={styles.quickAction}>
        <Button testID="tab-book" label="Book a pitch" onPress={openBook} fullWidth />
      </View>
      <View style={styles.quickAction}>
        <Button label="Find a game" variant="secondary" onPress={openFindGame} fullWidth />
      </View>
    </View>
  );
}

/** "Check the score" (levels like Playtomic, Panos 25 November): a pickup's
 *  score the viewer can accept or reject, because they played on the side
 *  the booker isn't on. The server decides which cards show. */
function CheckScoreSection() {
  const styles = useStyles();
  const toCheck = useMyScoresToCheck();

  useFocusEffect(
    useCallback(() => {
      toCheck.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (toCheck.status === 'error') {
    return (
      <View style={styles.section}>
        <SectionHeader title="Check the score" />
        <InlineError message="Could not load the scores to check." onRetry={toCheck.reload} />
      </View>
    );
  }
  if (toCheck.status !== 'ready' || toCheck.scores.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Check the score" />
      {toCheck.scores.map((score) => (
        <CheckScoreCard key={score.matchId} score={score} onAnswered={toCheck.reload} />
      ))}
    </View>
  );
}

/** Score forms for games that have ended. A game with a match (made since
 *  A2) is logged by its captain on the after-game screens (S13B: "Log the
 *  score", get_my_matches_to_log); games recorded before A2 keep the old
 *  forms: a friendly match, a league fixture you captain, or a plain booking
 *  you made. */
function LogScoreSection({ onScored }: { onScored: () => void }) {
  const styles = useStyles();
  const venuesState = useVenues();
  const friendlyMatches = useMyFriendlyMatches();
  const fixtures = useMyFixtures();
  const myCaptainTeamIds = useMyCaptainTeamIds();
  const unscoredBookings = useMyUnscoredBookings();
  const toLog = useMyMatchesToLog();

  useFocusEffect(
    useCallback(() => {
      friendlyMatches.reload();
      fixtures.reload();
      unscoredBookings.reload();
      toLog.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

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

  const errors = [
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
  const hasForms = resultMatches.length > 0 || hasOldForms;
  if (!hasForms && errors.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Log a score" />
      {errors.map((e) => (
        <InlineError key={e.key} message={e.message} onRetry={e.retry} />
      ))}
      {resultMatches.map((match) => (
        <LogScoreCard key={match.matchId} match={match} />
      ))}
      {hasOldForms ? (
        <Card style={styles.cardStack}>
          {readyToScore.map((match) => (
            <FriendlyScoreForm
              key={match.id}
              match={match}
              onSubmitted={() => {
                friendlyMatches.reload();
                onScored();
              }}
            />
          ))}
          {readyToScoreFixtures.map((fixture) => (
            <FixtureScoreForm
              key={fixture.id}
              fixture={fixture}
              onSubmitted={() => {
                fixtures.reload();
                onScored();
              }}
            />
          ))}
          {visibleUnscored.map((booking) => (
            <BookingResultForm
              key={booking.id}
              booking={booking}
              venueName={venueName(booking.venue_id)}
              onSubmitted={() => {
                // Also covers a cancel, not just a logged score
                // (BookingResultForm uses this callback for both).
                unscoredBookings.reload();
                onScored();
              }}
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

/** Shows once a score is confirmed — a plain booking's self-reported result,
 *  or both sides agreeing on a friendly match / league fixture — all three
 *  feed this via lib/use-recent-results.ts. The hook lives in HomeScreen:
 *  logging a score in LogScoreSection must refresh this card at once, and
 *  only a shared parent can reload it. */
function RecentResultsSection({ recentResults }: { recentResults: ReturnType<typeof useRecentResults> }) {
  const styles = useStyles();
  const results = recentResults.status === 'ready' ? recentResults.results : [];
  // A10 (match-record.md decision 1j): a game that has a match offers the post-match flow.
  const matchLinks = useMatchLinks({
    bookingIds: results.flatMap((r) => (r.bookingId ? [r.bookingId] : [])),
    friendlyMatchIds: results.flatMap((r) => (r.friendlyMatchId ? [r.friendlyMatchId] : [])),
    leagueFixtureIds: results.flatMap((r) => (r.leagueFixtureId ? [r.leagueFixtureId] : [])),
  });
  const matchIdOf = (r: RecentResult) =>
    (r.bookingId && matchLinks.links.byBookingId.get(r.bookingId)) ||
    (r.friendlyMatchId && matchLinks.links.byFriendlyMatchId.get(r.friendlyMatchId)) ||
    (r.leagueFixtureId && matchLinks.links.byLeagueFixtureId.get(r.leagueFixtureId)) ||
    null;

  if (recentResults.status === 'error') {
    return (
      <View style={styles.section}>
        <SectionHeader title="Previous game" />
        <InlineError message="Could not load your results." onRetry={recentResults.reload} />
      </View>
    );
  }

  if (results.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Previous game" action={{ label: 'See all', onPress: () => router.push('/previous-games') }} />
      <Card padded={false}>
        {results.map((result) => {
          const kind = result.kind === 'league' ? 'League' : result.kind === 'friendly' ? 'Friendly' : 'Pickup game';
          const matchId = matchIdOf(result);
          return (
            <ListRow
              key={result.key}
              title={
                result.kind === 'booking'
                  ? `You ${result.homeScore}–${result.awayScore}`
                  : `${result.homeTeamName} ${result.homeScore}–${result.awayScore} ${result.awayTeamName}`
              }
              subtitle={result.playedAt ? `${kind} · ${formatMatchDate(result.playedAt)}` : kind}
              leading={{ icon: 'trophy.fill' }}
              trailing={
                matchId ? (
                  <Button
                    label="Add your stats"
                    variant="plain"
                    onPress={() => router.push({ pathname: '/match/after-game', params: { id: matchId } })}
                    testID={`previous-game-stats-${result.key}`}
                  />
                ) : undefined
              }
            />
          );
        })}
      </Card>
    </View>
  );
}

/** Live venues as rows. Becomes VenueCards (photo, price per player, next free
 *  times) once the server returns a per-player price and photos (P5/P9): the
 *  app never works a price out itself. */
function VenuesSection() {
  const styles = useStyles();
  const venuesState = useVenues();

  if (venuesState.status === 'loading') {
    return (
      <View style={styles.section}>
        <SectionHeader title="Venues" />
        <SkeletonText lines={3} />
      </View>
    );
  }

  if (venuesState.status === 'error') {
    return (
      <View style={styles.section}>
        <SectionHeader title="Venues" />
        <InlineError message="Could not load venues." onRetry={venuesState.reload} />
      </View>
    );
  }

  const venues = venuesState.venues.filter((v) => v.is_live).slice(0, VENUES_SHOWN);
  if (venues.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Venues" action={{ label: 'See all', onPress: openBook }} />
      <Card padded={false}>
        {venues.map((venue) => (
          <ListRow
            key={venue.id}
            title={venue.name}
            subtitle={venue.city}
            leading={{ avatar: { name: venue.name } }}
            chevron
            onPress={openBook}
          />
        ))}
      </Card>
    </View>
  );
}

function NeedPlayersSection() {
  const styles = useStyles();
  const posts = useSquadPosts('players');

  useFocusEffect(
    useCallback(() => {
      posts.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  let content;
  if (posts.status === 'loading') {
    content = <SkeletonText lines={3} />;
  } else if (posts.status === 'error') {
    content = <InlineError message="Could not load games looking for players." onRetry={posts.reload} />;
  } else {
    const open = posts.posts
      .filter((p) => p.status === 'open' && (p.players_needed == null || p.joined_count < p.players_needed))
      .slice(0, POSTS_SHOWN);
    content =
      open.length === 0 ? (
        <Card>
          <EmptyState icon="person.2.fill" message="No games need players right now" action={{ label: 'Find a game', onPress: openFindGame }} />
        </Card>
      ) : (
        <Card padded={false}>
          {open.map((post) => {
            const level = post.level_needed ?? post.level;
            const when = formatMatchWhen(post.scheduled_at);
            return (
              <ListRow
                key={post.id}
                title={post.venue_name}
                subtitle={level ? `${level} · ${when}` : when}
                leading={{ icon: 'person.2.fill' }}
                chevron
                onPress={() => router.push({ pathname: '/join-squad-post', params: { postId: post.id } })}
              />
            );
          })}
        </Card>
      );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Need players" action={{ label: 'See all', onPress: openFindGame }} />
      {content}
    </View>
  );
}

function PremiumSection() {
  const profile = useProfile();
  const isPremium = isPremiumPlayer(profile) === true;

  return (
    <Card padded={false}>
      <ListRow
        title={isPremium ? "You're on Premium" : 'Go Futty Premium'}
        subtitle={isPremium ? 'Manage your plan' : 'Book further ahead, no fee on your own spot'}
        leading={{ icon: 'star.fill' }}
        chevron
        onPress={() => router.push('/account/premium')}
      />
      {/* Team Premium is off for the release (lib/premium.ts). */}
      {TEAM_PREMIUM_ENABLED ? (
        <ListRow
          title="Team Premium"
          subtitle="Unlock 9-a-side and 11-a-side leagues for your team"
          leading={{ icon: 'shield.fill' }}
          chevron
          onPress={() => router.push('/team')}
        />
      ) : null}
    </Card>
  );
}

const openPayOwed = () => router.push('/account/payments/owed');

/** Who the banner's money is owed to, picked from my_owed's own fields: the
 *  one venue (or Futty) every debt is owed to, else none; without a debt,
 *  the venue of the payment the sentence is about. */
function owedBannerTitle(owed: Owed): string | undefined {
  if (debtBlockMessage(owed)) {
    const names = new Set(owed.debts.map(owedToName));
    return names.size === 1 ? [...names][0] : undefined;
  }
  return owed.payments[0]?.venue_name;
}

/** Anything owed (debt, a failed guarantee, an unpaid spot, unticked cash),
 *  as one banner in Book's words (contract 6). Loading or an error shows
 *  nothing: Home is never blocked by it. Checks again on return, e.g. from
 *  "Pay what I owe". */
function OwedBanner() {
  const owed = useOwed();
  useReloadOnReturn(owed.reload);

  if (owed.state.status !== 'ready') return null;
  const message = owedBannerMessage(owed.state.data);
  if (!message) return null;

  return (
    <View testID="owed-banner">
      <Banner
        tone="danger"
        title={owedBannerTitle(owed.state.data)}
        message={message}
        action={{ label: 'Pay what I owe', onPress: openPayOwed }}
      />
    </View>
  );
}

export default function HomeScreen() {
  const styles = useStyles();
  const recentResults = useRecentResults();
  // A5b: the five starting-level questions, once per device, after sign-up.
  useStartingLevelOffer();

  // Refetch whenever Home regains focus (e.g. back from Book or from
  // app/previous-games.tsx). LogScoreSection also reloads it the instant a
  // score is logged.
  useFocusEffect(
    useCallback(() => {
      recentResults.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  return (
    <View testID="home-screen" style={styles.screen}>
      {/* The quick actions come first: nothing that loads sits above them, so
          they never move under a finger (a moved Pressable drops the tap). */}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <QuickActions />
        <OwedBanner />
        {/* B3: a half pitch still without an opponent: the captain's choice. */}
        <NoOpponentChoices />
        <NextGameSection />
        <CheckScoreSection />
        <LogScoreSection onScored={recentResults.reload} />
        <RecentResultsSection recentResults={recentResults} />
        <TeamOfTheWeekHome />
        <VenuesSection />
        <NeedPlayersSection />
        <PremiumSection />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  section: { gap: space.md },
  cards: { gap: space.md },
  cardStack: { gap: space.lg },
  quickActions: { flexDirection: 'row', gap: space.md },
  quickAction: { flex: 1 },
  scoreForm: { gap: space.sm },
  scoreInputsRow: { flexDirection: 'row', gap: space.md },
  scoreInput: { flex: 1 },
}));
