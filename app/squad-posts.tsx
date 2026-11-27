import { usePaymentSheet } from '@stripe/stripe-react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostActions } from '@/components/booking/post-actions';
import { PublishGames } from '@/components/booking/publish-games';
import { TeamHeadToHead } from '@/components/match/head-to-head';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text, type TextTone } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { walletPayOptions } from '@/lib/wallet-pay';
import { useAuth } from '@/lib/auth';
import { publishBooking, unpublishPost } from '@/lib/booking-opposition';
import {
  fetchPublishableBookings,
  getBookingPostQuotes,
  isPostShown,
  type BookingPostQuote,
  type PublishableBooking,
} from '@/lib/booking-posts';
import { useLoad } from '@/lib/booking-search';
import { createSharePayment } from '@/lib/booking-shares';
import { describeFunctionError } from '@/lib/edge-functions';
import { formatMatchWhen } from '@/lib/match/format';
import { describeSquadError } from '@/lib/squad-errors';
import {
  cancelOppositionOffer,
  describeOppositionPostNeed,
  describePlayerPostNeed,
  getSquadPostPrices,
  leaveSquadPost,
  offerOpposition,
  type SquadPostPrice,
} from '@/lib/squads';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';
import { useMyTeams } from '@/lib/use-my-teams';
import { useSquadPosts, type SquadPostWithDetails } from '@/lib/use-squad-posts';
import { minutesText, ruleText } from '@/lib/rules';
import { useRules } from '@/lib/use-rules';

// Cancelling a matched opposition post is blocked from 30 minutes before
// kickoff onward — matches cancel_opposition_offer's server-side check
// (supabase/scores.sql).
const CANCEL_WINDOW_MS = 30 * 60 * 1000;

type View_ = 'players' | 'opposition';
const VIEW_OPTIONS: { value: View_; label: string }[] = [
  { value: 'players', label: 'Need players' },
  { value: 'opposition', label: 'Need opposition' },
];

/** One labelled fact on a post card — where, when, how many needed, how
 *  many spots are left. Plain canvas tiles: no colour per box. */
function Fact({ label, value, tone = 'ink' }: { label: string; value: string; tone?: TextTone }) {
  const styles = useStyles();
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="callout" tone={tone} tabular>
        {value}
      </Text>
      <Text variant="caption" tone="inkMuted">
        {label}
      </Text>
    </View>
  );
}

/** A neutral pill for a team's level or the payment mode. */
function Tag({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tag}>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

function Quote({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.quote}>
      <Text variant="callout" tone="inkMuted">
        &ldquo;{text}&rdquo;
      </Text>
    </View>
  );
}

function ErrorText({ children }: { children: string }) {
  return (
    <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

function PlayersPostCard({
  post,
  price,
  quote,
  onChanged,
}: {
  post: SquadPostWithDetails;
  /** The server's price per player; none while loading, on error or when
   *  the server has none for this post. */
  price?: SquadPostPrice;
  /** B4: a Booking v2 post's quote (booking_post_quotes); none for older posts. */
  quote?: BookingPostQuote;
  onChanged: () => void;
}) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spotsLeft = (post.players_needed ?? 0) - post.joined_count;
  const full = spotsLeft <= 0;

  async function leave() {
    setBusy(true);
    setError(null);
    const { error: leaveError } = await leaveSquadPost(post.id);
    setBusy(false);
    if (leaveError) setError(describeSquadError(leaveError));
    else onChanged();
  }

  const need = describePlayerPostNeed(post);

  return (
    <Card testID="players-post" style={styles.card}>
      <View style={styles.cardHead}>
        <Text variant="headline">{post.venue_name}</Text>
        <Text variant="callout" tone="inkMuted">
          {post.venue_city ?? 'Unknown city'} · {post.format}
          {post.level ? ` · ${post.level}` : ''}
        </Text>
      </View>

      {need ? <Quote text={need} /> : null}

      <View style={styles.facts}>
        <Fact label="When" value={formatMatchWhen(post.scheduled_at)} />
        <Fact label="Needed" value={String(post.players_needed ?? 0)} />
        <Fact
          label={full ? 'Status' : 'Spots left'}
          value={full ? 'Full' : String(spotsLeft)}
          tone={full ? 'inkMuted' : 'ink'}
        />
        {price && !quote ? <Fact label="Price" value={`${formatEuros(price.share_cents)} each`} /> : null}
      </View>

      {post.roster.length > 0 ? (
        <View style={styles.roster}>
          {post.roster.map((player, index) => (
            <View key={player.profileId ?? `house-${index}`} style={styles.rosterRow}>
              <Text variant="callout" style={styles.flex}>
                {player.name}
              </Text>
              <Text variant="caption" tone="inkMuted">
                {player.isHousePlayer ? 'Venue staff' : player.tier}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {quote ? (
        <V2Actions post={post} quote={quote} onChanged={onChanged} />
      ) : (
        <>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {post.joined_by_me ? (
            <Button label="Cancel" variant="secondary" onPress={leave} loading={busy} />
          ) : (
            <Button
              label={full ? 'Full' : 'Join and pay my share'}
              onPress={() => router.push({ pathname: '/join-squad-post', params: { postId: post.id } })}
              disabled={full}
            />
          )}
        </>
      )}
    </Card>
  );
}

/** B4: a Booking v2 post's action (Join, Accept as opponent, Unpublish, View
 *  booking), priced by the server for its side. */
function V2Actions({ post, quote, onChanged }: { post: SquadPostWithDetails; quote: BookingPostQuote; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unpublish() {
    setBusy(true);
    setError(null);
    const failed = await unpublishPost(post.id);
    setBusy(false);
    if (failed) setError(failed);
    else onChanged();
  }

  return (
    <PostActions
      kind={post.type}
      quote={quote}
      joinedByMe={post.joined_by_me}
      busy={busy}
      error={error}
      onUnpublish={unpublish}
      onJoin={() => router.push({ pathname: '/join-squad-post', params: { postId: post.id } })}
      onAccept={() => router.push({ pathname: '/opposition-invite', params: { postId: post.id } })}
      onView={() => {
        if (post.venue_booking_id) router.push({ pathname: '/booking/[id]', params: { id: post.venue_booking_id } });
      }}
    />
  );
}

/** B4: a Booking v2 opposition post: side B's price and "Accept as
 *  opponent", from the server. Its quote may still be loading. */
function V2OppositionPostCard({
  post,
  quote,
  onChanged,
}: {
  post: SquadPostWithDetails;
  quote?: BookingPostQuote;
  onChanged: () => void;
}) {
  const styles = useStyles();
  return (
    <Card testID="opposition-post" style={styles.card}>
      <View style={styles.cardHead}>
        <Text variant="headline">{post.team_name ?? post.venue_name}</Text>
        <Text variant="callout" tone="inkMuted">
          {post.venue_name} · {post.venue_city ?? 'Unknown city'} · {post.format}
        </Text>
      </View>
      <View style={styles.facts}>
        <Fact label="When" value={formatMatchWhen(post.scheduled_at)} />
        <Fact label="Players a side" value={String(post.players_needed ?? 0)} />
      </View>
      {quote ? <V2Actions post={post} quote={quote} onChanged={onChanged} /> : <SkeletonText lines={1} />}
    </Card>
  );
}

function OppositionPostCard({ post, onChanged }: { post: SquadPostWithDetails; onChanged: () => void }) {
  const styles = useStyles();
  const { user } = useAuth();
  const myTeams = useMyTeams();
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const [offering, setOffering] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captainTeams =
    myTeams.status === 'ready'
      ? myTeams.teams.filter((t) => t.role === 'captain' && t.team.id !== post.team_id)
      : [];

  // Either side of a matched post — the original poster's team or the team
  // that offered — can cancel it, so this checks both, not just the one the
  // "Offer" form above cares about.
  const myCaptainTeamIds =
    myTeams.status === 'ready'
      ? new Set(myTeams.teams.filter((t) => t.role === 'captain').map((t) => t.team.id))
      : new Set<string>();
  const isMyMatch =
    post.status === 'matched' &&
    ((post.team_id ? myCaptainTeamIds.has(post.team_id) : false) ||
      (post.matched_team_id ? myCaptainTeamIds.has(post.matched_team_id) : false));
  const canCancel = isMyMatch && new Date(post.scheduled_at).getTime() - CANCEL_WINDOW_MS > Date.now();

  async function submitOffer() {
    if (!teamId || busy) return;
    setBusy(true);
    setError(null);

    const { error: offerError } = await offerOpposition(post.id, teamId);
    if (offerError) {
      setBusy(false);
      setError(describeSquadError(offerError));
      return;
    }

    if (!post.venue_booking_id || !user) {
      // No real booking behind this post (or, in practice, always signed in
      // to have gotten this far) — nothing to hold, the match itself is
      // already locked in by offer_opposition above.
      setBusy(false);
      setOffering(false);
      onChanged();
      return;
    }

    // On a Gipedo Pano booking, offer_opposition (migration
    // 20261113130016_pay_gipedo_review_fixes) creates one pending share:
    // this captain's hold, to place within 15 minutes. It's fetched fresh
    // here rather than trusted from client state, same reasoning as
    // join-squad-post.tsx. Other bookings give the offering captain no
    // share, so there is nothing to pay below.
    const { data: share, error: shareError } = await supabase
      .from('booking_payment_shares')
      .select('id')
      .eq('booking_id', post.venue_booking_id)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (shareError) {
      setBusy(false);
      setError(shareError.message);
      return;
    }

    if (!share) {
      // Not a Gipedo Pano booking (or a free one): no hold to place; the
      // match is already on.
      setBusy(false);
      setOffering(false);
      onChanged();
      return;
    }

    // From here on, a failed or cancelled hold must not leave this match
    // "on": cancel_opposition_offer withdraws the offer, cancels this
    // captain's hold share, releases any payment it started and reopens the
    // post (gipedo_withdraw_offer).
    async function rollbackOffer() {
      await cancelOppositionOffer(post.id);
    }

    const { data: intent, error: intentError } = await createSharePayment(share.id);
    if (intentError || !intent?.clientSecret) {
      await rollbackOffer();
      setBusy(false);
      setError(intentError ? await describeFunctionError(intentError) : "Couldn't start payment.");
      return;
    }

    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: 'Futty',
      ...walletPayOptions,
      paymentIntentClientSecret: intent.clientSecret,
    });
    if (initError) {
      await rollbackOffer();
      setBusy(false);
      setError(initError.message);
      return;
    }

    const { error: presentError } = await presentPaymentSheet();
    if (presentError) {
      await rollbackOffer();
      setBusy(false);
      if (presentError.code !== 'Canceled') setError(presentError.message);
      return;
    }

    setBusy(false);
    setOffering(false);
    onChanged();

    // Only now — the offering captain's own hold actually succeeded — tell
    // both rosters they're playing and owe their own share. Fire-and-forget:
    // a push failing here must never undo a match that already went
    // through.
    supabase.functions
      .invoke('notify-opposition-matched', { body: { postId: post.id, payerProfileId: user.id } })
      .catch(() => {});
  }

  async function cancelMatch() {
    setBusy(true);
    setError(null);
    const { error: cancelError } = await cancelOppositionOffer(post.id);
    setBusy(false);
    if (cancelError) setError(describeSquadError(cancelError));
    else onChanged();
  }

  const need = describeOppositionPostNeed(post);

  return (
    <Card testID="opposition-post" style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.teamNameRow}>
          <Text variant="headline">{post.team_name}</Text>
          {post.team_level ? <Tag label={post.team_level} /> : null}
          {post.payment_mode === 'gipedo_pano' ? <Tag label="Gipedo Pano" /> : null}
        </View>
        <Text variant="callout" tone="inkMuted">
          {post.venue_name} · {post.venue_city ?? 'Unknown city'} · {post.format}
          {post.level ? ` · ${post.level}` : ''}
        </Text>
      </View>

      {need ? <Quote text={need} /> : null}

      <View style={styles.facts}>
        <Fact label="Where" value={post.venue_name} />
        <Fact label="When" value={formatMatchWhen(post.scheduled_at)} />
        <Fact
          label="Status"
          value={post.status === 'matched' ? 'Matched' : 'Open'}
          tone={post.status === 'matched' ? 'success' : 'ink'}
        />
      </View>

      {post.status === 'matched' ? (
        <>
          <Button
            label={`Matched vs ${post.matched_team_name} — view fixture`}
            variant="plain"
            onPress={() => router.push({ pathname: '/fixture-confirmed', params: { kind: 'squad', id: post.id } })}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          {isMyMatch ? (
            canCancel ? (
              <Button label="Cancel" variant="secondary" onPress={cancelMatch} loading={busy} />
            ) : (
              <Text variant="callout" tone="inkMuted">
                Too close to kickoff to cancel now.
              </Text>
            )
          ) : null}
        </>
      ) : offering ? (
        <>
          {captainTeams.length === 0 ? (
            <Text variant="callout" tone="inkMuted">
              You need to captain a team first.
            </Text>
          ) : (
            <View style={styles.wrapRow}>
              {captainTeams.map(({ team }) => (
                <Chip
                  key={team.id}
                  label={team.name}
                  selected={teamId === team.id}
                  onPress={() => setTeamId(team.id)}
                />
              ))}
            </View>
          )}
          {/* A3b-2b: head-to-head before accepting (05 section 3). */}
          {teamId && post.team_id ? (
            <TeamHeadToHead teamId={teamId} opponentTeamId={post.team_id} teamName={captainTeams.find((t) => t.team.id === teamId)?.team.name ?? 'Your team'} opponentName={post.team_name ?? 'Them'} />
          ) : null}
          <Text variant="callout" tone="inkMuted">
            {post.payment_mode === 'gipedo_pano'
              ? 'Gipedo Pano: the losing team pays for the pitch. Offering holds your card for the pitch price plus the service fee, and nothing is taken now. ' +
                ruleText(
                  (r) => `Place the hold within ${minutesText(r.payment_window_minutes)} or the offer lapses. `,
                  'Place the hold straight away or the offer lapses. ',
                ) +
                "After the match the loser's hold is taken, a draw, a dispute or no result is split 50/50, and the winner's hold is released."
              : 'Split payment: both full rosters share the pitch cost evenly, regardless of the result.'}
          </Text>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <View style={styles.wrapRow}>
            {captainTeams.length > 0 ? (
              <Button label="Offer and pay my share" onPress={submitOffer} disabled={!teamId} loading={busy} />
            ) : null}
            <Button label="Cancel" variant="secondary" onPress={() => setOffering(false)} disabled={busy} />
          </View>
        </>
      ) : (
        <Button label="Offer to play them" onPress={() => setOffering(true)} />
      )}
    </Card>
  );
}

/** Each "Need players" post's price per player, from squad_post_prices. Null
 *  while loading, on error, and for the other view: cards then show no price. */
function usePlayerPostPrices(posts: SquadPostWithDetails[] | null): Map<string, SquadPostPrice> | null {
  const [prices, setPrices] = useState<Map<string, SquadPostPrice> | null>(null);
  const key = posts ? posts.map((p) => p.id).join(',') : null;

  useEffect(() => {
    setPrices(null);
    if (key === null) return;
    let current = true;
    getSquadPostPrices(key ? key.split(',') : []).then((result) => {
      if (current) setPrices(result);
    });
    return () => {
      current = false;
    };
  }, [key]);

  return prices;
}

/** B4: each Booking v2 post's quote (booking_post_quotes), for both views.
 *  Null while loading or on error: older posts' cards don't need it, and
 *  Booking v2 opposition posts wait for it. */
function useBookingPostQuotes(posts: SquadPostWithDetails[] | null): Map<string, BookingPostQuote> | null {
  const [quotes, setQuotes] = useState<Map<string, BookingPostQuote> | null>(null);
  // Refetched when a post fills, closes or is matched, not on every render.
  const key = posts ? posts.map((p) => `${p.id}:${p.status}:${p.joined_count}`).join(',') : null;

  useEffect(() => {
    setQuotes(null);
    if (key === null) return;
    let current = true;
    const ids = key ? key.split(',').map((k) => k.split(':')[0]) : [];
    getBookingPostQuotes(ids).then((result) => {
      if (current) setQuotes(result);
    });
    return () => {
      current = false;
    };
  }, [key]);

  return quotes;
}

/** B4: "Your games": publish or unpublish the games I captain. */
function YourGames({ kind, onChanged }: { kind: View_; onChanged: () => void }) {
  const load = useCallback(() => fetchPublishableBookings(), []);
  const { state, reload } = useLoad<PublishableBooking[]>('mine', load);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(bookingId: string, action: () => Promise<string | null>) {
    setBusyId(bookingId);
    setError(null);
    const failed = await action();
    setBusyId(null);
    if (failed) setError(failed);
    void reload();
    onChanged();
  }

  if (state.status !== 'ready') return null;
  return (
    <PublishGames
      kind={kind}
      games={state.data}
      busyId={busyId}
      error={error}
      onPublish={(bookingId) => void run(bookingId, () => publishBooking(bookingId, kind))}
      onUnpublish={(postId) => {
        const game = state.data.find((g) => g.players_post_id === postId || g.opposition_post_id === postId);
        void run(game?.booking_id ?? postId, () => unpublishPost(postId));
      }}
    />
  );
}

export default function SquadPostsScreen() {
  // Spec 13's rules for the numbers in this screen's text (P10): loads them
  // and re-renders when they arrive.
  const styles = useStyles();
  useRules();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<View_>(params.view === 'opposition' ? 'opposition' : 'players');
  const posts = useSquadPosts(view);
  const prices = usePlayerPostPrices(view === 'players' && posts.status === 'ready' ? posts.posts : null);
  const quotes = useBookingPostQuotes(posts.status === 'ready' ? posts.posts : null);
  const shown =
    posts.status === 'ready' ? posts.posts.filter((post) => isPostShown(quotes?.get(post.id) ?? null, post.joined_by_me)) : [];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Posts' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} accessibilityLabel="Posts" />

        <YourGames kind={view} onChanged={posts.reload} />

        {posts.status === 'loading' ? (
          <Card testID="squads-skeleton">
            <SkeletonText lines={4} />
          </Card>
        ) : null}
        {posts.status === 'error' ? (
          <Banner
            tone="danger"
            message="Could not load games. Try again."
            action={{ label: 'Try again', onPress: posts.reload }}
          />
        ) : null}
        {posts.status === 'ready' && shown.length === 0 ? (
          <EmptyState
            icon="person.2.fill"
            message="No open games"
            action={{ label: 'Find a match', onPress: () => router.push({ pathname: '/squads', params: { view } }) }}
          />
        ) : null}

        {shown.map((post) =>
          view === 'players' ? (
            <PlayersPostCard
              key={post.id}
              post={post}
              price={prices?.get(post.id)}
              quote={quotes?.get(post.id)}
              onChanged={posts.reload}
            />
          ) : quotes?.get(post.id) || post.side ? (
            <V2OppositionPostCard key={post.id} post={post} quote={quotes?.get(post.id)} onChanged={posts.reload} />
          ) : (
            <OppositionPostCard key={post.id} post={post} onChanged={posts.reload} />
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { gap: space.md },
  cardHead: { gap: space.xs },
  teamNameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  fact: {
    flexGrow: 1,
    minWidth: space.xxl * 2 + space.lg,
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    backgroundColor: colors.canvas,
  },
  tag: {
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  quote: {
    borderLeftWidth: space.xs / 2,
    borderLeftColor: colors.border,
    paddingLeft: space.md,
    paddingVertical: space.xs,
  },
  roster: {
    gap: space.xs,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
}));
