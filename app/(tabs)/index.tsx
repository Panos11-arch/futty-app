import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { BookingResultForm } from '@/components/booking-result-form';
import { FixtureScoreForm } from '@/components/fixture-score-form';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { dateKeyAndTimeToDate, dateKeyToDate, dayLabel } from '@/lib/days';
import { canLogFixtureScore } from '@/lib/fixtures';
import { type FriendlyMatch, submitFriendlyScore } from '@/lib/friendly-matches';
import { describeLeagueError } from '@/lib/league-errors';
import { useMyBookings, useMyUnscoredBookings } from '@/lib/use-my-bookings';
import { useMyCaptainTeamIds, useMyFixtures } from '@/lib/use-fixtures';
import { useMyFriendlyMatches } from '@/lib/use-friendly-matches';
import { useNotifications } from '@/lib/use-notifications';
import { useRecentResults } from '@/lib/use-recent-results';
import { useProfile } from '@/lib/use-profile';
import { useVenues } from '@/lib/use-venues';

// No match duration is tracked anywhere (friendly_matches or league_fixtures)
// — assumed as a flat 2 hours so scoring can't happen before or during the
// game, matching supabase/scores.sql's server-side "too_early" check.
const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

// A different accent color per action, Playtomic-style — makes the row easy
// to scan at a glance instead of four identical green circles.
const QUICK_ACTIONS = [
  {
    icon: 'calendar' as const,
    label: 'Book',
    color: FuttyColors.emerald700,
    onPress: () => router.push('/book'),
  },
  {
    icon: 'person.2.fill' as const,
    label: 'Players',
    color: FuttyColors.sky500,
    onPress: () => router.push({ pathname: '/squads', params: { view: 'players' } }),
  },
  {
    icon: 'flag.fill' as const,
    label: 'Match',
    color: FuttyColors.coral500,
    onPress: () => router.push({ pathname: '/squads', params: { view: 'opposition' } }),
  },
  {
    icon: 'trophy.fill' as const,
    label: 'League',
    color: FuttyColors.violet500,
    onPress: () => router.push('/leagues'),
  },
];

/** A friendly match only needs logging once its (assumed) end time has
 *  passed and no final score has been agreed yet. */
function isReadyToScore(match: FriendlyMatch) {
  if (match.status !== 'pending_score' || !match.post?.scheduled_at) return false;
  return new Date(match.post.scheduled_at).getTime() + MATCH_DURATION_MS < Date.now();
}

function FriendlyScoreForm({ match, onSubmitted }: { match: FriendlyMatch; onSubmitted: () => void }) {
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (homeScore.trim() === '' || awayScore.trim() === '' || busy) return;

    setBusy(true);
    setError(null);
    const { error: submitError } = await submitFriendlyScore(
      match.id,
      Number(homeScore),
      Number(awayScore)
    );
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
      <Text style={styles.scoreFormTitle}>
        {match.home_team?.name ?? 'Team'} vs {match.away_team?.name ?? 'Team'}
      </Text>
      <View style={styles.scoreInputsRow}>
        <AuthField
          value={homeScore}
          onChangeText={setHomeScore}
          placeholder="0"
          keyboardType="number-pad"
          style={styles.scoreInput}
        />
        <Text style={styles.scoreDash}>–</Text>
        <AuthField
          value={awayScore}
          onChangeText={setAwayScore}
          placeholder="0"
          keyboardType="number-pad"
          style={styles.scoreInput}
        />
        <AuthButton
          label="Log score"
          onPress={submit}
          disabled={!homeScore.trim() || !awayScore.trim()}
          busy={busy}
        />
      </View>
      {error ? <AuthError>{error}</AuthError> : null}
    </View>
  );
}

// However many unscored plain bookings pile up, only this many show inline
// on the home card — the rest sit behind "View all" (app/previous-games.tsx)
// so a run of forgotten games doesn't turn the card into a wall of forms.
const INLINE_UNSCORED_CAP = 2;

function NextGameCard({ onScored }: { onScored: () => void }) {
  const myBookings = useMyBookings();
  const venuesState = useVenues();
  const friendlyMatches = useMyFriendlyMatches();
  const fixtures = useMyFixtures();
  const myCaptainTeamIds = useMyCaptainTeamIds();
  const unscoredBookings = useMyUnscoredBookings();

  // Home stays mounted in the background while you cancel a booking on the
  // separate "Your bookings" screen — without this, its own useMyBookings
  // state never learns the cancellation happened until some other reload.
  useFocusEffect(
    useCallback(() => {
      myBookings.reload();
      friendlyMatches.reload();
      fixtures.reload();
      unscoredBookings.reload();
      // Only re-run when the screen refocuses, not on every state change —
      // reload/refetch would otherwise re-trigger this same effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // Was just the single soonest booking (bookings[0]) — showing a short list
  // instead means a 2nd booking you just made is directly visible here
  // rather than trusting a one-line summary to have picked the right one.
  const upcoming = myBookings.status === 'ready' ? myBookings.bookings.slice(0, 3) : [];

  function venueFor(venueId: string) {
    return venuesState.status === 'ready' ? venuesState.venues.find((v) => v.id === venueId) : null;
  }

  const readyToScore =
    friendlyMatches.status === 'ready' ? friendlyMatches.matches.filter(isReadyToScore) : [];
  const readyToScoreFixtures =
    fixtures.status === 'ready' ? fixtures.fixtures.filter((f) => canLogFixtureScore(f, myCaptainTeamIds)) : [];

  // A booking that was later turned into a "Need opposition" post and got
  // matched already has a friendly_matches row for the exact same game — show
  // only that (it has the real two-sided scoring + dispute mechanic), not
  // also this booking's own plain self-reported log, or the same game's
  // score prompt would appear twice. Matched primarily via the post's
  // venue_booking_id (exact); venue+time is kept only as a fallback for any
  // post created before that column existed, since its scheduled_at may
  // predate booking-actions.sql's timezone fix and no longer line up with a
  // freshly recomputed instant.
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
    unscoredBookings.status === 'ready'
      ? unscoredBookings.bookings.filter(
          (booking) =>
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

  return (
    <View style={styles.nextGameCard}>
      <View style={styles.cardTitleRow}>
        <IconSymbol name="sportscourt.fill" size={14} color={FuttyColors.emerald950} />
        <Text style={styles.cardTitleInRow}>Your next games</Text>
      </View>
      {myBookings.status === 'loading' ? (
        <Text style={styles.cardBody}>Loading…</Text>
      ) : upcoming.length === 0 ? (
        <View style={styles.cardTitleRow}>
          <IconSymbol name="magnifyingglass" size={12} color={FuttyColors.stone400} />
          <Text style={styles.cardEmpty}>No games booked yet.</Text>
        </View>
      ) : (
        <View style={styles.upcomingList}>
          {upcoming.map((booking, index) => {
            const bookingVenue = venueFor(booking.venue_id);
            return (
              <View key={booking.id} style={index > 0 ? styles.upcomingRow : undefined}>
                <Text style={styles.nextGameVenue}>{bookingVenue?.name ?? 'Booked venue'}</Text>
                <Text style={styles.cardBody}>
                  {bookingVenue?.city ? `${bookingVenue.city} · ` : ''}
                  {dayLabel(dateKeyToDate(booking.booking_day))} · {booking.start_time.slice(0, 5)}–
                  {booking.end_time.slice(0, 5)} · {booking.format}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {friendlyMatches.status === 'error' ? (
        <View style={styles.scoreSection}>
          <Text style={styles.cardBody}>Could not load friendly matches: {friendlyMatches.message}</Text>
        </View>
      ) : null}

      {fixtures.status === 'error' ? (
        <View style={styles.scoreSection}>
          <Text style={styles.cardBody}>Could not load fixtures: {fixtures.message}</Text>
        </View>
      ) : null}

      {unscoredBookings.status === 'error' ? (
        <View style={styles.scoreSection}>
          <Text style={styles.cardBody}>Could not load bookings: {unscoredBookings.message}</Text>
        </View>
      ) : null}

      {readyToScore.length > 0 || readyToScoreFixtures.length > 0 || unscored.length > 0 ? (
        <View style={styles.scoreSection}>
          <View style={styles.cardTitleRow}>
            <IconSymbol name="pencil" size={14} color={FuttyColors.emerald950} />
            <Text style={styles.cardTitleInRow}>Log a score</Text>
          </View>
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
              venueName={venueFor(booking.venue_id)?.name ?? 'Booked venue'}
              onSubmitted={() => {
                unscoredBookings.reload();
                // Also covers a cancel, not just a logged score (BookingResultForm
                // uses this same callback for both) — an extra, otherwise-unused
                // refetch on cancel is harmless and not worth a 2nd prop to avoid.
                onScored();
              }}
            />
          ))}
          {hiddenUnscoredCount > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/previous-games')}>
              <Text style={styles.viewAllLink}>View all {unscored.length} pending →</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function formatResultDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Shows once a score is confirmed — a plain booking's self-reported result,
 *  or both sides agreeing on a friendly match (submit_friendly_score) /
 *  league fixture (submit_fixture_score) — all three feed this via
 *  lib/use-recent-results.ts. The hook lives in HomeScreen, not here: logging
 *  a score in NextGameCard's "Log a score" section needs to refresh this
 *  card immediately, and two sibling components can't reload each other's
 *  own independent hook state — only a shared parent can. */
function RecentResultsCard({ recentResults }: { recentResults: ReturnType<typeof useRecentResults> }) {
  if (recentResults.status === 'error') {
    return (
      <View style={styles.nextGameCard}>
        <View style={styles.cardTitleRow}>
          <IconSymbol name="trophy.fill" size={14} color={FuttyColors.emerald950} />
          <Text style={styles.cardTitleInRow}>Previous game</Text>
        </View>
        <Text style={styles.cardBody}>Could not load: {recentResults.message}</Text>
      </View>
    );
  }

  if (recentResults.status !== 'ready' || recentResults.results.length === 0) return null;

  return (
    <View style={styles.nextGameCard}>
      <View style={styles.cardTitleRow}>
        <IconSymbol name="trophy.fill" size={14} color={FuttyColors.emerald950} />
        <Text style={styles.cardTitleInRow}>Previous game</Text>
      </View>
      {recentResults.results.map((result) => (
        <View key={result.key} style={styles.resultRow}>
          <Text style={styles.resultTeams}>
            {result.kind === 'booking'
              ? `You ${result.homeScore}–${result.awayScore}`
              : `${result.homeTeamName} ${result.homeScore}–${result.awayScore} ${result.awayTeamName}`}
          </Text>
          <Text style={styles.cardBody}>
            {result.kind === 'league' ? 'League' : result.kind === 'friendly' ? 'Friendly' : 'Pickup game'} ·{' '}
            {formatResultDate(result.playedAt)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PremiumBox() {
  const profile = useProfile();
  const isPremium = profile.status === 'ready' && profile.profile.is_premium;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/account/premium')}
      style={styles.premiumBox}>
      <View style={styles.premiumIconCircle}>
        <IconSymbol name="star.fill" size={20} color={FuttyColors.emerald950} />
      </View>
      <View style={styles.premiumTextBlock}>
        <Text style={styles.premiumTitle}>{isPremium ? "You're on Premium" : 'Go Futty Premium'}</Text>
        <Text style={styles.premiumSubtitle}>
          {isPremium ? 'Manage your plan' : 'Book further ahead + get the verified badge'}
        </Text>
      </View>
      <IconSymbol name="chevron.right" size={18} color={FuttyColors.emerald950} />
    </Pressable>
  );
}

function TeamPremiumBox() {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/team')} style={styles.teamPremiumBox}>
      <View style={styles.teamPremiumIconCircle}>
        <IconSymbol name="shield.fill" size={20} color={FuttyColors.white} />
      </View>
      <View style={styles.premiumTextBlock}>
        <Text style={styles.teamPremiumTitle}>Team Premium</Text>
        <Text style={styles.teamPremiumSubtitle}>Unlock 9-a-side & 11-a-side leagues for your team</Text>
      </View>
      <IconSymbol name="chevron.right" size={18} color={FuttyColors.white} />
    </Pressable>
  );
}

/** Top-right header actions — kept as two distinct icons rather than one
 *  combined menu: the bell is a live feed (badge count, tap straight into
 *  the relevant screen), the account icon is a static menu hierarchy
 *  (app/account/index.tsx). Folding both into one icon would make the
 *  common case (checking notifications) a two-tap action instead of one. */
function HomeHeaderActions() {
  const notifications = useNotifications();

  return (
    <View style={styles.headerActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        onPress={() => router.push('/notifications')}
        style={styles.headerIconButton}>
        <IconSymbol name="bell.fill" size={18} color={FuttyColors.white} />
        {notifications.unreadCount > 0 ? (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>
              {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        onPress={() => router.push('/account')}
        style={styles.headerIconButton}>
        <IconSymbol name="person.fill" size={18} color={FuttyColors.white} />
      </Pressable>
    </View>
  );
}

export default function HomeScreen() {
  const recentResults = useRecentResults();

  // Refetch whenever Home itself regains focus (e.g. back from Book or from
  // app/previous-games.tsx) — NextGameCard separately calls reload() the
  // instant a score is logged without leaving this screen at all.
  useFocusEffect(
    useCallback(() => {
      recentResults.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.wordmark}>FUTTY</Text>
            <HomeHeaderActions />
          </View>
          <View style={styles.headerSubtitleRow}>
            <IconSymbol name="sportscourt.fill" size={13} color={FuttyColors.emerald200} />
            <Text style={styles.headerSubtitle}>What are we playing today?</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.quickActions}>
          {QUICK_ACTIONS.map(({ icon, label, color, onPress }) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              onPress={onPress}
              style={styles.quickAction}>
              <View style={[styles.quickActionCircle, { backgroundColor: color }]}>
                <IconSymbol name={icon} size={20} color={FuttyColors.white} />
              </View>
              <Text style={styles.quickActionLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <NextGameCard onScored={recentResults.reload} />
        <RecentResultsCard recentResults={recentResults} />
        <PremiumBox />
        <TeamPremiumBox />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: FuttyColors.stone50,
  },
  headerSafeArea: {
    backgroundColor: FuttyColors.emerald950,
  },
  header: {
    backgroundColor: FuttyColors.emerald950,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: FuttyFonts.display,
    fontSize: 24,
    color: FuttyColors.white,
    letterSpacing: 0.5,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: FuttyColors.emerald800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: FuttyColors.rose600,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: FuttyColors.emerald950,
  },
  headerBadgeText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 9,
    color: FuttyColors.white,
  },
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  headerSubtitle: {
    fontFamily: FuttyFonts.sans,
    fontSize: 14,
    color: FuttyColors.emerald200,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 16,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickAction: {
    alignItems: 'center',
    gap: 6,
    width: 72,
  },
  quickActionCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 10,
    color: FuttyColors.stone700,
    textAlign: 'center',
    lineHeight: 13,
  },
  nextGameCard: {
    backgroundColor: FuttyColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    padding: 16,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  cardTitleInRow: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 14,
    color: FuttyColors.emerald950,
  },
  cardEmpty: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone400,
  },
  cardBody: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  nextGameVenue: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 14,
    color: FuttyColors.emerald950,
    marginBottom: 2,
  },
  upcomingList: {
    gap: 0,
  },
  upcomingRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
  },
  resultRow: {
    marginTop: 8,
    gap: 2,
  },
  resultTeams: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 13,
    color: FuttyColors.emerald950,
  },
  scoreSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
    gap: 10,
  },
  viewAllLink: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 12,
    color: FuttyColors.emerald700,
  },
  scoreForm: {
    gap: 6,
  },
  scoreFormTitle: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 13,
    color: FuttyColors.emerald950,
  },
  scoreInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreInput: {
    width: 48,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  scoreDash: {
    fontFamily: FuttyFonts.sans,
    color: FuttyColors.stone500,
  },
  premiumBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: FuttyColors.amber400,
    borderRadius: 18,
    padding: 14,
  },
  premiumIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: FuttyColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumTextBlock: {
    flex: 1,
    gap: 2,
  },
  premiumTitle: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 14,
    color: FuttyColors.emerald950,
  },
  premiumSubtitle: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.emerald950,
    opacity: 0.8,
  },
  teamPremiumBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: FuttyColors.emerald800,
    borderRadius: 18,
    padding: 14,
  },
  teamPremiumIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: FuttyColors.emerald950,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamPremiumTitle: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 14,
    color: FuttyColors.white,
  },
  teamPremiumSubtitle: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.white,
    opacity: 0.85,
  },
});
