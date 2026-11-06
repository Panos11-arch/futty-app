import { usePaymentSheet } from '@stripe/stripe-react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { walletPayOptions } from '@/lib/wallet-pay';
import { useAuth } from '@/lib/auth';
import { addBookingPlayer, createSharePayment, listBookingShares, type BookingShare } from '@/lib/booking-shares';
import { describeFunctionError } from '@/lib/edge-functions';
import { formatEuros } from '@/lib/service-fee';
import { PostSquadNeed } from '@/app/my-bookings';
import { supabase } from '@/lib/supabase';
import type { MyBooking } from '@/lib/use-my-bookings';

const centsToLabel = formatEuros;

const STATUS_ICON: Record<BookingShare['status'], React.ComponentProps<typeof IconSymbol>['name']> = {
  pending: 'clock.fill',
  authorized: 'lock.fill',
  paid: 'checkmark.circle.fill',
  refunded: 'exclamationmark.triangle.fill',
  cancelled: 'xmark',
};

const STATUS_LABEL: Record<BookingShare['status'], string> = {
  pending: 'Awaiting payment',
  authorized: 'Card held — charged once everyone joins',
  paid: 'Charged',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

// Gipedo Pano (supabase/gipedo-pano-payments.sql): the hold itself is
// identical to a normal split payment — same amount, same authorize step —
// only what happens to it once the result is known differs, so only these
// two statuses need different wording.
const GIPEDO_PANO_STATUS_LABEL: Partial<Record<BookingShare['status'], string>> = {
  authorized: 'Card held — only charged if your team loses',
  cancelled: 'Released — your team won (or the match was voided)',
};

/** Shown right after a priced booking is created, replacing the old
 *  "pay the full amount now" screen — the booker authorizes their own share
 *  here (which is what actually reserves the pitch), other players show as
 *  pending until they each authorize their own via their own device.
 *
 *  Item 6 — nobody is actually charged here. This only places a hold; every
 *  authorized share in the booking is captured together, all at once, the
 *  moment the last spot fills (see supabase/functions/stripe-webhook). If
 *  the roster never fills before kickoff, the hold is released, never
 *  charged (supabase/functions/cancel-unpaid-bookings). */
export default function BookingPaymentScreen() {
  const { bookingId, needChoice } = useLocalSearchParams<{
    bookingId: string;
    needChoice?: 'players' | 'opposition' | 'neither';
  }>();
  const { user } = useAuth();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();

  const [shares, setShares] = useState<BookingShare[] | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [gipedoPano, setGipedoPano] = useState(false);
  // Flat per-player service fee for this booking; null for bookings made
  // before the flat fee (their 8.9% is folded into the price, no breakdown).
  const [feeCents, setFeeCents] = useState<number | null>(null);
  const [booking, setBooking] = useState<MyBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingShareId, setPayingShareId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bookingId) return;
    const [{ data: shareRows, error: shareError }, { data: bookingRow }, { data: oppositionPost }] =
      await Promise.all([
        listBookingShares(bookingId),
        supabase
          .from('venue_bookings')
          .select('id, venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, service_fee_cents_per_player')
          .eq('id', bookingId)
          .maybeSingle(),
        supabase
          .from('squad_posts')
          .select('payment_mode')
          .eq('venue_booking_id', bookingId)
          .eq('type', 'opposition')
          .eq('status', 'matched')
          .maybeSingle(),
      ]);
    if (shareError) setError(shareError.message);
    else setShares(shareRows ?? []);
    if (bookingRow) setBooking(bookingRow);
    if (bookingRow) setBookingStatus(bookingRow.status);
    setFeeCents(bookingRow?.service_fee_cents_per_player ?? null);
    setGipedoPano(oppositionPost?.payment_mode === 'gipedo_pano');
  }, [bookingId]);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const myShare = shares?.find((s) => s.profile_id === user?.id) ?? null;
  const isBooker = myShare?.is_booker ?? false;
  // No share at all means a free venue — nothing to authorize. Otherwise
  // "Done" must not be reachable until this player's own hold has actually
  // succeeded (item 2) — leaving this screen with a still-'pending' share
  // was exactly the bug: the wizard/this screen could be closed as if the
  // booking were real when no payment had ever gone through.
  const myShareSettled = !myShare || myShare.status === 'authorized' || myShare.status === 'paid';

  async function payShare(share: BookingShare) {
    setPayingShareId(share.id);
    setError(null);

    const { data, error: createError } = await createSharePayment(share.id);
    if (createError || !data?.clientSecret) {
      setPayingShareId(null);
      setError(createError ? await describeFunctionError(createError) : "Couldn't start payment — try again.");
      return;
    }

    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: 'Futty',
      ...walletPayOptions,
      paymentIntentClientSecret: data.clientSecret,
    });
    if (initError) {
      setPayingShareId(null);
      setError(initError.message);
      return;
    }

    const { error: presentError } = await presentPaymentSheet();
    setPayingShareId(null);

    if (presentError) {
      if (presentError.code !== 'Canceled') setError(presentError.message);
      return;
    }

    // Payment authorized: leave this screen straight away, so the player
    // isn't left looking at an "Authorize your share" button that still
    // reads 'pending' until stripe-webhook flips the share (the server, not
    // this call, is the source of truth for that). router.replace, not push,
    // so the back button doesn't return here.
    //
    // The booker goes to My Bookings, which still has their booking's
    // "need players / need opposition" post form and Cancel button; anyone
    // else goes Home.
    const destination = share.is_booker ? '/my-bookings' : '/';
    Alert.alert(
      'Payment confirmed',
      share.is_booker
        ? "Your pitch is reserved. Your card is only charged once everyone's in."
        : "You're in! Your card is only charged once everyone's in.",
      [{ text: 'OK', onPress: () => router.replace(destination) }],
      { cancelable: false }
    );
  }

  async function addPlayer() {
    if (!bookingId || !username.trim() || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    const { error: addPlayerError } = await addBookingPlayer(bookingId, username.trim());
    setAddBusy(false);
    if (addPlayerError) {
      setAddError(addPlayerError.message.includes('player_not_found') ? 'No player with that username.' : addPlayerError.message);
    } else {
      setUsername('');
      load();
    }
  }

  if (!shares) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconLabel icon="creditcard.fill" type="subtitle">
          {gipedoPano ? 'Gipedo Pano' : 'Split payment'}
        </IconLabel>

        {gipedoPano ? (
          <ThemedText style={styles.note}>
            Gipedo Pano: the losing team pays for the whole pitch. Everyone still authorizes a hold for
            their normal share up front — same as any other match — but only the losing team is actually
            charged once the result is confirmed. The winning team&apos;s holds are released, nobody charged. A
            draw falls back to normal split payment.
          </ThemedText>
        ) : bookingStatus === 'confirmed' ? (
          <IconLabel icon="checkmark.circle.fill" iconColor={FuttyColors.emerald700} style={styles.note}>
            Pitch reserved — your card is held, not charged. Everyone&apos;s charged together once the roster
            is full.
          </IconLabel>
        ) : (
          <ThemedText style={styles.note}>
            The pitch is reserved once your own card is authorized. No one is charged until every spot is
            filled — if it never fills before kickoff, the hold is simply released.
          </ThemedText>
        )}

        {/* Not gated on bookingStatus === 'confirmed' — create_squad_post has
         *  no such requirement server-side, and gating it here meant a
         *  priced booking (the common case) hid this entire form, position
         *  and level pickers included, until AFTER the booker authorized
         *  their own share, which could be several screens/minutes later.
         *  A free booking (app/book.tsx's "completed" state) already shows
         *  this immediately; matching that here is the fix. */}
        {booking && needChoice && needChoice !== 'neither' ? (
          <PostSquadNeed booking={booking} initialMode={needChoice} />
        ) : null}

        {shares.map((share) => (
          <ThemedView key={share.id} style={[styles.shareCard, { borderColor: border }]}>
            <View style={styles.shareRow}>
              <IconSymbol
                name={STATUS_ICON[share.status]}
                size={16}
                color={share.status === 'paid' ? FuttyColors.emerald700 : FuttyColors.stone400}
              />
              <View style={styles.shareText}>
                <ThemedText type="defaultSemiBold" style={styles.shareName}>
                  {share.profile_id === user?.id ? 'You' : (share.username ?? 'Player')}
                  {share.is_booker ? ' · Booker' : ''}
                </ThemedText>
                <ThemedText style={styles.shareStatus}>
                  {(gipedoPano ? GIPEDO_PANO_STATUS_LABEL[share.status] : undefined) ??
                    STATUS_LABEL[share.status] ??
                    share.status}
                </ThemedText>
              </View>
              <View style={styles.shareAmountColumn}>
                <ThemedText style={styles.shareAmount}>{centsToLabel(share.amount_cents)}</ThemedText>
                {feeCents ? (
                  <ThemedText style={styles.feeBreakdown}>
                    Pitch {centsToLabel(share.amount_cents - feeCents)} + service fee {centsToLabel(feeCents)}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            {share.profile_id === user?.id && share.status === 'pending' ? (
              <AuthButton
                label="Authorize your share"
                onPress={() => payShare(share)}
                busy={payingShareId === share.id}
              />
            ) : null}
          </ThemedView>
        ))}

        {error ? <AuthError>{error}</AuthError> : null}

        {isBooker ? (
          <View style={styles.addPlayerSection}>
            <ThemedText style={styles.label}>Add a player manually</ThemedText>
            <View style={styles.addPlayerRow}>
              <AuthField
                value={username}
                onChangeText={setUsername}
                placeholder="Their username"
                autoCapitalize="none"
                style={styles.addPlayerField}
              />
              <AuthButton label="Add" onPress={addPlayer} busy={addBusy} disabled={!username.trim()} />
            </View>
            {addError ? <AuthError>{addError}</AuthError> : null}
            <ThemedText style={styles.hint}>
              Players who join via a &quot;need players&quot; post linked to this booking are added
              automatically.
            </ThemedText>
          </View>
        ) : null}

        {!myShareSettled ? (
          <ThemedText style={styles.note}>Authorize your share above to finish booking this pitch.</ThemedText>
        ) : null}
        <AuthButton
          label="Done"
          variant="secondary"
          onPress={() => router.back()}
          disabled={!myShareSettled}
          compact
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  note: {
    fontSize: 12,
    opacity: 0.8,
  },
  shareCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shareText: {
    flex: 1,
    gap: 1,
  },
  shareName: {
    fontSize: 14,
  },
  shareStatus: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  shareAmount: {
    fontFamily: FuttyFonts.monoSemiBold,
    fontSize: 14,
    color: FuttyColors.stone900,
  },
  shareAmountColumn: {
    alignItems: 'flex-end',
  },
  feeBreakdown: {
    fontFamily: FuttyFonts.sans,
    fontSize: 11,
    color: FuttyColors.stone500,
  },
  addPlayerSection: {
    gap: 8,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: FuttyColors.stone900,
  },
  addPlayerRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addPlayerField: {
    flex: 1,
  },
  hint: {
    fontSize: 11,
    opacity: 0.6,
  },
});
