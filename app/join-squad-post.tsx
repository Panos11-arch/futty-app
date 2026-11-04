import { usePaymentSheet } from '@stripe/stripe-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthError } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { createSharePayment } from '@/lib/booking-shares';
import { describeFunctionError } from '@/lib/edge-functions';
import { describeSquadError } from '@/lib/squad-errors';
import { cancelPendingShare, describePlayerPostNeed, joinSquadPost, leaveSquadPost } from '@/lib/squads';
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
 *  later); this combines them into the one "Join & Pay My Share" action the
 *  reference flow describes. Nothing is actually charged here — see item 6:
 *  this only places an authorization hold, captured later (all shares at
 *  once) once the roster fills, via supabase/functions/stripe-webhook. */
export default function JoinSquadPostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const posts = useSquadPosts('players');
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();

  const [shareCents, setShareCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = posts.status === 'ready' ? posts.posts.find((p) => p.id === postId) : null;

  useEffect(() => {
    if (!post?.venue_booking_id) return;
    supabase
      .from('venue_bookings')
      .select('amount_cents, format')
      .eq('id', post.venue_booking_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || !data.amount_cents) return;
        const counts: Record<string, number> = { '5-a-side': 5, '7-a-side': 7, '9-a-side': 9, '11-a-side': 11 };
        const perPlayer = counts[data.format as string] ?? 10;
        setShareCents(Math.round(data.amount_cents / perPlayer));
      });
  }, [post?.venue_booking_id]);

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
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.center}>
          <ThemedText style={styles.note}>Could not load this post.</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView style={[styles.card, { borderColor: border }]}>
          <ThemedText type="defaultSemiBold" style={styles.venue}>
            {post.venue_name}
          </ThemedText>
          <ThemedText style={styles.note}>
            {post.level ? `${post.level} · ` : ''}
            {post.venue_city ?? 'Unknown city'} · {formatWhen(post.scheduled_at)}
          </ThemedText>
        </ThemedView>

        <View style={[styles.openSpotsRow, { borderColor: border }]}>
          <IconSymbol name="person.2.fill" size={16} color={FuttyColors.stone700} />
          <ThemedText style={styles.openSpotsText}>
            {spotsLeft} open spot{spotsLeft === 1 ? '' : 's'}
          </ThemedText>
        </View>

        {shareCents !== null ? (
          <View style={styles.shareBox}>
            <ThemedText style={styles.shareLabel}>Your share</ThemedText>
            <ThemedText style={styles.shareAmount}>€{(shareCents / 100).toFixed(2)}</ThemedText>
          </View>
        ) : null}

        {describePlayerPostNeed(post) ? (
          <View style={styles.quote}>
            <ThemedText style={styles.quoteText}>&ldquo;{describePlayerPostNeed(post)}&rdquo;</ThemedText>
          </View>
        ) : null}

        <ThemedText style={styles.disclaimer}>
          Your card is only held, not charged — you&apos;re only charged once the match is confirmed with a full
          roster.
        </ThemedText>

        {error ? <AuthError>{error}</AuthError> : null}

        <Pressable
          accessibilityRole="button"
          onPress={joinAndPay}
          disabled={busy}
          style={({ pressed }) => [styles.joinButton, busy && styles.joinButtonDisabled, pressed && !busy && styles.joinButtonPressed]}>
          <ThemedText style={styles.joinButtonText}>{busy ? 'Please wait…' : 'Join & Pay My Share'}</ThemedText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 32,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  venue: {
    fontSize: 16,
  },
  openSpotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  openSpotsText: {
    fontSize: 13,
    fontWeight: '600',
  },
  shareBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: FuttyColors.emerald200,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  shareLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: FuttyColors.emerald950,
  },
  shareAmount: {
    fontFamily: FuttyFonts.monoSemiBold,
    fontSize: 18,
    color: FuttyColors.emerald950,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: FuttyColors.amber400,
    paddingLeft: 12,
    paddingVertical: 4,
  },
  quoteText: {
    fontSize: 13,
    fontStyle: 'italic',
    color: FuttyColors.stone700,
  },
  disclaimer: {
    fontSize: 11,
    color: FuttyColors.stone500,
  },
  joinButton: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FuttyColors.emerald950,
    marginTop: 4,
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonPressed: {
    opacity: 0.85,
  },
  joinButtonText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 16,
    color: FuttyColors.white,
  },
});
