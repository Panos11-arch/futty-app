import { usePaymentSheet } from '@stripe/stripe-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PriceBreakdown } from '@/components/ui/price-breakdown';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import { walletPayOptions } from '@/lib/wallet-pay';
import { createSharePayment } from '@/lib/booking-shares';
import { describeFunctionError } from '@/lib/edge-functions';
import { describeSquadError } from '@/lib/squad-errors';
import {
  type BlockNotice,
  cancelPendingShare,
  describePlayerPostNeed,
  getSquadPostBlockNotice,
  joinSquadPost,
  leaveSquadPost,
} from '@/lib/squads';
import { supabase } from '@/lib/supabase';
import { useSquadPosts } from '@/lib/use-squad-posts';

function formatWhen(iso: string) {
  const date = new Date(iso);
  const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** "Join as Player" — item 5. Joining and authorizing payment used to be two
 *  separate trips (join here, then go authorize on app/booking-payment.tsx
 *  later); this combines them into the one "Join and pay my share" action the
 *  reference flow describes. Nothing is actually charged here — see item 6:
 *  this only places an authorization hold, captured later (all shares at
 *  once) once the roster fills, via supabase/functions/stripe-webhook. */
export default function JoinSquadPostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const posts = useSquadPosts('players');
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();

  const [shareCents, setShareCents] = useState<number | null>(null);
  const [feeCents, setFeeCents] = useState<number | null>(null);
  const [blockNotice, setBlockNotice] = useState<BlockNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = posts.status === 'ready' ? posts.posts.find((p) => p.id === postId) : null;

  useEffect(() => {
    if (!post?.venue_booking_id) return;
    // The server works the share out (same maths as the share it creates on
    // join); someone else's booking total isn't readable from the app.
    supabase
      .rpc('squad_post_price', { p_post_id: post.id })
      .maybeSingle<{ share_cents: number; fee_cents: number | null }>()
      .then(({ data }) => {
        if (!data) return;
        setShareCents(data.share_cents);
        setFeeCents(data.fee_cents);
      });
  }, [post?.id, post?.venue_booking_id]);

  // The venue may have closed new bookings for this time. A block stops new
  // bookings only: this game was booked before it, so it can still be joined,
  // and the player sees the venue's notice (spec 13, "Blocking pitches").
  useEffect(() => {
    if (!post?.venue_booking_id) return;
    let current = true;
    getSquadPostBlockNotice(post.id).then((notice) => {
      if (current) setBlockNotice(notice);
    });
    return () => {
      current = false;
    };
  }, [post?.id, post?.venue_booking_id]);

  const spotsLeft = post ? (post.players_needed ?? 0) - post.joined_count : 0;
  const isLastSpot = spotsLeft === 1;

  async function joinAndPay() {
    if (!post || busy) return;
    setBusy(true);
    setError(null);

    const { error: joinError } = await joinSquadPost(post.id);
    if (joinError) {
      setBusy(false);
      setError(describeSquadError(joinError));
      return;
    }

    if (!post.venue_booking_id) {
      // Not linked to a real booking at all (shouldn't happen via the app's
      // own posting flow, but the data model allows it) — nothing to pay.
      setBusy(false);
      router.back();
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setBusy(false);
      setError('Not signed in.');
      return;
    }

    // Fetched fresh here, not from the pre-join shareCents display state —
    // that's set by a separate useEffect that may not have resolved yet by
    // the time this runs, and treating "still loading" as "nothing to pay"
    // was the actual bug: it skipped straight to router.back() with no
    // Stripe call at all. join_squad_post()'s trigger
    // (auto_add_booking_share_on_join) inserts the share synchronously
    // inside the same transaction, so it's guaranteed to exist by now if
    // this booking has a price.
    const { data: share, error: shareError } = await supabase
      .from('booking_payment_shares')
      .select('id')
      .eq('booking_id', post.venue_booking_id)
      .eq('profile_id', authData.user.id)
      .maybeSingle();

    if (shareError) {
      setBusy(false);
      setError(shareError.message);
      return;
    }

    if (!share) {
      // No share row at all means a free venue (amount_cents = 0) — the
      // trigger deliberately skips creating one in that case, see
      // add_booking_share_internal. Genuinely nothing to authorize.
      setBusy(false);
      router.back();
      return;
    }

    // From here on, a failed/cancelled payment must not leave this player
    // occupying a spot they never actually authorized for — roll back both
    // the join itself (leave_squad_post) and the 'pending' share the join
    // trigger created alongside it (cancel_pending_share; leave_squad_post
    // alone doesn't touch booking_payment_shares at all).
    async function rollbackJoin() {
      await leaveSquadPost(post!.id);
      await cancelPendingShare(post!.venue_booking_id!);
    }

    const { data: intent, error: intentError } = await createSharePayment(share.id);
    if (intentError || !intent?.clientSecret) {
      await rollbackJoin();
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
      await rollbackJoin();
      setBusy(false);
      setError(initError.message);
      return;
    }

    const { error: presentError } = await presentPaymentSheet();

    if (presentError) {
      await rollbackJoin();
      setBusy(false);
      if (presentError.code !== 'Canceled') setError(presentError.message);
      return;
    }

    setBusy(false);

    // Authorized (not charged — item 6). If this was the last spot, the
    // booking is about to be fully authorized and captured server-side;
    // show the same "Match Found" screen either way isn't right here since
    // there's no opponent, so this is the plain-booking variant.
    if (isLastSpot) {
      router.replace({ pathname: '/fixture-confirmed', params: { kind: 'booking', id: post.venue_booking_id } });
    } else {
      router.back();
    }
  }

  if (posts.status === 'loading' || (posts.status === 'ready' && !post)) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View testID="join-skeleton" style={styles.content}>
          <Card>
            <SkeletonText lines={2} />
          </Card>
          <SkeletonBlock width="100%" height={space.xxl + space.lg} />
          <SkeletonBlock width="100%" height={space.xxl * 2} />
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <Banner
            tone="danger"
            message="Could not load this post."
            action={{ label: 'Try again', onPress: posts.reload }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const need = describePlayerPostNeed(post);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.head}>
          <Text variant="title" accessibilityRole="header">
            {post.venue_name}
          </Text>
          <Text variant="callout" tone="inkMuted" tabular>
            {post.level ? `${post.level} · ` : ''}
            {post.venue_city ?? 'Unknown city'} · {formatWhen(post.scheduled_at)}
          </Text>
        </Card>

        {blockNotice ? <Banner tone="warning" title={blockNotice.title} message={blockNotice.body} /> : null}

        <View style={styles.openSpotsRow}>
          <IconSymbol name="person.2.fill" size={ICON.small} color={colors.inkMuted} />
          <Text variant="body" tabular>
            {spotsLeft} open spot{spotsLeft === 1 ? '' : 's'}
          </Text>
        </View>

        {shareCents !== null ? (
          <Card testID="share-price">
            <PriceBreakdown
              lines={
                feeCents
                  ? [
                      { label: 'Pitch', cents: shareCents - feeCents },
                      { label: 'Service fee', cents: feeCents },
                    ]
                  : []
              }
              totalCents={shareCents}
              totalLabel="Your share"
            />
          </Card>
        ) : null}

        {need ? (
          <View style={styles.quote}>
            <Text variant="callout" tone="inkMuted">
              &ldquo;{need}&rdquo;
            </Text>
          </View>
        ) : null}

        <Text variant="callout" tone="inkMuted">
          Your card is only held, not charged — you&apos;re only charged once the match is confirmed with a full
          roster.
        </Text>

        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Button label="Join and pay my share" fullWidth onPress={joinAndPay} loading={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.lg, padding: space.lg, paddingBottom: space.xxl },
  head: { gap: space.xs },
  openSpotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: space.xxl + space.lg,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: space.md,
    paddingVertical: space.xs,
  },
});
